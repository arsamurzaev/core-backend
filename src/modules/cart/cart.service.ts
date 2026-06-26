import {
	CartCheckoutMethod,
	CartStatus,
	CartTableSessionStatus,
	IntegrationProvider,
	Prisma
} from '@generated/client'
import {
	BadRequestException,
	ForbiddenException,
	Inject,
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit
} from '@nestjs/common'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import type { SessionUser } from '@/modules/auth/types/auth-request'
import {
	CAPABILITY_READER_PORT,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'
import { MediaUrlService } from '@/shared/media/media-url.service'

import { CartCurrentService } from './cart-current.service'
import { CartLifecycleService } from './cart-lifecycle.service'
import { CartLineService } from './cart-line.service'
import { CartLookupService } from './cart-lookup.service'
import { CartManagerSessionService } from './cart-manager-session.service'
import { CartOrderExportService } from './cart-order-export.service'
import { type CartShareInput, CartShareService } from './cart-share.service'
import { type CartSsePayload, CartSseService } from './cart-sse.service'
import { type CartEntity, cartSelect } from './cart.selects'
import {
	CART_COOKIE_NAME,
	CART_GUEST_TOKEN_HEADER,
	mapCartEntity,
	PUBLIC_KEY_BYTES,
	readCartTokenFromCookie,
	type UpsertCartItemInput
} from './cart.utils'
import type { CartCommandPort } from './contracts'
import { OrderCheckoutService } from './order-checkout.service'

const CART_MANAGER_INACTIVITY_MS =
	Number(process.env.CART_MANAGER_INACTIVITY_MS ?? 60_000) || 60_000
const CART_MANAGER_SWEEP_MS =
	Number(process.env.CART_MANAGER_SWEEP_MS ?? 15_000) || 15_000
const CART_DRAFT_TTL_MS =
	Number(process.env.CART_DRAFT_TTL_MS ?? 7 * 24 * 60 * 60 * 1000) ||
	7 * 24 * 60 * 60 * 1000
const CART_DRAFT_SWEEP_MS =
	Number(process.env.CART_DRAFT_SWEEP_MS ?? 60 * 60 * 1000) || 60 * 60 * 1000
const HALL_TABLE_SESSION_TTL_MS =
	Number(process.env.HALL_TABLE_SESSION_TTL_MS ?? 6 * 60 * 60 * 1000) ||
	6 * 60 * 60 * 1000
const HALL_TABLE_GUEST_TOKEN_TTL_MS =
	Number(
		process.env.HALL_TABLE_GUEST_TOKEN_TTL_MS ??
			HALL_TABLE_SESSION_TTL_MS + 60 * 60 * 1000
	) || HALL_TABLE_SESSION_TTL_MS + 60 * 60 * 1000
const HALL_TABLE_SESSION_SWEEP_MS =
	Number(process.env.HALL_TABLE_SESSION_SWEEP_MS ?? 5 * 60 * 1000) ||
	5 * 60 * 1000
const HALL_ORDER_IIKO_EXPORT_WAIT_TIMEOUT_MS =
	Number(process.env.HALL_ORDER_IIKO_EXPORT_WAIT_TIMEOUT_MS ?? 60_000) || 60_000
const HALL_ORDER_IIKO_EXPORT_WAIT_INTERVAL_MS =
	Number(process.env.HALL_ORDER_IIKO_EXPORT_WAIT_INTERVAL_MS ?? 500) || 500
const INTEGRATION_EXTERNAL_ITEM_TYPE_TABLE = 'TABLE'
const CART_GUEST_TOKEN_VERSION = 1
const TERMINAL_CART_STATUSES = new Set<CartStatus>([
	CartStatus.CONVERTED,
	CartStatus.CANCELLED,
	CartStatus.EXPIRED
])

type CartMutationResult = {
	cart: CartEntity
	changed: boolean
	inventoryCacheCatalogIds?: string[]
}

type JoinHallTableSessionInput = {
	guestSessionId?: string | null
	guestToken?: string | null
	guestName?: string | null
	guestsCount?: number | null
}

type HallTableSessionRecord = NonNullable<CartEntity['tableSession']>

type HallTableGuestTokenPayload = {
	v: typeof CART_GUEST_TOKEN_VERSION
	catalogId: string
	cartId: string
	sessionId: string
	tableExternalId: string
	publicCode: string
	guestSessionId: string
	iat: number
	exp: number
	nonce: string
}

type ClosableHallTableSessionStatus = Extract<
	CartTableSessionStatus,
	'CLOSED' | 'CANCELLED'
>

const ACTIVE_HALL_TABLE_SESSION_STATUSES = [
	CartTableSessionStatus.OPEN,
	CartTableSessionStatus.PENDING_CONFIRMATION
] as const

const cartTableSessionSelect = {
	id: true,
	cartId: true,
	status: true,
	publicCode: true,
	tableExternalId: true,
	tableNumber: true,
	tableName: true,
	sectionExternalId: true,
	sectionName: true,
	guestsCount: true,
	externalOrderId: true,
	submittedOrderId: true,
	submittedAt: true,
	closedAt: true,
	createdAt: true,
	updatedAt: true
} satisfies Prisma.CartTableSessionSelect
@Injectable()
export class CartService
	implements CartCommandPort, OnModuleInit, OnModuleDestroy
{
	private readonly logger = new Logger(CartService.name)
	private managerSweepTimer: NodeJS.Timeout | null = null
	private draftSweepTimer: NodeJS.Timeout | null = null
	private hallTableSessionSweepTimer: NodeJS.Timeout | null = null

	constructor(
		private readonly mediaUrl: MediaUrlService,
		private readonly currentCart: CartCurrentService,
		private readonly cartLine: CartLineService,
		private readonly lookup: CartLookupService,
		private readonly lifecycle: CartLifecycleService,
		private readonly managerSession: CartManagerSessionService,
		private readonly share: CartShareService,
		private readonly cartSse: CartSseService,
		private readonly orderCheckout: OrderCheckoutService,
		private readonly orderExport: CartOrderExportService,
		private readonly prisma: PrismaService,
		@Inject(CAPABILITY_READER_PORT)
		private readonly capabilities: CapabilityReaderPort
	) {}

	onModuleInit() {
		this.cartSse.setupRedisSubscriber()

		if (CART_MANAGER_SWEEP_MS > 0) {
			this.managerSweepTimer = setInterval(() => {
				void this.expireInactiveManagerSessions().catch(error => {
					const message =
						error instanceof Error ? (error.stack ?? error.message) : String(error)
					this.logger.error('Cart manager timeout sweep failed', message)
				})
			}, CART_MANAGER_SWEEP_MS)
			this.managerSweepTimer.unref?.()
		}

		if (CART_DRAFT_SWEEP_MS > 0) {
			this.draftSweepTimer = setInterval(() => {
				void this.expireAbandonedDraftCarts().catch(error => {
					const message =
						error instanceof Error ? (error.stack ?? error.message) : String(error)
					this.logger.error('Cart draft TTL sweep failed', message)
				})
			}, CART_DRAFT_SWEEP_MS)
			this.draftSweepTimer.unref?.()
		}

		if (HALL_TABLE_SESSION_SWEEP_MS > 0) {
			this.hallTableSessionSweepTimer = setInterval(() => {
				void this.expireStaleHallTableSessions().catch(error => {
					const message =
						error instanceof Error ? (error.stack ?? error.message) : String(error)
					this.logger.error('Hall table session TTL sweep failed', message)
				})
			}, HALL_TABLE_SESSION_SWEEP_MS)
			this.hallTableSessionSweepTimer.unref?.()
		}
	}

	onModuleDestroy() {
		this.cartSse.shutdown()

		if (this.managerSweepTimer) {
			clearInterval(this.managerSweepTimer)
			this.managerSweepTimer = null
		}
		if (this.draftSweepTimer) {
			clearInterval(this.draftSweepTimer)
			this.draftSweepTimer = null
		}
		if (this.hallTableSessionSweepTimer) {
			clearInterval(this.hallTableSessionSweepTimer)
			this.hallTableSessionSweepTimer = null
		}
	}

	getCookieName() {
		return CART_COOKIE_NAME
	}

	readTokenFromCookie(cookieHeader?: string): string | null {
		return readCartTokenFromCookie(cookieHeader)
	}

	async getOrCreateCurrentCart(catalogId: string, token?: string | null) {
		const result = await this.currentCart.getOrCreate(catalogId, token)
		return {
			cart: await this.mapCart(result.cart),
			isNew: result.isNew,
			token: result.token
		}
	}

	async getCurrentCartOrThrow(catalogId: string, token?: string | null) {
		const result = await this.currentCart.getOrThrow(catalogId, token)
		return { cart: await this.mapCart(result.cart), token: result.token }
	}

	async shareCurrentCart(
		catalogId: string,
		token?: string | null,
		input: CartShareInput | string | null = {}
	) {
		const result = await this.share.shareCurrentCart(catalogId, token, input)
		return { cart: await this.mapCart(result.cart), token: result.token }
	}

	async submitCurrentHallOrder(
		catalogId: string,
		token?: string | null,
		input: CartShareInput | string | null = {}
	) {
		const shareInput: CartShareInput =
			typeof input === 'string' ? { comment: input } : (input ?? {})
		const checkoutData = await this.normalizeHallCheckoutData(
			catalogId,
			shareInput.checkoutData
		)
		const shared = await this.share.shareCurrentCart(catalogId, token, {
			...shareInput,
			checkoutMethod: CartCheckoutMethod.PICKUP,
			checkoutData
		})
		this.ensureCartIsOpen(shared.cart.status)

		if (!shared.cart.items.length) {
			throw new BadRequestException('Нельзя оформить пустую корзину')
		}

		const result = await this.orderCheckout.complete(shared.cart.id, null)
		const exportResult = await this.orderExport.waitForIikoCompletedOrder(
			result.order.catalogId,
			result.order.id,
			{
				timeoutMs: HALL_ORDER_IIKO_EXPORT_WAIT_TIMEOUT_MS,
				intervalMs: HALL_ORDER_IIKO_EXPORT_WAIT_INTERVAL_MS
			}
		)
		if (!exportResult.ok) {
			this.logger.warn('Hall order was completed locally but iiko export failed', {
				orderId: result.order.id,
				exportId: exportResult.exportId,
				status: exportResult.status,
				reason: exportResult.reason,
				error: exportResult.error
			})
			throw new BadRequestException(
				'Произошла ошибка при отправке заказа официантам. Позовите сотрудника или попробуйте еще раз.'
			)
		}

		const freshCart = await this.lookup.findByIdOrThrow(result.cartId)
		await this.broadcastCartStatusChanged(freshCart)

		return { order: result.order, token: shared.token }
	}

	async getHallTableLink(catalogId: string, code: string) {
		const normalizedCode = normalizeText(code)
		if (!normalizedCode) {
			throw new BadRequestException('Не указан код стола')
		}

		const item = await this.findHallIntegrationExternalItemByCode(
			catalogId,
			normalizedCode
		)
		if (!item) {
			throw new BadRequestException(
				'Ссылка на стол iiko недействительна или устарела'
			)
		}

		const data = this.mapHallIntegrationExternalItem(item)
		return {
			code: item.publicCode,
			tableName: normalizeText(data.tableName ?? data.hallTableName),
			tableNumber: normalizeText(data.tableNumber ?? data.hallTableNumber),
			sectionId: normalizeText(data.iikoRestaurantSectionId ?? data.hallSectionId),
			sectionName: normalizeText(
				data.iikoRestaurantSectionName ?? data.hallSectionName
			)
		}
	}

	async listHallTables(catalogId: string) {
		const items = await this.findHallIntegrationExternalItems(catalogId)
		if (!items.length) return []

		const tableExternalIds = items.map(item => item.externalId)
		const sessions = await this.prisma.cartTableSession.findMany({
			where: {
				catalogId,
				provider: IntegrationProvider.IIKO,
				tableExternalId: { in: tableExternalIds },
				status: { in: [...ACTIVE_HALL_TABLE_SESSION_STATUSES] },
				deleteAt: null,
				cart: { deleteAt: null }
			},
			select: {
				...cartTableSessionSelect,
				cart: { select: cartSelect }
			},
			orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
		})

		const sessionsByTableExternalId = new Map<string, (typeof sessions)[number]>()
		for (const session of sessions) {
			if (!sessionsByTableExternalId.has(session.tableExternalId)) {
				sessionsByTableExternalId.set(session.tableExternalId, session)
			}
		}

		const tables: Array<
			Parameters<typeof compareHallTableOverview>[0] & {
				cart: unknown
				itemsCount: number
				publicKey: string | null
				sectionId: string | null
				session: unknown
				tableExternalId: string
				total: number
				updatedAt: Date | string | null
			}
		> = []
		for (const item of items) {
			const tableData = this.mapHallIntegrationExternalItem(item)
			const session = sessionsByTableExternalId.get(item.externalId) ?? null
			const cart = session ? await this.mapCart(session.cart) : null
			const sessionDto = cart?.tableSession ?? null

			tables.push({
				code: item.publicCode,
				tableExternalId: item.externalId,
				tableName: normalizeText(tableData.tableName ?? tableData.hallTableName),
				tableNumber: normalizeTextOrNumber(
					tableData.tableNumber ?? tableData.hallTableNumber
				),
				sectionId: normalizeText(
					tableData.iikoRestaurantSectionId ?? tableData.hallSectionId
				),
				sectionName: normalizeText(
					tableData.iikoRestaurantSectionName ?? tableData.hallSectionName
				),
				publicKey: cart?.publicKey ?? null,
				session: sessionDto,
				cart,
				hasItems: Boolean(cart?.items.length),
				needsConfirmation:
					sessionDto?.status === CartTableSessionStatus.PENDING_CONFIRMATION,
				itemsCount: cart?.totals.itemsCount ?? 0,
				total: cart?.totals.total ?? 0,
				updatedAt: normalizeDateLike(cart?.updatedAt ?? session?.updatedAt)
			})
		}

		return tables.sort(compareHallTableOverview)
	}

	async joinHallTableSession(
		catalogId: string,
		code: string,
		input: JoinHallTableSessionInput = {}
	) {
		const normalizedCode = normalizeText(code)
		if (!normalizedCode) {
			throw new BadRequestException('Не указан код стола')
		}

		const item = await this.findHallIntegrationExternalItemByCode(
			catalogId,
			normalizedCode
		)
		if (!item) {
			throw new BadRequestException(
				'Ссылка на стол iiko недействительна или устарела'
			)
		}

		const tableData = this.mapHallIntegrationExternalItem(item)
		const tableId = normalizeText(tableData.iikoTableId)
		if (!tableId) {
			throw new BadRequestException('Не указан стол iiko для заказа в зале')
		}

		const activeKey = buildHallTableActiveKey(catalogId, tableId)
		const session = await this.getOrCreateHallTableSession({
			activeKey,
			catalogId,
			item,
			tableData,
			input
		})
		const verifiedGuest = this.verifyHallTableGuestTokenOrNull(input.guestToken, {
			catalogId,
			cartId: session.cartId,
			sessionId: session.id,
			tableExternalId: session.tableExternalId,
			publicCode: session.publicCode
		})
		const guestSessionId =
			verifiedGuest?.guestSessionId ?? generateGuestSessionId()
		const guestToken = this.issueHallTableGuestToken({
			catalogId,
			cartId: session.cartId,
			sessionId: session.id,
			tableExternalId: session.tableExternalId,
			publicCode: session.publicCode,
			guestSessionId
		})
		const cart = await this.lookup.findByIdOrThrow(session.cartId)
		const mappedCart = await this.mapCart(cart)
		if (!mappedCart.publicKey || !mappedCart.tableSession) {
			throw new BadRequestException('Корзина не относится к сессии стола')
		}

		return {
			session: mappedCart.tableSession,
			cart: mappedCart,
			publicKey: mappedCart.publicKey,
			guestSessionId,
			guestToken
		}
	}

	async submitPublicHallOrder(
		publicKey: string,
		input: CartShareInput | string | null = {},
		guestToken?: string | null
	) {
		const shareInput: CartShareInput =
			typeof input === 'string' ? { comment: input } : (input ?? {})
		const cart = await this.lookup.findByPublicKeyOrThrow(publicKey)
		const session = cart.tableSession
		if (!session) {
			throw new BadRequestException('Сессия стола не найдена')
		}
		if (session.status === CartTableSessionStatus.PENDING_CONFIRMATION) {
			return { cart: await this.mapCart(cart) }
		}
		if (session.status !== CartTableSessionStatus.OPEN) {
			throw new BadRequestException('Сессия стола не открыта')
		}
		this.ensureCartIsOpen(cart.status)
		this.resolveHallTableGuestSessionId(cart, guestToken)

		if (!cart.items.length) {
			throw new BadRequestException('Нельзя отправить пустую корзину')
		}

		await this.applyHallTableCheckoutInput(cart, session, shareInput)
		await this.prisma.cartTableSession.update({
			where: { id: session.id },
			data: {
				status: CartTableSessionStatus.PENDING_CONFIRMATION
			}
		})

		const requestedCart = await this.lookup.findByIdOrThrow(cart.id)
		await this.broadcastCartStatusChanged(requestedCart)

		return { cart: await this.mapCart(requestedCart) }
	}

	async getPublicCart(publicKey: string) {
		const cart = await this.lookup.findByPublicKeyOrThrow(publicKey)
		return this.mapCart(cart)
	}

	async upsertCurrentItem(
		catalogId: string,
		token: string | null | undefined,
		input: UpsertCartItemInput
	) {
		const current = await this.getOrCreateCurrentCart(catalogId, token)
		const updated = await this.upsertItem(current.cart.id, input)
		const cart = await this.mapCart(updated.cart)
		if (updated.changed) {
			this.broadcastCart(updated.cart.id, 'cart.updated', cart)
		}
		return { cart, token: current.token }
	}

	async removeCurrentItem(
		catalogId: string,
		token: string | null | undefined,
		itemId: string
	) {
		const current = await this.getCurrentCartOrThrow(catalogId, token)
		const updated = await this.removeItem(current.cart.id, itemId)
		const cart = await this.mapCart(updated.cart)
		if (updated.changed) {
			this.broadcastCart(updated.cart.id, 'cart.updated', cart)
		}
		return { cart, token: current.token }
	}

	async deleteCurrentCart(catalogId: string, token: string | null | undefined) {
		const result = await this.lifecycle.deleteCurrentCart(catalogId, token)

		if (result.mode === 'deleted') {
			this.broadcastCart(result.cartId, 'cart.detached', {
				cartId: result.cartId,
				deletedAt: result.deletedAt.toISOString()
			})
		}

		return { mode: result.mode, token: result.token }
	}

	async upsertPublicItem(
		publicKey: string,
		input: UpsertCartItemInput,
		guestToken?: string | null
	) {
		const cart = await this.lookup.findByPublicKeyOrThrow(publicKey)
		this.ensurePublicCartAcceptsMutations(cart)
		const guestSessionId = cart.tableSession
			? this.resolveHallTableGuestSessionId(cart, guestToken)
			: null
		const updated = await this.upsertItem(
			cart.id,
			guestSessionId ? { ...input, guestSessionId } : input
		)
		const mappedCart = await this.mapCart(updated.cart)
		if (updated.changed) {
			this.broadcastCart(updated.cart.id, 'cart.updated', mappedCart)
		}
		return mappedCart
	}

	async removePublicItem(
		publicKey: string,
		itemId: string,
		guestToken?: string | null
	) {
		const cart = await this.lookup.findByPublicKeyOrThrow(publicKey)
		this.ensurePublicCartAcceptsMutations(cart)
		const guestSessionId = cart.tableSession
			? this.resolveHallTableGuestSessionId(cart, guestToken)
			: null
		const updated = await this.removeItem(
			cart.id,
			itemId,
			guestSessionId ? { guestSessionId } : undefined
		)
		const mappedCart = await this.mapCart(updated.cart)
		if (updated.changed) {
			this.broadcastCart(updated.cart.id, 'cart.updated', mappedCart)
		}
		return mappedCart
	}

	async beginManagerSession(publicKey: string, user: SessionUser) {
		const result = await this.managerSession.begin(publicKey, user)
		const cart = await this.mapCart(result.cart)
		if (result.statusChanged) {
			this.broadcastCart(result.cart.id, 'cart.status_changed', cart)
		}

		return cart
	}

	async heartbeatManagerSession(publicKey: string, user: SessionUser) {
		const result = await this.managerSession.heartbeat(publicKey, user)
		const cart = await this.mapCart(result.cart)
		if (result.statusChanged) {
			this.broadcastCart(result.cart.id, 'cart.status_changed', cart)
		}

		return cart
	}

	async releaseManagerSession(publicKey: string, user: SessionUser) {
		const result = await this.managerSession.release(publicKey, user)
		const cart = await this.mapCart(result.cart)
		if (result.statusChanged) {
			this.broadcastCart(result.cart.id, 'cart.status_changed', cart)
		}

		return cart
	}

	async completeManagerOrder(
		publicKey: string,
		user: SessionUser,
		input: CartShareInput | string | null = {}
	) {
		const shareInput: CartShareInput =
			typeof input === 'string' ? { comment: input } : (input ?? {})
		const cart = await this.managerSession.findManageableCartByPublicKeyOrThrow(
			publicKey,
			user
		)
		if (cart.tableSession) {
			return this.completeHallTableCart(cart, user, shareInput)
		}

		this.ensureCartIsOpen(cart.status)

		if (!cart.items.length) {
			throw new BadRequestException('Нельзя оформить пустую корзину')
		}

		await this.applyManagerCheckoutInput(cart, shareInput)

		const result = await this.orderCheckout.complete(cart.id, user.id)
		const freshCart = await this.lookup.findByIdOrThrow(result.cartId)
		await this.broadcastCartStatusChanged(freshCart)

		return { order: result.order }
	}

	async confirmHallTableOrder(
		publicKey: string,
		user: SessionUser,
		input: CartShareInput | string | null = {}
	) {
		const shareInput: CartShareInput =
			typeof input === 'string' ? { comment: input } : (input ?? {})
		const cart = await this.managerSession.findManageableCartByPublicKeyOrThrow(
			publicKey,
			user
		)

		return this.completeHallTableCart(cart, user, shareInput)
	}

	private async completeHallTableCart(
		cart: CartEntity,
		user: SessionUser,
		shareInput: CartShareInput
	) {
		const session = cart.tableSession
		if (!session) {
			throw new BadRequestException('Сессия стола не найдена')
		}
		if (!this.isActiveHallTableSessionStatus(session.status)) {
			throw new BadRequestException('Сессия стола не активна')
		}
		this.ensureCartIsOpen(cart.status)

		if (!cart.items.length) {
			throw new BadRequestException('Нельзя оформить пустую корзину')
		}

		await this.applyHallTableCheckoutInput(cart, session, shareInput)

		const result = await this.orderCheckout.complete(cart.id, user.id)
		const submittedAt = new Date()
		await this.prisma.cartTableSession.update({
			where: { id: session.id },
			data: {
				status: CartTableSessionStatus.SUBMITTED,
				submittedOrderId: result.order.id,
				submittedAt,
				activeKey: null
			}
		})
		const submittedCart = await this.lookup.findByIdOrThrow(result.cartId)
		await this.broadcastCartStatusChanged(submittedCart)

		const exportResult = await this.orderExport.waitForIikoCompletedOrder(
			result.order.catalogId,
			result.order.id,
			{
				timeoutMs: HALL_ORDER_IIKO_EXPORT_WAIT_TIMEOUT_MS,
				intervalMs: HALL_ORDER_IIKO_EXPORT_WAIT_INTERVAL_MS
			}
		)
		const exportRecord = await this.prisma.integrationOrderExport.findFirst({
			where: {
				orderId: result.order.id,
				provider: IntegrationProvider.IIKO
			},
			select: {
				externalId: true,
				response: true
			}
		})

		if (!exportResult.ok) {
			await this.prisma.cartTableSession.update({
				where: { id: session.id },
				data: {
					status: CartTableSessionStatus.EXPORT_ERROR,
					submittedOrderId: result.order.id,
					submittedAt,
					activeKey: null,
					externalOrderId: exportRecord?.externalId ?? null,
					externalCorrelationId: resolveIikoCorrelationId(exportRecord?.response)
				}
			})
			this.logger.warn('Hall table session export failed', {
				orderId: result.order.id,
				sessionId: session.id,
				exportId: exportResult.exportId,
				status: exportResult.status,
				reason: exportResult.reason,
				error: exportResult.error
			})
			const freshCart = await this.lookup.findByIdOrThrow(result.cartId)
			await this.broadcastCartStatusChanged(freshCart)
			throw new BadRequestException(
				'Произошла ошибка при отправке заказа официантам. Позовите сотрудника или попробуйте еще раз.'
			)
		}

		await this.prisma.cartTableSession.update({
			where: { id: session.id },
			data: {
				status: CartTableSessionStatus.SUBMITTED,
				submittedOrderId: result.order.id,
				submittedAt,
				activeKey: null,
				externalOrderId: exportRecord?.externalId ?? null,
				externalCorrelationId: resolveIikoCorrelationId(exportRecord?.response)
			}
		})

		const freshCart = await this.lookup.findByIdOrThrow(result.cartId)
		await this.broadcastCartStatusChanged(freshCart)

		return { order: result.order }
	}

	async closeHallTableSession(publicKey: string, user: SessionUser) {
		return this.finishOpenHallTableSession(
			publicKey,
			user,
			CartTableSessionStatus.CLOSED
		)
	}

	async resetHallTableSession(publicKey: string, user: SessionUser) {
		return this.finishOpenHallTableSession(
			publicKey,
			user,
			CartTableSessionStatus.CANCELLED
		)
	}

	private async finishOpenHallTableSession(
		publicKey: string,
		user: SessionUser,
		status: ClosableHallTableSessionStatus
	) {
		const cart = await this.managerSession.findManageableCartByPublicKeyOrThrow(
			publicKey,
			user
		)
		this.ensureHallTableSessionActive(cart)
		this.ensureCartIsOpen(cart.status)

		const result = await this.lifecycle.closeHallTableSession(
			cart,
			status,
			user.id
		)
		await this.broadcastCartStatusChanged(result.cart)

		return this.mapCart(result.cart)
	}

	private async getOrCreateHallTableSession(params: {
		activeKey: string
		catalogId: string
		item: {
			id: string
			integrationId: string
			externalId: string
			externalParentId: string | null
			name: string | null
			code: string | null
			publicCode: string
			rawMeta: unknown
		}
		tableData: Record<string, unknown>
		input: JoinHallTableSessionInput
	}): Promise<HallTableSessionRecord> {
		const existing = await this.findActiveHallTableSession(params.activeKey)
		if (existing) {
			if (existing.status === CartTableSessionStatus.OPEN) {
				await this.updateHallTableSessionGuests(existing.id, params.input)
			}
			return existing
		}

		try {
			return await this.createHallTableSession(params)
		} catch (error) {
			if (isUniqueConstraintError(error)) {
				const raced = await this.findActiveHallTableSession(params.activeKey)
				if (raced) return raced
			}
			throw error
		}
	}

	private async findActiveHallTableSession(
		activeKey: string
	): Promise<HallTableSessionRecord | null> {
		const session = await this.prisma.cartTableSession.findFirst({
			where: {
				activeKey,
				status: { in: [...ACTIVE_HALL_TABLE_SESSION_STATUSES] },
				deleteAt: null,
				cart: { deleteAt: null }
			},
			select: cartTableSessionSelect
		})

		return session
	}

	private async createHallTableSession(params: {
		activeKey: string
		catalogId: string
		item: {
			id: string
			integrationId: string
			externalId: string
			externalParentId: string | null
			name: string | null
			code: string | null
			publicCode: string
			rawMeta: unknown
		}
		tableData: Record<string, unknown>
		input: JoinHallTableSessionInput
	}): Promise<HallTableSessionRecord> {
		const publicKey = await this.generateUniquePublicKey()
		const guestsCount = normalizePositiveInt(params.input.guestsCount)
		const checkoutData = {
			...params.tableData,
			...(guestsCount ? { guestsCount, personsCount: guestsCount } : {})
		}
		const checkout = await this.share.resolveCheckoutSnapshot(params.catalogId, {
			checkoutMethod: CartCheckoutMethod.PICKUP,
			checkoutData
		})

		const created = await this.prisma.$transaction(async tx => {
			const cart = await tx.cart.create({
				data: {
					catalogId: params.catalogId,
					status: CartStatus.SHARED,
					statusChangedAt: new Date(),
					publicKey,
					checkoutMethod: checkout.checkoutMethod,
					checkoutData: checkout.checkoutData,
					checkoutContacts: checkout.checkoutContacts
				},
				select: { id: true }
			})

			return tx.cartTableSession.create({
				data: {
					catalogId: params.catalogId,
					integrationId: params.item.integrationId,
					cartId: cart.id,
					externalTableItemId: params.item.id,
					provider: IntegrationProvider.IIKO,
					status: CartTableSessionStatus.OPEN,
					activeKey: params.activeKey,
					publicCode: params.item.publicCode,
					tableExternalId: params.item.externalId,
					tableNumber: normalizeTextOrNumber(
						params.tableData.tableNumber ?? params.tableData.hallTableNumber
					),
					tableName: normalizeText(
						params.tableData.tableName ?? params.tableData.hallTableName
					),
					sectionExternalId: normalizeText(
						params.tableData.iikoRestaurantSectionId ?? params.tableData.hallSectionId
					),
					sectionName: normalizeText(
						params.tableData.iikoRestaurantSectionName ??
							params.tableData.hallSectionName
					),
					guestsCount,
					metadata: params.tableData as Prisma.InputJsonValue
				},
				select: cartTableSessionSelect
			})
		})

		return created
	}

	private async updateHallTableSessionGuests(
		sessionId: string,
		input: JoinHallTableSessionInput
	) {
		const guestsCount = normalizePositiveInt(input.guestsCount)
		if (!guestsCount) return

		await this.prisma.cartTableSession.update({
			where: { id: sessionId },
			data: { guestsCount }
		})
	}

	private async applyHallTableCheckoutInput(
		cart: CartEntity,
		session: HallTableSessionRecord,
		input: CartShareInput
	) {
		const baseData = {
			orderMode: 'HALL',
			catalogMode: 'HALL',
			iikoTableId: session.tableExternalId,
			hallTableId: session.tableExternalId,
			tableId: session.tableExternalId,
			integrationExternalItemCode: session.publicCode,
			hallTableCode: session.publicCode,
			tableCode: session.publicCode,
			t: session.publicCode,
			...(session.tableNumber
				? {
						table: session.tableNumber,
						tableNumber: session.tableNumber,
						hallTableNumber: session.tableNumber
					}
				: {}),
			...(session.tableName
				? {
						tableName: session.tableName,
						hallTableName: session.tableName
					}
				: {}),
			...(session.sectionExternalId
				? {
						iikoRestaurantSectionId: session.sectionExternalId,
						hallSectionId: session.sectionExternalId
					}
				: {}),
			...(session.sectionName
				? {
						iikoRestaurantSectionName: session.sectionName,
						hallSectionName: session.sectionName
					}
				: {}),
			...(session.guestsCount
				? {
						guestsCount: session.guestsCount,
						personsCount: session.guestsCount
					}
				: {})
		}
		const checkoutData = await this.normalizeHallCheckoutData(
			cart.catalogId,
			mergeCheckoutData(
				mergeCheckoutData(cart.checkoutData, baseData),
				input.checkoutData
			)
		)
		const checkout = await this.share.resolveCheckoutSnapshot(cart.catalogId, {
			checkoutData,
			checkoutMethod: CartCheckoutMethod.PICKUP
		})
		const comment = normalizeCartComment(input.comment)

		await this.prisma.cart.update({
			where: { id: cart.id },
			data: {
				...(input.comment !== undefined ? { comment } : {}),
				checkoutMethod: checkout.checkoutMethod,
				checkoutData: checkout.checkoutData,
				checkoutContacts: checkout.checkoutContacts
			}
		})
	}

	private async generateUniquePublicKey() {
		for (;;) {
			const candidate = randomBytes(PUBLIC_KEY_BYTES).toString('base64url')
			const exists = await this.prisma.cart.findFirst({
				where: { publicKey: candidate },
				select: { id: true }
			})
			if (!exists) return candidate
		}
	}

	private async applyManagerCheckoutInput(
		cart: CartEntity,
		input: CartShareInput
	) {
		const data: Prisma.CartUpdateInput = {}
		const hasCheckoutUpdate =
			input.checkoutData !== undefined || input.checkoutMethod !== undefined
		const comment = normalizeCartComment(input.comment)

		if (input.comment !== undefined && comment !== cart.comment) {
			data.comment = comment
		}

		if (hasCheckoutUpdate) {
			const checkoutData =
				input.checkoutData !== undefined
					? mergeCheckoutData(cart.checkoutData, input.checkoutData)
					: cart.checkoutData
			const checkout = await this.share.resolveCheckoutSnapshot(cart.catalogId, {
				checkoutData,
				checkoutMethod: input.checkoutMethod ?? cart.checkoutMethod ?? undefined
			})

			data.checkoutMethod = checkout.checkoutMethod
			data.checkoutData = checkout.checkoutData
			data.checkoutContacts = checkout.checkoutContacts
		}

		if (Object.keys(data).length === 0) return

		await this.prisma.cart.update({
			where: { id: cart.id },
			data
		})
	}

	async connectCurrentSse(
		catalogId: string,
		token?: string | null,
		lastEventId?: string | null
	) {
		const current = await this.getCurrentCartOrThrow(catalogId, token)
		return this.cartSse.connect(
			current.cart.id,
			async () => {
				const fresh = await this.lookup.findByIdOrThrow(current.cart.id)
				return this.mapCart(fresh)
			},
			lastEventId
		)
	}

	async connectPublicSse(publicKey: string, lastEventId?: string | null) {
		const cart = await this.lookup.findByPublicKeyOrThrow(publicKey)
		return this.cartSse.connect(
			cart.id,
			() => this.getPublicCart(publicKey),
			lastEventId
		)
	}

	private async upsertItem(
		cartId: string,
		input: UpsertCartItemInput
	): Promise<CartMutationResult> {
		const result = await this.cartLine.upsertItem(cartId, input)
		return {
			cart: await this.lookup.findByIdOrThrow(result.cartId),
			changed: result.changed,
			inventoryCacheCatalogIds: result.inventoryCacheCatalogIds
		}
	}

	private async removeItem(
		cartId: string,
		itemId: string,
		options?: { guestSessionId?: string | null }
	): Promise<CartMutationResult> {
		const result = await this.cartLine.removeItem(cartId, itemId, options)
		return {
			cart: await this.lookup.findByIdOrThrow(result.cartId),
			changed: result.changed,
			inventoryCacheCatalogIds: result.inventoryCacheCatalogIds
		}
	}

	private broadcastCart(cartId: string, type: string, payload: CartSsePayload) {
		this.cartSse.broadcast(cartId, type, payload)
	}

	private async broadcastCartStatusChanged(cart: CartEntity) {
		const payload = await this.mapCart(cart)
		this.broadcastCart(cart.id, 'cart.status_changed', payload)
	}

	private async mapCart(cart: CartEntity) {
		const features = await this.capabilities.getCurrentFeatures(cart.catalogId)
		return mapCartEntity(cart, media => this.mediaUrl.mapMedia(media), {
			canUseProductVariants: features.canUseProductVariants,
			canUseCatalogSaleUnits: features.canUseCatalogSaleUnits,
			canUseCatalogModifiers: features.canUseCatalogModifiers
		})
	}

	private ensureCartIsOpen(status: CartStatus) {
		if (!TERMINAL_CART_STATUSES.has(status)) return
		throw new BadRequestException('Корзина уже закрыта')
	}

	private ensurePublicCartAcceptsMutations(cart: CartEntity) {
		this.ensureCartIsOpen(cart.status)
		if (!cart.tableSession) return
		this.ensureHallTableSessionOpen(cart)
	}

	private resolveHallTableGuestSessionId(
		cart: CartEntity,
		guestToken?: string | null
	): string {
		const session = cart.tableSession
		if (!session) {
			throw new BadRequestException('Сессия стола не найдена')
		}

		const payload = this.verifyHallTableGuestTokenOrNull(guestToken, {
			catalogId: cart.catalogId,
			cartId: cart.id,
			sessionId: session.id,
			tableExternalId: session.tableExternalId,
			publicCode: session.publicCode
		})

		if (!payload) {
			throw new ForbiddenException(
				`Заголовок ${CART_GUEST_TOKEN_HEADER} обязателен для действий гостя за столом`
			)
		}

		return payload.guestSessionId
	}

	private issueHallTableGuestToken(params: {
		catalogId: string
		cartId: string
		sessionId: string
		tableExternalId: string
		publicCode: string
		guestSessionId: string
	}): string {
		const now = Date.now()
		const payload: HallTableGuestTokenPayload = {
			v: CART_GUEST_TOKEN_VERSION,
			catalogId: params.catalogId,
			cartId: params.cartId,
			sessionId: params.sessionId,
			tableExternalId: params.tableExternalId,
			publicCode: params.publicCode,
			guestSessionId: params.guestSessionId,
			iat: now,
			exp: now + HALL_TABLE_GUEST_TOKEN_TTL_MS,
			nonce: randomBytes(8).toString('hex')
		}
		const encodedPayload = encodeBase64UrlJson(payload)
		return `${encodedPayload}.${signCartGuestTokenPayload(encodedPayload)}`
	}

	private verifyHallTableGuestTokenOrNull(
		guestToken: string | null | undefined,
		expected: {
			catalogId: string
			cartId: string
			sessionId: string
			tableExternalId: string
			publicCode: string
		}
	): HallTableGuestTokenPayload | null {
		const normalized = normalizeText(guestToken)
		if (!normalized) return null

		const [encodedPayload, signature, ...extra] = normalized.split('.')
		if (!encodedPayload || !signature || extra.length) return null
		if (!safeEqualText(signCartGuestTokenPayload(encodedPayload), signature)) {
			return null
		}

		const payload = decodeBase64UrlJson(encodedPayload)
		if (!isHallTableGuestTokenPayload(payload)) return null
		if (payload.exp < Date.now()) return null
		if (payload.catalogId !== expected.catalogId) return null
		if (payload.cartId !== expected.cartId) return null
		if (payload.sessionId !== expected.sessionId) return null
		if (payload.tableExternalId !== expected.tableExternalId) return null
		if (payload.publicCode !== expected.publicCode) return null

		return payload
	}

	private ensureHallTableSessionActive(cart: CartEntity) {
		if (!cart.tableSession) {
			throw new BadRequestException('Сессия стола не найдена')
		}
		if (!this.isActiveHallTableSessionStatus(cart.tableSession.status)) {
			throw new BadRequestException('Сессия стола не активна')
		}
	}

	private ensureHallTableSessionOpen(cart: CartEntity) {
		if (!cart.tableSession) {
			throw new BadRequestException('Сессия стола не найдена')
		}
		if (cart.tableSession.status !== CartTableSessionStatus.OPEN) {
			throw new BadRequestException('Сессия стола не открыта')
		}
	}

	private isActiveHallTableSessionStatus(status: CartTableSessionStatus) {
		return ACTIVE_HALL_TABLE_SESSION_STATUSES.some(active => active === status)
	}

	private async normalizeHallCheckoutData(
		catalogId: string,
		value: unknown
	): Promise<Record<string, unknown>> {
		const data = isRecord(value) ? value : {}
		const itemCode = normalizeText(
			data.integrationExternalItemCode ??
				data.hallTableCode ??
				data.tableCode ??
				data.t
		)
		const itemData = itemCode
			? await this.resolveHallIntegrationExternalItemCode(catalogId, itemCode)
			: {}
		const mergedData: Record<string, unknown> = {
			...data,
			...itemData,
			...(itemCode
				? {
						integrationExternalItemCode: itemCode,
						hallTableCode: itemCode,
						tableCode: itemCode,
						t: itemCode
					}
				: {})
		}
		const tableId = normalizeText(
			mergedData.iikoTableId ?? mergedData.hallTableId ?? mergedData.tableId
		)
		if (!tableId) {
			throw new BadRequestException('Не указан стол iiko для заказа в зале')
		}

		return {
			...mergedData,
			orderMode: 'HALL',
			iikoTableId: tableId,
			hallTableId: normalizeText(mergedData.hallTableId) ?? tableId
		}
	}

	private async resolveHallIntegrationExternalItemCode(
		catalogId: string,
		code: string
	): Promise<Record<string, unknown>> {
		const item = await this.findHallIntegrationExternalItemByCode(catalogId, code)
		if (!item) {
			throw new BadRequestException(
				'Ссылка на стол iiko недействительна или устарела'
			)
		}

		return this.mapHallIntegrationExternalItem(item)
	}

	private findHallIntegrationExternalItems(catalogId: string) {
		return this.prisma.integrationExternalItem.findMany({
			where: {
				catalogId,
				provider: IntegrationProvider.IIKO,
				type: INTEGRATION_EXTERNAL_ITEM_TYPE_TABLE,
				isActive: true,
				integration: {
					isActive: true,
					deleteAt: null
				}
			},
			select: {
				id: true,
				integrationId: true,
				externalId: true,
				externalParentId: true,
				name: true,
				code: true,
				publicCode: true,
				rawMeta: true
			},
			orderBy: [{ name: 'asc' }, { code: 'asc' }]
		})
	}

	private findHallIntegrationExternalItemByCode(
		catalogId: string,
		code: string
	) {
		return this.prisma.integrationExternalItem.findFirst({
			where: {
				catalogId,
				provider: IntegrationProvider.IIKO,
				type: INTEGRATION_EXTERNAL_ITEM_TYPE_TABLE,
				publicCode: code,
				isActive: true,
				integration: {
					isActive: true,
					deleteAt: null
				}
			},
			select: {
				id: true,
				integrationId: true,
				externalId: true,
				externalParentId: true,
				name: true,
				code: true,
				publicCode: true,
				rawMeta: true
			}
		})
	}

	private mapHallIntegrationExternalItem(item: {
		externalId: string
		externalParentId: string | null
		name: string | null
		code: string | null
		publicCode: string
		rawMeta: unknown
	}): Record<string, unknown> {
		const rawMeta = isRecord(item.rawMeta) ? item.rawMeta : {}
		const tableNumber =
			normalizeTextOrNumber(rawMeta.iikoTableNumber) ??
			normalizeTextOrNumber(rawMeta.displayTableNumber) ??
			normalizeTextOrNumber(rawMeta.tableNumber) ??
			normalizeText(item.code)
		const tableName = normalizeText(rawMeta.tableName) ?? normalizeText(item.name)
		const sectionId =
			normalizeText(rawMeta.restaurantSectionId) ??
			normalizeText(item.externalParentId)
		const sectionName = normalizeText(rawMeta.restaurantSectionName)

		return {
			iikoTableId: item.externalId,
			hallTableId: item.externalId,
			tableId: item.externalId,
			integrationExternalItemCode: item.publicCode,
			hallTableCode: item.publicCode,
			tableCode: item.publicCode,
			t: item.publicCode,
			...(tableNumber
				? {
						table: tableNumber,
						tableNumber,
						hallTableNumber: tableNumber
					}
				: {}),
			...(tableName
				? {
						tableName,
						hallTableName: tableName
					}
				: {}),
			...(sectionId
				? {
						iikoRestaurantSectionId: sectionId,
						hallSectionId: sectionId
					}
				: {}),
			...(sectionName
				? {
						iikoRestaurantSectionName: sectionName,
						hallSectionName: sectionName
					}
				: {})
		}
	}

	private async expireInactiveManagerSessions() {
		const result = await this.lifecycle.expireInactiveManagerSessions(
			CART_MANAGER_INACTIVITY_MS
		)

		for (const cart of result.pausedCarts) {
			await this.broadcastCartStatusChanged(cart)
		}
	}

	private async expireAbandonedDraftCarts() {
		const result =
			await this.lifecycle.expireAbandonedDraftCarts(CART_DRAFT_TTL_MS)

		if (!result.expiredCount) return

		this.logger.log(
			`Cart draft TTL sweep: expired ${result.expiredCount} abandoned cart(s)`
		)
	}

	private async expireStaleHallTableSessions() {
		const result = await this.lifecycle.expireStaleHallTableSessions(
			HALL_TABLE_SESSION_TTL_MS
		)

		if (!result.expiredCount) return

		for (const cart of result.expiredCarts) {
			await this.broadcastCartStatusChanged(cart)
		}

		this.logger.log(
			`Hall table session TTL sweep: expired ${result.expiredCount} stale session(s)`
		)
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function encodeBase64UrlJson(value: unknown): string {
	return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeBase64UrlJson(value: string): unknown {
	try {
		return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
	} catch {
		return null
	}
}

function signCartGuestTokenPayload(encodedPayload: string): string {
	return createHmac('sha256', requireCartGuestTokenSecret())
		.update(encodedPayload)
		.digest('base64url')
}

function requireCartGuestTokenSecret(): string {
	const secret =
		process.env.CART_GUEST_TOKEN_SECRET?.trim() ||
		process.env.INTEGRATION_ENCRYPTION_KEY?.trim()
	if (secret) return secret
	throw new Error(
		'CART_GUEST_TOKEN_SECRET or INTEGRATION_ENCRYPTION_KEY is required for guest cart tokens'
	)
}

function safeEqualText(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left)
	const rightBuffer = Buffer.from(right)
	if (leftBuffer.length !== rightBuffer.length) return false
	return timingSafeEqual(leftBuffer, rightBuffer)
}

function isHallTableGuestTokenPayload(
	value: unknown
): value is HallTableGuestTokenPayload {
	if (!isRecord(value)) return false
	return (
		value.v === CART_GUEST_TOKEN_VERSION &&
		typeof value.catalogId === 'string' &&
		typeof value.cartId === 'string' &&
		typeof value.sessionId === 'string' &&
		typeof value.tableExternalId === 'string' &&
		typeof value.publicCode === 'string' &&
		typeof value.guestSessionId === 'string' &&
		typeof value.iat === 'number' &&
		typeof value.exp === 'number' &&
		typeof value.nonce === 'string'
	)
}

function normalizeText(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized || null
}

function normalizeTextOrNumber(value: unknown): string | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return String(value)
	}

	return normalizeText(value)
}

function normalizeDateLike(value: unknown): Date | string | null {
	if (value instanceof Date || typeof value === 'string') return value
	return null
}

function normalizePositiveInt(value: unknown): number | null {
	const parsed =
		typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number(value.trim())
				: Number.NaN
	if (!Number.isInteger(parsed) || parsed < 1) return null
	return Math.min(parsed, 999)
}

function compareHallTableOverview(
	left: {
		needsConfirmation: boolean
		hasItems: boolean
		sectionName: string | null
		tableNumber: string | null
		tableName: string | null
		code: string
	},
	right: {
		needsConfirmation: boolean
		hasItems: boolean
		sectionName: string | null
		tableNumber: string | null
		tableName: string | null
		code: string
	}
) {
	const priority =
		Number(right.needsConfirmation) - Number(left.needsConfirmation) ||
		Number(right.hasItems) - Number(left.hasItems)
	if (priority !== 0) return priority

	return (
		[
			compareNullableText(left.sectionName, right.sectionName),
			compareTableNumber(left.tableNumber, right.tableNumber),
			compareNullableText(left.tableName, right.tableName),
			left.code.localeCompare(right.code)
		].find(value => value !== 0) ?? 0
	)
}

function compareNullableText(left: string | null, right: string | null) {
	return (left ?? '').localeCompare(right ?? '')
}

function compareTableNumber(left: string | null, right: string | null) {
	const leftNumber = left ? Number(left) : Number.NaN
	const rightNumber = right ? Number(right) : Number.NaN
	if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
		return leftNumber - rightNumber
	}
	return compareNullableText(left, right)
}

function normalizeCartComment(comment?: string | null): string | null {
	const normalized = comment?.trim()
	return normalized ? normalized : null
}

function mergeCheckoutData(existing: unknown, incoming: unknown): unknown {
	if (incoming === undefined) return existing
	if (!isRecord(incoming)) return incoming
	return {
		...(isRecord(existing) ? existing : {}),
		...incoming
	}
}

function buildHallTableActiveKey(catalogId: string, tableExternalId: string) {
	return `${catalogId}:${IntegrationProvider.IIKO}:${tableExternalId}`.slice(
		0,
		255
	)
}

function isUniqueConstraintError(error: unknown): boolean {
	return (
		error instanceof Prisma.PrismaClientKnownRequestError &&
		error.code === 'P2002'
	)
}

function resolveIikoCorrelationId(response: unknown): string | null {
	if (!isRecord(response)) return null
	return normalizeText(response.correlationId)
}

function generateGuestSessionId(): string {
	return `guest-${randomBytes(8).toString('hex')}`
}

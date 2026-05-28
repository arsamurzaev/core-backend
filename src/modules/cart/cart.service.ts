import {
	CartCheckoutMethod,
	CartStatus,
	IntegrationProvider,
	Prisma
} from '@generated/client'
import {
	BadRequestException,
	Inject,
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit
} from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import type { SessionUser } from '@/modules/auth/types/auth-request'
import {
	CAPABILITY_READER_PORT,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'
import {
	INTEGRATION_EXTERNAL_ITEM_TYPE_TABLE
} from '@/modules/integration/public'
import { MediaUrlService } from '@/shared/media/media-url.service'

import { CartCurrentService } from './cart-current.service'
import { CartLifecycleService } from './cart-lifecycle.service'
import { CartLineService } from './cart-line.service'
import { CartLookupService } from './cart-lookup.service'
import { CartManagerSessionService } from './cart-manager-session.service'
import { CartOrderExportService } from './cart-order-export.service'
import { type CartShareInput, CartShareService } from './cart-share.service'
import { type CartSsePayload, CartSseService } from './cart-sse.service'
import type { CartEntity } from './cart.selects'
import {
	CART_COOKIE_NAME,
	mapCartEntity,
	readCartTokenFromCookie,
	type UpsertCartItemInput
} from './cart.utils'
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
const HALL_ORDER_IIKO_EXPORT_WAIT_TIMEOUT_MS =
	Number(process.env.HALL_ORDER_IIKO_EXPORT_WAIT_TIMEOUT_MS ?? 60_000) || 60_000
const HALL_ORDER_IIKO_EXPORT_WAIT_INTERVAL_MS =
	Number(process.env.HALL_ORDER_IIKO_EXPORT_WAIT_INTERVAL_MS ?? 500) || 500
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
@Injectable()
export class CartService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(CartService.name)
	private managerSweepTimer: NodeJS.Timeout | null = null
	private draftSweepTimer: NodeJS.Timeout | null = null

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
			throw new BadRequestException('hall table code is required')
		}

		const item = await this.findHallIntegrationExternalItemByCode(
			catalogId,
			normalizedCode
		)
		if (!item) {
			throw new BadRequestException('iiko table link is invalid or expired')
		}

		const data = this.mapHallIntegrationExternalItem(item)
		return {
			code: item.publicCode,
			tableName: normalizeText(data.tableName ?? data.hallTableName),
			tableNumber: normalizeText(data.tableNumber ?? data.hallTableNumber),
			sectionId: normalizeText(
				data.iikoRestaurantSectionId ?? data.hallSectionId
			),
			sectionName: normalizeText(
				data.iikoRestaurantSectionName ?? data.hallSectionName
			)
		}
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

	async upsertPublicItem(publicKey: string, input: UpsertCartItemInput) {
		const cart = await this.lookup.findByPublicKeyOrThrow(publicKey)
		const updated = await this.upsertItem(cart.id, input)
		const mappedCart = await this.mapCart(updated.cart)
		if (updated.changed) {
			this.broadcastCart(updated.cart.id, 'cart.updated', mappedCart)
		}
		return mappedCart
	}

	async removePublicItem(publicKey: string, itemId: string) {
		const cart = await this.lookup.findByPublicKeyOrThrow(publicKey)
		const updated = await this.removeItem(cart.id, itemId)
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
			data.checkoutData = checkout.checkoutData as Prisma.InputJsonValue
			data.checkoutContacts = checkout.checkoutContacts as Prisma.InputJsonValue
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
		itemId: string
	): Promise<CartMutationResult> {
		const result = await this.cartLine.removeItem(cartId, itemId)
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
			canUseCatalogSaleUnits: features.canUseCatalogSaleUnits
		})
	}

	private ensureCartIsOpen(status: CartStatus) {
		if (!TERMINAL_CART_STATUSES.has(status)) return
		throw new BadRequestException('Корзина уже закрыта')
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
			throw new BadRequestException('iiko table id is required for hall order')
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
			throw new BadRequestException('iiko table link is invalid or expired')
		}

		return this.mapHallIntegrationExternalItem(item)
	}

	private findHallIntegrationExternalItemByCode(catalogId: string, code: string) {
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
		const tableName =
			normalizeText(rawMeta.tableName) ??
			normalizeText(item.name)
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
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function normalizeCartComment(comment?: string | null): string | null {
	const normalized = comment?.trim()
	return normalized ? normalized : null
}

function mergeCheckoutData(
	existing: unknown,
	incoming: unknown
): Record<string, unknown> | unknown {
	if (!isRecord(incoming)) return incoming
	return {
		...(isRecord(existing) ? existing : {}),
		...incoming
	}
}

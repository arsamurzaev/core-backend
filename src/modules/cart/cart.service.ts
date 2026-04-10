import { CartStatus, OrderStatus, type Prisma, Role } from '@generated/client'
import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	MessageEvent,
	NotFoundException,
	OnModuleDestroy,
	OnModuleInit,
	UnauthorizedException
} from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { Observable, Subject } from 'rxjs'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import type { SessionUser } from '@/modules/auth/types/auth-request'

import {
	CART_COOKIE_NAME,
	CART_SSE_HEARTBEAT_MS,
	CART_TOKEN_BYTES,
	CHECKOUT_KEY_BYTES,
	mapCartEntity,
	normalizeCartItemInput,
	type NormalizedCartItemInput,
	PUBLIC_KEY_BYTES,
	readCartTokenFromCookie,
	type UpsertCartItemInput
} from './cart.utils'

type SsePayload = string | Record<string, unknown>

const CART_MANAGER_INACTIVITY_MS =
	Number(process.env.CART_MANAGER_INACTIVITY_MS ?? 60_000) || 60_000
const CART_MANAGER_SWEEP_MS =
	Number(process.env.CART_MANAGER_SWEEP_MS ?? 15_000) || 15_000
const CURRENT_CART_VISIBLE_STATUSES = [
	CartStatus.DRAFT,
	CartStatus.SHARED,
	CartStatus.IN_PROGRESS
] as const
const TERMINAL_CART_STATUSES = new Set<CartStatus>([
	CartStatus.CONVERTED,
	CartStatus.CANCELLED,
	CartStatus.EXPIRED
])

const cartSelect = {
	id: true,
	catalogId: true,
	token: true,
	status: true,
	statusChangedAt: true,
	publicKey: true,
	checkoutKey: true,
	checkoutAt: true,
	assignedManagerId: true,
	managerSessionStartedAt: true,
	managerLastSeenAt: true,
	closedAt: true,
	createdAt: true,
	updatedAt: true,
	items: {
		where: { deleteAt: null },
		select: {
			id: true,
			productId: true,
			variantId: true,
			quantity: true,
			createdAt: true,
			updatedAt: true,
			product: {
				select: {
					id: true,
					name: true,
					slug: true,
					price: true
				}
			}
		},
		orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
	}
}

type CartEntity = Prisma.CartGetPayload<{ select: typeof cartSelect }>
type CartContext = { id: string; catalogId: string; status: CartStatus }
type ExistingCartItem = {
	id: string
	deleteAt: Date | null
	quantity: number
} | null
type CartMutationResult = { cart: CartEntity; changed: boolean }

const completedOrderSelect = {
	id: true,
	status: true,
	catalogId: true,
	totalAmount: true,
	createdAt: true,
	items: {
		select: {
			id: true,
			productId: true,
			variantId: true,
			quantity: true,
			unitPrice: true
		},
		orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
	}
}

type CompletedOrderEntity = Prisma.OrderGetPayload<{
	select: typeof completedOrderSelect
}>

@Injectable()
export class CartService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(CartService.name)
	private readonly sseStreams = new Map<string, Set<Subject<MessageEvent>>>()
	private managerSweepTimer: NodeJS.Timeout | null = null

	constructor(private readonly prisma: PrismaService) {}

	onModuleInit() {
		if (CART_MANAGER_SWEEP_MS <= 0) return

		this.managerSweepTimer = setInterval(() => {
			void this.expireInactiveManagerSessions().catch(error => {
				const message =
					error instanceof Error ? (error.stack ?? error.message) : String(error)
				this.logger.error('Cart manager timeout sweep failed', message)
			})
		}, CART_MANAGER_SWEEP_MS)

		this.managerSweepTimer.unref?.()
	}

	onModuleDestroy() {
		if (this.managerSweepTimer) {
			clearInterval(this.managerSweepTimer)
			this.managerSweepTimer = null
		}
	}

	getCookieName() {
		return CART_COOKIE_NAME
	}

	readTokenFromCookie(cookieHeader?: string): string | null {
		return readCartTokenFromCookie(cookieHeader)
	}

	async getOrCreateCurrentCart(catalogId: string, token?: string | null) {
		const normalizedToken = token?.trim()
		if (normalizedToken) {
			const existing = await this.findByToken(catalogId, normalizedToken)
			if (existing) {
				return {
					cart: this.mapCart(existing),
					token: normalizedToken,
					isNew: false
				}
			}
		}

		const newToken = await this.generateUniqueToken()
		const created = await this.prisma.cart.create({
			data: {
				catalogId,
				token: newToken,
				status: CartStatus.DRAFT
			},
			select: cartSelect
		})

		return { cart: this.mapCart(created), token: newToken, isNew: true }
	}

	async getCurrentCartOrThrow(catalogId: string, token?: string | null) {
		const normalizedToken = token?.trim()
		if (!normalizedToken) {
			throw new NotFoundException('Корзина не найдена')
		}

		const cart = await this.findByToken(catalogId, normalizedToken)
		if (!cart) {
			throw new NotFoundException('Корзина не найдена')
		}

		return { cart: this.mapCart(cart), token: normalizedToken }
	}

	async shareCurrentCart(catalogId: string, token?: string | null) {
		const current = await this.getOrCreateCurrentCart(catalogId, token)
		let publicKey = current.cart.publicKey
		const now = new Date()
		const data: Prisma.CartUpdateInput = {}

		if (!publicKey) {
			publicKey = await this.generateUniquePublicKey()
			data.publicKey = publicKey
		}

		if (current.cart.status === CartStatus.DRAFT) {
			data.status = CartStatus.SHARED
			data.statusChangedAt = now
		}

		if (Object.keys(data).length > 0) {
			await this.prisma.cart.update({
				where: { id: current.cart.id },
				data
			})
		}

		const fresh = await this.findByIdOrThrow(current.cart.id)
		return { cart: this.mapCart(fresh), token: current.token }
	}

	async issueCheckoutKey(publicKey: string) {
		const key = publicKey.trim()
		if (!key) {
			throw new BadRequestException('Параметр publicKey обязателен')
		}

		const cart = await this.findByPublicKeyOrThrow(key)
		const checkoutKey = await this.generateUniqueCheckoutKey()
		const now = new Date()
		const data: Prisma.CartUpdateInput = {
			checkoutKey,
			checkoutAt: now
		}

		if (cart.status === CartStatus.DRAFT) {
			data.status = CartStatus.SHARED
			data.statusChangedAt = now
		}

		await this.prisma.cart.update({
			where: { id: cart.id },
			data
		})

		const fresh = await this.findByIdOrThrow(cart.id)
		return {
			cart: this.mapCart(fresh),
			checkoutKey
		}
	}

	async getPublicCart(publicKey: string, checkoutKey?: string | null) {
		const cart = await this.findByPublicKeyOrThrow(publicKey)
		this.ensureCheckoutAccess(cart, checkoutKey)
		return this.mapCart(cart)
	}

	async upsertCurrentItem(
		catalogId: string,
		token: string | null | undefined,
		input: UpsertCartItemInput
	) {
		const current = await this.getOrCreateCurrentCart(catalogId, token)
		const updated = await this.upsertItem(current.cart.id, input)
		if (updated.changed) {
			this.broadcastCart(
				updated.cart.id,
				'cart.updated',
				this.mapCart(updated.cart)
			)
		}
		return { cart: this.mapCart(updated.cart), token: current.token }
	}

	async removeCurrentItem(
		catalogId: string,
		token: string | null | undefined,
		itemId: string
	) {
		const current = await this.getCurrentCartOrThrow(catalogId, token)
		const updated = await this.removeItem(current.cart.id, itemId)
		if (updated.changed) {
			this.broadcastCart(
				updated.cart.id,
				'cart.updated',
				this.mapCart(updated.cart)
			)
		}
		return { cart: this.mapCart(updated.cart), token: current.token }
	}

	async upsertPublicItem(
		publicKey: string,
		checkoutKey: string | null | undefined,
		input: UpsertCartItemInput
	) {
		const cart = await this.findByPublicKeyOrThrow(publicKey)
		this.ensureCheckoutAccess(cart, checkoutKey)
		const updated = await this.upsertItem(cart.id, input)
		if (updated.changed) {
			this.broadcastCart(
				updated.cart.id,
				'cart.updated',
				this.mapCart(updated.cart)
			)
		}
		return this.mapCart(updated.cart)
	}

	async removePublicItem(
		publicKey: string,
		checkoutKey: string | null | undefined,
		itemId: string
	) {
		const cart = await this.findByPublicKeyOrThrow(publicKey)
		this.ensureCheckoutAccess(cart, checkoutKey)
		const updated = await this.removeItem(cart.id, itemId)
		if (updated.changed) {
			this.broadcastCart(
				updated.cart.id,
				'cart.updated',
				this.mapCart(updated.cart)
			)
		}
		return this.mapCart(updated.cart)
	}

	async beginManagerSession(publicKey: string, user: SessionUser) {
		const cart = await this.findManageableCartByPublicKeyOrThrow(publicKey, user)
		this.ensureCartIsOpen(cart.status)
		this.ensureManagerCanTakeCart(cart, user)

		const now = new Date()
		const statusChanged =
			cart.status !== CartStatus.IN_PROGRESS || cart.assignedManagerId !== user.id

		await this.prisma.cart.update({
			where: { id: cart.id },
			data: {
				status: CartStatus.IN_PROGRESS,
				statusChangedAt: statusChanged ? now : cart.statusChangedAt,
				assignedManagerId: user.id,
				managerSessionStartedAt:
					cart.status === CartStatus.IN_PROGRESS &&
					cart.assignedManagerId === user.id &&
					cart.managerSessionStartedAt
						? cart.managerSessionStartedAt
						: now,
				managerLastSeenAt: now
			}
		})

		const fresh = await this.findByIdOrThrow(cart.id)
		if (statusChanged) {
			this.broadcastCartStatusChanged(fresh)
		}

		return this.mapCart(fresh)
	}

	async heartbeatManagerSession(publicKey: string, user: SessionUser) {
		const cart = await this.findManageableCartByPublicKeyOrThrow(publicKey, user)
		this.ensureCartIsOpen(cart.status)
		this.ensureManagerCanRefreshPresence(cart, user)

		const now = new Date()
		const statusChanged =
			cart.status !== CartStatus.IN_PROGRESS || cart.assignedManagerId !== user.id

		await this.prisma.cart.update({
			where: { id: cart.id },
			data: {
				status: CartStatus.IN_PROGRESS,
				statusChangedAt: statusChanged ? now : cart.statusChangedAt,
				assignedManagerId: user.id,
				managerSessionStartedAt:
					cart.status === CartStatus.IN_PROGRESS &&
					cart.assignedManagerId === user.id &&
					cart.managerSessionStartedAt
						? cart.managerSessionStartedAt
						: now,
				managerLastSeenAt: now
			}
		})

		const fresh = await this.findByIdOrThrow(cart.id)
		if (statusChanged) {
			this.broadcastCartStatusChanged(fresh)
		}

		return this.mapCart(fresh)
	}

	async releaseManagerSession(publicKey: string, user: SessionUser) {
		const cart = await this.findManageableCartByPublicKeyOrThrow(publicKey, user)
		this.ensureCartIsOpen(cart.status)
		this.ensureManagerCanRefreshPresence(cart, user)

		const now = new Date()
		const statusChanged =
			cart.status !== CartStatus.PAUSED || cart.assignedManagerId !== user.id

		await this.prisma.cart.update({
			where: { id: cart.id },
			data: {
				status: CartStatus.PAUSED,
				statusChangedAt: statusChanged ? now : cart.statusChangedAt,
				assignedManagerId: user.id,
				managerSessionStartedAt: cart.managerSessionStartedAt ?? now,
				managerLastSeenAt: now
			}
		})

		const fresh = await this.findByIdOrThrow(cart.id)
		if (statusChanged) {
			this.broadcastCartStatusChanged(fresh)
		}

		return this.mapCart(fresh)
	}

	async completeManagerOrder(publicKey: string, user: SessionUser) {
		const cart = await this.findManageableCartByPublicKeyOrThrow(publicKey, user)
		this.ensureCartIsOpen(cart.status)

		if (!cart.items.length) {
			throw new BadRequestException('Нельзя оформить пустую корзину')
		}

		const now = new Date()
		const result = await this.prisma.$transaction(async tx => {
			const freshCart = await this.findByIdOrThrow(cart.id, tx)
			this.ensureCartIsOpen(freshCart.status)

			if (!freshCart.items.length) {
				throw new BadRequestException('Нельзя оформить пустую корзину')
			}

			const snapshotItems = freshCart.items.map(item => {
				const unitPrice = Number(item.product.price)
				return {
					id: item.id,
					productId: item.productId,
					variantId: item.variantId,
					quantity: item.quantity,
					unitPrice,
					lineTotal: Number((unitPrice * item.quantity).toFixed(2)),
					product: {
						id: item.product.id,
						name: item.product.name,
						slug: item.product.slug
					}
				}
			})

			const totalAmount = Math.round(
				snapshotItems.reduce((sum, item) => sum + item.lineTotal, 0)
			)

			const order = await tx.order.create({
				data: {
					status: OrderStatus.COMPLETED,
					catalogId: freshCart.catalogId,
					paymentProof: [],
					products: snapshotItems,
					totalAmount,
					items: {
						create: freshCart.items.map(item => ({
							productId: item.productId,
							variantId: item.variantId,
							quantity: item.quantity,
							unitPrice: item.product.price
						}))
					}
				},
				select: completedOrderSelect
			})

			await tx.cart.update({
				where: { id: freshCart.id },
				data: {
					status: CartStatus.CONVERTED,
					statusChangedAt: now,
					assignedManagerId: user.id,
					managerLastSeenAt: now,
					closedAt: now,
					publicKey: null,
					checkoutKey: null
				}
			})

			return {
				order,
				cart: await this.findByIdOrThrow(freshCart.id, tx)
			}
		})

		this.broadcastCartStatusChanged(result.cart)
		return { order: this.mapCompletedOrder(result.order) }
	}

	async connectCurrentSse(catalogId: string, token?: string | null) {
		const current = await this.getOrCreateCurrentCart(catalogId, token)
		return {
			stream: this.createSseStream(current.cart.id),
			token: current.token
		}
	}

	async connectPublicSse(publicKey: string, checkoutKey?: string | null) {
		const cart = await this.findByPublicKeyOrThrow(publicKey)
		this.ensureCheckoutAccess(cart, checkoutKey)
		return this.createSseStream(cart.id)
	}

	private async upsertItem(
		cartId: string,
		input: UpsertCartItemInput
	): Promise<CartMutationResult> {
		const normalizedInput = normalizeCartItemInput(input)

		return this.prisma.$transaction(async tx =>
			this.upsertItemInTransaction(cartId, normalizedInput, tx)
		)
	}

	private async removeItem(
		cartId: string,
		itemId: string
	): Promise<CartMutationResult> {
		const normalizedItemId = itemId.trim()
		if (!normalizedItemId) {
			throw new BadRequestException('Параметр itemId обязателен')
		}

		return this.prisma.$transaction(async tx => {
			const cart = await this.findCartContextOrThrow(cartId, tx)
			this.ensureCartIsOpen(cart.status)

			const item = await tx.cartItem.findFirst({
				where: {
					id: normalizedItemId,
					cartId,
					deleteAt: null
				},
				select: { id: true }
			})
			if (!item) {
				throw new NotFoundException('Позиция корзины не найдена')
			}

			await tx.cartItem.update({
				where: { id: item.id },
				data: { deleteAt: new Date() }
			})

			await this.touchCart(tx, cartId)

			return {
				cart: await this.findByIdOrThrow(cartId, tx),
				changed: true
			}
		})
	}

	private createSseStream(cartId: string): Observable<MessageEvent> {
		return new Observable<MessageEvent>(subscriber => {
			const stream = new Subject<MessageEvent>()
			const set = this.sseStreams.get(cartId) ?? new Set<Subject<MessageEvent>>()
			set.add(stream)
			this.sseStreams.set(cartId, set)

			const sub = stream.subscribe(subscriber)
			stream.next({
				type: 'connected',
				data: { cartId, timestamp: new Date().toISOString() }
			})

			const pingTimer = setInterval(() => {
				stream.next({
					type: 'ping',
					data: { timestamp: new Date().toISOString() }
				})
			}, CART_SSE_HEARTBEAT_MS)

			return () => {
				clearInterval(pingTimer)
				sub.unsubscribe()
				set.delete(stream)
				stream.complete()
				if (set.size === 0) {
					this.sseStreams.delete(cartId)
				}
			}
		})
	}

	private broadcastCart(cartId: string, type: string, payload: SsePayload) {
		const streams = this.sseStreams.get(cartId)
		if (!streams?.size) return

		for (const stream of streams) {
			stream.next({ type, data: payload })
		}
	}

	private broadcastCartStatusChanged(cart: CartEntity) {
		const payload = this.mapCart(cart)
		this.broadcastCart(cart.id, 'cart.status_changed', payload)
	}

	private mapCart(cart: CartEntity) {
		return mapCartEntity(cart)
	}

	private mapCompletedOrder(order: CompletedOrderEntity) {
		return {
			id: order.id,
			status: order.status,
			catalogId: order.catalogId,
			totalAmount: order.totalAmount,
			items: order.items.map(item => ({
				id: item.id,
				productId: item.productId,
				variantId: item.variantId,
				quantity: item.quantity,
				unitPrice: Number(item.unitPrice)
			})),
			createdAt: order.createdAt
		}
	}

	private ensureCheckoutAccess(cart: CartEntity, checkoutKey?: string | null) {
		const key = checkoutKey?.trim()
		if (!key || !cart.checkoutKey || key !== cart.checkoutKey) {
			throw new UnauthorizedException('Неверный ключ доступа к корзине')
		}
	}

	private ensureCartIsOpen(status: CartStatus) {
		if (!TERMINAL_CART_STATUSES.has(status)) return
		throw new BadRequestException('Корзина уже закрыта')
	}

	private ensureManagerCanTakeCart(cart: CartEntity, user: SessionUser) {
		if (
			cart.status === CartStatus.IN_PROGRESS &&
			cart.assignedManagerId &&
			cart.assignedManagerId !== user.id &&
			user.role !== Role.ADMIN
		) {
			throw new ForbiddenException('Эту корзину уже обрабатывает другой менеджер')
		}
	}

	private ensureManagerCanRefreshPresence(cart: CartEntity, user: SessionUser) {
		if (
			cart.assignedManagerId &&
			cart.assignedManagerId !== user.id &&
			user.role !== Role.ADMIN
		) {
			throw new ForbiddenException('Корзина закреплена за другим менеджером')
		}
	}

	private async ensureManagerOwnsCatalog(
		catalogId: string,
		user: SessionUser
	): Promise<void> {
		if (user.role === Role.ADMIN) return
		if (user.role !== Role.CATALOG) {
			throw new ForbiddenException(
				'Управлять корзинами могут только менеджеры каталога'
			)
		}

		const catalog = await this.prisma.catalog.findFirst({
			where: { id: catalogId, deleteAt: null },
			select: { id: true, userId: true }
		})

		if (!catalog) {
			throw new NotFoundException('Каталог не найден')
		}

		if (!catalog.userId || catalog.userId !== user.id) {
			throw new ForbiddenException('У вас нет доступа к этой корзине')
		}
	}

	private async findManageableCartByPublicKeyOrThrow(
		publicKey: string,
		user: SessionUser
	) {
		const cart = await this.findByPublicKeyOrThrow(publicKey)
		await this.ensureManagerOwnsCatalog(cart.catalogId, user)
		return cart
	}

	private async findByToken(catalogId: string, token: string) {
		return this.prisma.cart.findFirst({
			where: {
				catalogId,
				token,
				status: { in: [...CURRENT_CART_VISIBLE_STATUSES] },
				deleteAt: null
			},
			select: cartSelect
		})
	}

	private async findByPublicKeyOrThrow(publicKey: string) {
		const normalized = publicKey.trim()
		if (!normalized) {
			throw new BadRequestException('Параметр publicKey обязателен')
		}

		const cart = await this.prisma.cart.findFirst({
			where: {
				publicKey: normalized,
				deleteAt: null
			},
			select: cartSelect
		})

		if (!cart) throw new NotFoundException('Корзина не найдена')

		return cart
	}

	private async findByIdOrThrow(
		id: string,
		tx?: Prisma.TransactionClient
	): Promise<CartEntity> {
		const client = tx ?? this.prisma
		const cart = await client.cart.findFirst({
			where: { id, deleteAt: null },
			select: cartSelect
		})

		if (!cart) throw new NotFoundException('Корзина не найдена')

		return cart
	}

	private async upsertItemInTransaction(
		cartId: string,
		input: NormalizedCartItemInput,
		tx: Prisma.TransactionClient
	): Promise<CartMutationResult> {
		const cart = await this.findCartContextOrThrow(cartId, tx)
		this.ensureCartIsOpen(cart.status)
		await this.ensureProductInCatalog(tx, cart.catalogId, input.productId)
		await this.ensureVariantMatchesProduct(tx, input.productId, input.variantId)

		const existing = await this.findExistingItem(
			tx,
			cart.id,
			input.productId,
			input.variantId
		)

		const changed = await this.applyCartItemChange(tx, cart.id, existing, input)

		if (changed) {
			await this.touchCart(tx, cart.id)
		}

		return {
			cart: await this.findByIdOrThrow(cart.id, tx),
			changed
		}
	}

	private async findCartContextOrThrow(
		cartId: string,
		tx: Prisma.TransactionClient
	): Promise<CartContext> {
		const cart = await tx.cart.findFirst({
			where: { id: cartId, deleteAt: null },
			select: { id: true, catalogId: true, status: true }
		})

		if (!cart) throw new NotFoundException('Корзина не найдена')

		return cart
	}

	private async ensureProductInCatalog(
		tx: Prisma.TransactionClient,
		catalogId: string,
		productId: string
	): Promise<void> {
		const product = await tx.product.findFirst({
			where: {
				id: productId,
				catalogId,
				deleteAt: null
			},
			select: { id: true }
		})

		if (!product) {
			throw new BadRequestException('Товар не найден в текущем каталоге')
		}
	}

	private async ensureVariantMatchesProduct(
		tx: Prisma.TransactionClient,
		productId: string,
		variantId: string | null
	): Promise<void> {
		if (!variantId) return

		const variant = await tx.productVariant.findFirst({
			where: {
				id: variantId,
				productId,
				deleteAt: null
			},
			select: { id: true }
		})

		if (!variant) {
			throw new BadRequestException('Вариация не найдена для выбранного товара')
		}
	}

	private async findExistingItem(
		tx: Prisma.TransactionClient,
		cartId: string,
		productId: string,
		variantId: string | null
	): Promise<ExistingCartItem> {
		return tx.cartItem.findFirst({
			where: {
				cartId,
				productId,
				variantId
			},
			select: { id: true, deleteAt: true, quantity: true }
		})
	}

	private async applyCartItemChange(
		tx: Prisma.TransactionClient,
		cartId: string,
		existing: ExistingCartItem,
		input: NormalizedCartItemInput
	): Promise<boolean> {
		if (input.quantity === 0) {
			if (existing && !existing.deleteAt) {
				await tx.cartItem.update({
					where: { id: existing.id },
					data: { deleteAt: new Date() }
				})
				return true
			}
			return false
		}

		if (existing) {
			if (!existing.deleteAt && existing.quantity === input.quantity) {
				return false
			}

			await tx.cartItem.update({
				where: { id: existing.id },
				data: { quantity: input.quantity, deleteAt: null }
			})
			return true
		}

		await tx.cartItem.create({
			data: {
				cartId,
				productId: input.productId,
				variantId: input.variantId,
				quantity: input.quantity
			}
		})

		return true
	}

	private async touchCart(tx: Prisma.TransactionClient, cartId: string) {
		await tx.cart.update({
			where: { id: cartId },
			data: { updatedAt: new Date() }
		})
	}

	private async expireInactiveManagerSessions() {
		const threshold = new Date(Date.now() - CART_MANAGER_INACTIVITY_MS)
		const stale = await this.prisma.cart.findMany({
			where: {
				deleteAt: null,
				status: CartStatus.IN_PROGRESS,
				managerLastSeenAt: { lt: threshold }
			},
			select: { id: true }
		})

		if (!stale.length) return

		const now = new Date()
		const staleIds = stale.map(cart => cart.id)

		await this.prisma.cart.updateMany({
			where: {
				id: { in: staleIds },
				status: CartStatus.IN_PROGRESS
			},
			data: {
				status: CartStatus.PAUSED,
				statusChangedAt: now
			}
		})

		const fresh = await this.prisma.cart.findMany({
			where: {
				id: { in: staleIds },
				deleteAt: null
			},
			select: cartSelect
		})

		for (const cart of fresh) {
			if (cart.status === CartStatus.PAUSED) {
				this.broadcastCartStatusChanged(cart)
			}
		}
	}

	private async generateUniqueToken() {
		for (;;) {
			const candidate = randomBytes(CART_TOKEN_BYTES).toString('hex')
			const exists = await this.prisma.cart.findFirst({
				where: { token: candidate },
				select: { id: true }
			})
			if (!exists) return candidate
		}
	}

	private async generateUniquePublicKey() {
		for (;;) {
			const candidate = randomBytes(PUBLIC_KEY_BYTES).toString('hex')
			const exists = await this.prisma.cart.findFirst({
				where: { publicKey: candidate },
				select: { id: true }
			})
			if (!exists) return candidate
		}
	}

	private async generateUniqueCheckoutKey() {
		for (;;) {
			const candidate = randomBytes(CHECKOUT_KEY_BYTES).toString('hex')
			const exists = await this.prisma.cart.findFirst({
				where: { checkoutKey: candidate },
				select: { id: true }
			})
			if (!exists) return candidate
		}
	}
}

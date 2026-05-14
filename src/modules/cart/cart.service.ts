import { CartStatus } from '@generated/client'
import {
	BadRequestException,
	Inject,
	Injectable,
	Logger,
	OnModuleDestroy,
	OnModuleInit
} from '@nestjs/common'

import type { SessionUser } from '@/modules/auth/types/auth-request'
import { MediaUrlService } from '@/shared/media/media-url.service'
import {
	CAPABILITY_READER_PORT,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'

import { CartCurrentService } from './cart-current.service'
import { CartLifecycleService } from './cart-lifecycle.service'
import { CartLineService } from './cart-line.service'
import { CartLookupService } from './cart-lookup.service'
import { CartManagerSessionService } from './cart-manager-session.service'
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

	async completeManagerOrder(publicKey: string, user: SessionUser) {
		const cart = await this.managerSession.findManageableCartByPublicKeyOrThrow(
			publicKey,
			user
		)
		this.ensureCartIsOpen(cart.status)

		if (!cart.items.length) {
			throw new BadRequestException('Нельзя оформить пустую корзину')
		}

		const result = await this.orderCheckout.complete(cart.id, user.id)
		const freshCart = await this.lookup.findByIdOrThrow(result.cartId)
		await this.broadcastCartStatusChanged(freshCart)

		return { order: result.order }
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
		return mapCartEntity(
			cart,
			media => this.mediaUrl.mapMedia(media),
			{
				canUseProductVariants: features.canUseProductVariants,
				canUseCatalogSaleUnits: features.canUseCatalogSaleUnits
			}
		)
	}

	private ensureCartIsOpen(status: CartStatus) {
		if (!TERMINAL_CART_STATUSES.has(status)) return
		throw new BadRequestException('Корзина уже закрыта')
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

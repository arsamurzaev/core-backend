import type { Prisma } from '@generated/client'
import {
	BadRequestException,
	Injectable,
	MessageEvent,
	NotFoundException,
	UnauthorizedException
} from '@nestjs/common'
import { randomBytes } from 'node:crypto'
import { Observable, Subject } from 'rxjs'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

type UpsertCartItemInput = {
	productId: string
	variantId?: string
	quantity: number
}

type SsePayload = string | Record<string, unknown>

const CART_TOKEN_BYTES = 24
const PUBLIC_KEY_BYTES = 16
const CHECKOUT_KEY_BYTES = 18
const COOKIE_NAME = 'cart_token'
const SSE_HEARTBEAT_MS = 20_000

const cartSelect = {
	id: true,
	catalogId: true,
	token: true,
	publicKey: true,
	checkoutKey: true,
	checkoutAt: true,
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

@Injectable()
export class CartService {
	private readonly sseStreams = new Map<string, Set<Subject<MessageEvent>>>()

	constructor(private readonly prisma: PrismaService) {}

	getCookieName() {
		return COOKIE_NAME
	}

	readTokenFromCookie(cookieHeader?: string): string | null {
		if (!cookieHeader) return null
		const pairs = cookieHeader.split(';')
		for (const pair of pairs) {
			const [key, ...rest] = pair.split('=')
			if (!key) continue
			if (key.trim() !== COOKIE_NAME) continue
			const rawValue = rest.join('=').trim()
			if (!rawValue) return null
			try {
				return decodeURIComponent(rawValue)
			} catch {
				return rawValue
			}
		}
		return null
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
			data: { catalogId, token: newToken },
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
		if (!publicKey) {
			publicKey = await this.generateUniquePublicKey()
			await this.prisma.cart.update({
				where: { id: current.cart.id },
				data: { publicKey }
			})
		}
		const fresh = await this.findByIdOrThrow(current.cart.id)
		return { cart: this.mapCart(fresh), token: current.token }
	}

	async issueCheckoutKey(publicKey: string) {
		const key = publicKey.trim()
		if (!key) {
			throw new BadRequestException('publicKey обязателен')
		}
		const cart = await this.findByPublicKeyOrThrow(key)
		const checkoutKey = await this.generateUniqueCheckoutKey()
		await this.prisma.cart.update({
			where: { id: cart.id },
			data: {
				checkoutKey,
				checkoutAt: new Date()
			}
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
		this.broadcastCart(updated.id, 'cart.updated', this.mapCart(updated))
		return { cart: this.mapCart(updated), token: current.token }
	}

	async removeCurrentItem(
		catalogId: string,
		token: string | null | undefined,
		itemId: string
	) {
		const current = await this.getCurrentCartOrThrow(catalogId, token)
		const updated = await this.removeItem(current.cart.id, itemId)
		this.broadcastCart(updated.id, 'cart.updated', this.mapCart(updated))
		return { cart: this.mapCart(updated), token: current.token }
	}

	async upsertPublicItem(
		publicKey: string,
		checkoutKey: string | null | undefined,
		input: UpsertCartItemInput
	) {
		const cart = await this.findByPublicKeyOrThrow(publicKey)
		this.ensureCheckoutAccess(cart, checkoutKey)
		const updated = await this.upsertItem(cart.id, input)
		this.broadcastCart(updated.id, 'cart.updated', this.mapCart(updated))
		return this.mapCart(updated)
	}

	async removePublicItem(
		publicKey: string,
		checkoutKey: string | null | undefined,
		itemId: string
	) {
		const cart = await this.findByPublicKeyOrThrow(publicKey)
		this.ensureCheckoutAccess(cart, checkoutKey)
		const updated = await this.removeItem(cart.id, itemId)
		this.broadcastCart(updated.id, 'cart.updated', this.mapCart(updated))
		return this.mapCart(updated)
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

	private async upsertItem(cartId: string, input: UpsertCartItemInput) {
		const productId = input.productId.trim()
		const variantId = input.variantId?.trim() || null
		const quantity = input.quantity

		if (!productId) {
			throw new BadRequestException('productId обязателен')
		}
		if (!Number.isInteger(quantity) || quantity < 0) {
			throw new BadRequestException(
				'quantity должен быть целым числом больше или равен 0'
			)
		}

		return this.prisma.$transaction(async tx => {
			const cart = await tx.cart.findFirst({
				where: { id: cartId, deleteAt: null },
				select: { id: true, catalogId: true }
			})
			if (!cart) throw new NotFoundException('Корзина не найдена')

			const product = await tx.product.findFirst({
				where: {
					id: productId,
					catalogId: cart.catalogId,
					deleteAt: null
				},
				select: { id: true }
			})
			if (!product) {
				throw new BadRequestException('Товар не найден в текущем каталоге')
			}

			if (variantId) {
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

			const existing = await tx.cartItem.findFirst({
				where: {
					cartId: cart.id,
					productId,
					variantId
				},
				select: { id: true, deleteAt: true }
			})

			if (quantity === 0) {
				if (existing && !existing.deleteAt) {
					await tx.cartItem.update({
						where: { id: existing.id },
						data: { deleteAt: new Date() }
					})
				}
			} else if (existing) {
				await tx.cartItem.update({
					where: { id: existing.id },
					data: { quantity, deleteAt: null }
				})
			} else {
				await tx.cartItem.create({
					data: {
						cartId: cart.id,
						productId,
						variantId,
						quantity
					}
				})
			}

			return this.findByIdOrThrow(cart.id, tx)
		})
	}

	private async removeItem(cartId: string, itemId: string) {
		const normalizedItemId = itemId.trim()
		if (!normalizedItemId) {
			throw new BadRequestException('itemId обязателен')
		}

		return this.prisma.$transaction(async tx => {
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

			return this.findByIdOrThrow(cartId, tx)
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
			}, SSE_HEARTBEAT_MS)

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

	private mapCart(cart: CartEntity) {
		const items = cart.items.map(item => {
			const unitPrice = Number(item.product.price)
			const lineTotal = Number((unitPrice * item.quantity).toFixed(2))
			return {
				id: item.id,
				productId: item.productId,
				variantId: item.variantId,
				quantity: item.quantity,
				product: {
					id: item.product.id,
					name: item.product.name,
					slug: item.product.slug,
					price: unitPrice
				},
				lineTotal,
				createdAt: item.createdAt,
				updatedAt: item.updatedAt
			}
		})

		const itemsCount = items.reduce((acc, item) => acc + item.quantity, 0)
		const subtotal = Number(
			items.reduce((acc, item) => acc + item.lineTotal, 0).toFixed(2)
		)

		return {
			id: cart.id,
			catalogId: cart.catalogId,
			publicKey: cart.publicKey,
			checkoutAt: cart.checkoutAt,
			items,
			totals: {
				itemsCount,
				subtotal
			},
			createdAt: cart.createdAt,
			updatedAt: cart.updatedAt
		}
	}

	private ensureCheckoutAccess(cart: CartEntity, checkoutKey?: string | null) {
		const key = checkoutKey?.trim()
		if (!key || !cart.checkoutKey || key !== cart.checkoutKey) {
			throw new UnauthorizedException('Неверный checkoutKey')
		}
	}

	private async findByToken(catalogId: string, token: string) {
		return this.prisma.cart.findFirst({
			where: {
				catalogId,
				token,
				deleteAt: null
			},
			select: cartSelect
		})
	}

	private async findByPublicKeyOrThrow(publicKey: string) {
		const normalized = publicKey.trim()
		if (!normalized) {
			throw new BadRequestException('publicKey обязателен')
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

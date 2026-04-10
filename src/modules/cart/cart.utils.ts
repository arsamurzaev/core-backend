import { CartStatus } from '@generated/client'
import { BadRequestException } from '@nestjs/common'

export type UpsertCartItemInput = {
	productId: string
	variantId?: string
	quantity: number
}

export type NormalizedCartItemInput = {
	productId: string
	variantId: string | null
	quantity: number
}

type CartEntityLike = {
	id: string
	catalogId: string
	status: CartStatus
	statusChangedAt: unknown
	publicKey: string | null
	checkoutAt: unknown
	assignedManagerId: string | null
	managerSessionStartedAt: unknown
	managerLastSeenAt: unknown
	closedAt: unknown
	items: CartItemLike[]
	createdAt: unknown
	updatedAt: unknown
}

type CartItemLike = {
	id: string
	productId: string
	variantId: string | null
	quantity: number
	createdAt: unknown
	updatedAt: unknown
	product: {
		id: string
		name: string
		slug: string
		price: unknown
	}
}

export const CART_TOKEN_BYTES = 24
export const PUBLIC_KEY_BYTES = 16
export const CHECKOUT_KEY_BYTES = 18
export const CART_COOKIE_NAME = 'cart_token'
export const CART_SSE_HEARTBEAT_MS = 20_000

function getCartStatusMessage(status: CartStatus): string | null {
	if (status === CartStatus.IN_PROGRESS) {
		return 'Менеджер магазина сейчас просматривает ваш заказ.'
	}

	return null
}

export function readCartTokenFromCookie(cookieHeader?: string): string | null {
	if (!cookieHeader) return null

	const pairs = cookieHeader.split(';')
	for (const pair of pairs) {
		const [key, ...rest] = pair.split('=')
		if (!key) continue
		if (key.trim() !== CART_COOKIE_NAME) continue

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

export function normalizeCartItemInput(
	input: UpsertCartItemInput
): NormalizedCartItemInput {
	const productId = input.productId.trim()
	const variantId = input.variantId?.trim() || null
	const quantity = input.quantity

	if (!productId) {
		throw new BadRequestException('Поле productId обязательно')
	}

	if (!Number.isInteger(quantity) || quantity < 0) {
		throw new BadRequestException(
			'quantity должен быть целым числом больше или равен 0'
		)
	}

	return { productId, variantId, quantity }
}

export function mapCartEntity(cart: CartEntityLike) {
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
		status: cart.status,
		statusMessage: getCartStatusMessage(cart.status),
		statusChangedAt: cart.statusChangedAt,
		publicKey: cart.publicKey,
		checkoutAt: cart.checkoutAt,
		assignedManagerId: cart.assignedManagerId,
		managerSessionStartedAt: cart.managerSessionStartedAt,
		managerLastSeenAt: cart.managerLastSeenAt,
		closedAt: cart.closedAt,
		items,
		totals: {
			itemsCount,
			subtotal
		},
		createdAt: cart.createdAt,
		updatedAt: cart.updatedAt
	}
}

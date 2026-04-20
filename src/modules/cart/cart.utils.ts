import { CartStatus } from '@generated/client'
import { BadRequestException } from '@nestjs/common'

import type { MediaRecord } from '@/shared/media/media-url.service'

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

// ProductMedia junction: { position, media }
type CartProductMedia = {
	position: number
	media: MediaRecord
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
		media?: CartProductMedia[] | null
	}
}

export const CART_TOKEN_BYTES = 24
export const PUBLIC_KEY_BYTES = 16
export const CHECKOUT_KEY_BYTES = 18
export const CART_COOKIE_NAME = 'cart_token'
export const CART_SSE_HEARTBEAT_MS = 20_000
export const MAX_ITEM_QUANTITY = 999
export const MAX_CART_ITEMS = 50

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

function toCents(price: any): number {
	return Math.round(Number(String(price)) * 100)
}

export function mapCartEntity(
	cart: CartEntityLike,
	mapMedia?: (media: MediaRecord) => unknown
) {
	const items = cart.items.map(item => {
		const unitPriceCents = toCents(item.product.price)
		const lineTotalCents = unitPriceCents * item.quantity
		const primaryMedia = item.product.media?.[0]?.media ?? null

		return {
			id: item.id,
			productId: item.productId,
			variantId: item.variantId,
			quantity: item.quantity,
			product: {
				id: item.product.id,
				name: item.product.name,
				slug: item.product.slug,
				price: unitPriceCents / 100,
				media: primaryMedia && mapMedia ? mapMedia(primaryMedia) : null
			},
			lineTotal: lineTotalCents / 100,
			createdAt: item.createdAt,
			updatedAt: item.updatedAt
		}
	})

	const itemsCount = items.reduce((acc, item) => acc + item.quantity, 0)
	const subtotalCents = cart.items.reduce(
		(acc, item) => acc + toCents(item.product.price) * item.quantity,
		0
	)
	const subtotal = subtotalCents / 100
	const total = subtotal

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
			subtotal,
			total
		},
		createdAt: cart.createdAt,
		updatedAt: cart.updatedAt
	}
}

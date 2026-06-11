import {
	CartCheckoutMethod,
	CartStatus,
	CartTableSessionStatus
} from '@generated/client'
import { BadRequestException } from '@nestjs/common'

import type { MediaRecord } from '@/shared/media/media-url.service'
import {
	type PriceAttributeLike,
	resolveLinePricing
} from '@/shared/order/price-resolver.utils'

export type UpsertCartItemInput = {
	productId: string
	variantId?: string
	saleUnitId?: string
	quantity: number
	guestSessionId?: string | null
	guestName?: string | null
	modifiers?: UpsertCartItemModifierInput[]
}

export type UpsertCartItemModifierInput = {
	productModifierGroupId: string
	productModifierOptionId: string
	quantity?: number
}

export type NormalizedCartItemInput = {
	productId: string
	variantId: string | null
	saleUnitId: string | null
	quantity: number
	guestSessionId?: string | null
	guestName?: string | null
	modifiers?: NormalizedCartItemModifierInput[]
}

export type NormalizedCartItemModifierInput = {
	productModifierGroupId: string
	productModifierOptionId: string
	quantity: number
}

type CartEntityLike = {
	id: string
	catalogId: string
	status: CartStatus
	statusChangedAt: unknown
	publicKey: string | null
	checkoutAt: unknown
	checkoutMethod: CartCheckoutMethod | null
	checkoutData: unknown
	checkoutContacts: unknown
	comment: string | null
	assignedManagerId: string | null
	managerSessionStartedAt: unknown
	managerLastSeenAt: unknown
	closedAt: unknown
	tableSession?: CartTableSessionLike | null
	items: CartItemLike[]
	createdAt: unknown
	updatedAt: unknown
}

type CartTableSessionLike = {
	id: string
	cartId?: string
	status: string
	publicCode: string
	tableExternalId: string
	tableNumber: string | null
	tableName: string | null
	sectionExternalId: string | null
	sectionName: string | null
	guestsCount: number | null
	externalOrderId: string | null
	submittedOrderId: string | null
	submittedAt: unknown
	closedAt: unknown
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
	saleUnitId?: string | null
	modifierSignature?: string | null
	quantity: number
	baseQuantity?: number | null
	unitPriceSnapshot?: unknown
	priceListId?: string | null
	priceListCode?: string | null
	priceListName?: string | null
	guestSessionId?: string | null
	guestName?: string | null
	createdAt: unknown
	updatedAt: unknown
	variant?: CartVariantLike | null
	saleUnit?: CartSaleUnitLike | null
	modifiers?: CartModifierLike[] | null
	product: {
		id: string
		name: string
		slug: string
		price: unknown
		media?: CartProductMedia[] | null
		productAttributes?: PriceAttributeLike[] | null
	}
}

type CartVariantLike = {
	id: string
	sku: string
	variantKey: string
	price: unknown
	stock: number | null
	status: string
	isAvailable: boolean
	attributes?: CartVariantAttributeLike[] | null
}

type CartSaleUnitLike = {
	id: string
	variantId: string
	catalogSaleUnitId?: string | null
	code: string
	name: string
	baseQuantity: unknown
	price: unknown
	barcode?: string | null
	isDefault: boolean
	isActive: boolean
	displayOrder: number
}

type CartModifierLike = {
	id: string
	productModifierGroupId?: string | null
	productModifierOptionId?: string | null
	catalogModifierGroupId?: string | null
	catalogModifierOptionId?: string | null
	groupCode: string
	groupName: string
	optionCode: string
	optionName: string
	quantity: number
	unitPriceSnapshot: unknown
}

type CartVariantAttributeLike = {
	attribute: {
		id: string
		key: string
		displayName: string
		displayOrder: number
	}
	enumValue: {
		id: string
		value: string
		displayName: string | null
		displayOrder: number
	}
}

export type CartEntityMapOptions = {
	canUseProductVariants?: boolean
	canUseCatalogSaleUnits?: boolean
	canUseCatalogModifiers?: boolean
}

function sortCartVariantAttributes(
	attributes: CartVariantAttributeLike[]
): CartVariantAttributeLike[] {
	return [...attributes].sort(
		(a, b) =>
			a.attribute.displayOrder - b.attribute.displayOrder ||
			a.enumValue.displayOrder - b.enumValue.displayOrder ||
			a.attribute.key.localeCompare(b.attribute.key) ||
			a.enumValue.value.localeCompare(b.enumValue.value)
	)
}

function trimToNull(value?: string | null): string | null {
	const trimmed = value?.trim()
	return trimmed ? trimmed : null
}

function buildCartItemLineKey(
	item: CartItemLike,
	options: {
		canExposeSaleUnits: boolean
		canExposeModifiers: boolean
		canUseProductVariants: boolean
	}
): string {
	return [
		item.productId,
		options.canUseProductVariants
			? (trimToNull(item.variantId) ?? 'default')
			: 'default',
		options.canExposeSaleUnits
			? (trimToNull(item.saleUnitId) ?? 'default')
			: 'default',
		options.canExposeModifiers
			? (trimToNull(item.modifierSignature) ??
				buildModifierSignatureFromCartItem(item))
			: 'default',
		trimToNull(item.guestSessionId) ?? 'default'
	].join(':')
}

function buildModifierSignatureFromCartItem(item: CartItemLike): string {
	const parts = (item.modifiers ?? [])
		.map(modifier => {
			const optionId = trimToNull(modifier.productModifierOptionId)
			if (!optionId) return null
			return `${optionId}x${Math.max(1, Math.trunc(modifier.quantity || 1))}`
		})
		.filter((part): part is string => Boolean(part))
		.sort()
	return parts.join('|')
}

function mergeCartItemQuantity(
	left: number | null | undefined,
	right: number | null | undefined
): number | null | undefined {
	if (left === undefined && right === undefined) return undefined
	if (left === null && right === null) return null
	return toNumber(left ?? 0) + toNumber(right ?? 0)
}

function mergeDuplicateCartItems(
	items: CartItemLike[],
	options: {
		canExposeSaleUnits: boolean
		canExposeModifiers: boolean
		canUseProductVariants: boolean
	}
): CartItemLike[] {
	const map = new Map<string, CartItemLike>()

	for (const item of items) {
		const key = buildCartItemLineKey(item, options)
		const existing = map.get(key)

		if (!existing) {
			map.set(key, { ...item })
			continue
		}

		existing.quantity += item.quantity
		existing.baseQuantity = mergeCartItemQuantity(
			existing.baseQuantity,
			item.baseQuantity
		)
		if (
			existing.unitPriceSnapshot === null ||
			existing.unitPriceSnapshot === undefined
		) {
			existing.unitPriceSnapshot = item.unitPriceSnapshot
		}
	}

	return [...map.values()]
}

function buildCartVariantLabel(variant: CartVariantLike): string {
	const label = sortCartVariantAttributes(variant.attributes ?? [])
		.map(attribute => {
			const attributeName = trimToNull(attribute.attribute.displayName)
			const valueName =
				trimToNull(attribute.enumValue.displayName) ??
				trimToNull(attribute.enumValue.value)

			if (attributeName && valueName) return `${attributeName}: ${valueName}`
			return attributeName ?? valueName
		})
		.filter((part): part is string => Boolean(part))
		.join(', ')

	return label || variant.variantKey
}

export const CART_TOKEN_BYTES = 24
export const PUBLIC_KEY_BYTES = 18
export const CART_COOKIE_NAME = 'cart_token'
export const CART_GUEST_TOKEN_HEADER = 'x-cart-guest-token'
export const CART_SSE_HEARTBEAT_MS = 200_000
export const MAX_ITEM_QUANTITY = 999
export const MAX_CART_ITEMS = 50

function getCartStatusMessage(
	status: CartStatus,
	tableSessionStatus?: string | null
): string | null {
	if (tableSessionStatus === CartTableSessionStatus.PENDING_CONFIRMATION) {
		return 'Заказ отправлен официанту. Дождитесь подтверждения.'
	}
	if (tableSessionStatus === CartTableSessionStatus.EXPORT_ERROR) {
		return 'Не удалось отправить заказ в iiko. Позовите сотрудника.'
	}
	if (tableSessionStatus === CartTableSessionStatus.SUBMITTED) {
		return 'Заказ принят.'
	}

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
	const saleUnitId = input.saleUnitId?.trim() || null
	const guestSessionId = normalizeOptionalText(input.guestSessionId, 64)
	const guestName = normalizeOptionalText(input.guestName, 120)
	const quantity = input.quantity
	const modifiers = normalizeCartItemModifiers(input.modifiers)

	if (!productId) {
		throw new BadRequestException('Поле productId обязательно')
	}

	if (!Number.isInteger(quantity) || quantity < 0) {
		throw new BadRequestException(
			'quantity должен быть целым числом больше или равен 0'
		)
	}

	return {
		productId,
		variantId,
		saleUnitId,
		quantity,
		guestSessionId,
		guestName,
		modifiers
	}
}

function normalizeCartItemModifiers(
	modifiers: UpsertCartItemModifierInput[] | undefined
): NormalizedCartItemModifierInput[] {
	const map = new Map<string, NormalizedCartItemModifierInput>()
	for (const modifier of modifiers ?? []) {
		const productModifierGroupId = modifier.productModifierGroupId?.trim()
		const productModifierOptionId = modifier.productModifierOptionId?.trim()
		const quantity = modifier.quantity ?? 1
		if (!productModifierGroupId) {
			throw new BadRequestException('Не указана группа модификатора')
		}
		if (!productModifierOptionId) {
			throw new BadRequestException('Не указана опция модификатора')
		}
		if (!Number.isInteger(quantity) || quantity < 1) {
			throw new BadRequestException('Количество модификатора должно быть больше 0')
		}
		const key = `${productModifierGroupId}:${productModifierOptionId}`
		const current = map.get(key)
		if (current) {
			current.quantity += quantity
			continue
		}
		map.set(key, {
			productModifierGroupId,
			productModifierOptionId,
			quantity
		})
	}

	return [...map.values()].sort(
		(left, right) =>
			left.productModifierGroupId.localeCompare(right.productModifierGroupId) ||
			left.productModifierOptionId.localeCompare(right.productModifierOptionId)
	)
}

function readFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed : null
	}
	if (typeof value === 'bigint') {
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed : null
	}
	if (typeof value === 'object' && value !== null) {
		const candidate = value as { toNumber?: unknown }
		if (typeof candidate.toNumber === 'function') {
			const toNumber = candidate.toNumber as () => unknown
			const parsed: unknown = toNumber()
			if (typeof parsed === 'number' && Number.isFinite(parsed)) {
				return parsed
			}
		}
		const toString = (value as { toString?: unknown }).toString
		if (
			typeof toString === 'function' &&
			toString !== Object.prototype.toString
		) {
			const parsed = Number((toString as () => string).call(value))
			return Number.isFinite(parsed) ? parsed : null
		}
	}
	return null
}

function toCents(price: unknown): number {
	return Math.round((readFiniteNumber(price) ?? 0) * 100)
}

function toNumber(value: unknown): number {
	return readFiniteNumber(value) ?? 0
}

function toOptionalMoney(value: unknown): number | null {
	if (value === null || value === undefined) return null
	const parsed = readFiniteNumber(value)
	if (parsed === null) return null
	return Number.isFinite(parsed)
		? Math.max(0, Math.round(parsed * 100)) / 100
		: null
}

export function resolveCartItemUnitPriceCents(item: {
	product: { price: unknown; productAttributes?: PriceAttributeLike[] | null }
	variant?: { price: unknown } | null
	saleUnit?: { price: unknown } | null
	modifiers?: CartModifierLike[] | null
	unitPriceSnapshot?: unknown
	priceListId?: string | null
}): number {
	return resolveLinePricing({
		...item,
		unitPriceSnapshotIsBasePrice: Boolean(item.priceListId)
	}).unitPriceCents
}

export function resolveCartItemPricing(item: {
	product: { price: unknown; productAttributes?: PriceAttributeLike[] | null }
	variant?: { price: unknown } | null
	saleUnit?: { price: unknown } | null
	modifiers?: CartModifierLike[] | null
	unitPriceSnapshot?: unknown
	priceListId?: string | null
	quantity: number
}) {
	return resolveLinePricing({
		...item,
		unitPriceSnapshotIsBasePrice: Boolean(item.priceListId)
	})
}

export function resolveCartItemBaseQuantity(item: {
	quantity: number
	baseQuantity?: number | null
	saleUnit?: { baseQuantity: unknown } | null
}): number {
	if (item.baseQuantity !== undefined && item.baseQuantity !== null) {
		return Math.max(0, Math.ceil(toNumber(item.baseQuantity)))
	}

	const multiplier = item.saleUnit ? toNumber(item.saleUnit.baseQuantity) : 1
	const baseQuantity = item.quantity * (multiplier > 0 ? multiplier : 1)
	return Math.max(0, Math.ceil(baseQuantity))
}

function resolveMappedCartItemBaseQuantity(
	item: CartItemLike,
	saleUnit: CartSaleUnitLike | null
): number {
	return resolveCartItemBaseQuantity({
		quantity: item.quantity,
		baseQuantity: saleUnit ? item.baseQuantity : null,
		saleUnit
	})
}

export function mapCartEntity(
	cart: CartEntityLike,
	mapMedia?: (media: MediaRecord) => unknown,
	options: CartEntityMapOptions = {}
) {
	const canUseProductVariants = options.canUseProductVariants ?? true
	const canUseCatalogSaleUnits = options.canUseCatalogSaleUnits ?? true
	const canUseCatalogModifiers = options.canUseCatalogModifiers ?? true
	const canExposeSaleUnits = canUseCatalogSaleUnits
	const canExposeModifiers = canUseCatalogModifiers
	const cartItems = mergeDuplicateCartItems(cart.items, {
		canExposeSaleUnits,
		canExposeModifiers,
		canUseProductVariants
	})
	const pricedItems = cartItems.map(item => {
		const itemVariant = canUseProductVariants ? (item.variant ?? null) : null
		const itemSaleUnit = canExposeSaleUnits ? (item.saleUnit ?? null) : null
		const itemModifiers = canExposeModifiers ? (item.modifiers ?? []) : []
		const hasPriceListSnapshot = Boolean(item.priceListId)
		const shouldUseSnapshot =
			toOptionalMoney(item.unitPriceSnapshot) !== null &&
			(hasPriceListSnapshot ||
				((canUseProductVariants || !item.variantId) &&
					(canExposeSaleUnits || !(item.saleUnitId ?? null))))
		const pricingSource = {
			...item,
			variant: itemVariant,
			saleUnit: itemSaleUnit,
			modifiers: itemModifiers,
			unitPriceSnapshot: shouldUseSnapshot ? item.unitPriceSnapshot : null
		}
		const pricing = resolveCartItemPricing(pricingSource)
		const itemPriceSnapshot = shouldUseSnapshot
			? toOptionalMoney(item.unitPriceSnapshot)
			: null

		return {
			item,
			itemVariant,
			itemSaleUnit,
			itemModifiers,
			itemPriceSnapshot,
			pricing
		}
	})

	const items = pricedItems.map(
		({
			item,
			itemVariant,
			itemSaleUnit,
			itemModifiers,
			itemPriceSnapshot,
			pricing
		}) => {
			const primaryMedia = item.product.media?.[0]?.media ?? null
			const hasKnownDisplayPrice =
				toOptionalMoney(
					itemPriceSnapshot ??
						itemSaleUnit?.price ??
						itemVariant?.price ??
						item.product.price
				) !== null

			return {
				id: item.id,
				productId: item.productId,
				variantId: canUseProductVariants ? item.variantId : null,
				saleUnitId: canExposeSaleUnits ? (item.saleUnitId ?? null) : null,
				priceListId: item.priceListId ?? null,
				priceListCode: item.priceListCode ?? null,
				priceListName: item.priceListName ?? null,
				guestSessionId: item.guestSessionId ?? null,
				guestName: item.guestName ?? null,
				quantity: item.quantity,
				baseQuantity: resolveMappedCartItemBaseQuantity(item, itemSaleUnit),
				unitPriceSnapshot: itemPriceSnapshot,
				product: {
					id: item.product.id,
					name: item.product.name,
					slug: item.product.slug,
					price: hasKnownDisplayPrice ? pricing.unitPrice : null,
					media: primaryMedia && mapMedia ? mapMedia(primaryMedia) : null
				},
				variant: mapCartVariant(
					itemVariant,
					itemSaleUnit ? undefined : itemPriceSnapshot
				),
				saleUnit: mapCartSaleUnit(itemSaleUnit, itemPriceSnapshot),
				modifiers: itemModifiers.map(mapCartModifier),
				baseUnitPrice: pricing.baseUnitPrice,
				unitPrice: pricing.unitPrice,
				discountPercent: pricing.discountPercent,
				hasDiscount: pricing.hasDiscount,
				lineTotal: pricing.lineTotal,
				createdAt: item.createdAt,
				updatedAt: item.updatedAt
			}
		}
	)

	const itemsCount = items.reduce((acc, item) => acc + item.quantity, 0)
	const baseSubtotalCents = pricedItems.reduce(
		(acc, { item, pricing }) => acc + pricing.baseUnitPriceCents * item.quantity,
		0
	)
	const subtotalCents = pricedItems.reduce(
		(acc, { pricing }) => acc + pricing.lineTotalCents,
		0
	)
	const baseSubtotal = baseSubtotalCents / 100
	const subtotal = subtotalCents / 100
	const total = subtotal

	return {
		id: cart.id,
		catalogId: cart.catalogId,
		status: cart.status,
		statusMessage: getCartStatusMessage(
			cart.status,
			cart.tableSession?.status ?? null
		),
		statusChangedAt: cart.statusChangedAt,
		publicKey: cart.publicKey,
		checkoutAt: cart.checkoutAt,
		checkoutMethod: cart.checkoutMethod,
		checkoutData: cart.checkoutData,
		checkoutContacts: cart.checkoutContacts,
		comment: cart.comment,
		assignedManagerId: cart.assignedManagerId,
		managerSessionStartedAt: cart.managerSessionStartedAt,
		managerLastSeenAt: cart.managerLastSeenAt,
		closedAt: cart.closedAt,
		tableSession: mapCartTableSession(cart.tableSession ?? null),
		items,
		totals: {
			itemsCount,
			baseSubtotal,
			discountTotal: Math.max(0, baseSubtotal - subtotal),
			hasDiscount: baseSubtotal > subtotal,
			subtotal,
			total
		},
		createdAt: cart.createdAt,
		updatedAt: cart.updatedAt
	}
}

export function mapCartModifier(modifier: CartModifierLike) {
	return {
		id: modifier.id,
		productModifierGroupId: modifier.productModifierGroupId ?? null,
		productModifierOptionId: modifier.productModifierOptionId ?? null,
		catalogModifierGroupId: modifier.catalogModifierGroupId ?? null,
		catalogModifierOptionId: modifier.catalogModifierOptionId ?? null,
		groupCode: modifier.groupCode,
		groupName: modifier.groupName,
		optionCode: modifier.optionCode,
		optionName: modifier.optionName,
		quantity: Math.max(1, Math.trunc(modifier.quantity || 1)),
		unitPrice: toCents(modifier.unitPriceSnapshot) / 100
	}
}

function normalizeOptionalText(
	value: string | null | undefined,
	maxLength: number
): string | null {
	const normalized = value?.trim()
	if (!normalized) return null
	return normalized.slice(0, maxLength)
}

export function mapCartTableSession(session?: CartTableSessionLike | null) {
	if (!session) return null

	return {
		id: session.id,
		status: session.status,
		publicCode: session.publicCode,
		tableExternalId: session.tableExternalId,
		tableNumber: session.tableNumber,
		tableName: session.tableName,
		sectionExternalId: session.sectionExternalId,
		sectionName: session.sectionName,
		guestsCount: session.guestsCount,
		externalOrderId: session.externalOrderId,
		submittedOrderId: session.submittedOrderId,
		submittedAt: session.submittedAt,
		closedAt: session.closedAt,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt
	}
}

export function mapCartSaleUnit(
	saleUnit?: CartSaleUnitLike | null,
	priceOverride?: unknown
) {
	if (!saleUnit) return null

	return {
		id: saleUnit.id,
		variantId: saleUnit.variantId,
		catalogSaleUnitId: saleUnit.catalogSaleUnitId ?? null,
		code: saleUnit.code,
		name: saleUnit.name,
		baseQuantity: toNumber(saleUnit.baseQuantity),
		price: toCents(priceOverride ?? saleUnit.price) / 100,
		barcode: saleUnit.barcode ?? null,
		isDefault: saleUnit.isDefault,
		isActive: saleUnit.isActive,
		displayOrder: saleUnit.displayOrder
	}
}

export function mapCartVariant(
	variant?: CartVariantLike | null,
	priceOverride?: unknown
) {
	if (!variant) return null
	const attributes = sortCartVariantAttributes(variant.attributes ?? []).map(
		attribute => ({
			attribute: {
				id: attribute.attribute.id,
				key: attribute.attribute.key,
				displayName: attribute.attribute.displayName
			},
			enumValue: {
				id: attribute.enumValue.id,
				value: attribute.enumValue.value,
				displayName: attribute.enumValue.displayName
			}
		})
	)

	return {
		id: variant.id,
		sku: variant.sku,
		variantKey: variant.variantKey,
		label: buildCartVariantLabel(variant),
		price: toOptionalMoney(priceOverride ?? variant.price),
		stock: variant.stock,
		status: variant.status,
		isAvailable: variant.isAvailable,
		attributes
	}
}

export type PriceAttributeLike = {
	attribute?: { key?: string | null } | null
	valueDecimal?: unknown
	valueInteger?: unknown
	valueString?: unknown
	valueDateTime?: unknown
}

export type PriceProductLike = {
	price: unknown
	productAttributes?: PriceAttributeLike[] | null
}

export type PriceLineInput = {
	product: PriceProductLike
	variant?: { price: unknown } | null
	saleUnit?: { price: unknown } | null
	modifiers?: PriceModifierLike[] | null
	quantity?: number
	unitPriceSnapshot?: unknown
	now?: Date
}

export type PriceModifierLike = {
	quantity?: unknown
	price?: unknown
	unitPriceSnapshot?: unknown
}

export type ResolvedLinePricing = {
	baseUnitPrice: number
	baseUnitPriceCents: number
	unitPrice: number
	unitPriceCents: number
	discountPercent: number
	hasDiscount: boolean
	lineTotal: number
	lineTotalCents: number
	quantity: number
}

type ProductDiscountRule = {
	discountPercent: number
	discountedPrice: number | null
	startAt: Date | null
	endAt: Date | null
}

function normalizeAttributeKey(value: string | null | undefined): string {
	return (value ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function readCustomString(value: object): string | null {
	const candidate = value as { toString?: () => string }
	if (
		typeof candidate.toString !== 'function' ||
		candidate.toString === Object.prototype.toString
	) {
		return null
	}
	return candidate.toString()
}

function toFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null
	}
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed : null
	}
	if (typeof value === 'object' && value !== null) {
		const text = readCustomString(value)
		if (!text) return null
		const parsed = Number(text)
		return Number.isFinite(parsed) ? parsed : null
	}
	return null
}

function toCents(value: unknown): number {
	const parsed = toFiniteNumber(value)
	if (parsed === null) return 0
	return Math.max(0, Math.round(parsed * 100))
}

function fromCents(value: number): number {
	return Number((value / 100).toFixed(2))
}

function resolveModifierUnitTotalCents(
	modifiers: PriceModifierLike[] | null | undefined
): number {
	return (modifiers ?? []).reduce((sum, modifier) => {
		const quantity = Math.max(
			1,
			Math.trunc(toFiniteNumber(modifier.quantity) ?? 1)
		)
		const price = modifier.unitPriceSnapshot ?? modifier.price
		return sum + toCents(price) * quantity
	}, 0)
}

function clampDiscountPercent(value: unknown): number {
	const parsed = toFiniteNumber(value)
	if (parsed === null) return 0
	return Math.min(100, Math.max(0, parsed))
}

function readAttributeNumber(attribute: PriceAttributeLike): number | null {
	return (
		toFiniteNumber(attribute.valueDecimal) ??
		toFiniteNumber(attribute.valueInteger) ??
		toFiniteNumber(attribute.valueString)
	)
}

function readAttributeDate(attribute: PriceAttributeLike): Date | null {
	const raw = attribute.valueDateTime ?? attribute.valueString
	if (!raw) return null

	const rawText =
		typeof raw === 'string' ||
		typeof raw === 'number' ||
		typeof raw === 'boolean' ||
		typeof raw === 'bigint'
			? String(raw)
			: typeof raw === 'object' && raw !== null
				? readCustomString(raw)
				: null
	const parsed = raw instanceof Date ? raw : rawText ? new Date(rawText) : null
	if (!parsed) return null
	return Number.isNaN(parsed.getTime()) ? null : parsed
}

function resolveDiscountRule(
	attributes: PriceAttributeLike[] | null | undefined
): ProductDiscountRule {
	const rule: ProductDiscountRule = {
		discountPercent: 0,
		discountedPrice: null,
		startAt: null,
		endAt: null
	}

	for (const attribute of attributes ?? []) {
		const key = normalizeAttributeKey(attribute.attribute?.key)
		if (key === 'discount') {
			rule.discountPercent = clampDiscountPercent(readAttributeNumber(attribute))
			continue
		}
		if (key === 'discountedprice') {
			const discountedPrice = readAttributeNumber(attribute)
			rule.discountedPrice =
				discountedPrice !== null && discountedPrice >= 0 ? discountedPrice : null
			continue
		}
		if (key === 'discountstartat') {
			rule.startAt = readAttributeDate(attribute)
			continue
		}
		if (key === 'discountendat') {
			rule.endAt = readAttributeDate(attribute)
		}
	}

	return rule
}

function isDiscountWindowActive(rule: ProductDiscountRule, now: Date): boolean {
	if (rule.startAt && now < rule.startAt) return false
	if (rule.endAt && now > rule.endAt) return false
	return true
}

function applyProductDiscountCents(
	baseUnitPriceCents: number,
	product: PriceProductLike,
	options: {
		canUseLegacyDiscountedPrice: boolean
		now: Date
	}
): number {
	if (baseUnitPriceCents <= 0) return baseUnitPriceCents

	const rule = resolveDiscountRule(product.productAttributes)
	if (!isDiscountWindowActive(rule, options.now)) return baseUnitPriceCents

	if (
		options.canUseLegacyDiscountedPrice &&
		rule.discountedPrice !== null &&
		rule.discountedPrice < fromCents(baseUnitPriceCents)
	) {
		return Math.min(baseUnitPriceCents, toCents(rule.discountedPrice))
	}

	if (rule.discountPercent <= 0) return baseUnitPriceCents

	return Math.max(
		0,
		Math.round(baseUnitPriceCents * ((100 - rule.discountPercent) / 100))
	)
}

function resolveDiscountPercent(
	baseUnitPriceCents: number,
	unitPriceCents: number
): number {
	if (baseUnitPriceCents <= 0 || unitPriceCents >= baseUnitPriceCents) return 0
	return Math.round(
		((baseUnitPriceCents - unitPriceCents) / baseUnitPriceCents) * 100
	)
}

export function resolveLinePricing(input: PriceLineInput): ResolvedLinePricing {
	const quantity = Math.max(0, Math.trunc(input.quantity ?? 1))
	const baseItemUnitPriceCents = toCents(
		input.saleUnit?.price ?? input.variant?.price ?? input.product.price
	)
	const modifierUnitTotalCents = resolveModifierUnitTotalCents(input.modifiers)
	const hasVariantOrSaleUnit = Boolean(input.saleUnit || input.variant)
	const discountedBaseItemUnitPriceCents = applyProductDiscountCents(
		baseItemUnitPriceCents,
		input.product,
		{
			canUseLegacyDiscountedPrice: !hasVariantOrSaleUnit,
			now: input.now ?? new Date()
		}
	)
	const snapshotBaseItemPriceCents =
		input.unitPriceSnapshot === undefined || input.unitPriceSnapshot === null
			? null
			: toCents(input.unitPriceSnapshot)
	const baseUnitPriceCents = baseItemUnitPriceCents + modifierUnitTotalCents
	const unitPriceCents =
		(snapshotBaseItemPriceCents ?? discountedBaseItemUnitPriceCents) +
		modifierUnitTotalCents
	const lineTotalCents = unitPriceCents * quantity
	const discountPercent = resolveDiscountPercent(
		baseUnitPriceCents,
		unitPriceCents
	)

	return {
		baseUnitPrice: fromCents(baseUnitPriceCents),
		baseUnitPriceCents,
		unitPrice: fromCents(unitPriceCents),
		unitPriceCents,
		discountPercent,
		hasDiscount: discountPercent > 0,
		lineTotal: fromCents(lineTotalCents),
		lineTotalCents,
		quantity
	}
}

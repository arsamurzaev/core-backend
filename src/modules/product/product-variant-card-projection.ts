import { ProductVariantKind, ProductVariantStatus } from '@generated/enums'

import {
	EMPTY_VARIANT_SUMMARY,
	type ProductVariantPickerOption,
	type ProductVariantProjection,
	type ProductVariantSummary
} from './contracts'

type ProductVariantSummarySource = ProductVariantSummary & {
	productId: string
}

export type ProductVariantPickerSource = {
	id: string
	productId?: string
	sku: string
	variantKey: string
	kind: ProductVariantKind
	price: unknown
	stock: number | null
	status: ProductVariantStatus
	isAvailable: boolean
	saleUnits?: SaleUnitPickerSource[] | null
	attributes: Array<{
		attribute: { displayOrder: number }
		enumValue?: {
			displayOrder?: number | null
			value: string
			displayName?: string | null
		} | null
	}>
}

const FALLBACK_VARIANT_LABEL = 'Вариация'
const DEFAULT_VARIANT_KEY = 'default'

function toSafeString(value: unknown): string {
	if (typeof value === 'string') return value
	if (
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	) {
		return String(value)
	}
	if (value instanceof Date) return value.toISOString()
	if (value && typeof value === 'object') {
		const toString = (value as { toString?: () => string }).toString
		if (
			typeof toString === 'function' &&
			toString !== Object.prototype.toString
		) {
			return toString.call(value) as string
		}
	}
	return ''
}

function toDecimalString(value: unknown): string | null {
	if (value === null || value === undefined) return null
	if (typeof value === 'string') return value
	if (typeof value === 'number') return value.toFixed(2)
	const normalized = toSafeString(value)
	if (normalized) return normalized

	return null
}

function toNumberValue(value: unknown): number | null {
	if (value === null || value === undefined) return null
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null
	}

	const parsed = Number(toSafeString(value))
	return Number.isFinite(parsed) ? parsed : null
}

type SaleUnitPickerSource = {
	id: string
	price: unknown
	baseQuantity: unknown
	isDefault?: boolean | null
	displayOrder?: number | null
}

type VariantPriceOptions = {
	canUseCatalogSaleUnits?: boolean
}

function resolveDefaultSaleUnit(
	variant: { saleUnits?: SaleUnitPickerSource[] | null } | null | undefined,
	options: VariantPriceOptions = {}
): SaleUnitPickerSource | null {
	if (options.canUseCatalogSaleUnits === false) return null

	const saleUnits = Array.isArray(variant?.saleUnits)
		? variant.saleUnits.filter(
				(unit): unit is SaleUnitPickerSource =>
					Boolean(unit) && typeof unit.id === 'string'
			)
		: []
	if (!saleUnits.length) return null

	return (
		saleUnits
			.slice()
			.sort(
				(left, right) =>
					Number(Boolean(right.isDefault)) - Number(Boolean(left.isDefault)) ||
					Number(left.displayOrder ?? 0) - Number(right.displayOrder ?? 0)
			)[0] ?? null
	)
}

function resolveVariantDisplayPrice(
	variant: ProductVariantPickerSource,
	options: VariantPriceOptions = {}
): unknown {
	return resolveDefaultSaleUnit(variant, options)?.price ?? variant.price
}

function resolveVariantMaxQuantity(
	variant: ProductVariantPickerSource,
	saleUnit: SaleUnitPickerSource | null
): number | null {
	if (variant.stock === null) return null

	const stock = Math.max(0, variant.stock)
	const baseQuantity = toNumberValue(saleUnit?.baseQuantity)
	if (baseQuantity === null || baseQuantity <= 0) return stock

	return Math.floor(stock / baseQuantity)
}

export function shouldBuildVariantPickerOptions(
	summary: ProductVariantSummary
): boolean {
	const activeCount = Math.max(0, summary.activeCount)
	const singleVariantId = summary.singleVariantId?.trim()

	return activeCount > 0 && !(activeCount === 1 && singleVariantId)
}

function buildVariantPickerLabel(variant: ProductVariantPickerSource): string {
	const values = variant.attributes
		.slice()
		.sort(
			(left, right) =>
				left.attribute.displayOrder - right.attribute.displayOrder ||
				(left.enumValue?.displayOrder ?? 0) - (right.enumValue?.displayOrder ?? 0)
		)
		.map(
			attribute =>
				attribute.enumValue?.displayName?.trim() ||
				attribute.enumValue?.value.trim()
		)
		.filter((value): value is string => Boolean(value))

	return (
		values.join(', ') ||
		variant.sku.trim() ||
		variant.variantKey.trim() ||
		FALLBACK_VARIANT_LABEL
	)
}

function isDefaultVariant(variant: ProductVariantPickerSource): boolean {
	return (
		variant.kind === ProductVariantKind.DEFAULT ||
		variant.variantKey === DEFAULT_VARIANT_KEY
	)
}

export function compareVariantPickerOptions(
	left: ProductVariantPickerSource,
	right: ProductVariantPickerSource
): number {
	const leftAttribute = left.attributes[0]
	const rightAttribute = right.attributes[0]

	return (
		(leftAttribute?.attribute.displayOrder ?? 0) -
			(rightAttribute?.attribute.displayOrder ?? 0) ||
		(leftAttribute?.enumValue?.displayOrder ?? 0) -
			(rightAttribute?.enumValue?.displayOrder ?? 0) ||
		buildVariantPickerLabel(left).localeCompare(buildVariantPickerLabel(right)) ||
		left.id.localeCompare(right.id)
	)
}

export function mapVariantPickerOption(
	variant: ProductVariantPickerSource,
	options: VariantPriceOptions = {}
): ProductVariantPickerOption {
	const defaultSaleUnit = resolveDefaultSaleUnit(variant, options)
	const displayPrice = resolveVariantDisplayPrice(variant, options)

	return {
		id: variant.id,
		label: buildVariantPickerLabel(variant),
		price: toDecimalString(displayPrice),
		stock: variant.stock,
		status: variant.status,
		isAvailable: variant.isAvailable,
		saleUnitId: defaultSaleUnit?.id ?? null,
		saleUnitPrice: toDecimalString(defaultSaleUnit?.price),
		maxQuantity: resolveVariantMaxQuantity(variant, defaultSaleUnit)
	}
}

export function buildVariantPickerOptionsFromVariants(
	variants: ProductVariantPickerSource[],
	summary: ProductVariantSummary,
	options: VariantPriceOptions = {}
): ProductVariantPickerOption[] {
	if (!shouldBuildVariantPickerOptions(summary)) {
		return []
	}

	return variants
		.filter(
			variant =>
				!isDefaultVariant(variant) &&
				variant.status !== ProductVariantStatus.DISABLED
		)
		.slice()
		.sort(compareVariantPickerOptions)
		.map(variant => mapVariantPickerOption(variant, options))
}

function resolveVariantTotalStock(
	variants: ProductVariantPickerSource[]
): number | null {
	if (!variants.length) return 0
	if (variants.some(variant => variant.stock === null)) return null
	return variants.reduce(
		(sum, variant) => sum + Math.max(0, variant.stock ?? 0),
		0
	)
}

export function buildVariantSummaryFromVariants(
	variants: ProductVariantPickerSource[],
	options: VariantPriceOptions = {}
): ProductVariantSummary {
	const activeVariants = variants.filter(
		variant =>
			!isDefaultVariant(variant) &&
			variant.status !== ProductVariantStatus.DISABLED
	)

	if (!activeVariants.length) {
		return { ...EMPTY_VARIANT_SUMMARY }
	}

	const prices = activeVariants
		.map(variant => toNumberValue(resolveVariantDisplayPrice(variant, options)))
		.filter((price): price is number => price !== null)
	if (!prices.length) {
		return {
			...EMPTY_VARIANT_SUMMARY,
			activeCount: activeVariants.length,
			totalStock: resolveVariantTotalStock(activeVariants),
			singleVariantId: activeVariants.length === 1 ? activeVariants[0].id : null
		}
	}
	const minPrice = Math.min(...prices)
	const maxPrice = Math.max(...prices)

	return {
		minPrice: minPrice.toFixed(2),
		maxPrice: maxPrice.toFixed(2),
		activeCount: activeVariants.length,
		totalStock: resolveVariantTotalStock(activeVariants),
		singleVariantId: activeVariants.length === 1 ? activeVariants[0].id : null
	}
}

export function buildVariantSummaryMap(
	summaries: ProductVariantSummarySource[]
): Map<string, ProductVariantSummary> {
	return new Map(
		summaries.map(summary => {
			const { productId, ...rest } = summary
			return [productId, rest] as const
		})
	)
}

export function buildVariantPickerOptionsMap(
	variants: ProductVariantPickerSource[],
	options: VariantPriceOptions = {}
): Map<string, ProductVariantPickerOption[]> {
	const map = new Map<string, ProductVariantPickerOption[]>()

	for (const variant of variants.slice().sort(compareVariantPickerOptions)) {
		const productOptions = map.get(variant.productId) ?? []
		productOptions.push(mapVariantPickerOption(variant, options))
		map.set(variant.productId, productOptions)
	}

	return map
}

export function createEmptyVariantProjection(): ProductVariantProjection {
	return {
		variantSummary: { ...EMPTY_VARIANT_SUMMARY },
		variantPickerOptions: []
	}
}

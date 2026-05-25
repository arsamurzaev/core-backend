import { ProductVariantKind, ProductVariantStatus } from '@generated/enums'

import type {
	ProductVariantPickerOptionRecord,
	ProductVariantSummaryRecord
} from './product.repository'

export type ProductVariantSummary = Omit<
	ProductVariantSummaryRecord,
	'productId'
>

export type ProductVariantPickerOption = {
	id: string
	label: string
	price: string | null
	stock: number | null
	status: ProductVariantPickerOptionRecord['status']
	isAvailable: boolean
	saleUnitId: string | null
	saleUnitPrice: string | null
	maxQuantity: number | null
}

export type ProductVariantProjection = {
	variantSummary: ProductVariantSummary
	variantPickerOptions: ProductVariantPickerOption[]
}

type ProductVariantPickerSource = Omit<
	ProductVariantPickerOptionRecord,
	'productId'
> & {
	productId?: string
}

export const EMPTY_VARIANT_SUMMARY: ProductVariantSummary = {
	minPrice: null,
	maxPrice: null,
	activeCount: 0,
	totalStock: 0,
	singleVariantId: null
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

function resolveDefaultSaleUnit(
	variant: { saleUnits?: SaleUnitPickerSource[] | null } | null | undefined
): SaleUnitPickerSource | null {
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

function resolveVariantDisplayPrice(variant: ProductVariantPickerSource): unknown {
	return resolveDefaultSaleUnit(variant)?.price ?? variant.price
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
	variant: ProductVariantPickerSource
): ProductVariantPickerOption {
	const defaultSaleUnit = resolveDefaultSaleUnit(variant)
	const displayPrice = resolveVariantDisplayPrice(variant)

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
	summary: ProductVariantSummary
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
		.map(mapVariantPickerOption)
}

export function buildVariantSummaryMap(
	summaries: ProductVariantSummaryRecord[]
): Map<string, ProductVariantSummary> {
	return new Map(
		summaries.map(summary => {
			const { productId, ...rest } = summary
			return [productId, rest] as const
		})
	)
}

export function buildVariantPickerOptionsMap(
	variants: ProductVariantPickerOptionRecord[]
): Map<string, ProductVariantPickerOption[]> {
	const map = new Map<string, ProductVariantPickerOption[]>()

	for (const variant of variants.slice().sort(compareVariantPickerOptions)) {
		const options = map.get(variant.productId) ?? []
		options.push(mapVariantPickerOption(variant))
		map.set(variant.productId, options)
	}

	return map
}

export function createEmptyVariantProjection(): ProductVariantProjection {
	return {
		variantSummary: { ...EMPTY_VARIANT_SUMMARY },
		variantPickerOptions: []
	}
}

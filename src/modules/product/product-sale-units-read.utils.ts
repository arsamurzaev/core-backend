import { ProductVariantKind } from '@generated/enums'

const DEFAULT_VARIANT_KEY = 'default'

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDefaultVariantRecord(variant: Record<string, unknown>): boolean {
	return (
		variant.kind === ProductVariantKind.DEFAULT ||
		variant.variantKey === DEFAULT_VARIANT_KEY
	)
}

export function resolveProductSaleUnitsForRead(
	product: { variants?: unknown },
	options: {
		canUseCatalogSaleUnits: boolean
		shouldExposeVariants: boolean
	}
): unknown[] {
	if (!options.canUseCatalogSaleUnits || options.shouldExposeVariants) return []

	const variants = Array.isArray(product.variants)
		? product.variants.filter(isRecord)
		: []
	const defaultVariant =
		variants.find(isDefaultVariantRecord) ??
		variants.find(
			variant =>
				Array.isArray(variant.attributes) && variant.attributes.length === 0
		) ??
		variants[0]
	const saleUnits = defaultVariant?.saleUnits

	return Array.isArray(saleUnits) ? saleUnits : []
}

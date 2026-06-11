import { ProductVariantKind } from '@generated/enums'

import type { CatalogPriceListProductPriceContext } from '@/modules/catalog-price-list/public'

const DEFAULT_VARIANT_KEY = 'default'

type PriceListSaleUnitSource = {
	id: string
	price?: unknown
}

type PriceListVariantSource = {
	id: string
	kind?: ProductVariantKind | null
	variantKey?: string | null
	price?: unknown
	saleUnits?: unknown
}

type ApplyPriceListContextOptions = {
	filterUnavailable?: boolean
	canUseCatalogSaleUnits?: boolean
}

function hasResolvedPrice(value: unknown): boolean {
	if (value === null || value === undefined) return false
	if (typeof value === 'string') return value.trim().length > 0
	return true
}

function isDefaultVariant(variant: PriceListVariantSource): boolean {
	return (
		variant.kind === ProductVariantKind.DEFAULT ||
		variant.variantKey === DEFAULT_VARIANT_KEY
	)
}

function isVariantSource(value: unknown): value is PriceListVariantSource {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { id?: unknown }).id === 'string'
	)
}

function isSaleUnitSource(value: unknown): value is PriceListSaleUnitSource {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof (value as { id?: unknown }).id === 'string'
	)
}

export function applyPriceListContextToProduct<
	T extends { id: string; price?: unknown; variants?: unknown }
>(
	product: T,
	context: CatalogPriceListProductPriceContext,
	options: ApplyPriceListContextOptions = {}
): T {
	if (!context.priceList) return product

	const filterUnavailable = options.filterUnavailable === true
	const productPrice = context.productPrices.get(product.id)
	const variants = Array.isArray(product.variants)
		? product.variants
				.filter(isVariantSource)
				.map(variant =>
					applyPriceListContextToVariant(product.id, variant, context, options)
				)
				.filter((variant): variant is PriceListVariantSource => variant !== null)
		: product.variants

	return {
		...product,
		price: productPrice ?? null,
		variants
	}
}

export function applyPriceListContextToVariant<
	T extends PriceListVariantSource
>(
	productId: string,
	variant: T,
	context: CatalogPriceListProductPriceContext,
	options: ApplyPriceListContextOptions = {}
): T | null {
	if (!context.priceList) return variant

	const filterUnavailable = options.filterUnavailable === true
	const canUseCatalogSaleUnits = options.canUseCatalogSaleUnits ?? true
	const sourceSaleUnits =
		canUseCatalogSaleUnits && Array.isArray(variant.saleUnits)
			? variant.saleUnits.filter(isSaleUnitSource)
			: []
	const requiresSaleUnitPrice = sourceSaleUnits.length > 0
	const saleUnits = canUseCatalogSaleUnits
		? sourceSaleUnits.reduce<PriceListSaleUnitSource[]>((acc, saleUnit) => {
				if (!isSaleUnitSource(saleUnit)) return acc
				const price = context.saleUnitPrices.get(saleUnit.id)
				if (hasResolvedPrice(price)) {
					acc.push({ ...saleUnit, price })
					return acc
				}
				if (!filterUnavailable) acc.push({ ...saleUnit, price: null })
				return acc
			}, [])
		: []
	const matrixVariant = !isDefaultVariant(variant)
	const variantPrice = context.variantPrices.get(variant.id)
	const productPrice = context.productPrices.get(productId)
	const displayPrice =
		saleUnits[0]?.price ??
		(requiresSaleUnitPrice
			? null
			: ((matrixVariant ? variantPrice : productPrice) ?? null))

	if (!hasResolvedPrice(displayPrice) && filterUnavailable) {
		return null
	}

	return {
		...variant,
		price: displayPrice,
		saleUnits
	}
}

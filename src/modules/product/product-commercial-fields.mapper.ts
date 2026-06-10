import type { ProductSellableProjection } from './contracts'

export type ProductCommercialFields = Pick<
	ProductSellableProjection,
	| 'priceState'
	| 'displayPrice'
	| 'minPrice'
	| 'maxPrice'
	| 'availabilityState'
	| 'stock'
	| 'defaultVariantId'
	| 'requiresVariantSelection'
	| 'usesPriceList'
	| 'priceListId'
	| 'priceListCode'
	| 'priceListName'
>

export function toProductCommercialFields(
	projection: ProductSellableProjection
): ProductCommercialFields {
	return {
		priceState: projection.priceState,
		displayPrice: projection.displayPrice,
		minPrice: projection.minPrice,
		maxPrice: projection.maxPrice,
		availabilityState: projection.availabilityState,
		stock: projection.stock,
		defaultVariantId: projection.defaultVariantId,
		requiresVariantSelection: projection.requiresVariantSelection,
		usesPriceList: projection.usesPriceList,
		priceListId: projection.priceListId,
		priceListCode: projection.priceListCode,
		priceListName: projection.priceListName
	}
}

export function toProductCommercialFieldsMap(
	projections: ReadonlyMap<string, ProductSellableProjection>
): Map<string, ProductCommercialFields> {
	return new Map(
		[...projections.entries()].map(([productId, projection]) => [
			productId,
			toProductCommercialFields(projection)
		])
	)
}

export function applyProductCommercialFields<T extends Record<string, unknown>>(
	product: T,
	commercial?: ProductCommercialFields
): T & ProductCommercialFields {
	const fields = commercial ?? buildFallbackProductCommercialFields(product)
	const price =
		fields.priceState === 'UNKNOWN' ? null : (fields.displayPrice ?? null)

	return {
		...product,
		price,
		...fields
	}
}

export function buildFallbackProductCommercialFields(product: {
	price?: unknown
}): ProductCommercialFields {
	const price = toDecimalString(product.price)
	return {
		priceState: price === null ? 'UNKNOWN' : 'KNOWN',
		displayPrice: price,
		minPrice: price,
		maxPrice: price,
		availabilityState: 'AVAILABLE',
		stock: null,
		defaultVariantId: null,
		requiresVariantSelection: false,
		usesPriceList: false,
		priceListId: null,
		priceListCode: null,
		priceListName: null
	}
}

function toDecimalString(value: unknown): string | null {
	if (value === null || value === undefined) return null
	if (typeof value === 'string') return value
	if (typeof value === 'number')
		return Number.isFinite(value) ? value.toFixed(2) : null
	if (
		typeof value === 'boolean' ||
		typeof value === 'bigint' ||
		value instanceof Date
	) {
		return String(value)
	}
	if (value && typeof value === 'object') {
		const candidate = value as {
			toNumber?: () => unknown
			toString?: () => string
		}
		if (typeof candidate.toNumber === 'function') {
			const numberValue = candidate.toNumber()
			if (typeof numberValue === 'number' && Number.isFinite(numberValue)) {
				return numberValue.toFixed(2)
			}
		}
		if (
			typeof candidate.toString === 'function' &&
			candidate.toString !== Object.prototype.toString
		) {
			const normalized = candidate.toString()
			return normalized ? normalized : null
		}
	}
	return null
}

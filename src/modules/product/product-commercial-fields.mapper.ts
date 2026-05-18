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
		requiresVariantSelection: projection.requiresVariantSelection
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

export function applyProductCommercialFields<
	T extends Record<string, unknown>
>(
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
		requiresVariantSelection: false
	}
}

function toDecimalString(value: unknown): string | null {
	if (value === null || value === undefined) return null
	if (typeof value === 'string') return value
	if (typeof value === 'number') return Number.isFinite(value) ? value.toFixed(2) : null
	if (
		typeof value === 'boolean' ||
		typeof value === 'bigint' ||
		value instanceof Date
	) {
		return String(value)
	}
	if (value && typeof value === 'object') {
		const toString = (value as { toString?: () => string }).toString
		if (
			typeof toString === 'function' &&
			toString !== Object.prototype.toString
		) {
			const normalized = toString.call(value)
			return normalized ? normalized : null
		}
	}
	return null
}

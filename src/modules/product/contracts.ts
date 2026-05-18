import type { ProductStatus } from '@generated/enums'

export const PRODUCT_COMMAND_PORT = Symbol('PRODUCT_COMMAND_PORT')
export const PRODUCT_READER_PORT = Symbol('PRODUCT_READER_PORT')
export const PRODUCT_SNAPSHOT_PORT = Symbol('PRODUCT_SNAPSHOT_PORT')
export const PRODUCT_VARIANT_RESOLVER_PORT = Symbol(
	'PRODUCT_VARIANT_RESOLVER_PORT'
)
export const PRODUCT_PRICING_PORT = Symbol('PRODUCT_PRICING_PORT')
export const PRODUCT_SELLABLE_READER_PORT = Symbol(
	'PRODUCT_SELLABLE_READER_PORT'
)
export const PRODUCT_EXTERNAL_SYNC_PORT = Symbol('PRODUCT_EXTERNAL_SYNC_PORT')
export const PRODUCT_MAINTENANCE_PORT = Symbol('PRODUCT_MAINTENANCE_PORT')

export type ProductSellableMode = 'SIMPLE' | 'MATRIX'
export type ProductSellablePriceState = 'UNKNOWN' | 'KNOWN' | 'RANGE'
export type ProductSellableAvailabilityState =
	| 'AVAILABLE'
	| 'OUT_OF_STOCK'
	| 'UNAVAILABLE'

export type ProductSellableResolveOptions = {
	variantId?: string | null
	quantity?: number
	enforceStock?: boolean
}

export type ProductSellableProjection = {
	catalogId: string
	productId: string
	mode: ProductSellableMode
	variantId: string | null
	defaultVariantId: string | null
	requiresVariantSelection: boolean
	priceState: ProductSellablePriceState
	displayPrice: string | null
	minPrice: string | null
	maxPrice: string | null
	availabilityState: ProductSellableAvailabilityState
	stock: number | null
}

export type ProductExternalDefaultVariantInput = {
	catalogId: string
	productId: string
	sku: string
	price: number | string | null
	stock?: number | null
	productStatus?: string | null
}

export type ProductExternalCommercialStateInput = {
	catalogId: string
	productId: string
}

export type ProductExternalSyncProductRecord = {
	id: string
	catalogId: string
	productTypeId: string | null
	name: string
	sku: string
	slug: string
	price: unknown
	status: ProductStatus
	deleteAt: Date | null
}

export type ProductExternalProductCreateInput = {
	catalogId: string
	name: string
	sku: string
	slug: string
	price: number | string | null
	status: string
	tx?: unknown
}

export type ProductExternalProductUpdateInput = {
	catalogId: string
	productId: string
	data: {
		name?: string
		sku?: string
		price?: number | string | null
		status?: string
	}
	tx?: unknown
}

export type ProductExternalProductDescriptionInput = {
	catalogId: string
	productId: string
	description?: string | null
	tx?: unknown
}

export type ProductExternalProductSoftDeleteInput = {
	catalogId: string
	productId: string
}

export type ProductExternalProductIdentityInput = {
	catalogId: string
	productId: string
	tx?: unknown
}

export type ProductExternalProductSkuInput = {
	catalogId: string
	sku: string
	tx?: unknown
}

export type ProductExternalProductSlugExistsInput = {
	catalogId: string
	slug: string
	excludeId?: string
	tx?: unknown
}

export type ProductExternalProductSkuExistsInput = {
	sku: string
	excludeId?: string
	tx?: unknown
}

export interface ProductReaderPort {
	getAll(...args: unknown[]): Promise<unknown>
	getPopular(...args: unknown[]): Promise<unknown>
	getPopularCards(...args: unknown[]): Promise<unknown>
	getInfinite(...args: unknown[]): Promise<unknown>
	getInfiniteCards(...args: unknown[]): Promise<unknown>
	getRecommendationsInfinite(...args: unknown[]): Promise<unknown>
	getRecommendationsInfiniteCards(...args: unknown[]): Promise<unknown>
	getUncategorizedInfinite(...args: unknown[]): Promise<unknown>
	getUncategorizedInfiniteCards(...args: unknown[]): Promise<unknown>
	getById(id: string, ...args: unknown[]): Promise<unknown>
	getBySlug(slug: string, ...args: unknown[]): Promise<unknown>
}

export interface ProductCommandPort {
	create(...args: unknown[]): Promise<unknown>
	update(id: string, ...args: unknown[]): Promise<unknown>
	remove(id: string, ...args: unknown[]): Promise<unknown>
}

export interface ProductSnapshotPort {
	buildOrderSnapshot?(input: unknown): Promise<unknown>
}

export interface ProductVariantResolverPort {
	resolvePurchasableVariant?(input: unknown): Promise<unknown>
}

export interface ProductPricingPort {
	resolveLinePrice(input: unknown): unknown
}

export interface ProductSellableReader {
	resolveProductSellable(
		catalogId: string,
		productId: string,
		options?: ProductSellableResolveOptions
	): Promise<ProductSellableProjection>

	resolveProductsSellable(
		catalogId: string,
		productIds: string[],
		options?: ProductSellableResolveOptions
	): Promise<Map<string, ProductSellableProjection>>

	resolveVariantSellable(
		catalogId: string,
		productId: string,
		variantId: string,
		options?: ProductSellableResolveOptions
	): Promise<ProductSellableProjection>
}

export interface ProductExternalSyncPort {
	upsertExternalProduct?(input: unknown): Promise<unknown>
	upsertExternalVariant?(input: unknown): Promise<unknown>

	findExternalProductById(
		input: ProductExternalProductIdentityInput
	): Promise<ProductExternalSyncProductRecord | null>

	findExternalProductBySku(
		input: ProductExternalProductSkuInput
	): Promise<ProductExternalSyncProductRecord | null>

	existsExternalProductSlug(
		input: ProductExternalProductSlugExistsInput
	): Promise<boolean>

	existsExternalProductSku(
		input: ProductExternalProductSkuExistsInput
	): Promise<boolean>

	createExternalProduct(
		input: ProductExternalProductCreateInput
	): Promise<ProductExternalSyncProductRecord>

	updateExternalProduct(
		input: ProductExternalProductUpdateInput
	): Promise<ProductExternalSyncProductRecord | null>

	syncExternalProductDescription(
		input: ProductExternalProductDescriptionInput
	): Promise<boolean>

	softDeleteExternalProduct(
		input: ProductExternalProductSoftDeleteInput
	): Promise<boolean>

	ensureDefaultVariant(
		input: ProductExternalDefaultVariantInput
	): Promise<boolean | null>

	recomputeProductCommercialState(
		input: ProductExternalCommercialStateInput
	): Promise<boolean>
}

export type ProductMaintenanceResult = {
	updatedProducts: number
	affectedCatalogs: number
}

export interface ProductMaintenancePort {
	expireScheduledDiscounts(now?: Date): Promise<ProductMaintenanceResult>
	repairMissingDefaultVariantsForCatalog(catalogId: string): Promise<unknown>
	diagnoseDefaultVariantsForCatalog(
		catalogId: string,
		sampleLimit?: number
	): Promise<unknown>
	repairDefaultVariantPriceMismatchesForCatalog(
		catalogId: string,
		options?: {
			apply?: boolean
			batchSize?: number
			sampleLimit?: number
		}
	): Promise<unknown>
}

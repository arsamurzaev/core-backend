export const PRODUCT_COMMAND_PORT = Symbol('PRODUCT_COMMAND_PORT')
export const PRODUCT_READER_PORT = Symbol('PRODUCT_READER_PORT')
export const PRODUCT_SNAPSHOT_PORT = Symbol('PRODUCT_SNAPSHOT_PORT')
export const PRODUCT_VARIANT_RESOLVER_PORT = Symbol(
	'PRODUCT_VARIANT_RESOLVER_PORT'
)
export const PRODUCT_PRICING_PORT = Symbol('PRODUCT_PRICING_PORT')

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

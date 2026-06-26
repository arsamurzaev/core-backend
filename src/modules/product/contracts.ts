import type { Prisma } from '@generated/client'
import type {
	CatalogPriceListPriceTarget,
	ProductStatus,
	ProductVariantStatus
} from '@generated/enums'

import type { CatalogPriceListProductPriceContext } from '@/modules/catalog-price-list/public'
import type { ProductMappableRecord } from '@/shared/media/product-media.mapper'
import type {
	PriceLineInput,
	ResolvedLinePricing
} from '@/shared/order/price-resolver.utils'

export const PRODUCT_COMMAND_PORT = Symbol('PRODUCT_COMMAND_PORT')
export const PRODUCT_READER_PORT = Symbol('PRODUCT_READER_PORT')
export const PRODUCT_PRICING_PORT = Symbol('PRODUCT_PRICING_PORT')
export const PRODUCT_SELLABLE_READER_PORT = Symbol(
	'PRODUCT_SELLABLE_READER_PORT'
)
export const PRODUCT_EXTERNAL_SYNC_PORT = Symbol('PRODUCT_EXTERNAL_SYNC_PORT')
export const PRODUCT_MAINTENANCE_PORT = Symbol('PRODUCT_MAINTENANCE_PORT')
export const PRODUCT_VARIANT_PROJECTION_PORT = Symbol(
	'PRODUCT_VARIANT_PROJECTION_PORT'
)
export const PRODUCT_CATEGORY_READ_PROJECTOR_PORT = Symbol(
	'PRODUCT_CATEGORY_READ_PROJECTOR_PORT'
)

export type ProductSellableMode = 'SIMPLE' | 'MATRIX'
export type ProductSellablePriceState = 'UNKNOWN' | 'KNOWN' | 'RANGE'
export type ProductSellableAvailabilityState =
	| 'AVAILABLE'
	| 'OUT_OF_STOCK'
	| 'UNAVAILABLE'
export type ProductTransaction = Prisma.TransactionClient
export type ProductExternalTransaction = ProductTransaction
export type ProductCommandProductResult = { id: string } & Record<
	string,
	unknown
>
export type ProductAttributeValueInput = {
	attributeId: string
	enumValueId?: string
	valueString?: string
	valueInteger?: number
	valueDecimal?: number
	valueBoolean?: boolean
	valueDateTime?: string
}
export type ProductVariantSaleUnitCommandInput = {
	catalogSaleUnitId: string
	code?: string
	name?: string
	baseQuantity: number
	price: number
	barcode?: string | null
	isDefault?: boolean
	isActive?: boolean
	displayOrder?: number
}
export type ProductVariantAttributeCommandInput = {
	attributeId: string
	enumValueId?: string
	value?: string
}
export type ProductVariantCommandInput = {
	price?: number | null
	stock?: number | null
	isAvailable?: boolean
	status?: ProductVariantStatus
	attributes?: ProductVariantAttributeCommandInput[]
	saleUnits?: ProductVariantSaleUnitCommandInput[]
}
export type ProductVariantUpdateCommandInput = {
	variantKey: string
	price?: number | null
	stock?: number | null
	status?: ProductVariantStatus
	saleUnits?: ProductVariantSaleUnitCommandInput[]
}
export type ProductCreatePriceListVariantAttributeInput = {
	attributeId: string
	enumValueId: string
}
export type ProductCreatePriceListPriceInput = {
	priceListId: string
	target: CatalogPriceListPriceTarget
	price: number
	variantAttributes?: ProductCreatePriceListVariantAttributeInput[]
	catalogSaleUnitId?: string
}
export type ProductCreateCommandInput = {
	name: string
	price?: number | null
	mediaIds?: string[]
	isPopular?: boolean
	status?: ProductStatus
	position?: number
	brandId?: string | null
	productTypeId?: string | null
	categories?: string[]
	attributes?: ProductAttributeValueInput[]
	saleUnits?: ProductVariantSaleUnitCommandInput[]
	variants?: ProductVariantCommandInput[]
	priceListPrices?: ProductCreatePriceListPriceInput[]
}
export type ProductUpdateCommandInput = {
	name?: string
	price?: number | null
	mediaIds?: string[]
	isPopular?: boolean
	status?: ProductStatus
	position?: number
	brandId?: string | null
	productTypeId?: string | null
	categories?: string[]
	categoryId?: string
	categoryPosition?: number
	attributes?: ProductAttributeValueInput[]
	removeAttributeIds?: string[]
	saleUnits?: ProductVariantSaleUnitCommandInput[]
	variants?: ProductVariantUpdateCommandInput[]
	variantMatrix?: ProductVariantCommandInput[]
}
export type ProductRemoveResult = {
	ok: boolean
}
export type ProductReadQuery = Record<string, unknown>
export type ProductReadOptions = {
	includeInactive?: boolean
	includeVariantIntegration?: boolean
	applyPriceList?: boolean
	enforcePriceListVisibility?: boolean
}
export type ProductUncategorizedReadOptions = ProductReadOptions & {
	cursor?: string
	limit?: number | string
}
export type ProductVariantProjectionResolveOptions = {
	filterUnavailable?: boolean
	canUseCatalogSaleUnits?: boolean
}
export type ProductVariantSummary = {
	minPrice: string | null
	maxPrice: string | null
	activeCount: number
	totalStock: number | null
	singleVariantId: string | null
}
export const EMPTY_VARIANT_SUMMARY: ProductVariantSummary = {
	minPrice: null,
	maxPrice: null,
	activeCount: 0,
	totalStock: 0,
	singleVariantId: null
}
export type ProductVariantPickerOption = {
	id: string
	label: string
	price: string | null
	stock: number | null
	status: ProductVariantStatus
	isAvailable: boolean
	saleUnitId: string | null
	saleUnitPrice: string | null
	maxQuantity: number | null
}
export type ProductVariantProjection = {
	variantSummary: ProductVariantSummary
	variantPickerOptions: ProductVariantPickerOption[]
}
export type ProductReaderListItem = { id: string } & Record<string, unknown>
export type ProductReaderDetailsItem = ProductReaderListItem
export type ProductReaderInfinitePage = {
	items: ProductReaderListItem[]
	nextCursor: string | null
	seed: string | null
}
export type ProductReaderCursorPage = {
	items: ProductReaderListItem[]
	nextCursor: string | null
}
export type ProductCategoryReadSource = ProductMappableRecord & {
	id: string
	price?: unknown
	productType?: { id?: string | null } | null
}
export type ProductCategoryReadProjectionInput<
	TProduct extends ProductCategoryReadSource = ProductCategoryReadSource
> = {
	catalogId: string
	buyerCatalogId: string
	products: TProduct[]
	canUseCatalogSaleUnits: boolean
	applyPriceList?: boolean
	enforcePriceListVisibility?: boolean
}
export type ProductCategoryVisibleProductIdsInput = {
	catalogId: string
	buyerCatalogId: string
	productIds: string[]
}

export type ProductSellableResolveOptions = {
	variantId?: string | null
	buyerCatalogId?: string | null
	ignorePriceList?: boolean
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
	usesPriceList: boolean
	priceListId: string | null
	priceListCode: string | null
	priceListName: string | null
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
	price: Prisma.Decimal | null
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
	isPopular?: boolean
	position?: number
	tx?: ProductExternalTransaction
}

export type ProductExternalProductUpdateInput = {
	catalogId: string
	productId: string
	data: {
		name?: string
		sku?: string
		slug?: string
		price?: number | string | null
		status?: string
		isPopular?: boolean
		position?: number
	}
	tx?: ProductExternalTransaction
}

export type ProductExternalProductDescriptionInput = {
	catalogId: string
	productId: string
	description?: string | null
	tx?: ProductExternalTransaction
}

export type ProductExternalProductSoftDeleteInput = {
	catalogId: string
	productId: string
}

export type ProductExternalProductIdentityInput = {
	catalogId: string
	productId: string
	tx?: ProductExternalTransaction
}

export type ProductExternalProductSkuInput = {
	catalogId: string
	sku: string
	tx?: ProductExternalTransaction
}

export type ProductExternalProductSlugExistsInput = {
	catalogId: string
	slug: string
	excludeId?: string
	tx?: ProductExternalTransaction
}

export type ProductExternalProductSkuExistsInput = {
	sku: string
	excludeId?: string
	tx?: ProductExternalTransaction
}

export interface ProductReaderPort {
	getAll(options?: ProductReadOptions): Promise<ProductReaderListItem[]>
	getPopular(options?: ProductReadOptions): Promise<ProductReaderListItem[]>
	getPopularCards(options?: ProductReadOptions): Promise<ProductReaderListItem[]>
	getInfinite(
		query: ProductReadQuery,
		options?: ProductReadOptions
	): Promise<ProductReaderInfinitePage>
	getInfiniteCards(
		query: ProductReadQuery,
		options?: ProductReadOptions
	): Promise<ProductReaderInfinitePage>
	getRecommendationsInfinite(
		query: ProductReadQuery,
		options?: ProductReadOptions
	): Promise<ProductReaderInfinitePage>
	getRecommendationsInfiniteCards(
		query: ProductReadQuery,
		options?: ProductReadOptions
	): Promise<ProductReaderInfinitePage>
	getUncategorizedInfinite(
		options?: ProductUncategorizedReadOptions
	): Promise<ProductReaderCursorPage>
	getUncategorizedInfiniteCards(
		options?: ProductUncategorizedReadOptions
	): Promise<ProductReaderCursorPage>
	getById(
		id: string,
		options?: ProductReadOptions
	): Promise<ProductReaderDetailsItem>
	getBySlug(
		slug: string,
		options?: ProductReadOptions
	): Promise<ProductReaderDetailsItem>
}

export interface ProductCategoryReadProjectorPort {
	mapCategoryProducts<TProduct extends ProductCategoryReadSource>(
		input: ProductCategoryReadProjectionInput<TProduct>
	): Promise<Array<ProductReaderListItem | null>>
	resolveVisibleCategoryProductIds(
		input: ProductCategoryVisibleProductIdsInput
	): Promise<Set<string> | null>
}

export interface ProductCommandPort {
	create(dto: ProductCreateCommandInput): Promise<ProductCommandProductResult>
	update(
		id: string,
		dto: ProductUpdateCommandInput
	): Promise<ProductCommandProductResult>
	remove(id: string): Promise<ProductRemoveResult>
}

export interface ProductPricingPort {
	resolveLinePrice(input: PriceLineInput): ResolvedLinePricing
}

export interface ProductVariantProjectionReader {
	resolveForProductIds(
		productIds: string[],
		priceContext?: CatalogPriceListProductPriceContext,
		options?: ProductVariantProjectionResolveOptions
	): Promise<Map<string, ProductVariantProjection>>
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
export type ProductDefaultVariantRepairResult = {
	checkedProducts: number
	repairedProducts: number
	affectedCatalogs: number
}
export type ProductDefaultVariantDiagnosticCode =
	| 'SIMPLE_WITHOUT_DEFAULT_VARIANT'
	| 'MULTIPLE_DEFAULT_VARIANTS'
	| 'CUSTOM_VARIANT_WITHOUT_ATTRIBUTES'
	| 'DEFAULT_VARIANT_WITH_ATTRIBUTES'
	| 'DEFAULT_VARIANT_PRICE_MISMATCH'
export type ProductDefaultVariantDiagnosticStatus = 'ok' | 'warn' | 'fail'
export type ProductDefaultVariantDiagnosticSample = {
	productId: string
	productName: string
	productSku: string
	variantId: string | null
	variantKey: string | null
	variantSku: string | null
	details: string | null
}
export type ProductDefaultVariantDiagnosticCheck = {
	code: ProductDefaultVariantDiagnosticCode
	status: ProductDefaultVariantDiagnosticStatus
	count: number
	message: string
	samples: ProductDefaultVariantDiagnosticSample[]
}
export type ProductDefaultVariantDiagnostics = {
	catalogId: string
	sampleLimit: number
	checks: ProductDefaultVariantDiagnosticCheck[]
	warnCount: number
	failCount: number
	ok: boolean
}
export type ProductDefaultVariantPriceMismatchRepairOptions = {
	apply?: boolean
	batchSize?: number
	sampleLimit?: number
}
export type ProductDefaultVariantPriceMismatchRepairCandidate = {
	productId: string
	productName: string
	productSku: string
	variantId: string
	variantKey: string
	variantSku: string
	previousProductPrice: string | null
	nextProductPrice: string | null
}
export type ProductDefaultVariantPriceMismatchRepairResult = {
	catalogId: string
	dryRun: boolean
	checkedProducts: number
	repairableProducts: number
	updatedProducts: number
	affectedCatalogs: number
	batchSize: number
	sampleLimit: number
	samples: ProductDefaultVariantPriceMismatchRepairCandidate[]
}
export type ProductDefaultVariantRepairOptions = {
	tx?: ProductTransaction
}

export interface ProductMaintenancePort {
	expireScheduledDiscounts(now?: Date): Promise<ProductMaintenanceResult>
	repairMissingDefaultVariantForProduct(
		catalogId: string,
		productId: string,
		options?: ProductDefaultVariantRepairOptions
	): Promise<boolean | null>
	repairMissingDefaultVariantsForCatalog(
		catalogId: string
	): Promise<ProductDefaultVariantRepairResult>
	diagnoseDefaultVariantsForCatalog(
		catalogId: string,
		sampleLimit?: number
	): Promise<ProductDefaultVariantDiagnostics>
	repairDefaultVariantPriceMismatchesForCatalog(
		catalogId: string,
		options?: ProductDefaultVariantPriceMismatchRepairOptions
	): Promise<ProductDefaultVariantPriceMismatchRepairResult>
}

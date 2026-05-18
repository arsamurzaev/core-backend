import {
	DataType,
	IntegrationProvider,
	ProductStatus,
	ProductVariantKind,
	ProductVariantStatus
} from '@generated/enums'
import { ApiProperty } from '@nestjs/swagger'

import { SeoDto } from '@/modules/seo/public'
import { MediaDto } from '@/shared/media/dto/media.dto.res'

export class ProductAttributeEnumValueDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	value: string

	@ApiProperty({ type: String, nullable: true })
	displayName: string | null

	@ApiProperty({ type: Number })
	displayOrder: number

	@ApiProperty({ type: String, nullable: true })
	businessId: string | null
}

export class ProductAttributeRefDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	key: string

	@ApiProperty({ type: String })
	displayName: string

	@ApiProperty({ enum: DataType })
	dataType: DataType

	@ApiProperty({ type: Boolean })
	isRequired: boolean

	@ApiProperty({ type: Boolean })
	isVariantAttribute: boolean

	@ApiProperty({ type: Boolean })
	isFilterable: boolean

	@ApiProperty({ type: Number })
	displayOrder: number

	@ApiProperty({ type: Boolean })
	isHidden: boolean
}

export class ProductAttributeDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	attributeId: string

	@ApiProperty({ type: String, nullable: true })
	enumValueId: string | null

	@ApiProperty({ type: String, nullable: true })
	valueString: string | null

	@ApiProperty({ type: Number, nullable: true })
	valueInteger: number | null

	@ApiProperty({ type: String, nullable: true })
	valueDecimal: string | null

	@ApiProperty({ type: Boolean, nullable: true })
	valueBoolean: boolean | null

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	valueDateTime: string | null

	@ApiProperty({ type: ProductAttributeRefDto })
	attribute: ProductAttributeRefDto

	@ApiProperty({ type: ProductAttributeEnumValueDto, nullable: true })
	enumValue: ProductAttributeEnumValueDto | null
}

export class VariantAttributeDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	attributeId: string

	@ApiProperty({ type: String })
	enumValueId: string

	@ApiProperty({ type: ProductAttributeRefDto })
	attribute: ProductAttributeRefDto

	@ApiProperty({ type: ProductAttributeEnumValueDto })
	enumValue: ProductAttributeEnumValueDto
}

export class ProductIntegrationDto {
	@ApiProperty({ enum: IntegrationProvider })
	provider: IntegrationProvider

	@ApiProperty({ type: String })
	externalId: string

	@ApiProperty({ type: String, nullable: true })
	externalCode: string | null

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	lastSyncedAt: string | null
}

export class ProductVariantCatalogSaleUnitDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String, example: '1.0000' })
	defaultBaseQuantity: string
}

export class ProductVariantSaleUnitDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String, nullable: true })
	catalogSaleUnitId: string | null

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String, example: '1.0000' })
	baseQuantity: string

	@ApiProperty({ type: String, example: '999.00' })
	price: string

	@ApiProperty({ type: String, nullable: true })
	barcode: string | null

	@ApiProperty({ type: Boolean })
	isDefault: boolean

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: Number })
	displayOrder: number

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string

	@ApiProperty({ type: () => ProductVariantCatalogSaleUnitDto, nullable: true })
	catalogSaleUnit: ProductVariantCatalogSaleUnitDto | null
}

export class ProductVariantDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	sku: string

	@ApiProperty({ type: String })
	variantKey: string

	@ApiProperty({ enum: ProductVariantKind })
	kind: ProductVariantKind

	@ApiProperty({ type: Number, nullable: true })
	stock: number | null

	@ApiProperty({ type: String, example: '0.00', nullable: true })
	price: string | null

	@ApiProperty({ enum: ProductVariantStatus })
	status: ProductVariantStatus

	@ApiProperty({ type: Boolean })
	isAvailable: boolean

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string

	@ApiProperty({ type: [VariantAttributeDto] })
	attributes: VariantAttributeDto[]

	@ApiProperty({ type: [ProductVariantSaleUnitDto] })
	saleUnits: ProductVariantSaleUnitDto[]

	@ApiProperty({
		type: () => ProductIntegrationDto,
		nullable: true,
		required: false
	})
	integration?: ProductIntegrationDto | null
}

export class ProductMediaDto {
	@ApiProperty({ type: Number })
	position: number

	@ApiProperty({ type: String, nullable: true })
	kind: string | null

	@ApiProperty({ type: MediaDto })
	media: MediaDto
}

export class ProductBrandDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String })
	slug: string
}

export class ProductTypeRefDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string
}

export class ProductCategoryDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: Number })
	position: number
}

export class ProductVariantSummaryDto {
	@ApiProperty({ type: String, nullable: true, example: '999.00' })
	minPrice: string | null

	@ApiProperty({ type: String, nullable: true, example: '1299.00' })
	maxPrice: string | null

	@ApiProperty({ type: Number })
	activeCount: number

	@ApiProperty({ type: Number, nullable: true })
	totalStock: number | null

	@ApiProperty({ type: String, nullable: true })
	singleVariantId: string | null
}

export class ProductVariantPickerOptionDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	label: string

	@ApiProperty({ type: String, example: '999.00', nullable: true })
	price: string | null

	@ApiProperty({ type: Number, nullable: true })
	stock: number | null

	@ApiProperty({ enum: ProductVariantStatus })
	status: ProductVariantStatus

	@ApiProperty({ type: Boolean })
	isAvailable: boolean

	@ApiProperty({ type: String, nullable: true })
	saleUnitId: string | null

	@ApiProperty({ type: String, nullable: true, example: '999.00' })
	saleUnitPrice: string | null

	@ApiProperty({ type: Number, nullable: true })
	maxQuantity: number | null
}

export class ProductDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	sku: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String })
	slug: string

	@ApiProperty({ type: String, example: '999.00', nullable: true })
	price: string | null

	@ApiProperty({ enum: ['UNKNOWN', 'KNOWN', 'RANGE'] })
	priceState: 'UNKNOWN' | 'KNOWN' | 'RANGE'

	@ApiProperty({ type: String, example: '999.00', nullable: true })
	displayPrice: string | null

	@ApiProperty({ type: String, example: '999.00', nullable: true })
	minPrice: string | null

	@ApiProperty({ type: String, example: '1299.00', nullable: true })
	maxPrice: string | null

	@ApiProperty({ enum: ['AVAILABLE', 'OUT_OF_STOCK', 'UNAVAILABLE'] })
	availabilityState: 'AVAILABLE' | 'OUT_OF_STOCK' | 'UNAVAILABLE'

	@ApiProperty({ type: Number, nullable: true })
	stock: number | null

	@ApiProperty({ type: String, nullable: true })
	defaultVariantId: string | null

	@ApiProperty({ type: Boolean })
	requiresVariantSelection: boolean

	@ApiProperty({ type: [ProductMediaDto] })
	media: ProductMediaDto[]

	@ApiProperty({ type: ProductBrandDto, nullable: true })
	brand: ProductBrandDto | null

	@ApiProperty({ type: ProductTypeRefDto, nullable: true })
	productType: ProductTypeRefDto | null

	@ApiProperty({ type: [ProductCategoryDto] })
	categories: ProductCategoryDto[]

	@ApiProperty({ type: ProductIntegrationDto, nullable: true })
	integration: ProductIntegrationDto | null

	@ApiProperty({ type: Boolean })
	isPopular: boolean

	@ApiProperty({ enum: ProductStatus })
	status: ProductStatus

	@ApiProperty({ type: Number })
	position: number

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}

export class ProductWithAttributesDto extends ProductDto {
	@ApiProperty({ type: [ProductAttributeDto] })
	productAttributes: ProductAttributeDto[]

	@ApiProperty({ type: ProductVariantSummaryDto })
	variantSummary: ProductVariantSummaryDto

	@ApiProperty({ type: [ProductVariantPickerOptionDto] })
	variantPickerOptions: ProductVariantPickerOptionDto[]
}

export class ProductWithDetailsDto extends ProductWithAttributesDto {
	@ApiProperty({ type: [ProductVariantDto] })
	variants: ProductVariantDto[]

	@ApiProperty({ type: SeoDto, nullable: true })
	seo: SeoDto | null
}

export class ProductInfinitePageDto {
	@ApiProperty({ type: [ProductWithAttributesDto] })
	items: ProductWithAttributesDto[]

	@ApiProperty({ type: String, nullable: true })
	nextCursor: string | null

	@ApiProperty({
		type: String,
		nullable: true,
		description: 'Стабильный seed для детерминированной рандомизации'
	})
	seed: string | null
}

export class ProductCardPageDto {
	@ApiProperty({ type: [ProductWithAttributesDto] })
	items: ProductWithAttributesDto[]

	@ApiProperty({ type: String, nullable: true })
	nextCursor: string | null

	@ApiProperty({
		type: String,
		nullable: true,
		description: 'Стабильный seed для детерминированной рандомизации'
	})
	seed: string | null
}

export class ProductCursorPageDto {
	@ApiProperty({ type: [ProductWithAttributesDto] })
	items: ProductWithAttributesDto[]

	@ApiProperty({ type: String, nullable: true })
	nextCursor: string | null
}

export class ProductCursorCardPageDto {
	@ApiProperty({ type: [ProductWithAttributesDto] })
	items: ProductWithAttributesDto[]

	@ApiProperty({ type: String, nullable: true })
	nextCursor: string | null
}

export class ProductDefaultVariantRepairResponseDto {
	@ApiProperty({ type: Number })
	checkedProducts: number

	@ApiProperty({ type: Number })
	repairedProducts: number

	@ApiProperty({ type: Number })
	affectedCatalogs: number
}

export class ProductDefaultVariantDiagnosticSampleDto {
	@ApiProperty({ type: String })
	productId: string

	@ApiProperty({ type: String })
	productName: string

	@ApiProperty({ type: String })
	productSku: string

	@ApiProperty({ type: String, nullable: true })
	variantId: string | null

	@ApiProperty({ type: String, nullable: true })
	variantKey: string | null

	@ApiProperty({ type: String, nullable: true })
	variantSku: string | null

	@ApiProperty({ type: String, nullable: true })
	details: string | null
}

export class ProductDefaultVariantDiagnosticCheckDto {
	@ApiProperty({
		enum: [
			'SIMPLE_WITHOUT_DEFAULT_VARIANT',
			'MULTIPLE_DEFAULT_VARIANTS',
			'CUSTOM_VARIANT_WITHOUT_ATTRIBUTES',
			'DEFAULT_VARIANT_WITH_ATTRIBUTES',
			'DEFAULT_VARIANT_PRICE_MISMATCH'
		]
	})
	code:
		| 'SIMPLE_WITHOUT_DEFAULT_VARIANT'
		| 'MULTIPLE_DEFAULT_VARIANTS'
		| 'CUSTOM_VARIANT_WITHOUT_ATTRIBUTES'
		| 'DEFAULT_VARIANT_WITH_ATTRIBUTES'
		| 'DEFAULT_VARIANT_PRICE_MISMATCH'

	@ApiProperty({ enum: ['ok', 'warn', 'fail'] })
	status: 'ok' | 'warn' | 'fail'

	@ApiProperty({ type: Number })
	count: number

	@ApiProperty({ type: String })
	message: string

	@ApiProperty({ type: [ProductDefaultVariantDiagnosticSampleDto] })
	samples: ProductDefaultVariantDiagnosticSampleDto[]
}

export class ProductDefaultVariantDiagnosticsResponseDto {
	@ApiProperty({ type: String })
	catalogId: string

	@ApiProperty({ type: Number })
	sampleLimit: number

	@ApiProperty({ type: [ProductDefaultVariantDiagnosticCheckDto] })
	checks: ProductDefaultVariantDiagnosticCheckDto[]

	@ApiProperty({ type: Number })
	warnCount: number

	@ApiProperty({ type: Number })
	failCount: number

	@ApiProperty({ type: Boolean })
	ok: boolean
}

export class ProductDefaultVariantPriceMismatchRepairSampleDto {
	@ApiProperty({ type: String })
	productId: string

	@ApiProperty({ type: String })
	productName: string

	@ApiProperty({ type: String })
	productSku: string

	@ApiProperty({ type: String })
	variantId: string

	@ApiProperty({ type: String })
	variantSku: string

	@ApiProperty({ type: String })
	variantKey: string

	@ApiProperty({ type: String, nullable: true })
	previousProductPrice: string | null

	@ApiProperty({ type: String, nullable: true })
	nextProductPrice: string | null
}

export class ProductDefaultVariantPriceMismatchRepairResponseDto {
	@ApiProperty({ type: String })
	catalogId: string

	@ApiProperty({ type: Boolean })
	dryRun: boolean

	@ApiProperty({ type: Number })
	checkedProducts: number

	@ApiProperty({ type: Number })
	repairableProducts: number

	@ApiProperty({ type: Number })
	updatedProducts: number

	@ApiProperty({ type: Number })
	affectedCatalogs: number

	@ApiProperty({ type: Number })
	batchSize: number

	@ApiProperty({ type: Number })
	sampleLimit: number

	@ApiProperty({ type: [ProductDefaultVariantPriceMismatchRepairSampleDto] })
	samples: ProductDefaultVariantPriceMismatchRepairSampleDto[]
}

export class ProductTypeCompatibilityIssueDto {
	@ApiProperty({ type: String })
	attributeId: string

	@ApiProperty({ type: String })
	key: string

	@ApiProperty({ type: String })
	displayName: string

	@ApiProperty({ type: [String] })
	variantKeys: string[]

	@ApiProperty({
		enum: ['MISSING_IN_TARGET_TYPE', 'SCOPE_MISMATCH', 'TARGET_TYPE_EMPTY']
	})
	reason: 'MISSING_IN_TARGET_TYPE' | 'SCOPE_MISMATCH' | 'TARGET_TYPE_EMPTY'

	@ApiProperty({ type: Boolean, nullable: true })
	targetIsVariant: boolean | null
}

export class ProductTypeCompatibilityPreviewDto {
	@ApiProperty({ type: String })
	productId: string

	@ApiProperty({ type: String, nullable: true })
	currentProductTypeId: string | null

	@ApiProperty({ type: String, nullable: true })
	requestedProductTypeId: string | null

	@ApiProperty({ type: Boolean })
	sameProductType: boolean

	@ApiProperty({ type: Boolean })
	hasScopedData: boolean

	@ApiProperty({ type: Boolean })
	canChangeNow: boolean

	@ApiProperty({ type: Boolean })
	compatible: boolean

	@ApiProperty({ type: Boolean })
	requiresUserDecision: boolean

	@ApiProperty({ type: String, nullable: true })
	blockingReason: string | null

	@ApiProperty({ type: Number })
	productAttributeCount: number

	@ApiProperty({ type: Number })
	variantAttributeCount: number

	@ApiProperty({ type: [ProductTypeCompatibilityIssueDto] })
	productAttributeConflicts: ProductTypeCompatibilityIssueDto[]

	@ApiProperty({ type: [ProductTypeCompatibilityIssueDto] })
	variantAttributeConflicts: ProductTypeCompatibilityIssueDto[]
}

export class ProductUpdateResponseDto extends ProductWithDetailsDto {
	@ApiProperty({ example: true })
	ok: boolean
}

export class ProductVariantsResponseDto extends ProductWithDetailsDto {
	@ApiProperty({ example: true })
	ok: boolean
}

export class ProductCreateResponseDto extends ProductWithDetailsDto {
	@ApiProperty({ example: true })
	ok: boolean
}

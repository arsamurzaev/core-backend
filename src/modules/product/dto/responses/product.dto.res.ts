import {
	DataType,
	IntegrationProvider,
	ProductStatus,
	ProductVariantStatus
} from '@generated/enums'
import { ApiProperty } from '@nestjs/swagger'

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

export class ProductVariantDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	sku: string

	@ApiProperty({ type: String })
	variantKey: string

	@ApiProperty({ type: Number })
	stock: number

	@ApiProperty({ type: String, example: '0.00' })
	price: string

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

export class ProductCategoryDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: Number })
	position: number
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

export class ProductDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	sku: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String })
	slug: string

	@ApiProperty({ type: String, example: '999.00' })
	price: string

	@ApiProperty({ type: [ProductMediaDto] })
	media: ProductMediaDto[]

	@ApiProperty({ type: ProductBrandDto, nullable: true })
	brand: ProductBrandDto | null

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
}

export class ProductWithDetailsDto extends ProductWithAttributesDto {
	@ApiProperty({ type: [ProductVariantDto] })
	variants: ProductVariantDto[]
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
		description: 'РЎС‚Р°Р±РёР»СЊРЅС‹Р№ seed РґР»СЏ РґРµС‚РµСЂРјРёРЅРёСЂРѕРІР°РЅРЅРѕР№ СЂР°РЅРґРѕРјРёР·Р°С†РёРё'
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

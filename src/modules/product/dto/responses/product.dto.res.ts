import { DataType, ProductStatus } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

export class ProductAttributeEnumValueDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	value: string

	@ApiProperty({ type: String, nullable: true })
	displayName: string | null

	@ApiProperty({ type: Number })
	displayOrder: number
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
}

export class ProductAttributeDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	attributeId: string

	@ApiProperty({ type: String, nullable: true })
	enumValueId: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	valueString?: string | null

	@ApiPropertyOptional({ type: Number, nullable: true })
	valueInteger?: number | null

	@ApiPropertyOptional({ type: String, nullable: true })
	valueDecimal?: string | null

	@ApiPropertyOptional({ type: Boolean, nullable: true })
	valueBoolean?: boolean | null

	@ApiProperty({ type: ProductAttributeRefDto })
	attribute: ProductAttributeRefDto

	@ApiPropertyOptional({ type: ProductAttributeEnumValueDto, nullable: true })
	enumValue?: ProductAttributeEnumValueDto | null
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

	@ApiProperty({ type: [String] })
	imagesUrls: string[]

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

export class ProductCreateResponseDto extends OkResponseDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	slug: string
}

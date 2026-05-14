import { DataType } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { ProductTypeScope } from '../../product-type.constants'

export class ProductTypeAttributeAttributeDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	key: string

	@ApiProperty({ type: String })
	displayName: string

	@ApiProperty({ enum: DataType })
	dataType: DataType
}

export class ProductTypeAttributeDto {
	@ApiProperty({ type: String })
	productTypeId: string

	@ApiProperty({ type: String })
	attributeId: string

	@ApiProperty({ type: Boolean })
	isVariant: boolean

	@ApiProperty({ type: Boolean })
	isRequired: boolean

	@ApiProperty({ type: Number })
	displayOrder: number

	@ApiProperty({ type: ProductTypeAttributeAttributeDto })
	attribute: ProductTypeAttributeAttributeDto

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}

export class ProductTypeDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String, nullable: true })
	catalogId: string | null

	@ApiProperty({ enum: ProductTypeScope })
	scope: ProductTypeScope

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String, nullable: true })
	description: string | null

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: Boolean })
	isArchived: boolean

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	archivedAt: string | null

	@ApiPropertyOptional({ type: [ProductTypeAttributeDto] })
	attributes?: ProductTypeAttributeDto[]

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}

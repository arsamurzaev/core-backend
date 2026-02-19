import { DataType } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class AttributeEnumValueDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	attributeId: string

	@ApiProperty({ type: String })
	value: string

	@ApiProperty({ type: String, nullable: true })
	displayName: string | null

	@ApiProperty({ type: Number })
	displayOrder: number

	@ApiProperty({ type: String, nullable: true })
	businessId: string | null

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}

export class AttributeDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: [String] })
	typeIds: string[]

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

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string

	@ApiPropertyOptional({ type: [AttributeEnumValueDto] })
	enumValues?: AttributeEnumValueDto[]
}

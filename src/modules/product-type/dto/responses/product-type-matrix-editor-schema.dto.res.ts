import { DataType } from '@generated/enums'
import { ApiProperty } from '@nestjs/swagger'

import { ProductTypeScope } from '../../product-type.constants'

export class ProductTypeMatrixEditorTypeDto {
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

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}

export class ProductTypeMatrixEditorAttributeDto {
	@ApiProperty({ type: String })
	productTypeId: string

	@ApiProperty({ type: String })
	attributeId: string

	@ApiProperty({ type: String })
	key: string

	@ApiProperty({ type: String })
	displayName: string

	@ApiProperty({ enum: DataType })
	dataType: DataType

	@ApiProperty({ type: Boolean })
	isVariant: boolean

	@ApiProperty({ type: Boolean })
	isRequired: boolean

	@ApiProperty({ type: Boolean })
	isFilterable: boolean

	@ApiProperty({ type: Boolean })
	isHidden: boolean

	@ApiProperty({ type: Number })
	displayOrder: number
}

export class ProductTypeMatrixEditorEnumValueAliasDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	attributeId: string

	@ApiProperty({ type: String, nullable: true })
	catalogId: string | null

	@ApiProperty({ type: String })
	enumValueId: string

	@ApiProperty({ type: String })
	value: string

	@ApiProperty({ type: String, nullable: true })
	displayName: string | null
}

export class ProductTypeMatrixEditorEnumValueDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	attributeId: string

	@ApiProperty({ type: String, nullable: true })
	catalogId: string | null

	@ApiProperty({ type: String })
	value: string

	@ApiProperty({ type: String, nullable: true })
	displayName: string | null

	@ApiProperty({ type: String, nullable: true })
	businessId: string | null

	@ApiProperty({ type: Number })
	displayOrder: number

	@ApiProperty({ enum: ['MANUAL', 'AUTO', 'IMPORTED'] })
	source: 'MANUAL' | 'AUTO' | 'IMPORTED'

	@ApiProperty({ type: String, nullable: true })
	mergedIntoId: string | null

	@ApiProperty({ type: Boolean })
	isArchived: boolean

	@ApiProperty({ type: [ProductTypeMatrixEditorEnumValueAliasDto] })
	aliases: ProductTypeMatrixEditorEnumValueAliasDto[]
}

export class ProductTypeMatrixEditorSchemaDto {
	@ApiProperty({ type: ProductTypeMatrixEditorTypeDto })
	type: ProductTypeMatrixEditorTypeDto

	@ApiProperty({ type: [ProductTypeMatrixEditorAttributeDto] })
	attributes: ProductTypeMatrixEditorAttributeDto[]

	@ApiProperty({ type: [ProductTypeMatrixEditorAttributeDto] })
	variantAttributes: ProductTypeMatrixEditorAttributeDto[]

	@ApiProperty({ type: [ProductTypeMatrixEditorAttributeDto] })
	requiredAttributes: ProductTypeMatrixEditorAttributeDto[]

	@ApiProperty({ type: [ProductTypeMatrixEditorEnumValueDto] })
	enumValues: ProductTypeMatrixEditorEnumValueDto[]
}

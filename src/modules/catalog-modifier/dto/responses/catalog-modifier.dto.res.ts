import { ProductModifierScope } from '@generated/enums'
import { ApiProperty } from '@nestjs/swagger'

export class CatalogModifierOptionDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	catalogId: string

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String, nullable: true })
	description: string | null

	@ApiProperty({ type: String, example: '100.00' })
	defaultPrice: string

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: Number })
	displayOrder: number

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	deleteAt: string | null
}

export class CatalogModifierGroupOptionDto {
	@ApiProperty({ type: String })
	groupId: string

	@ApiProperty({ type: String })
	optionId: string

	@ApiProperty({ type: String, nullable: true, example: '100.00' })
	defaultPrice: string | null

	@ApiProperty({ type: Boolean })
	isDefault: boolean

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: Number })
	displayOrder: number

	@ApiProperty({ type: CatalogModifierOptionDto })
	option: CatalogModifierOptionDto
}

export class CatalogModifierGroupDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	catalogId: string

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String, nullable: true })
	description: string | null

	@ApiProperty({ type: Boolean })
	isRequired: boolean

	@ApiProperty({ type: Number })
	minSelected: number

	@ApiProperty({ type: Number, nullable: true })
	maxSelected: number | null

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: Number })
	displayOrder: number

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	deleteAt: string | null

	@ApiProperty({ type: [CatalogModifierGroupOptionDto] })
	options: CatalogModifierGroupOptionDto[]
}

export class CatalogModifierStateDto {
	@ApiProperty({ type: [CatalogModifierGroupDto] })
	groups: CatalogModifierGroupDto[]

	@ApiProperty({ type: [CatalogModifierOptionDto] })
	options: CatalogModifierOptionDto[]
}

export class ProductModifierOptionDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	productModifierGroupId: string

	@ApiProperty({ type: String, nullable: true })
	catalogModifierOptionId: string | null

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String, example: '100.00' })
	price: string

	@ApiProperty({ type: Number, nullable: true })
	maxQuantity: number | null

	@ApiProperty({ type: Boolean })
	isDefault: boolean

	@ApiProperty({ type: Boolean })
	isAvailable: boolean

	@ApiProperty({ type: Number })
	displayOrder: number
}

export class ProductModifierGroupDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	productId: string

	@ApiProperty({ type: String, nullable: true })
	variantId: string | null

	@ApiProperty({ type: String, nullable: true })
	catalogModifierGroupId: string | null

	@ApiProperty({ enum: ProductModifierScope })
	scope: ProductModifierScope

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String, nullable: true })
	description: string | null

	@ApiProperty({ type: Boolean })
	isRequired: boolean

	@ApiProperty({ type: Number })
	minSelected: number

	@ApiProperty({ type: Number, nullable: true })
	maxSelected: number | null

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: Number })
	displayOrder: number

	@ApiProperty({ type: [ProductModifierOptionDto] })
	options: ProductModifierOptionDto[]
}

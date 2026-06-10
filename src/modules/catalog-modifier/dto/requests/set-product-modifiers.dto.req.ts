import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsArray,
	IsBoolean,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	MaxLength,
	Min,
	ValidateNested
} from 'class-validator'

function trimOptionalString(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined
	if (typeof value !== 'string') return value as string
	const trimmed = value.trim()
	return trimmed.length ? trimmed : undefined
}

function trimNullableString(value: unknown): string | null | undefined {
	if (value === undefined) return undefined
	if (value === null) return null
	if (typeof value !== 'string') return value as string
	const trimmed = value.trim()
	return trimmed.length ? trimmed : null
}

export class ProductModifierOptionBindingDtoReq {
	@ApiPropertyOptional({ type: String, format: 'uuid' })
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	catalogModifierOptionId?: string

	@ApiPropertyOptional({ type: String, example: 'extra-cheese' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	code?: string

	@ApiPropertyOptional({ type: String, example: 'Extra cheese' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	name?: string

	@ApiPropertyOptional({ type: Number, example: 100 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	price?: number

	@ApiPropertyOptional({ type: Number, nullable: true, example: 2 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	maxQuantity?: number | null

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	isDefault?: boolean

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	isAvailable?: boolean

	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	displayOrder?: number
}

export class ProductModifierGroupBindingDtoReq {
	@ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
	@IsOptional()
	@IsString()
	variantId?: string | null

	@ApiPropertyOptional({ type: String, format: 'uuid' })
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	catalogModifierGroupId?: string

	@ApiPropertyOptional({ type: String, example: 'add-ons' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	code?: string

	@ApiPropertyOptional({ type: String, example: 'Add-ons' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	name?: string

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	@Transform(({ value }: { value: unknown }) => trimNullableString(value))
	description?: string | null

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	isRequired?: boolean

	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	minSelected?: number

	@ApiPropertyOptional({ type: Number, nullable: true, example: 3 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	maxSelected?: number | null

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean

	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	displayOrder?: number

	@ApiPropertyOptional({ type: [ProductModifierOptionBindingDtoReq] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductModifierOptionBindingDtoReq)
	options?: ProductModifierOptionBindingDtoReq[]
}

export class SetProductModifiersDtoReq {
	@ApiProperty({ type: [ProductModifierGroupBindingDtoReq] })
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductModifierGroupBindingDtoReq)
	groups: ProductModifierGroupBindingDtoReq[]
}

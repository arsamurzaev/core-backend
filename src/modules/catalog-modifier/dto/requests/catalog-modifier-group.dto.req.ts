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

export class CatalogModifierGroupOptionDtoReq {
	@ApiProperty({ type: String, format: 'uuid' })
	@IsString()
	@IsNotEmpty()
	optionId: string

	@ApiPropertyOptional({ type: Number, nullable: true, example: 100 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	defaultPrice?: number | null

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	isDefault?: boolean

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
}

export class CreateCatalogModifierGroupDtoReq {
	@ApiProperty({ type: String, example: 'Add-ons' })
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	name: string

	@ApiPropertyOptional({ type: String, example: 'add-ons' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	code?: string

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

	@ApiPropertyOptional({ type: [CatalogModifierGroupOptionDtoReq] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CatalogModifierGroupOptionDtoReq)
	options?: CatalogModifierGroupOptionDtoReq[]
}

export class UpdateCatalogModifierGroupDtoReq {
	@ApiPropertyOptional({ type: String, example: 'Add-ons' })
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	name?: string

	@ApiPropertyOptional({ type: String, example: 'add-ons' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	code?: string

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

	@ApiPropertyOptional({ type: [CatalogModifierGroupOptionDtoReq] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CatalogModifierGroupOptionDtoReq)
	options?: CatalogModifierGroupOptionDtoReq[]
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsBoolean,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	MaxLength,
	Min
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

export class CreateCatalogModifierOptionDtoReq {
	@ApiProperty({ type: String, example: 'Extra cheese' })
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	name: string

	@ApiPropertyOptional({ type: String, example: 'extra-cheese' })
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

	@ApiPropertyOptional({ type: Number, example: 100 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	defaultPrice?: number

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

export class UpdateCatalogModifierOptionDtoReq {
	@ApiPropertyOptional({ type: String, example: 'Extra cheese' })
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	name?: string

	@ApiPropertyOptional({ type: String, example: 'extra-cheese' })
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

	@ApiPropertyOptional({ type: Number, example: 100 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	defaultPrice?: number

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

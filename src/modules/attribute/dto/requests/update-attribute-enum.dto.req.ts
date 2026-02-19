import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	MaxLength,
	Min
} from 'class-validator'

function normalizeOptionalString(value: unknown): string | undefined {
	if (value === undefined) return undefined
	if (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	) {
		return String(value).trim()
	}
	return undefined
}

export class UpdateAttributeEnumDtoReq {
	@ApiPropertyOptional({ type: String, example: 'xs' })
	@IsOptional()
	@Transform(({ value }: { value: unknown }) => {
		const normalized = normalizeOptionalString(value)
		return normalized === undefined ? undefined : normalized.toLowerCase()
	})
	@IsString()
	@MaxLength(255)
	value?: string

	@ApiPropertyOptional({ type: String, example: 'XS' })
	@IsOptional()
	@Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
	@IsString()
	@MaxLength(255)
	displayName?: string

	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	displayOrder?: number

	@ApiPropertyOptional({
		type: String,
		example: 'business-id',
		description: 'ID бизнеса для пользовательского значения'
	})
	@IsOptional()
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		return normalizeOptionalString(value)
	})
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	businessId?: string | null
}

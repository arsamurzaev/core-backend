import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsArray,
	IsNotEmpty,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	MinLength,
	ValidateNested
} from 'class-validator'

import { PRODUCT_TYPE_CODE_PATTERN } from '../../product-type.utils'

import { ProductTypeAttributeDtoReq } from './product-type-attribute.dto.req'

function normalizeOptionalString(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined
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

export class CreateProductTypeDtoReq {
	@ApiPropertyOptional({
		type: String,
		example: 'mens-shoes',
		description: 'If omitted, code is generated from name.'
	})
	@Transform(({ value }: { value: unknown }) => {
		const normalized = normalizeOptionalString(value)
		return normalized === undefined ? undefined : normalized.toLowerCase()
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MinLength(2)
	@MaxLength(100)
	@Matches(PRODUCT_TYPE_CODE_PATTERN)
	code?: string

	@ApiProperty({ type: String, example: 'Mens shoes' })
	@Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	name: string

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		example: 'Footwear variants'
	})
	@Transform(({ value }: { value: unknown }) => {
		if (value === null) return null
		return normalizeOptionalString(value)
	})
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	description?: string | null

	@ApiPropertyOptional({ type: [ProductTypeAttributeDtoReq] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductTypeAttributeDtoReq)
	attributes?: ProductTypeAttributeDtoReq[]
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	ArrayMaxSize,
	Equals,
	IsArray,
	IsBoolean,
	IsOptional,
	IsString,
	ValidateNested
} from 'class-validator'

import { ProductAttributeValueDto } from './product-attribute.dto.req'
import { ProductVariantDtoReq } from './product-variant.dto.req'

function normalizeStringArrayInput(value: unknown): unknown {
	if (!Array.isArray(value)) return value
	return value.map((item: unknown) =>
		typeof item === 'string' ? item.trim() : item
	)
}

export class ApplyProductTypeChangeDtoReq {
	@ApiProperty({
		type: String,
		nullable: true,
		description: 'Next product type inside current catalog. Pass null to clear.'
	})
	@IsOptional()
	@IsString()
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value !== 'string') return value
		const normalized = value.trim()
		return normalized.length ? normalized : null
	})
	productTypeId?: string | null

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		description:
			'Optional stale-preview guard. Apply fails if current product type differs.'
	})
	@IsOptional()
	@IsString()
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value !== 'string') return value
		const normalized = value.trim()
		return normalized.length ? normalized : null
	})
	expectedCurrentProductTypeId?: string | null

	@ApiProperty({
		type: Boolean,
		example: true,
		description: 'Explicit user confirmation for changing typed product data.'
	})
	@IsBoolean()
	@Equals(true)
	confirm: true

	@ApiPropertyOptional({
		type: [String],
		description:
			'Product attribute ids to remove when they are incompatible with target product type.'
	})
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(100)
	@IsString({ each: true })
	@Transform(({ value }: { value: unknown }) => normalizeStringArrayInput(value))
	removeAttributeIds?: string[]

	@ApiPropertyOptional({
		type: [ProductAttributeValueDto],
		description:
			'Product attributes to upsert after switching to the target product type.'
	})
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductAttributeValueDto)
	attributes?: ProductAttributeValueDto[]

	@ApiPropertyOptional({
		type: [ProductVariantDtoReq],
		description:
			'Full replacement matrix. Required when existing variant attributes conflict with target product type.'
	})
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductVariantDtoReq)
	items?: ProductVariantDtoReq[]
}

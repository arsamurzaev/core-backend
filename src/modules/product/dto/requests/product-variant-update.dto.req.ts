import { ProductVariantStatus } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	Matches,
	Min
} from 'class-validator'

const SKU_PATTERN = /^[A-Za-z0-9_-]+$/

export class ProductVariantUpdateDtoReq {
	@ApiProperty({ type: String, example: 'TSHIRT-001-S-WHT' })
	@IsString()
	@IsNotEmpty()
	@Matches(SKU_PATTERN)
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return undefined
		if (typeof value === 'string') {
			const trimmed = value.trim()
			return trimmed.length ? trimmed : undefined
		}
		if (typeof value === 'number' || typeof value === 'boolean') {
			return String(value).trim()
		}
		return undefined
	})
	sku: string

	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	price?: number

	@ApiPropertyOptional({ type: Number, example: 10 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	stock?: number

	@ApiPropertyOptional({ enum: ProductVariantStatus, example: 'ACTIVE' })
	@IsOptional()
	@IsEnum(ProductVariantStatus)
	status?: ProductVariantStatus
}

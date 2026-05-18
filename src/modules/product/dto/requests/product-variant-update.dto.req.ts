import { ProductVariantStatus } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsArray,
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	MaxLength,
	Min,
	ValidateNested
} from 'class-validator'

import { ProductVariantSaleUnitDtoReq } from './product-variant.dto.req'

export class ProductVariantUpdateDtoReq {
	@ApiProperty({
		type: String,
		example: 'size=xs;color=white',
		description: 'Ключ варианта, приходит из ответа товара'
	})
	@IsString()
	@IsNotEmpty()
	@MaxLength(300)
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return undefined
		if (typeof value === 'string') {
			const trimmed = value.trim()
			return trimmed.length ? trimmed : undefined
		}
		return undefined
	})
	variantKey: string

	@ApiPropertyOptional({ type: Number, example: 0, nullable: true })
	@IsOptional()
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value === 'string' && value.trim().length === 0) return null
		return Number(value)
	})
	@IsNumber()
	@Min(0)
	price?: number | null

	@ApiPropertyOptional({
		type: Number,
		example: 10,
		nullable: true,
		description: 'null означает, что остаток не ведется'
	})
	@IsOptional()
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value === 'string' && value.trim().length === 0) return null
		return Number(value)
	})
	@IsInt()
	@Min(0)
	stock?: number | null

	@ApiPropertyOptional({ enum: ProductVariantStatus, example: 'ACTIVE' })
	@IsOptional()
	@IsEnum(ProductVariantStatus)
	status?: ProductVariantStatus

	@ApiPropertyOptional({ type: [ProductVariantSaleUnitDtoReq] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductVariantSaleUnitDtoReq)
	saleUnits?: ProductVariantSaleUnitDtoReq[]
}

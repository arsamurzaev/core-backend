import { ProductStatus } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsEnum,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	MaxLength,
	ValidateNested
} from 'class-validator'

import { ProductAttributeValueDto } from './product-attribute.dto.req'
import {
	ProductVariantDtoReq,
	ProductVariantSaleUnitDtoReq
} from './product-variant.dto.req'

export class CreateProductDtoReq {
	@ApiProperty({ type: String, example: 'Basic T-Shirt' })
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	name: string

	@ApiPropertyOptional({ type: Number, example: 999.0, nullable: true })
	@IsOptional()
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value === 'string' && value.trim().length === 0) return null
		return Number(value)
	})
	@IsNumber()
	price?: number | null

	@ApiPropertyOptional({ type: [String], example: ['media-uuid'] })
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(12)
	@IsString({ each: true })
	mediaIds?: string[]

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	isPopular?: boolean

	@ApiPropertyOptional({ type: String, example: ProductStatus.ACTIVE })
	@IsOptional()
	@IsEnum(ProductStatus)
	status?: ProductStatus

	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	position?: number

	@ApiPropertyOptional({ type: String, example: 'brand-uuid' })
	@IsOptional()
	@IsString()
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value !== 'string') return value
		const normalized = value.trim()
		return normalized.length ? normalized : null
	})
	brandId?: string | null

	@ApiPropertyOptional({
		type: String,
		example: 'product-type-uuid',
		nullable: true
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
		type: [String],
		example: ['category-uuid-1', 'category-uuid-2'],
		description:
			'Список категорий. Товар будет добавлен в начало (position=0) каждой категории.',
		uniqueItems: true
	})
	@IsOptional()
	@IsArray()
	@ArrayMaxSize(50)
	@IsString({ each: true })
	@Transform(({ value }: { value: unknown }) => {
		if (!Array.isArray(value)) return value

		const items = value as unknown[]
		return items.map(item => (typeof item === 'string' ? item.trim() : item))
	})
	categories?: string[]

	@ApiPropertyOptional({ type: [ProductAttributeValueDto] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductAttributeValueDto)
	attributes?: ProductAttributeValueDto[]

	@ApiPropertyOptional({
		type: [ProductVariantSaleUnitDtoReq],
		description:
			'Единицы продажи простого товара. Сохраняются на технический default-вариант.'
	})
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductVariantSaleUnitDtoReq)
	saleUnits?: ProductVariantSaleUnitDtoReq[]

	@ApiPropertyOptional({ type: [ProductVariantDtoReq] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductVariantDtoReq)
	variants?: ProductVariantDtoReq[]
}

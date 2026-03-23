import { ProductStatus } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsEnum,
	IsInt,
	IsNumber,
	IsOptional,
	IsString,
	MaxLength,
	Min,
	ValidateNested
} from 'class-validator'

import { ProductAttributeValueDto } from './product-attribute.dto.req'
import { ProductVariantUpdateDtoReq } from './product-variant-update.dto.req'

export class UpdateProductDtoReq {
	@ApiPropertyOptional({ type: String, example: 'Basic T-Shirt' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	name?: string

	@ApiPropertyOptional({ type: Number, example: 999.0 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	price?: number

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

	@ApiPropertyOptional({
		type: String,
		example: 'brand-uuid',
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
	brandId?: string | null

	@ApiPropertyOptional({
		type: [String],
		example: ['category-uuid-1', 'category-uuid-2'],
		description:
			'Список категорий товара. При редактировании заменяет набор привязок товара к категориям.',
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

	@ApiPropertyOptional({
		type: String,
		example: 'category-uuid',
		description:
			'ID категории, в которой нужно изменить/установить позицию товара'
	})
	@IsOptional()
	@IsString()
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (typeof value !== 'string') return value
		return value.trim()
	})
	categoryId?: string

	@ApiPropertyOptional({
		type: Number,
		example: 0,
		description:
			'Позиция товара внутри категории (передавать только вместе с categoryId)',
		minimum: 0
	})
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	categoryPosition?: number

	@ApiPropertyOptional({
		type: [ProductAttributeValueDto],
		description: 'Только видимые атрибуты (isHidden=false)'
	})
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductAttributeValueDto)
	attributes?: ProductAttributeValueDto[]

	@ApiPropertyOptional({
		type: [String],
		example: ['attribute-uuid'],
		description: 'ID атрибутов товара, которые нужно удалить при редактировании'
	})
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	removeAttributeIds?: string[]

	@ApiPropertyOptional({ type: [ProductVariantUpdateDtoReq] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductVariantUpdateDtoReq)
	variants?: ProductVariantUpdateDtoReq[]
}

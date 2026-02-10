import { ProductStatus } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsArray,
	IsBoolean,
	IsEmpty,
	IsEnum,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	MinLength,
	ValidateNested
} from 'class-validator'

import { ProductAttributeValueDto } from './product-attribute.dto.req'

const SLUG_PATTERN = /^[a-z0-9-]+$/
const SKU_PATTERN = /^[A-Za-z0-9_-]+$/

export class CreateProductDtoReq {
	@ApiPropertyOptional({
		type: String,
		example: 'TSHIRT-001',
		description: 'Если не указан, SKU будет сгенерирован автоматически'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MinLength(3)
	@MaxLength(100)
	@Matches(SKU_PATTERN)
	@Transform(({ value }) => {
		if (value === undefined || value === null) return value
		const trimmed = String(value).trim()
		return trimmed || undefined
	})
	sku?: string

	@ApiProperty({ type: String, example: 'Basic T-Shirt' })
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	name: string

	@ApiPropertyOptional({
		type: String,
		example: 'basic-tshirt',
		description: 'Если не указан, slug будет сгенерирован автоматически'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MinLength(2)
	@MaxLength(255)
	@Matches(SLUG_PATTERN)
	@Transform(({ value }) => {
		if (value === undefined || value === null) return value
		const trimmed = String(value).trim().toLowerCase()
		return trimmed || undefined
	})
	slug?: string

	@ApiProperty({ type: Number, example: 999.0 })
	@Type(() => Number)
	@IsNumber()
	price: number

	@ApiPropertyOptional({ type: [String], example: ['https://cdn/img.png'] })
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	imagesUrls?: string[]

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

	@ApiPropertyOptional({ type: [ProductAttributeValueDto] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductAttributeValueDto)
	attributes?: ProductAttributeValueDto[]

	@ApiPropertyOptional({
		description: 'Вариации товара создаются администратором'
	})
	@IsOptional()
	@IsEmpty({ message: 'Вариации товара создаются администратором' })
	variants?: unknown

}

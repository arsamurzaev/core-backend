import { ProductStatus } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsArray,
	IsBoolean,
	IsEnum,
	IsNumber,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	ValidateNested
} from 'class-validator'

import { ProductAttributeValueDto } from './product-attribute.dto.req'

const SLUG_PATTERN = /^[a-z0-9-]+$/
const SKU_PATTERN = /^[A-Za-z0-9_-]+$/

export class UpdateProductDtoReq {
	@ApiPropertyOptional({ type: String, example: 'TSHIRT-001' })
	@IsOptional()
	@IsString()
	@Matches(SKU_PATTERN)
	@Transform(({ value }) =>
		value === undefined ? value : String(value).trim()
	)
	sku?: string

	@ApiPropertyOptional({ type: String, example: 'Basic T-Shirt' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	name?: string

	@ApiPropertyOptional({ type: String, example: 'basic-tshirt' })
	@IsOptional()
	@IsString()
	@Matches(SLUG_PATTERN)
	@Transform(({ value }) =>
		value === undefined ? value : String(value).trim().toLowerCase()
	)
	slug?: string

	@ApiPropertyOptional({ type: Number, example: 999.0 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	price?: number

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
}

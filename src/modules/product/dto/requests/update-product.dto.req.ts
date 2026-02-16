import { ProductStatus } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
	ArrayMaxSize,
	IsArray,
	IsBoolean,
	IsEnum,
	IsNumber,
	IsOptional,
	IsString,
	MaxLength,
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

	@ApiPropertyOptional({ type: [ProductAttributeValueDto] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductAttributeValueDto)
	attributes?: ProductAttributeValueDto[]

	@ApiPropertyOptional({ type: [ProductVariantUpdateDtoReq] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => ProductVariantUpdateDtoReq)
	variants?: ProductVariantUpdateDtoReq[]
}

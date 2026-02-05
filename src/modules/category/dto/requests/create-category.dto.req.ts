import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsArray,
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	MaxLength,
	Min,
	ValidateNested
} from 'class-validator'

import { CategoryProductInputDtoReq } from './category-product.dto.req'

export class CreateCategoryDtoReq {
	@ApiProperty({ type: String, example: 'Category name' })
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	name: string

	@ApiPropertyOptional({ type: String, example: 'https://cdn/img.png' })
	@IsOptional()
	@IsString()
	imageUrl?: string

	@ApiPropertyOptional({ type: String, example: 'Short description' })
	@IsOptional()
	@IsString()
	@Transform(({ value }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		const normalized = String(value).trim()
		return normalized.length ? normalized : null
	})
	descriptor?: string | null

	@ApiPropertyOptional({ type: Number, example: 10 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	discount?: number | null

	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	position?: number

	@ApiPropertyOptional({ type: String, example: 'parent-id', nullable: true })
	@IsOptional()
	@IsString()
	@Transform(({ value }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		const normalized = String(value).trim()
		return normalized.length ? normalized : null
	})
	parentId?: string | null

	@ApiPropertyOptional({ type: [CategoryProductInputDtoReq] })
	@IsOptional()
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => CategoryProductInputDtoReq)
	products?: CategoryProductInputDtoReq[]
}

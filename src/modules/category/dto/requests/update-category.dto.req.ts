import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsArray,
	IsInt,
	IsOptional,
	IsString,
	MaxLength,
	Min
} from 'class-validator'

export class UpdateCategoryDtoReq {
	@ApiPropertyOptional({ type: String, example: 'Category name' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	name?: string

	@ApiPropertyOptional({ type: String, example: 'https://cdn/img.png' })
	@IsOptional()
	@IsString()
	imageUrl?: string

	@ApiPropertyOptional({ type: String, example: 'Short description', nullable: true })
	@IsOptional()
	@IsString()
	@Transform(({ value }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		const normalized = String(value).trim()
		return normalized.length ? normalized : null
	})
	descriptor?: string | null

	@ApiPropertyOptional({ type: Number, example: 10, nullable: true })
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

	@ApiPropertyOptional({ type: [String], example: ['product-id'] })
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	productIds?: string[]
}

import { DataType } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	ArrayMinSize,
	IsArray,
	IsBoolean,
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	Min
} from 'class-validator'

const KEY_PATTERN = /^[a-z0-9_-]+$/

export class UpdateAttributeDtoReq {
	@ApiPropertyOptional({
		type: [String],
		example: ['type-id'],
		description: 'Заменить список типов, где доступен атрибут'
	})
	@IsOptional()
	@IsArray()
	@ArrayMinSize(1)
	@IsString({ each: true })
	typeIds?: string[]

	@ApiPropertyOptional({ type: String, example: 'brand' })
	@IsOptional()
	@Transform(({ value }) =>
		value === undefined ? value : String(value).trim().toLowerCase()
	)
	@IsString()
	@MaxLength(100)
	@Matches(KEY_PATTERN)
	key?: string

	@ApiPropertyOptional({ type: String, example: 'Brand' })
	@IsOptional()
	@Transform(({ value }) => (value === undefined ? value : String(value).trim()))
	@IsString()
	@MaxLength(255)
	displayName?: string

	@ApiPropertyOptional({ enum: DataType, example: DataType.STRING })
	@IsOptional()
	@IsEnum(DataType)
	dataType?: DataType

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	isRequired?: boolean

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	isVariantAttribute?: boolean

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	isFilterable?: boolean

	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	displayOrder?: number
}

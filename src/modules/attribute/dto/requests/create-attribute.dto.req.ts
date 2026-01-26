import { DataType } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsBoolean,
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	Min
} from 'class-validator'

const KEY_PATTERN = /^[a-z0-9_-]+$/

export class CreateAttributeDtoReq {
	@ApiProperty({ type: String, example: 'type-id' })
	@IsString()
	@IsNotEmpty()
	typeId: string

	@ApiProperty({ type: String, example: 'brand' })
	@Transform(({ value }) =>
		value === undefined ? value : String(value).trim().toLowerCase()
	)
	@IsString()
	@IsNotEmpty()
	@MaxLength(100)
	@Matches(KEY_PATTERN)
	key: string

	@ApiProperty({ type: String, example: 'Brand' })
	@Transform(({ value }) =>
		value === undefined ? value : String(value).trim()
	)
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	displayName: string

	@ApiProperty({ enum: DataType, example: DataType.STRING })
	@IsEnum(DataType)
	dataType: DataType

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

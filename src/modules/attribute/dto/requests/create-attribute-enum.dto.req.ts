import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	Min
} from 'class-validator'

const ENUM_VALUE_PATTERN = /^[a-z0-9_-]+$/

export class CreateAttributeEnumDtoReq {
	@ApiPropertyOptional({
		type: String,
		example: 'xs',
		description: 'Если не указан, значение будет сгенерировано из displayName'
	})
	@Transform(({ value }) =>
		value === undefined ? value : String(value).trim().toLowerCase()
	)
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@Matches(ENUM_VALUE_PATTERN)
	@MaxLength(255)
	value?: string

	@ApiPropertyOptional({ type: String, example: 'XS' })
	@IsOptional()
	@Transform(({ value }) => (value === undefined ? value : String(value).trim()))
	@IsString()
	@MaxLength(255)
	displayName?: string

	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	displayOrder?: number
}

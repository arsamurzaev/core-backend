import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	MaxLength,
	Min
} from 'class-validator'

export class CreateAttributeEnumDtoReq {
	@ApiProperty({ type: String, example: 'xs' })
	@Transform(({ value }) =>
		value === undefined ? value : String(value).trim().toLowerCase()
	)
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	value: string

	@ApiPropertyOptional({ type: String, example: 'XS' })
	@IsOptional()
	@Transform(({ value }) =>
		value === undefined ? value : String(value).trim()
	)
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

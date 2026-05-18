import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
	IsBoolean,
	IsDateString,
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	MaxLength
} from 'class-validator'

export const PRODUCT_ATTRIBUTE_VALUE_STRING_MAX_LENGTH = 3000

export class ProductAttributeValueDto {
	@ApiProperty({ type: String, example: 'attribute-id' })
	@IsString()
	@IsNotEmpty()
	attributeId: string

	@ApiPropertyOptional({ type: String, example: 'enum-value-id' })
	@IsOptional()
	@IsString()
	enumValueId?: string

	@ApiPropertyOptional({
		type: String,
		example: '100% cotton',
		maxLength: PRODUCT_ATTRIBUTE_VALUE_STRING_MAX_LENGTH
	})
	@IsOptional()
	@IsString()
	@MaxLength(PRODUCT_ATTRIBUTE_VALUE_STRING_MAX_LENGTH)
	valueString?: string

	@ApiPropertyOptional({ type: Number, example: 42 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	valueInteger?: number

	@ApiPropertyOptional({ type: Number, example: 12.5 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	valueDecimal?: number

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	valueBoolean?: boolean

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	@IsOptional()
	@IsDateString()
	valueDateTime?: string
}

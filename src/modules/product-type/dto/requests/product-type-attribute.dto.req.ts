import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
	IsBoolean,
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	Min
} from 'class-validator'

export class ProductTypeAttributeDtoReq {
	@ApiProperty({ type: String, example: 'attribute-id' })
	@IsString()
	@IsNotEmpty()
	attributeId: string

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isVariant?: boolean

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isRequired?: boolean

	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	displayOrder?: number
}

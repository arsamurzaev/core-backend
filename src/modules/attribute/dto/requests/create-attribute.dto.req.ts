import { DataType } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	ArrayMinSize,
	IsArray,
	IsBoolean,
	IsEnum,
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	Matches,
	MaxLength,
	MinLength,
	Min
} from 'class-validator'

const KEY_PATTERN = /^[a-z0-9_-]+$/

export class CreateAttributeDtoReq {
	@ApiPropertyOptional({
		type: [String],
		example: ['type-id'],
		description: 'Список типов, где будет доступен атрибут'
	})
	@IsOptional()
	@IsArray()
	@ArrayMinSize(1)
	@IsString({ each: true })
	typeIds?: string[]

	@ApiPropertyOptional({
		type: String,
		example: 'type-id',
		description: 'Один тип (устаревшее поле, используйте typeIds)'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	typeId?: string

	@ApiPropertyOptional({
		type: String,
		example: 'brand',
		description: 'Если не указан, ключ будет сгенерирован из названия'
	})
	@Transform(({ value }) =>
		value === undefined ? value : String(value).trim().toLowerCase()
	)
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MinLength(2)
	@MaxLength(100)
	@Matches(KEY_PATTERN)
	key?: string

	@ApiProperty({ type: String, example: 'Brand' })
	@Transform(({ value }) => (value === undefined ? value : String(value).trim()))
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

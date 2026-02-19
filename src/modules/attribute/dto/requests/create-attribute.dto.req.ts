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
	Min,
	MinLength
} from 'class-validator'

const KEY_PATTERN = /^[a-z0-9_-]+$/

function normalizeOptionalString(value: unknown): string | undefined {
	if (value === undefined) return undefined
	if (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	) {
		return String(value).trim()
	}
	return undefined
}

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
	@Transform(({ value }: { value: unknown }) => {
		const normalized = normalizeOptionalString(value)
		return normalized === undefined ? undefined : normalized.toLowerCase()
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MinLength(2)
	@MaxLength(100)
	@Matches(KEY_PATTERN)
	key?: string

	@ApiProperty({ type: String, example: 'Brand' })
	@Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
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

	@ApiPropertyOptional({
		type: Boolean,
		example: false,
		description: 'Скрытый атрибут не участвует в создании и редактировании товара'
	})
	@IsOptional()
	@IsBoolean()
	isHidden?: boolean
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsInt,
	IsNotEmpty,
	IsNumber,
	IsOptional,
	IsString,
	MaxLength,
	Min
} from 'class-validator'

function trimOptionalString(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined
	if (typeof value !== 'string') return value as string
	const trimmed = value.trim()
	return trimmed.length ? trimmed : undefined
}

function trimNullableString(value: unknown): string | null | undefined {
	if (value === undefined) return undefined
	if (value === null) return null
	if (typeof value !== 'string') return value as string
	const trimmed = value.trim()
	return trimmed.length ? trimmed : null
}

export class CreateCatalogSaleUnitDtoReq {
	@ApiProperty({
		type: String,
		example: 'Короб',
		description: 'Название формата продажи внутри текущего каталога.'
	})
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	name: string

	@ApiPropertyOptional({
		type: String,
		example: 'box',
		description: 'Технический код можно не передавать: backend создаст его сам.'
	})
	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	code?: string

	@ApiPropertyOptional({
		type: Number,
		example: 12,
		description:
			'Подсказка количества внутри. Конкретный товар все равно хранит свое количество.'
	})
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0.0001)
	defaultBaseQuantity?: number

	@ApiPropertyOptional({ type: String, example: '4601234567890' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Transform(({ value }: { value: unknown }) => trimNullableString(value))
	barcode?: string | null

	@ApiPropertyOptional({ type: Number, example: 0 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(0)
	displayOrder?: number
}

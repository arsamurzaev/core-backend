import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min
} from 'class-validator'

function normalizeOptionalString(value: unknown): unknown {
	if (value === undefined || value === null) return undefined
	if (typeof value !== 'string') return value
	const trimmed = value.trim()
	return trimmed.length ? trimmed : undefined
}

export class MultipartStartDtoReq {
	@ApiProperty({
		example: 'image/jpeg',
		description: 'MIME-тип файла'
	})
	@IsString()
	@IsNotEmpty()
	contentType: string

	@ApiProperty({
		example: 73400320,
		description: 'Размер файла в байтах'
	})
	@IsInt()
	@Min(1)
	@Max(524288000)
	fileSize: number

	@ApiPropertyOptional({
		example: 64,
		description: 'Размер части в мегабайтах (по умолчанию 64)'
	})
	@IsOptional()
	@IsInt()
	@Min(5)
	partSizeMb?: number

	@ApiPropertyOptional({
		example: 'products/seo',
		description: 'Путь внутри каталога'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(200)
	@Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
	path?: string

	@ApiPropertyOptional({ example: 'products' })
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(50)
	folder?: string

	@ApiPropertyOptional({ example: 'product-id' })
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(120)
	entityId?: string
}

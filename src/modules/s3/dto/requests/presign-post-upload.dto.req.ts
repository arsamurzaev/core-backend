import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsInt,
	IsNotEmpty,
	IsOptional,
	IsString,
	MaxLength,
	Min
} from 'class-validator'

function normalizeOptionalString(value: unknown): unknown {
	if (value === undefined || value === null) return undefined
	if (typeof value !== 'string') return value
	const trimmed = value.trim()
	return trimmed.length ? trimmed : undefined
}

export class PresignPostUploadDtoReq {
	@ApiProperty({
		example: 'image/jpeg',
		description: 'MIME-тип файла'
	})
	@IsString()
	@IsNotEmpty()
	contentType: string

	@ApiPropertyOptional({
		example: 1048576,
		description: 'Размер файла в байтах (для предварительной проверки лимита)'
	})
	@IsOptional()
	@IsInt()
	@Min(1)
	contentLength?: number

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

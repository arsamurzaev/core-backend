import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

function normalizeOptionalString(value: unknown): unknown {
	if (value === undefined || value === null) return undefined
	if (typeof value !== 'string') return value
	const trimmed = value.trim()
	return trimmed.length ? trimmed : undefined
}

export class UploadImageDtoReq {
	@ApiPropertyOptional({
		example: 'products/seo',
		description: 'Путь внутри каталога. Можно указывать несколько уровней через /'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(200)
	@Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
	path?: string

	@ApiPropertyOptional({
		example: 'products',
		description: 'Папка для группировки файлов'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(50)
	@Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
	folder?: string

	@ApiPropertyOptional({
		example: 'product-id',
		description: 'Идентификатор сущности для группировки'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(120)
	@Transform(({ value }: { value: unknown }) => normalizeOptionalString(value))
	entityId?: string
}

import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

export class UploadImageDtoReq {
	@ApiPropertyOptional({
		example: 'products/seo',
		description:
			'Путь внутри каталога. Можно указывать несколько уровней через /'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(200)
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return undefined
		const trimmed = String(value).trim()
		return trimmed.length ? trimmed : undefined
	})
	path?: string

	@ApiPropertyOptional({
		example: 'products',
		description: 'Папка для группировки файлов'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(50)
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return undefined
		const trimmed = String(value).trim()
		return trimmed.length ? trimmed : undefined
	})
	folder?: string

	@ApiPropertyOptional({
		example: 'product-id',
		description: 'Идентификатор сущности для группировки'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(120)
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return undefined
		const trimmed = String(value).trim()
		return trimmed.length ? trimmed : undefined
	})
	entityId?: string
}

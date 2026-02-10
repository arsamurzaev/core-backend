import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsArray,
	IsNotEmpty,
	IsOptional,
	IsString,
	MaxLength,
	ValidateNested
} from 'class-validator'

export class UploadFromS3ItemDtoReq {
	@ApiPropertyOptional({
		example: 'catalogs/catalog-id/products/2026/02/09/raw/uuid.jpg'
	})
	@IsString()
	@IsNotEmpty()
	@MaxLength(400)
	key: string
}

export class UploadFromS3DtoReq {
	@ApiPropertyOptional({
		description: 'JSON-массив объектов с ключами загруженных файлов'
	})
	@IsOptional()
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return undefined
		if (Array.isArray(value)) return value
		if (typeof value === 'string') {
			const trimmed = value.trim()
			if (!trimmed) return undefined
			try {
				return JSON.parse(trimmed)
			} catch {
				return value
			}
		}
		return value
	})
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => UploadFromS3ItemDtoReq)
	items?: UploadFromS3ItemDtoReq[]
}

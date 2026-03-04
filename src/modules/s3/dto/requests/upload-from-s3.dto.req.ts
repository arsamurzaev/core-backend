import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
	IsArray,
	IsNotEmpty,
	IsOptional,
	IsString,
	MaxLength,
	ValidateNested
} from 'class-validator'

function parseUnknownArray(value: unknown): unknown {
	if (value === undefined || value === null) return undefined
	if (Array.isArray(value)) return value as unknown[]
	if (typeof value !== 'string') return value
	const trimmed = value.trim()
	if (!trimmed) return undefined

	try {
		return JSON.parse(trimmed) as unknown
	} catch {
		return value
	}
}

export class UploadFromS3ItemDtoReq {
	@ApiProperty({
		example: 'catalogs/catalog-id/products/2026/02/09/raw/uuid.jpg'
	})
	@IsString()
	@IsNotEmpty()
	@MaxLength(400)
	key: string

	@ApiPropertyOptional({
		example: 'uuid',
		description: 'ID записи media (если есть в ответе presign)'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(120)
	mediaId?: string

	@ApiPropertyOptional({
		example: 'https://cdn.example.com/.../raw/uuid.jpg',
		description: 'URL файла (если есть в ответе presign)'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(1000)
	url?: string
}

export class UploadFromS3DtoReq {
	@ApiPropertyOptional({
		example: 'catalogs/catalog-id/products/2026/02/09/raw/uuid.jpg',
		description:
			'Один ключ загруженного файла. Можно передать вместо массива items.'
	})
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(400)
	key?: string

	@ApiPropertyOptional({
		type: [UploadFromS3ItemDtoReq],
		description:
			'JSON-массив объектов с ключами загруженных файлов. Можно передать вместо key.'
	})
	@IsOptional()
	@Transform(({ value }: { value: unknown }) => parseUnknownArray(value))
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => UploadFromS3ItemDtoReq)
	items?: UploadFromS3ItemDtoReq[]
}

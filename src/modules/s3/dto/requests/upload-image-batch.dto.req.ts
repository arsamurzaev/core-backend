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

export class UploadImageBatchItemDtoReq {
	@ApiPropertyOptional({ example: 'products/seo' })
	@IsOptional()
	@IsString()
	@IsNotEmpty()
	@MaxLength(200)
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

export class UploadImageBatchDtoReq {
	@ApiPropertyOptional({
		description:
			'JSON-массив с настройками для каждого файла (по индексу в массиве files)'
	})
	@IsOptional()
	@Transform(({ value }: { value: unknown }) => parseUnknownArray(value))
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => UploadImageBatchItemDtoReq)
	items?: UploadImageBatchItemDtoReq[]
}

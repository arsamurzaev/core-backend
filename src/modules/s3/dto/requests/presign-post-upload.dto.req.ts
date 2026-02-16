import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator'

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
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return undefined
		const trimmed = String(value).trim()
		return trimmed.length ? trimmed : undefined
	})
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

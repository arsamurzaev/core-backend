import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
	IsArray,
	IsInt,
	IsNotEmpty,
	IsString,
	MaxLength,
	Min,
	ValidateNested
} from 'class-validator'

export class MultipartCompletePartDtoReq {
	@ApiProperty({ example: 1 })
	@IsInt()
	@Min(1)
	partNumber: number

	@ApiProperty({ example: '"etag-value"' })
	@IsString()
	@IsNotEmpty()
	@MaxLength(200)
	etag: string
}

export class MultipartCompleteDtoReq {
	@ApiProperty({ example: 'catalogs/uuid/products/2026/02/09/raw/uuid.jpg' })
	@IsString()
	@IsNotEmpty()
	@MaxLength(400)
	key: string

	@ApiProperty({ example: 'upload-id' })
	@IsString()
	@IsNotEmpty()
	@MaxLength(200)
	uploadId: string

	@ApiProperty({ type: [MultipartCompletePartDtoReq] })
	@IsArray()
	@ValidateNested({ each: true })
	@Type(() => MultipartCompletePartDtoReq)
	parts: MultipartCompletePartDtoReq[]
}

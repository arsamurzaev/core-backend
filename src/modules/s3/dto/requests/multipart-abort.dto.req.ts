import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export class MultipartAbortDtoReq {
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
}

import { ApiProperty } from '@nestjs/swagger'
import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator'

export class MultipartPartDtoReq {
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

	@ApiProperty({ example: 1 })
	@IsInt()
	@Min(1)
	partNumber: number
}

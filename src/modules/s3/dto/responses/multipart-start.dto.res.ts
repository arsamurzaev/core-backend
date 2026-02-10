import { ApiProperty } from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

export class MultipartStartResponseDto extends OkResponseDto {
	@ApiProperty({ example: 'uuid' })
	mediaId: string

	@ApiProperty({ example: 'upload-id' })
	uploadId: string

	@ApiProperty({ example: 'catalogs/uuid/products/2026/02/09/raw/uuid.jpg' })
	key: string

	@ApiProperty({ example: 'https://cdn.example.com/.../raw/uuid.jpg' })
	url: string

	@ApiProperty({ example: 67108864 })
	partSize: number

	@ApiProperty({ example: 3 })
	partCount: number
}

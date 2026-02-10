import { ApiProperty } from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

export class PresignUploadResponseDto extends OkResponseDto {
	@ApiProperty({ example: 'uuid' })
	mediaId: string

	@ApiProperty({ example: 'https://s3.amazonaws.com/...signed...' })
	uploadUrl: string

	@ApiProperty({ example: 'catalogs/uuid/products/2026/02/09/raw/uuid.jpg' })
	key: string

	@ApiProperty({ example: 'https://cdn.example.com/.../raw/uuid.jpg' })
	url: string

	@ApiProperty({ example: 600 })
	expiresIn: number
}

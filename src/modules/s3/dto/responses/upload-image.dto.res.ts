import { ApiProperty } from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

export class ImageVariantDto {
	@ApiProperty({ example: 'detail' })
	name: string

	@ApiProperty({ example: 1600 })
	width: number

	@ApiProperty({ example: 1200 })
	height: number

	@ApiProperty({ example: 245678 })
	size: number

	@ApiProperty({ example: 'image/webp' })
	contentType: string

	@ApiProperty({ example: 'catalogs/uuid/products/2026/02/09/uuid-detail.webp' })
	key: string

	@ApiProperty({ example: 'https://cdn.example.com/.../uuid-detail.webp' })
	url: string
}

export class UploadImageResponseDto extends OkResponseDto {
	@ApiProperty({ example: 'uuid' })
	mediaId: string

	@ApiProperty({ example: 'catalogs/uuid/products/2026/02/09/uuid-detail.webp' })
	key: string

	@ApiProperty({ example: 'https://cdn.example.com/.../uuid-detail.webp' })
	url: string

	@ApiProperty({ type: [ImageVariantDto] })
	variants: ImageVariantDto[]
}

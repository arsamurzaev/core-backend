import { ApiProperty } from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

export class ImageVariantDto {
	@ApiProperty({ example: 'xl' })
	name: string

	@ApiProperty({ example: 1600 })
	width: number

	@ApiProperty({ example: 1200 })
	height: number

	@ApiProperty({ example: 245678 })
	size: number

	@ApiProperty({ example: 'image/webp' })
	contentType: string

	@ApiProperty({ example: 'catalogs/uuid/products/2026/02/09/uuid-xl.webp' })
	key: string

	@ApiProperty({ example: 'https://cdn.example.com/.../uuid-xl.webp' })
	url: string
}

export class UploadImageResponseDto extends OkResponseDto {
	@ApiProperty({ example: 'uuid' })
	mediaId: string

	@ApiProperty({ example: 'catalogs/uuid/products/2026/02/09/uuid-xl.webp' })
	key: string

	@ApiProperty({ example: 'https://cdn.example.com/.../uuid-xl.webp' })
	url: string

	@ApiProperty({ type: [ImageVariantDto] })
	variants: ImageVariantDto[]
}

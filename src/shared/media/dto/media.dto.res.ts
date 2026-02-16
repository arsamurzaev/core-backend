import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { MediaStatus } from '@generated/enums'

export class MediaVariantDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	kind: string

	@ApiPropertyOptional({ type: String, nullable: true })
	mimeType?: string | null

	@ApiPropertyOptional({ type: Number, nullable: true })
	size?: number | null

	@ApiPropertyOptional({ type: Number, nullable: true })
	width?: number | null

	@ApiPropertyOptional({ type: Number, nullable: true })
	height?: number | null

	@ApiProperty({ type: String })
	key: string

	@ApiProperty({ type: String })
	url: string
}

export class MediaDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	originalName: string

	@ApiProperty({ type: String })
	mimeType: string

	@ApiPropertyOptional({ type: Number, nullable: true })
	size?: number | null

	@ApiPropertyOptional({ type: Number, nullable: true })
	width?: number | null

	@ApiPropertyOptional({ type: Number, nullable: true })
	height?: number | null

	@ApiProperty({ enum: MediaStatus })
	status: MediaStatus

	@ApiProperty({ type: String })
	key: string

	@ApiProperty({ type: String })
	url: string

	@ApiProperty({ type: [MediaVariantDto] })
	variants: MediaVariantDto[]
}

import { MediaStatus } from '@generated/enums'
import { ApiProperty } from '@nestjs/swagger'

export class MediaVariantDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	kind: string

	@ApiProperty({ type: String, nullable: true })
	mimeType: string | null

	@ApiProperty({ type: Number, nullable: true })
	size: number | null

	@ApiProperty({ type: Number, nullable: true })
	width: number | null

	@ApiProperty({ type: Number, nullable: true })
	height: number | null

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

	@ApiProperty({ type: Number, nullable: true })
	size: number | null

	@ApiProperty({ type: Number, nullable: true })
	width: number | null

	@ApiProperty({ type: Number, nullable: true })
	height: number | null

	@ApiProperty({ enum: MediaStatus })
	status: MediaStatus

	@ApiProperty({ type: String })
	key: string

	@ApiProperty({ type: String })
	url: string

	@ApiProperty({ type: [MediaVariantDto] })
	variants: MediaVariantDto[]
}

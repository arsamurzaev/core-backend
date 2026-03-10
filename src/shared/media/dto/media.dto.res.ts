import { MediaStatus } from '@generated/enums'
import { ApiProperty } from '@nestjs/swagger'

export class MediaVariantDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({
		type: String,
		example: 'card-webp',
		description:
			'Ключ варианта медиа в формате <role>-<format>. Поддерживаемые role: thumb, card, detail.'
	})
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

	@ApiProperty({
		type: String,
		description:
			'Публичный URL конкретного варианта. Для клиентской выдачи ориентируйтесь на kind.'
	})
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

	@ApiProperty({
		type: String,
		description:
			'Основной URL медиа. Для адаптивной выдачи используйте variants по назначению.'
	})
	url: string

	@ApiProperty({
		type: [MediaVariantDto],
		description:
			'Доступные варианты изображения. Обычно используются роли: thumb для корзины/миниатюр, card для карточек в списках, detail для страницы товара.'
	})
	variants: MediaVariantDto[]
}

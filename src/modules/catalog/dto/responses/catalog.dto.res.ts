import { CatalogStatus, ProductsDisplayMode } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

export class CatalogConfigDto {
	@ApiProperty({ enum: CatalogStatus })
	status: CatalogStatus

	@ApiPropertyOptional({ type: String, nullable: true })
	about?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	description?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	currency?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	logoUrl?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	bgUrl?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	note?: string | null
}

export class CatalogSettingsDto {
	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: Boolean })
	isCommerceEnabled: boolean

	@ApiProperty({ enum: ProductsDisplayMode })
	productsDisplayMode: ProductsDisplayMode
}

export class CatalogDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	slug: string

	@ApiProperty({ type: String, nullable: true })
	domain: string | null

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String })
	typeId: string

	@ApiProperty({ type: String, nullable: true })
	parentId: string | null

	@ApiProperty({ type: String, nullable: true })
	userId: string | null

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	deleteAt?: string | null

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	createdAt?: string

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	updatedAt?: string

	@ApiProperty({ type: CatalogConfigDto })
	config: CatalogConfigDto

	@ApiProperty({ type: CatalogSettingsDto })
	settings: CatalogSettingsDto
}

export class CatalogCreateResponseDto extends OkResponseDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	slug: string

	@ApiProperty({ type: String, nullable: true })
	domain: string | null
}

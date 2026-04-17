import { CatalogExperienceMode, CatalogStatus, ContactType } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { AttributeDto } from '@/modules/attribute/dto/responses/attribute.dto.res'
import { SeoDto } from '@/modules/seo/dto/responses/seo.dto.res'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { MediaDto } from '@/shared/media/dto/media.dto.res'

export class CatalogConfigDto {
	@ApiProperty({ enum: CatalogStatus })
	status: CatalogStatus

	@ApiProperty({ type: String })
	about: string

	@ApiProperty({ type: String, nullable: true })
	description: string | null

	@ApiProperty({ type: String })
	currency: string

	@ApiProperty({ type: MediaDto, nullable: true })
	logoMedia: MediaDto | null

	@ApiProperty({ type: MediaDto, nullable: true })
	bgMedia: MediaDto | null

	@ApiProperty({ type: String, nullable: true })
	note: string | null
}

export class CatalogSettingsDto {
	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ enum: CatalogExperienceMode })
	defaultMode: CatalogExperienceMode

	@ApiProperty({ enum: CatalogExperienceMode, isArray: true })
	allowedModes: CatalogExperienceMode[]

	@ApiProperty({ type: String, nullable: true })
	googleVerification: string | null

	@ApiProperty({ type: String, nullable: true })
	yandexVerification: string | null
}

export class CatalogTypeDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: [AttributeDto] })
	attributes: AttributeDto[]
}

export class CatalogContactDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ enum: ContactType })
	type: ContactType

	@ApiProperty({ type: Number })
	position: number

	@ApiProperty({ type: String })
	value: string
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

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	subscriptionEndsAt?: string | null

	@ApiProperty({ type: CatalogConfigDto, nullable: true })
	config: CatalogConfigDto | null

	@ApiProperty({ type: CatalogSettingsDto, nullable: true })
	settings: CatalogSettingsDto | null
}

export class CatalogCurrentDto extends CatalogDto {
	@ApiProperty({ type: [CatalogContactDto] })
	contacts: CatalogContactDto[]

	@ApiProperty({ type: SeoDto, nullable: true })
	seo: SeoDto | null

	@ApiProperty({ type: CatalogTypeDto })
	type: CatalogTypeDto
}

export class CatalogCurrentShellDto extends CatalogDto {
	@ApiProperty({ type: [CatalogContactDto] })
	contacts: CatalogContactDto[]

	@ApiProperty({ type: SeoDto, nullable: true })
	seo: SeoDto | null
}

export class CatalogCreateResponseDto extends OkResponseDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	slug: string

	@ApiProperty({ type: String, nullable: true })
	domain: string | null
}

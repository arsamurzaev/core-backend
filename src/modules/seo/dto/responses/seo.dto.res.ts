import { SeoChangeFreq, SeoEntityType } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { MediaDto } from '@/shared/media/dto/media.dto.res'

export class SeoDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	catalogId: string

	@ApiProperty({ enum: SeoEntityType })
	entityType: SeoEntityType

	@ApiProperty({ type: String })
	entityId: string

	@ApiPropertyOptional({ type: String, nullable: true })
	urlPath?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	canonicalUrl?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	title?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	description?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	keywords?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	h1?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	seoText?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	robots?: string | null

	@ApiPropertyOptional({ type: Boolean, nullable: true })
	isIndexable?: boolean | null

	@ApiPropertyOptional({ type: Boolean, nullable: true })
	isFollowable?: boolean | null

	@ApiPropertyOptional({ type: String, nullable: true })
	ogTitle?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	ogDescription?: string | null

	@ApiPropertyOptional({ type: MediaDto, nullable: true })
	ogMedia?: MediaDto | null

	@ApiPropertyOptional({ type: String, nullable: true })
	ogType?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	ogUrl?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	ogSiteName?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	ogLocale?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	twitterCard?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	twitterTitle?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	twitterDescription?: string | null

	@ApiPropertyOptional({ type: MediaDto, nullable: true })
	twitterMedia?: MediaDto | null

	@ApiPropertyOptional({ type: String, nullable: true })
	twitterSite?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	twitterCreator?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	hreflang?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	structuredData?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	extras?: string | null

	@ApiPropertyOptional({ type: Number, nullable: true })
	sitemapPriority?: number | null

	@ApiPropertyOptional({ enum: SeoChangeFreq, nullable: true })
	sitemapChangeFreq?: SeoChangeFreq | null

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}

import { SeoChangeFreq, SeoEntityType } from '@generated/enums'
import { ApiProperty } from '@nestjs/swagger'

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

	@ApiProperty({ type: String, nullable: true })
	urlPath: string | null

	@ApiProperty({ type: String, nullable: true })
	canonicalUrl: string | null

	@ApiProperty({ type: String, nullable: true })
	title: string | null

	@ApiProperty({ type: String, nullable: true })
	description: string | null

	@ApiProperty({ type: String, nullable: true })
	keywords: string | null

	@ApiProperty({ type: String, nullable: true })
	h1: string | null

	@ApiProperty({ type: String, nullable: true })
	seoText: string | null

	@ApiProperty({ type: String, nullable: true })
	robots: string | null

	@ApiProperty({ type: Boolean })
	isIndexable: boolean

	@ApiProperty({ type: Boolean })
	isFollowable: boolean

	@ApiProperty({ type: String, nullable: true })
	ogTitle: string | null

	@ApiProperty({ type: String, nullable: true })
	ogDescription: string | null

	@ApiProperty({ type: MediaDto, nullable: true })
	ogMedia: MediaDto | null

	@ApiProperty({ type: String, nullable: true })
	ogType: string | null

	@ApiProperty({ type: String, nullable: true })
	ogUrl: string | null

	@ApiProperty({ type: String, nullable: true })
	ogSiteName: string | null

	@ApiProperty({ type: String, nullable: true })
	ogLocale: string | null

	@ApiProperty({ type: String, nullable: true })
	twitterCard: string | null

	@ApiProperty({ type: String, nullable: true })
	twitterTitle: string | null

	@ApiProperty({ type: String, nullable: true })
	twitterDescription: string | null

	@ApiProperty({ type: MediaDto, nullable: true })
	twitterMedia: MediaDto | null

	@ApiProperty({ type: MediaDto, nullable: true })
	faviconMedia: MediaDto | null

	@ApiProperty({ type: String, nullable: true })
	twitterSite: string | null

	@ApiProperty({ type: String, nullable: true })
	twitterCreator: string | null

	@ApiProperty({ type: String, nullable: true })
	hreflang: string | null

	@ApiProperty({ type: String, nullable: true })
	structuredData: string | null

	@ApiProperty({ type: String, nullable: true })
	extras: string | null

	@ApiProperty({ type: Number, nullable: true })
	sitemapPriority: number | null

	@ApiProperty({ enum: SeoChangeFreq, nullable: true })
	sitemapChangeFreq: SeoChangeFreq | null

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: string

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string
}

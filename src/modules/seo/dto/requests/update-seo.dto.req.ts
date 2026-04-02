import { SeoChangeFreq, SeoEntityType } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
	IsBoolean,
	IsEnum,
	IsNumber,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min
} from 'class-validator'

export class UpdateSeoDtoReq {
	@ApiPropertyOptional({ type: String, example: SeoEntityType.PRODUCT })
	@IsOptional()
	@IsEnum(SeoEntityType)
	entityType?: SeoEntityType | null

	@ApiPropertyOptional({ type: String, example: 'entity-id' })
	@IsOptional()
	@IsString()
	entityId?: string | null

	@ApiPropertyOptional({ type: String, example: '/catalog/shoes' })
	@IsOptional()
	@IsString()
	@MaxLength(1024)
	urlPath?: string | null

	@ApiPropertyOptional({
		type: String,
		example: 'https://example.com/catalog/shoes'
	})
	@IsOptional()
	@IsString()
	@MaxLength(2048)
	canonicalUrl?: string | null

	@ApiPropertyOptional({ type: String, example: 'Page title' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	title?: string | null

	@ApiPropertyOptional({ type: String, example: 'Meta description' })
	@IsOptional()
	@IsString()
	@MaxLength(500)
	description?: string | null

	@ApiPropertyOptional({ type: String, example: 'shoes, catalog' })
	@IsOptional()
	@IsString()
	@MaxLength(500)
	keywords?: string | null

	@ApiPropertyOptional({ type: String, example: 'Heading' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	h1?: string | null

	@ApiPropertyOptional({ type: String, example: 'SEO text block' })
	@IsOptional()
	@IsString()
	seoText?: string | null

	@ApiPropertyOptional({ type: String, example: 'index,follow' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	robots?: string | null

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isIndexable?: boolean | null

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isFollowable?: boolean | null

	@ApiPropertyOptional({ type: String, example: 'OG title' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	ogTitle?: string | null

	@ApiPropertyOptional({ type: String, example: 'OG description' })
	@IsOptional()
	@IsString()
	@MaxLength(500)
	ogDescription?: string | null

	@ApiPropertyOptional({
		type: String,
		example: 'media-uuid'
	})
	@IsOptional()
	@IsString()
	@MaxLength(120)
	ogMediaId?: string | null

	@ApiPropertyOptional({ type: String, example: 'website' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	ogType?: string | null

	@ApiPropertyOptional({
		type: String,
		example: 'https://example.com/page'
	})
	@IsOptional()
	@IsString()
	@MaxLength(2048)
	ogUrl?: string | null

	@ApiPropertyOptional({ type: String, example: 'My Catalog' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	ogSiteName?: string | null

	@ApiPropertyOptional({ type: String, example: 'en_US' })
	@IsOptional()
	@IsString()
	@MaxLength(20)
	ogLocale?: string | null

	@ApiPropertyOptional({ type: String, example: 'summary_large_image' })
	@IsOptional()
	@IsString()
	@MaxLength(50)
	twitterCard?: string | null

	@ApiPropertyOptional({ type: String, example: 'Twitter title' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	twitterTitle?: string | null

	@ApiPropertyOptional({ type: String, example: 'Twitter description' })
	@IsOptional()
	@IsString()
	@MaxLength(500)
	twitterDescription?: string | null

	@ApiPropertyOptional({
		type: String,
		example: 'media-uuid'
	})
	@IsOptional()
	@IsString()
	@MaxLength(120)
	twitterMediaId?: string | null

	@ApiPropertyOptional({ type: String, example: 'media-uuid' })
	@IsOptional()
	@IsString()
	@MaxLength(120)
	faviconMediaId?: string | null

	@ApiPropertyOptional({ type: String, example: '@catalog' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	twitterSite?: string | null

	@ApiPropertyOptional({ type: String, example: '@author' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	twitterCreator?: string | null

	@ApiPropertyOptional({ type: Object })
	@IsOptional()
	hreflang?: Record<string, string> | null

	@ApiPropertyOptional({ type: Object })
	@IsOptional()
	structuredData?: Record<string, unknown> | null

	@ApiPropertyOptional({ type: Object })
	@IsOptional()
	extras?: Record<string, unknown> | null

	@ApiPropertyOptional({ type: Number, example: 0.5 })
	@IsOptional()
	@Type(() => Number)
	@IsNumber()
	@Min(0)
	@Max(1)
	sitemapPriority?: number | null

	@ApiPropertyOptional({ type: String, example: SeoChangeFreq.WEEKLY })
	@IsOptional()
	@IsEnum(SeoChangeFreq)
	sitemapChangeFreq?: SeoChangeFreq | null
}

import type { SeoChangeFreq, SeoEntityType } from '@generated/enums'
import type {
	SeoSettingCreateInput,
	SeoSettingUpdateInput
} from '@generated/models'

import type { MediaRecord } from '@/shared/media/media-url.service'

export const SEO_SETTINGS_PORT = Symbol('SEO_SETTINGS_PORT')

export type SeoSettingsCreateInput = SeoSettingCreateInput
export type SeoSettingsUpdateInput = SeoSettingUpdateInput

export type SeoSettingsRecord = {
	id: string
	catalogId: string
	entityType: SeoEntityType
	entityId: string
	urlPath: string | null
	canonicalUrl: string | null
	title: string | null
	description: string | null
	keywords: string | null
	h1: string | null
	seoText: string | null
	robots: string | null
	isIndexable: boolean
	isFollowable: boolean
	ogTitle: string | null
	ogDescription: string | null
	ogMedia: MediaRecord | null
	ogType: string | null
	ogUrl: string | null
	ogSiteName: string | null
	ogLocale: string | null
	twitterCard: string | null
	twitterTitle: string | null
	twitterDescription: string | null
	twitterMedia: MediaRecord | null
	faviconMedia: MediaRecord | null
	twitterSite: string | null
	twitterCreator: string | null
	hreflang: unknown | null
	structuredData: unknown | null
	extras: unknown | null
	sitemapPriority: unknown | null
	sitemapChangeFreq: SeoChangeFreq | null
	createdAt: Date
	updatedAt: Date
}

export interface SeoSettingsPort {
	findAll(catalogId: string): Promise<SeoSettingsRecord[]>
	findById(id: string, catalogId: string): Promise<SeoSettingsRecord | null>
	findByEntity(
		catalogId: string,
		entityType: SeoEntityType,
		entityId: string
	): Promise<SeoSettingsRecord | null>
	create(data: SeoSettingsCreateInput): Promise<SeoSettingsRecord>
	update(
		id: string,
		catalogId: string,
		data: SeoSettingsUpdateInput
	): Promise<SeoSettingsRecord | null>
	softDelete(id: string, catalogId: string): Promise<SeoSettingsRecord | null>
}

import type {
	SeoSettingCreateInput,
	SeoSettingUpdateInput
} from '@generated/models'

import { normalizeNullableTrimmedString } from '@/shared/utils'

import type { CreateSeoDtoReq } from './dto/requests/create-seo.dto.req'
import type { UpdateSeoDtoReq } from './dto/requests/update-seo.dto.req'

const SEO_NORMALIZED_TEXT_FIELDS = [
	'urlPath',
	'canonicalUrl',
	'title',
	'description',
	'keywords',
	'h1',
	'seoText',
	'robots',
	'ogTitle',
	'ogDescription',
	'ogType',
	'ogUrl',
	'ogSiteName',
	'ogLocale',
	'twitterCard',
	'twitterTitle',
	'twitterDescription',
	'twitterSite',
	'twitterCreator'
] as const

type SeoNormalizedTextField = (typeof SEO_NORMALIZED_TEXT_FIELDS)[number]

export function buildSeoCreateInput(
	dto: CreateSeoDtoReq,
	options: {
		catalogId: string
		entityId: string
		ogMediaId?: string | null
		twitterMediaId?: string | null
	}
): SeoSettingCreateInput {
	const data: SeoSettingCreateInput = {
		catalog: { connect: { id: options.catalogId } },
		entityType: dto.entityType,
		entityId: options.entityId,
		...(options.ogMediaId
			? { ogMedia: { connect: { id: options.ogMediaId } } }
			: {}),
		...(options.twitterMediaId
			? { twitterMedia: { connect: { id: options.twitterMediaId } } }
			: {}),
		hreflang: dto.hreflang ?? undefined,
		structuredData: serializeOptionalJson(dto.structuredData),
		extras: serializeOptionalJson(dto.extras),
		sitemapPriority: dto.sitemapPriority ?? undefined,
		sitemapChangeFreq: dto.sitemapChangeFreq ?? undefined
	}

	assignNormalizedTextFields(
		data as Record<string, unknown>,
		dto as Partial<Record<SeoNormalizedTextField, string | null | undefined>>
	)
	assignNullableBooleanFlags(data as Record<string, unknown>, dto)

	return data
}

export function buildSeoUpdateInput(
	dto: UpdateSeoDtoReq,
	options: {
		entityId?: string
		ogMediaId?: string | null
		twitterMediaId?: string | null
	}
): SeoSettingUpdateInput {
	const data: SeoSettingUpdateInput = {}

	if (dto.entityType !== undefined && dto.entityType !== null) {
		data.entityType = dto.entityType
	}

	if (options.entityId !== undefined) {
		data.entityId = options.entityId
	}

	assignNormalizedTextFields(
		data as Record<string, unknown>,
		dto as Partial<Record<SeoNormalizedTextField, string | null | undefined>>,
		true
	)

	if (dto.ogMediaId !== undefined) {
		data.ogMedia = options.ogMediaId
			? { connect: { id: options.ogMediaId } }
			: { disconnect: true }
	}

	if (dto.twitterMediaId !== undefined) {
		data.twitterMedia = options.twitterMediaId
			? { connect: { id: options.twitterMediaId } }
			: { disconnect: true }
	}

	if (dto.hreflang !== undefined) {
		data.hreflang = dto.hreflang
	}

	if (dto.structuredData !== undefined) {
		data.structuredData = serializeOptionalJson(dto.structuredData)
	}

	if (dto.extras !== undefined) {
		data.extras = serializeOptionalJson(dto.extras)
	}

	if (dto.sitemapPriority !== undefined) {
		data.sitemapPriority = dto.sitemapPriority
	}

	if (dto.sitemapChangeFreq !== undefined) {
		data.sitemapChangeFreq = dto.sitemapChangeFreq
	}

	assignNullableBooleanFlags(data as Record<string, unknown>, dto)

	return data
}

function assignNormalizedTextFields(
	target: Record<string, unknown>,
	source: Partial<Record<SeoNormalizedTextField, string | null | undefined>>,
	onlyDefined = false
) {
	for (const field of SEO_NORMALIZED_TEXT_FIELDS) {
		if (onlyDefined && source[field] === undefined) continue
		target[field] = normalizeNullableTrimmedString(source[field])
	}
}

function assignNullableBooleanFlags(
	target: Record<string, unknown>,
	source: Pick<CreateSeoDtoReq, 'isIndexable' | 'isFollowable'>
) {
	if (source.isIndexable !== undefined && source.isIndexable !== null) {
		target.isIndexable = source.isIndexable
	}

	if (source.isFollowable !== undefined && source.isFollowable !== null) {
		target.isFollowable = source.isFollowable
	}
}

function serializeOptionalJson(
	value?: Record<string, unknown> | null
): string | undefined {
	return value ? JSON.stringify(value) : undefined
}

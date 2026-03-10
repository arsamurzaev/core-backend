import { SeoEntityType } from '@generated/enums'
import { SeoSettingCreateInput, SeoSettingUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import type { MediaRecord } from '@/shared/media/media-url.service'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { ensureMediaInCatalog } from '@/shared/media/media.validation'
import { mustCatalogId } from '@/shared/tenancy/ctx'
import {
	assertHasUpdateFields,
	normalizeNullableTrimmedString,
	normalizeOptionalNonEmptyString,
	normalizeRequiredString
} from '@/shared/utils'

import { CreateSeoDtoReq } from './dto/requests/create-seo.dto.req'
import { UpdateSeoDtoReq } from './dto/requests/update-seo.dto.req'
import { SeoRepository } from './seo.repository'

@Injectable()
export class SeoService {
	constructor(
		private readonly repo: SeoRepository,
		private readonly mediaRepo: MediaRepository,
		private readonly mediaUrl: MediaUrlService
	) {}

	async getAll() {
		const catalogId = mustCatalogId()
		const items = await this.repo.findAll(catalogId)
		return items.map(item => this.mapSeo(item))
	}

	async getById(id: string) {
		const catalogId = mustCatalogId()
		const seo = await this.repo.findById(id, catalogId)
		if (!seo) throw new NotFoundException('SEO-настройка не найдена')
		return this.mapSeo(seo)
	}

	async getByEntity(entityType: SeoEntityType, entityId: string) {
		const catalogId = mustCatalogId()
		const normalizedEntityId = normalizeRequiredString(entityId, 'entityId')
		const seo = await this.repo.findByEntity(
			catalogId,
			entityType,
			normalizedEntityId
		)
		if (!seo) throw new NotFoundException('SEO-настройка не найдена')
		return this.mapSeo(seo)
	}

	async create(dto: CreateSeoDtoReq) {
		const catalogId = mustCatalogId()
		const entityId = normalizeRequiredString(dto.entityId, 'entityId')
		const ogMediaId = normalizeOptionalNonEmptyString(dto.ogMediaId, 'ogMediaId')
		const twitterMediaId = normalizeOptionalNonEmptyString(
			dto.twitterMediaId,
			'twitterMediaId'
		)

		if (ogMediaId) {
			await ensureMediaInCatalog(this.mediaRepo, ogMediaId, catalogId)
		}
		if (twitterMediaId) {
			await ensureMediaInCatalog(this.mediaRepo, twitterMediaId, catalogId)
		}

		const data: SeoSettingCreateInput = {
			catalog: { connect: { id: catalogId } },
			entityType: dto.entityType,
			entityId,
			urlPath: normalizeNullableTrimmedString(dto.urlPath),
			canonicalUrl: normalizeNullableTrimmedString(dto.canonicalUrl),
			title: normalizeNullableTrimmedString(dto.title),
			description: normalizeNullableTrimmedString(dto.description),
			keywords: normalizeNullableTrimmedString(dto.keywords),
			h1: normalizeNullableTrimmedString(dto.h1),
			seoText: normalizeNullableTrimmedString(dto.seoText),
			robots: normalizeNullableTrimmedString(dto.robots),
			ogTitle: normalizeNullableTrimmedString(dto.ogTitle),
			ogDescription: normalizeNullableTrimmedString(dto.ogDescription),
			...(ogMediaId ? { ogMedia: { connect: { id: ogMediaId } } } : {}),
			ogType: normalizeNullableTrimmedString(dto.ogType),
			ogUrl: normalizeNullableTrimmedString(dto.ogUrl),
			ogSiteName: normalizeNullableTrimmedString(dto.ogSiteName),
			ogLocale: normalizeNullableTrimmedString(dto.ogLocale),
			twitterCard: normalizeNullableTrimmedString(dto.twitterCard),
			twitterTitle: normalizeNullableTrimmedString(dto.twitterTitle),
			twitterDescription: normalizeNullableTrimmedString(dto.twitterDescription),
			...(twitterMediaId
				? { twitterMedia: { connect: { id: twitterMediaId } } }
				: {}),
			twitterSite: normalizeNullableTrimmedString(dto.twitterSite),
			twitterCreator: normalizeNullableTrimmedString(dto.twitterCreator),
			hreflang: dto.hreflang ?? undefined,
			structuredData: dto.structuredData
				? JSON.stringify(dto.structuredData)
				: undefined,
			extras: dto.extras ? JSON.stringify(dto.extras) : undefined,
			sitemapPriority: dto.sitemapPriority ?? undefined,
			sitemapChangeFreq: dto.sitemapChangeFreq ?? undefined
		}

		if (dto.isIndexable !== undefined && dto.isIndexable !== null) {
			data.isIndexable = dto.isIndexable
		}
		if (dto.isFollowable !== undefined && dto.isFollowable !== null) {
			data.isFollowable = dto.isFollowable
		}

		const created = await this.repo.create(data)
		return this.mapSeo(created)
	}

	async update(id: string, dto: UpdateSeoDtoReq) {
		const catalogId = mustCatalogId()
		const data: SeoSettingUpdateInput = {}

		if (dto.entityType !== undefined && dto.entityType !== null) {
			data.entityType = dto.entityType
		}
		if (dto.entityId !== undefined) {
			if (dto.entityId === null) {
				throw new BadRequestException('Поле entityId обязательно')
			}
			data.entityId = normalizeRequiredString(dto.entityId, 'entityId')
		}
		if (dto.urlPath !== undefined) {
			data.urlPath = normalizeNullableTrimmedString(dto.urlPath)
		}
		if (dto.canonicalUrl !== undefined) {
			data.canonicalUrl = normalizeNullableTrimmedString(dto.canonicalUrl)
		}
		if (dto.title !== undefined) {
			data.title = normalizeNullableTrimmedString(dto.title)
		}
		if (dto.description !== undefined) {
			data.description = normalizeNullableTrimmedString(dto.description)
		}
		if (dto.keywords !== undefined) {
			data.keywords = normalizeNullableTrimmedString(dto.keywords)
		}
		if (dto.h1 !== undefined) {
			data.h1 = normalizeNullableTrimmedString(dto.h1)
		}
		if (dto.seoText !== undefined) {
			data.seoText = normalizeNullableTrimmedString(dto.seoText)
		}
		if (dto.robots !== undefined) {
			data.robots = normalizeNullableTrimmedString(dto.robots)
		}
		if (dto.ogTitle !== undefined) {
			data.ogTitle = normalizeNullableTrimmedString(dto.ogTitle)
		}
		if (dto.ogDescription !== undefined) {
			data.ogDescription = normalizeNullableTrimmedString(dto.ogDescription)
		}
		if (dto.ogMediaId !== undefined) {
			const ogMediaId = normalizeOptionalNonEmptyString(dto.ogMediaId, 'ogMediaId')
			if (ogMediaId) {
				await ensureMediaInCatalog(this.mediaRepo, ogMediaId, catalogId)
				data.ogMedia = { connect: { id: ogMediaId } }
			} else {
				data.ogMedia = { disconnect: true }
			}
		}
		if (dto.ogType !== undefined) {
			data.ogType = normalizeNullableTrimmedString(dto.ogType)
		}
		if (dto.ogUrl !== undefined) {
			data.ogUrl = normalizeNullableTrimmedString(dto.ogUrl)
		}
		if (dto.ogSiteName !== undefined) {
			data.ogSiteName = normalizeNullableTrimmedString(dto.ogSiteName)
		}
		if (dto.ogLocale !== undefined) {
			data.ogLocale = normalizeNullableTrimmedString(dto.ogLocale)
		}
		if (dto.twitterCard !== undefined) {
			data.twitterCard = normalizeNullableTrimmedString(dto.twitterCard)
		}
		if (dto.twitterTitle !== undefined) {
			data.twitterTitle = normalizeNullableTrimmedString(dto.twitterTitle)
		}
		if (dto.twitterDescription !== undefined) {
			data.twitterDescription = normalizeNullableTrimmedString(
				dto.twitterDescription
			)
		}
		if (dto.twitterMediaId !== undefined) {
			const twitterMediaId = normalizeOptionalNonEmptyString(
				dto.twitterMediaId,
				'twitterMediaId'
			)
			if (twitterMediaId) {
				await ensureMediaInCatalog(this.mediaRepo, twitterMediaId, catalogId)
				data.twitterMedia = { connect: { id: twitterMediaId } }
			} else {
				data.twitterMedia = { disconnect: true }
			}
		}
		if (dto.twitterSite !== undefined) {
			data.twitterSite = normalizeNullableTrimmedString(dto.twitterSite)
		}
		if (dto.twitterCreator !== undefined) {
			data.twitterCreator = normalizeNullableTrimmedString(dto.twitterCreator)
		}
		if (dto.hreflang !== undefined) {
			data.hreflang = dto.hreflang
		}

		if (dto.structuredData !== undefined) {
			data.structuredData = dto.structuredData
				? JSON.stringify(dto.structuredData)
				: undefined
		}
		if (dto.extras !== undefined) {
			data.extras = dto.extras ? JSON.stringify(dto.extras) : undefined
		}
		if (dto.sitemapPriority !== undefined) {
			data.sitemapPriority = dto.sitemapPriority
		}
		if (dto.sitemapChangeFreq !== undefined) {
			data.sitemapChangeFreq = dto.sitemapChangeFreq
		}
		if (dto.isIndexable !== undefined && dto.isIndexable !== null) {
			data.isIndexable = dto.isIndexable
		}
		if (dto.isFollowable !== undefined && dto.isFollowable !== null) {
			data.isFollowable = dto.isFollowable
		}

		assertHasUpdateFields(data)

		const seo = await this.repo.update(id, catalogId, data)
		if (!seo) throw new NotFoundException('SEO-настройка не найдена')

		return this.mapSeo(seo)
	}

	async remove(id: string) {
		const catalogId = mustCatalogId()
		const seo = await this.repo.softDelete(id, catalogId)
		if (!seo) throw new NotFoundException('SEO-настройка не найдена')
		return { ok: true }
	}

	private mapSeo<
		T extends { ogMedia?: MediaRecord | null; twitterMedia?: MediaRecord | null }
	>(seo: T) {
		return {
			...seo,
			ogMedia: seo.ogMedia ? this.mediaUrl.mapMedia(seo.ogMedia) : null,
			twitterMedia: seo.twitterMedia
				? this.mediaUrl.mapMedia(seo.twitterMedia)
				: null
		}
	}
}

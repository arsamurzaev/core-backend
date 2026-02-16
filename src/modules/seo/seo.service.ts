/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import { SeoEntityType } from '@generated/enums'
import { SeoSettingCreateInput, SeoSettingUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { mustCatalogId } from '@/shared/tenancy/ctx'

import { CreateSeoDtoReq } from './dto/requests/create-seo.dto.req'
import { UpdateSeoDtoReq } from './dto/requests/update-seo.dto.req'
import { SeoRepository } from './seo.repository'

function normalizeOptionalString(
	value?: string | null
): string | null | undefined {
	if (value === undefined) return undefined
	if (value === null) return null
	const normalized = value.trim()
	return normalized.length ? normalized : null
}

function normalizeRequiredString(value: string, name: string): string {
	const normalized = value.trim()
	if (!normalized) {
		throw new BadRequestException(`Поле ${name} обязательно`)
	}
	return normalized
}

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
		const ogMediaId = this.normalizeOptionalId(dto.ogMediaId, 'ogMediaId')
		const twitterMediaId = this.normalizeOptionalId(
			dto.twitterMediaId,
			'twitterMediaId'
		)

		if (ogMediaId) {
			await this.ensureMediaInCatalog(ogMediaId, catalogId)
		}
		if (twitterMediaId) {
			await this.ensureMediaInCatalog(twitterMediaId, catalogId)
		}

		const data: SeoSettingCreateInput = {
			catalog: { connect: { id: catalogId } },
			entityType: dto.entityType,
			entityId,
			urlPath: normalizeOptionalString(dto.urlPath),
			canonicalUrl: normalizeOptionalString(dto.canonicalUrl),
			title: normalizeOptionalString(dto.title),
			description: normalizeOptionalString(dto.description),
			keywords: normalizeOptionalString(dto.keywords),
			h1: normalizeOptionalString(dto.h1),
			seoText: normalizeOptionalString(dto.seoText),
			robots: normalizeOptionalString(dto.robots),
			ogTitle: normalizeOptionalString(dto.ogTitle),
			ogDescription: normalizeOptionalString(dto.ogDescription),
			...(ogMediaId ? { ogMedia: { connect: { id: ogMediaId } } } : {}),
			ogType: normalizeOptionalString(dto.ogType),
			ogUrl: normalizeOptionalString(dto.ogUrl),
			ogSiteName: normalizeOptionalString(dto.ogSiteName),
			ogLocale: normalizeOptionalString(dto.ogLocale),
			twitterCard: normalizeOptionalString(dto.twitterCard),
			twitterTitle: normalizeOptionalString(dto.twitterTitle),
			twitterDescription: normalizeOptionalString(dto.twitterDescription),
			...(twitterMediaId
				? { twitterMedia: { connect: { id: twitterMediaId } } }
				: {}),
			twitterSite: normalizeOptionalString(dto.twitterSite),
			twitterCreator: normalizeOptionalString(dto.twitterCreator),
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
			data.urlPath = normalizeOptionalString(dto.urlPath)
		}
		if (dto.canonicalUrl !== undefined) {
			data.canonicalUrl = normalizeOptionalString(dto.canonicalUrl)
		}
		if (dto.title !== undefined) {
			data.title = normalizeOptionalString(dto.title)
		}
		if (dto.description !== undefined) {
			data.description = normalizeOptionalString(dto.description)
		}
		if (dto.keywords !== undefined) {
			data.keywords = normalizeOptionalString(dto.keywords)
		}
		if (dto.h1 !== undefined) {
			data.h1 = normalizeOptionalString(dto.h1)
		}
		if (dto.seoText !== undefined) {
			data.seoText = normalizeOptionalString(dto.seoText)
		}
		if (dto.robots !== undefined) {
			data.robots = normalizeOptionalString(dto.robots)
		}
		if (dto.ogTitle !== undefined) {
			data.ogTitle = normalizeOptionalString(dto.ogTitle)
		}
		if (dto.ogDescription !== undefined) {
			data.ogDescription = normalizeOptionalString(dto.ogDescription)
		}
		if (dto.ogMediaId !== undefined) {
			const ogMediaId = this.normalizeOptionalId(dto.ogMediaId, 'ogMediaId')
			if (ogMediaId) {
				await this.ensureMediaInCatalog(ogMediaId, catalogId)
				data.ogMedia = { connect: { id: ogMediaId } }
			} else {
				data.ogMedia = { disconnect: true }
			}
		}
		if (dto.ogType !== undefined) {
			data.ogType = normalizeOptionalString(dto.ogType)
		}
		if (dto.ogUrl !== undefined) {
			data.ogUrl = normalizeOptionalString(dto.ogUrl)
		}
		if (dto.ogSiteName !== undefined) {
			data.ogSiteName = normalizeOptionalString(dto.ogSiteName)
		}
		if (dto.ogLocale !== undefined) {
			data.ogLocale = normalizeOptionalString(dto.ogLocale)
		}
		if (dto.twitterCard !== undefined) {
			data.twitterCard = normalizeOptionalString(dto.twitterCard)
		}
		if (dto.twitterTitle !== undefined) {
			data.twitterTitle = normalizeOptionalString(dto.twitterTitle)
		}
		if (dto.twitterDescription !== undefined) {
			data.twitterDescription = normalizeOptionalString(dto.twitterDescription)
		}
		if (dto.twitterMediaId !== undefined) {
			const twitterMediaId = this.normalizeOptionalId(
				dto.twitterMediaId,
				'twitterMediaId'
			)
			if (twitterMediaId) {
				await this.ensureMediaInCatalog(twitterMediaId, catalogId)
				data.twitterMedia = { connect: { id: twitterMediaId } }
			} else {
				data.twitterMedia = { disconnect: true }
			}
		}
		if (dto.twitterSite !== undefined) {
			data.twitterSite = normalizeOptionalString(dto.twitterSite)
		}
		if (dto.twitterCreator !== undefined) {
			data.twitterCreator = normalizeOptionalString(dto.twitterCreator)
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

		if (Object.keys(data).length === 0) {
			throw new BadRequestException('Нет полей для обновления')
		}

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

	private mapSeo<T extends { ogMedia?: any | null; twitterMedia?: any | null }>(
		seo: T
	) {
		return {
			...seo,
			ogMedia: seo.ogMedia ? this.mediaUrl.mapMedia(seo.ogMedia) : null,
			twitterMedia: seo.twitterMedia
				? this.mediaUrl.mapMedia(seo.twitterMedia)
				: null
		}
	}

	private normalizeOptionalId(
		value?: string | null,
		name?: string
	): string | null | undefined {
		if (value === undefined || value === null) return value
		const normalized = String(value).trim()
		if (!normalized) {
			throw new BadRequestException(`Поле ${name ?? 'mediaId'} обязательно`)
		}
		return normalized
	}

	private async ensureMediaInCatalog(
		mediaId: string,
		catalogId: string
	): Promise<void> {
		const existing = await this.mediaRepo.findById(mediaId, catalogId)
		if (!existing) {
			throw new BadRequestException(`Медиа ${mediaId} не найдено в каталоге`)
		}
	}
}

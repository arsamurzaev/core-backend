import { SeoEntityType } from '@generated/enums'
import { SeoSettingCreateInput, SeoSettingUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

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
	constructor(private readonly repo: SeoRepository) {}

	async getAll() {
		const catalogId = mustCatalogId()
		return this.repo.findAll(catalogId)
	}

	async getById(id: string) {
		const catalogId = mustCatalogId()
		const seo = await this.repo.findById(id, catalogId)
		if (!seo) throw new NotFoundException('SEO-настройка не найдена')
		return seo
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
		return seo
	}

	async create(dto: CreateSeoDtoReq) {
		const catalogId = mustCatalogId()
		const entityId = normalizeRequiredString(dto.entityId, 'entityId')

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
			ogImage: normalizeOptionalString(dto.ogImage),
			ogType: normalizeOptionalString(dto.ogType),
			ogUrl: normalizeOptionalString(dto.ogUrl),
			ogSiteName: normalizeOptionalString(dto.ogSiteName),
			ogLocale: normalizeOptionalString(dto.ogLocale),
			twitterCard: normalizeOptionalString(dto.twitterCard),
			twitterTitle: normalizeOptionalString(dto.twitterTitle),
			twitterDescription: normalizeOptionalString(dto.twitterDescription),
			twitterImage: normalizeOptionalString(dto.twitterImage),
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

		return this.repo.create(data)
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
		if (dto.ogImage !== undefined) {
			data.ogImage = normalizeOptionalString(dto.ogImage)
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
		if (dto.twitterImage !== undefined) {
			data.twitterImage = normalizeOptionalString(dto.twitterImage)
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

		return seo
	}

	async remove(id: string) {
		const catalogId = mustCatalogId()
		const seo = await this.repo.softDelete(id, catalogId)
		if (!seo) throw new NotFoundException('SEO-настройка не найдена')
		return { ok: true }
	}
}

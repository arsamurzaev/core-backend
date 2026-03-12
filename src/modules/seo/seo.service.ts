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
	normalizeOptionalNonEmptyString,
	normalizeRequiredString
} from '@/shared/utils'

import { CreateSeoDtoReq } from './dto/requests/create-seo.dto.req'
import { UpdateSeoDtoReq } from './dto/requests/update-seo.dto.req'
import { SeoRepository } from './seo.repository'
import { buildSeoCreateInput, buildSeoUpdateInput } from './seo.utils'

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
		const mediaIds = await this.resolveSeoMediaIds(catalogId, dto)
		const data: SeoSettingCreateInput = buildSeoCreateInput(dto, {
			catalogId,
			entityId,
			...mediaIds
		})

		const created = await this.repo.create(data)
		return this.mapSeo(created)
	}

	async update(id: string, dto: UpdateSeoDtoReq) {
		const catalogId = mustCatalogId()
		const entityId = this.normalizeUpdateEntityId(dto.entityId)
		const mediaIds = await this.resolveSeoMediaIds(catalogId, dto)
		const data: SeoSettingUpdateInput = buildSeoUpdateInput(dto, {
			entityId,
			...mediaIds
		})

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

	private normalizeUpdateEntityId(
		entityId: UpdateSeoDtoReq['entityId']
	): string | undefined {
		if (entityId === undefined) return undefined
		if (entityId === null) {
			throw new BadRequestException('Поле entityId обязательно')
		}

		return normalizeRequiredString(entityId, 'entityId')
	}

	private async resolveSeoMediaIds(
		catalogId: string,
		dto: Pick<CreateSeoDtoReq, 'ogMediaId' | 'twitterMediaId'>
	): Promise<{
		ogMediaId?: string | null
		twitterMediaId?: string | null
	}> {
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

		return { ogMediaId, twitterMediaId }
	}
}

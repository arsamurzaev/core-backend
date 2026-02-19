/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-redundant-type-constituents */
import { CatalogCreateInput, CatalogUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import slugify from 'slugify'

import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_CACHE_VERSION,
	CATALOG_CURRENT_CACHE_TTL_SEC,
	CATALOG_TYPE_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import type { MediaDto } from '@/shared/media/dto/media.dto.res'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { RequestContext } from '@/shared/tenancy/request-context'

import { CatalogRepository } from './catalog.repository'
import { CreateCatalogDtoReq } from './dto/requests/create-catalog.dto.req'
import { UpdateCatalogDtoReq } from './dto/requests/update-catalog.dto.req'

const RESERVED_SUBDOMAINS = new Set(
	(
		process.env.CATALOG_RESERVED_SUBDOMAINS ??
		'www,api,admin,app,static,cdn,assets'
	)
		.split(',')
		.map(value => value.trim().toLowerCase())
		.filter(Boolean)
)

const SLUG_MAX_LENGTH = 63
const SLUG_FALLBACK = 'catalog'

function normalizeSlug(value: string): string {
	return value.trim().toLowerCase()
}

function normalizeDomain(value: string | null): string | null {
	if (value === null) return null
	let host = value.trim().toLowerCase()
	if (!host) return null
	host = host.replace(/^https?:\/\//, '')
	host = host.split('/')[0] ?? host
	host = host.split(':')[0] ?? host
	if (host.startsWith('www.')) host = host.slice(4)
	return host || null
}

function ensureSlugAllowed(slug: string) {
	if (!isSlugAllowed(slug)) {
		throw new BadRequestException('Слаг зарезервирован')
	}
}

function isSlugAllowed(slug: string) {
	return !RESERVED_SUBDOMAINS.has(slug)
}

function slugifyValue(value: string): string {
	const slug = slugify(value, { lower: true, strict: true, trim: true })
	return slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
}

function applySuffix(base: string, suffix: number): string {
	const suffixPart = suffix > 0 ? `-${suffix}` : ''
	const headLength = Math.max(0, SLUG_MAX_LENGTH - suffixPart.length)
	const head = base.slice(0, headLength).replace(/-+$/g, '')
	return `${head}${suffixPart}`
}

type CatalogConfigMediaMapped<T> = T extends { config?: infer C }
	? Omit<T, 'config'> & {
			config:
				| (C & { logoMedia?: MediaDto | null; bgMedia?: MediaDto | null })
				| null
		}
	: T

type CatalogCurrent = CatalogConfigMediaMapped<
	Awaited<ReturnType<CatalogRepository['getByIdWithType']>>
>

@Injectable()
export class CatalogService {
	private readonly cacheTtlSec = CATALOG_CURRENT_CACHE_TTL_SEC

	constructor(
		private readonly repo: CatalogRepository,
		private readonly cache: CacheService,
		private readonly mediaRepo: MediaRepository,
		private readonly mediaUrl: MediaUrlService
	) {}

	async create(dto: CreateCatalogDtoReq) {
		const { typeId, status, domain, slug, parentId, userId, ...rest } = dto

		const normalizedDomain = normalizeDomain(domain ?? null)
		if (normalizedDomain) {
			await this.ensureDomainAvailable(normalizedDomain)
		}

		const normalizedSlug = slug ? normalizeSlug(slug) : undefined
		if (normalizedSlug) {
			await this.ensureSlugAvailable(normalizedSlug)
		}
		const resolvedSlug =
			normalizedSlug ?? (await this.generateCatalogSlug(dto.name))

		const data: CatalogCreateInput = {
			...rest,
			slug: resolvedSlug,
			domain: normalizedDomain,
			type: { connect: { id: typeId } },
			config: {
				create: {
					status
				}
			},
			settings: {
				create: {}
			}
		}

		if (parentId) {
			data.parent = { connect: { id: parentId } }
		}

		if (userId) {
			data.user = { connect: { id: userId } }
		}

		const catalog = await this.repo.create(data)
		return {
			ok: true,
			id: catalog.id,
			slug: catalog.slug,
			domain: catalog.domain
		}
	}

	async getAll() {
		const catalogs = await this.repo.getAll()
		return catalogs.map(catalog => this.mapCatalog(catalog))
	}

	async getById(id: string) {
		const catalog = await this.repo.getById(id)
		if (!catalog) throw new NotFoundException('Каталог не найден')
		return this.mapCatalog(catalog)
	}

	async getCurrent() {
		const store = RequestContext.get()
		if (!store?.catalogId) throw new NotFoundException('Каталог не найден')
		if (!this.cacheTtlSec || !store.typeId) {
			return this.loadCurrentCatalog(store.catalogId)
		}

		const cacheKey = await this.buildCatalogCacheKey(
			store.catalogId,
			store.typeId
		)
		const cached = await this.cache.getJson<CatalogCurrent>(cacheKey)
		if (cached !== null) return cached

		const catalog = await this.loadCurrentCatalog(store.catalogId)
		await this.cache.setJson(cacheKey, catalog, this.cacheTtlSec)
		return catalog
	}

	async updateById(id: string, dto: UpdateCatalogDtoReq) {
		const data = await this.buildUpdateData(
			dto,
			{
				allowStatus: true,
				allowType: true,
				allowOwner: true,
				allowParent: true
			},
			id
		)
		const catalog = await this.repo.update(id, data)
		await this.invalidateCatalogCache(id)
		return this.mapCatalog(catalog)
	}

	async updateCurrent(dto: UpdateCatalogDtoReq) {
		const store = RequestContext.get()
		if (!store?.catalogId) throw new NotFoundException('Каталог не найден')
		const data = await this.buildUpdateData(
			dto,
			{
				allowStatus: false,
				allowType: false,
				allowOwner: false,
				allowParent: false
			},
			store.catalogId
		)
		const catalog = await this.repo.update(store.catalogId, data)
		await this.invalidateCatalogCache(store.catalogId)
		return this.mapCatalog(catalog)
	}

	private async buildUpdateData(
		dto: UpdateCatalogDtoReq,
		options: {
			allowStatus: boolean
			allowType: boolean
			allowOwner: boolean
			allowParent: boolean
		},
		catalogId: string
	): Promise<CatalogUpdateInput> {
		const data: CatalogUpdateInput = {}

		if (dto.slug !== undefined) {
			const normalized = normalizeSlug(dto.slug)
			await this.ensureSlugAvailable(normalized, catalogId)
			data.slug = normalized
		}

		if (dto.domain !== undefined) {
			const normalized = normalizeDomain(dto.domain)
			if (normalized) {
				await this.ensureDomainAvailable(normalized, catalogId)
			}
			data.domain = normalized
		}

		if (dto.name !== undefined) {
			data.name = dto.name
		}

		if (options.allowType && dto.typeId) {
			data.type = { connect: { id: dto.typeId } }
		}

		if (options.allowParent && dto.parentId !== undefined) {
			data.parent =
				dto.parentId === null
					? { disconnect: true }
					: { connect: { id: dto.parentId } }
		}

		if (options.allowOwner && dto.userId !== undefined) {
			data.user =
				dto.userId === null ? { disconnect: true } : { connect: { id: dto.userId } }
		}

		const configUpdate: Record<string, any> = {}
		const configCreate: Record<string, any> = {}

		if (dto.about !== undefined) {
			configUpdate.about = dto.about
			configCreate.about = dto.about
		}
		if (dto.description !== undefined) {
			configUpdate.description = dto.description
			configCreate.description = dto.description
		}
		if (dto.currency !== undefined) {
			configUpdate.currency = dto.currency
			configCreate.currency = dto.currency
		}
		if (dto.logoMediaId !== undefined) {
			const logoMediaId = this.normalizeRequiredId(dto.logoMediaId, 'logoMediaId')
			await this.ensureMediaInCatalog(logoMediaId, catalogId)
			configUpdate.logoMediaId = logoMediaId
			configCreate.logoMediaId = logoMediaId
		}
		if (dto.bgMediaId !== undefined) {
			const bgMediaId = this.normalizeRequiredId(dto.bgMediaId, 'bgMediaId')
			await this.ensureMediaInCatalog(bgMediaId, catalogId)
			configUpdate.bgMediaId = bgMediaId
			configCreate.bgMediaId = bgMediaId
		}
		if (dto.note !== undefined) {
			configUpdate.note = dto.note
			configCreate.note = dto.note
		}
		if (options.allowStatus && dto.status !== undefined) {
			configUpdate.status = dto.status
			configCreate.status = dto.status
		}

		if (Object.keys(configUpdate).length > 0) {
			data.config = {
				upsert: {
					update: configUpdate,
					create: configCreate
				}
			}
		}

		const settingsUpdate: Record<string, any> = {}
		const settingsCreate: Record<string, any> = {}

		if (dto.isActive !== undefined) {
			settingsUpdate.isActive = dto.isActive
			settingsCreate.isActive = dto.isActive
		}

		if (Object.keys(settingsUpdate).length > 0) {
			data.settings = {
				upsert: {
					update: settingsUpdate,
					create: settingsCreate
				}
			}
		}

		if (Object.keys(data).length === 0) {
			throw new BadRequestException('Нет полей для обновления')
		}

		return data
	}

	private async loadCurrentCatalog(catalogId: string) {
		try {
			const catalog = await this.repo.getByIdWithType(catalogId, {
				createdAt: false,
				updatedAt: false,
				deleteAt: false
			})
			if (!catalog) throw new NotFoundException('Каталог не найден')
			return this.mapCatalog(catalog)
		} catch (error) {
			if (this.isUnknownAttributeTypesError(error)) {
				const catalog = await this.repo.getByIdWithType(catalogId, {
					type: {
						select: {
							id: true,
							code: true,
							name: true,
							attributes: {
								where: { deleteAt: null },
								select: {
									id: true,
									key: true,
									displayName: true,
									dataType: true,
									isRequired: true,
									isVariantAttribute: true,
									isFilterable: true,
									displayOrder: true,
									createdAt: true,
									updatedAt: true,
									typeId: true,
									enumValues: {
										where: { deleteAt: null },
										select: {
											id: true,
											attributeId: true,
											value: true,
											displayName: true,
											displayOrder: true,
											createdAt: true,
											updatedAt: true
										},
										orderBy: [{ displayOrder: 'asc' as const }, { value: 'asc' as const }]
									}
								},
								orderBy: [{ displayOrder: 'asc' as const }, { key: 'asc' as const }]
							}
						}
					}
				} as any)
				if (!catalog) throw new NotFoundException('Каталог не найден')
				return this.mapCatalog(catalog)
			}
			throw error
		}
	}

	private mapCatalog<T extends { config?: any | null; type?: any }>(catalog: T) {
		if (!catalog) return catalog
		let result: any = catalog
		if (catalog.config) {
			const config = catalog.config as {
				logoMedia?: any | null
				bgMedia?: any | null
			}
			const hasLogo = Object.prototype.hasOwnProperty.call(config, 'logoMedia')
			const hasBg = Object.prototype.hasOwnProperty.call(config, 'bgMedia')
			if (hasLogo || hasBg) {
				result = {
					...result,
					config: {
						...config,
						logoMedia: config.logoMedia
							? this.mediaUrl.mapMedia(config.logoMedia)
							: null,
						bgMedia: config.bgMedia ? this.mediaUrl.mapMedia(config.bgMedia) : null
					}
				}
			}
		}

		const type = result.type
		if (type?.attributes?.length) {
			const attributes = type.attributes.map((attribute: any) => {
				const typeIds = Array.isArray(attribute.types)
					? attribute.types.map((item: any) => item.id)
					: attribute.typeId
						? [attribute.typeId]
						: []
				const { types, typeId, ...rest } = attribute
				return { ...rest, typeIds }
			})
			result = {
				...result,
				type: {
					...type,
					attributes
				}
			}
		}

		return result
	}

	private isUnknownAttributeTypesError(error: unknown): boolean {
		const message =
			typeof error === 'object' && error !== null && 'message' in error
				? String((error as { message?: string }).message)
				: ''
		return message.includes(
			'Unknown field `types` for select statement on model `Attribute`'
		)
	}

	private normalizeRequiredId(value: string, name: string): string {
		const normalized = String(value).trim()
		if (!normalized) {
			throw new BadRequestException(`Поле ${name} обязательно`)
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

	private async generateCatalogSlug(name: string): Promise<string> {
		const base = slugifyValue(name) || SLUG_FALLBACK
		return this.ensureUniqueCatalogSlug(base)
	}

	private async ensureUniqueCatalogSlug(base: string): Promise<string> {
		let candidate = applySuffix(base, 0)
		let suffix = 1

		while (!isSlugAllowed(candidate) || (await this.repo.existsSlug(candidate))) {
			candidate = applySuffix(base, suffix)
			suffix += 1
		}

		return candidate
	}

	private async ensureSlugAvailable(
		slug: string,
		excludeId?: string
	): Promise<void> {
		ensureSlugAllowed(slug)
		const exists = await this.repo.existsSlug(slug, excludeId)
		if (exists) {
			throw new BadRequestException('Слаг каталога уже используется')
		}
	}

	private async ensureDomainAvailable(
		domain: string,
		excludeId?: string
	): Promise<void> {
		const exists = await this.repo.existsDomain(domain, excludeId)
		if (exists) {
			throw new BadRequestException('Домен каталога уже используется')
		}
	}

	private async buildCatalogCacheKey(
		catalogId: string,
		typeId: string
	): Promise<string> {
		const [catalogVersion, typeVersion] = await Promise.all([
			this.cache.getVersion(CATALOG_CACHE_VERSION, catalogId),
			this.cache.getVersion(CATALOG_TYPE_CACHE_VERSION, typeId)
		])

		return this.cache.buildKey([
			'catalog',
			catalogId,
			'current',
			`type-${typeId}`,
			`v${catalogVersion}`,
			`t${typeVersion}`
		])
	}

	private async invalidateCatalogCache(catalogId: string): Promise<void> {
		if (!this.cacheTtlSec) return
		await this.cache.bumpVersion(CATALOG_CACHE_VERSION, catalogId)
	}
}

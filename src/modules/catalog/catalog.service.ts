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

type CatalogCurrent = Awaited<ReturnType<CatalogRepository['getByIdWithType']>>

@Injectable()
export class CatalogService {
	private readonly cacheTtlSec = CATALOG_CURRENT_CACHE_TTL_SEC

	constructor(
		private readonly repo: CatalogRepository,
		private readonly cache: CacheService
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
		return this.repo.getAll()
	}

	async getById(id: string) {
		const catalog = await this.repo.getById(id)
		if (!catalog) throw new NotFoundException('Каталог не найден')
		return catalog
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
		return catalog
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
		return catalog
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
		if (dto.logoUrl !== undefined) {
			configUpdate.logoUrl = dto.logoUrl
			configCreate.logoUrl = dto.logoUrl
		}
		if (dto.bgUrl !== undefined) {
			configUpdate.bgUrl = dto.bgUrl
			configCreate.bgUrl = dto.bgUrl
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
		if (dto.isCommerceEnabled !== undefined) {
			settingsUpdate.isCommerceEnabled = dto.isCommerceEnabled
			settingsCreate.isCommerceEnabled = dto.isCommerceEnabled
		}
		if (dto.productsDisplayMode !== undefined) {
			settingsUpdate.productsDisplayMode = dto.productsDisplayMode
			settingsCreate.productsDisplayMode = dto.productsDisplayMode
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
		const catalog = await this.repo.getByIdWithType(catalogId, {
			createdAt: false,
			updatedAt: false,
			deleteAt: false
		})
		if (!catalog) throw new NotFoundException('Каталог не найден')
		return catalog
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

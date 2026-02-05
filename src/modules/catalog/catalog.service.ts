import { CatalogCreateInput, CatalogUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

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
	if (RESERVED_SUBDOMAINS.has(slug)) {
		throw new BadRequestException('Slug is reserved')
	}
}

@Injectable()
export class CatalogService {
	constructor(private readonly repo: CatalogRepository) {}

	async create(dto: CreateCatalogDtoReq) {
		const { typeId, status, domain, slug, parentId, userId, ...rest } = dto

		const normalizedSlug = normalizeSlug(slug)
		ensureSlugAllowed(normalizedSlug)
		const normalizedDomain = normalizeDomain(domain ?? null)

		const data: CatalogCreateInput = {
			...rest,
			slug: normalizedSlug,
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
		if (!catalog) throw new NotFoundException('Catalog not found')
		return catalog
	}

	async getCurrent() {
		const store = RequestContext.get()
		if (!store?.catalogId) throw new NotFoundException('Catalog not found')
		const catalog = await this.repo.getById(store.catalogId, {
			createdAt: false,
			updatedAt: false,
			deleteAt: false
		})
		if (!catalog) throw new NotFoundException('Catalog not found')
		return catalog
	}

	async updateById(id: string, dto: UpdateCatalogDtoReq) {
		const data = await this.buildUpdateData(dto, {
			allowStatus: true,
			allowType: true,
			allowOwner: true,
			allowParent: true
		})
		return this.repo.update(id, data)
	}

	async updateCurrent(dto: UpdateCatalogDtoReq) {
		const store = RequestContext.get()
		if (!store?.catalogId) throw new NotFoundException('Catalog not found')
		const data = await this.buildUpdateData(dto, {
			allowStatus: false,
			allowType: false,
			allowOwner: false,
			allowParent: false
		})
		return this.repo.update(store.catalogId, data)
	}

	private async buildUpdateData(
		dto: UpdateCatalogDtoReq,
		options: {
			allowStatus: boolean
			allowType: boolean
			allowOwner: boolean
			allowParent: boolean
		}
	): Promise<CatalogUpdateInput> {
		const data: CatalogUpdateInput = {}

		if (dto.slug !== undefined) {
			const normalized = normalizeSlug(dto.slug)
			ensureSlugAllowed(normalized)
			data.slug = normalized
		}

		if (dto.domain !== undefined) {
			data.domain = normalizeDomain(dto.domain)
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
			throw new BadRequestException('No fields to update')
		}

		return data
	}
}

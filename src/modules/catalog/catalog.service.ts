/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import type {
	CatalogExperienceMode,
	CatalogInventoryMode,
	CatalogPresentationMode
} from '@generated/enums'
import { CatalogCreateInput, CatalogUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Inject,
	Injectable,
	NotFoundException,
	Optional
} from '@nestjs/common'

import {
	AUDIT_RECORDER_PORT,
	type AuditRecorderPort
} from '@/modules/audit/contracts'
import {
	CAPABILITY_ASSERT_PORT,
	CAPABILITY_READER_PORT,
	type CapabilityAssertPort,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_CACHE_VERSION,
	CATALOG_CURRENT_CACHE_TTL_SEC,
	CATALOG_TYPE_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { createDomainEvent } from '@/shared/domain-events/domain-event.utils'
import {
	DOMAIN_EVENT_DISPATCHER,
	type DomainEventDispatcher
} from '@/shared/domain-events/domain-events.contract'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { ensureMediaInCatalog } from '@/shared/media/media.validation'
import { RequestContext } from '@/shared/tenancy/request-context'
import { assertHasUpdateFields, normalizeRequiredString } from '@/shared/utils'

import type { SessionUser } from '../auth/types/auth-request'
import type { AuthRequest } from '../auth/types/auth-request'

import { resolveCatalogCheckoutConfig } from './catalog-checkout'
import { CatalogSeoSyncService } from './catalog-seo-sync.service'
import { mapCatalogRecord } from './catalog.mapper'
import { CatalogRepository } from './catalog.repository'
import {
	applyCatalogSlugSuffix,
	buildCatalogConfigUpsert,
	buildCatalogContactsUpdate,
	buildCatalogRelationUpdateData,
	buildCatalogSettingsUpsert,
	CATALOG_SLUG_FALLBACK,
	type CatalogUpdateAccess,
	ensureCatalogSlugAllowed,
	isCatalogSlugAllowed,
	normalizeCatalogDomain,
	normalizeCatalogSlug,
	slugifyCatalogValue
} from './catalog.utils'
import { CreateCatalogDtoReq } from './dto/requests/create-catalog.dto.req'
import { UpdateCatalogDtoReq } from './dto/requests/update-catalog.dto.req'
import type { CatalogRuntimeDto } from './dto/responses/catalog.dto.res'

type CatalogCurrent = any
type CatalogWithCheckoutSettings = Record<string, unknown> & {
	settings?:
		| (Record<string, unknown> & {
				checkout?: unknown
				presentationMode?: CatalogPresentationMode | null
				defaultMode?: CatalogExperienceMode | null
				allowedModes?: CatalogExperienceMode[] | null
				inventoryMode?: CatalogInventoryMode | null
		  })
		| null
}
type CatalogRuntimeTypeSchema = {
	id: string
	code: string
	name: string
}

const CATALOG_RUNTIME_SCHEMA_VERSION = 1
const CATALOG_PRESENTATION_MODE_DEFAULT: CatalogPresentationMode = 'CATALOG'
const CATALOG_EXPERIENCE_MODE_DEFAULT: CatalogExperienceMode = 'DELIVERY'
const CATALOG_INVENTORY_MODE_NONE: CatalogInventoryMode = 'NONE'
const CATALOG_INVENTORY_MODE_INTERNAL: CatalogInventoryMode = 'INTERNAL'

@Injectable()
export class CatalogService {
	private readonly cacheTtlSec = CATALOG_CURRENT_CACHE_TTL_SEC

	constructor(
		private readonly repo: CatalogRepository,
		private readonly cache: CacheService,
		private readonly mediaRepo: MediaRepository,
		private readonly mediaUrl: MediaUrlService,
		private readonly catalogSeoSync: CatalogSeoSyncService,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly featureAssertions: CapabilityAssertPort,
		@Inject(CAPABILITY_READER_PORT)
		private readonly featureReader: CapabilityReaderPort,
		@Inject(AUDIT_RECORDER_PORT)
		private readonly audit: AuditRecorderPort,
		@Optional()
		@Inject(DOMAIN_EVENT_DISPATCHER)
		private readonly events?: DomainEventDispatcher
	) {}

	async create(dto: CreateCatalogDtoReq) {
		const { typeId, status, domain, slug, parentId, userId, ...rest } = dto

		const normalizedDomain = normalizeCatalogDomain(domain ?? null)
		if (normalizedDomain) {
			await this.ensureDomainAvailable(normalizedDomain)
		}

		const normalizedSlug = slug ? normalizeCatalogSlug(slug) : undefined
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
		await this.catalogSeoSync.syncCatalog(catalog)
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
		if (!this.cacheTtlSec) {
			return this.loadCurrentCatalog(store.catalogId)
		}

		const shell = await this.loadCurrentCatalogShell(store.catalogId)
		const type = shell.typeId
			? await this.loadCatalogTypeSchema(shell.typeId)
			: null

		return this.withResolvedCheckout(
			{
				...shell,
				type,
				features: await this.buildCatalogFeatures(
					store.catalogId,
					this.readInventoryMode(shell)
				)
			},
			type
		)
	}

	async getCurrentShell() {
		const store = RequestContext.get()
		if (!store?.catalogId) throw new NotFoundException('Каталог не найден')

		const shell = await this.loadCurrentCatalogShell(
			store.catalogId,
			Boolean(this.cacheTtlSec)
		)
		const type =
			shell.settings && shell.typeId
				? await this.loadCatalogTypeSchema(shell.typeId)
				: null
		return this.withResolvedCheckout(
			{
				...shell,
				features: await this.buildCatalogFeatures(
					store.catalogId,
					this.readInventoryMode(shell)
				)
			},
			type
		)
	}

	async getCurrentRuntime(): Promise<CatalogRuntimeDto> {
		const store = RequestContext.get()
		if (!store?.catalogId) throw new NotFoundException('Каталог не найден')

		const shell = await this.loadCurrentCatalogShell(
			store.catalogId,
			Boolean(this.cacheTtlSec)
		)
		const type = shell.typeId
			? await this.loadCatalogTypeSchema(shell.typeId, Boolean(this.cacheTtlSec))
			: null
		const features = await this.buildCatalogFeatures(
			store.catalogId,
			this.readInventoryMode(shell)
		)

		return this.buildCatalogRuntime(shell, type, features)
	}

	async getCurrentTypeSchema() {
		const store = RequestContext.get()
		if (!store?.catalogId) throw new NotFoundException('Каталог не найден')

		const shell = store.typeId
			? undefined
			: await this.loadCurrentCatalogShell(
					store.catalogId,
					Boolean(this.cacheTtlSec)
				)
		const typeId = store.typeId ?? shell?.typeId

		if (!typeId) {
			throw new NotFoundException('Тип каталога не найден')
		}

		const type = await this.loadCatalogTypeSchema(
			typeId,
			Boolean(this.cacheTtlSec)
		)
		if (!type) {
			throw new NotFoundException('Тип каталога не найден')
		}

		return type
	}

	async getCurrentFeatures() {
		const store = RequestContext.get()
		if (!store?.catalogId) throw new NotFoundException('Каталог не найден')

		const catalog = await this.repo.getById(store.catalogId, {
			settings: {
				select: {
					inventoryMode: true
				}
			}
		})

		if (!catalog) throw new NotFoundException('Каталог не найден')

		return this.buildCatalogFeatures(
			store.catalogId,
			catalog.settings?.inventoryMode
		)
	}

	async updateById(
		id: string,
		dto: UpdateCatalogDtoReq,
		reqOrActor: AuthRequest | SessionUser | null = null
	) {
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
		const previousInventoryMode = await this.readPreviousInventoryModeForAudit(
			dto,
			id
		)
		const catalog = await this.repo.update(id, data)
		await this.catalogSeoSync.syncCatalog(catalog)
		await this.invalidateCatalogCache(id)
		await this.auditInternalInventoryEnabled(
			id,
			dto,
			previousInventoryMode,
			reqOrActor
		)
		return this.mapCatalog(catalog)
	}

	async updateCurrent(
		dto: UpdateCatalogDtoReq,
		reqOrActor: AuthRequest | SessionUser | null = null
	) {
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
		const previousInventoryMode = await this.readPreviousInventoryModeForAudit(
			dto,
			store.catalogId
		)
		await this.repo.update(store.catalogId, data)
		const catalog = await this.repo.getCurrentShellById(store.catalogId)
		if (!catalog) {
			throw new NotFoundException('Каталог не найден')
		}
		await this.catalogSeoSync.syncCatalog(catalog)
		await this.invalidateCatalogCache(store.catalogId)
		await this.auditInternalInventoryEnabled(
			store.catalogId,
			dto,
			previousInventoryMode,
			reqOrActor
		)
		const type = catalog.typeId
			? await this.loadCatalogTypeSchema(catalog.typeId, false)
			: null
		const mapped = this.mapCatalog(catalog)
		return this.withResolvedCheckout(
			{
				...mapped,
				features: await this.buildCatalogFeatures(
					store.catalogId,
					this.readInventoryMode(mapped)
				)
			},
			type
		)
	}

	private async buildUpdateData(
		dto: UpdateCatalogDtoReq,
		options: CatalogUpdateAccess,
		catalogId: string
	): Promise<CatalogUpdateInput> {
		const data = buildCatalogRelationUpdateData(dto, options)
		await this.applyCatalogIdentityUpdates(data, dto, catalogId)
		await this.assertCatalogSettingsEntitlements(dto, catalogId)

		const configMediaIds = await this.resolveConfigMediaIds(dto, catalogId)
		const config = buildCatalogConfigUpsert(dto, {
			allowStatus: options.allowStatus,
			...configMediaIds
		})
		if (config) {
			data.config = config
		}

		const currentSettings = this.hasCatalogSettingsChanges(dto)
			? await this.loadCatalogSettingsSnapshot(catalogId)
			: null
		const settings = buildCatalogSettingsUpsert(dto, currentSettings)
		if (settings) {
			data.settings = settings
		}

		const contacts = buildCatalogContactsUpdate(dto.contacts)
		if (contacts) {
			data.contacts = contacts
		}

		assertHasUpdateFields(data)

		return data
	}

	private hasCatalogSettingsChanges(dto: UpdateCatalogDtoReq): boolean {
		return (
			dto.isActive !== undefined ||
			dto.defaultMode !== undefined ||
			dto.allowedModes !== undefined ||
			dto.address !== undefined ||
			dto.checkout !== undefined ||
			dto.inventoryMode !== undefined ||
			dto.googleVerification !== undefined ||
			dto.yandexVerification !== undefined
		)
	}

	private async readPreviousInventoryModeForAudit(
		dto: UpdateCatalogDtoReq,
		catalogId: string
	): Promise<CatalogInventoryMode | null> {
		if (dto.inventoryMode !== CATALOG_INVENTORY_MODE_INTERNAL) return null

		const settings = await this.loadCatalogSettingsSnapshot(catalogId)
		return settings?.inventoryMode ?? 'NONE'
	}

	private async auditInternalInventoryEnabled(
		catalogId: string,
		dto: UpdateCatalogDtoReq,
		previousInventoryMode: CatalogInventoryMode | null,
		reqOrActor: AuthRequest | SessionUser | null
	): Promise<void> {
		if (dto.inventoryMode !== CATALOG_INVENTORY_MODE_INTERNAL) return
		if (previousInventoryMode === CATALOG_INVENTORY_MODE_INTERNAL) return

		await this.audit.record({
			action: 'catalog.inventory_mode.enable_internal',
			category: 'inventory',
			actor: this.resolveAuditActor(reqOrActor),
			request: this.resolveAuditRequest(reqOrActor),
			targetType: 'CATALOG',
			targetId: catalogId,
			targetCatalogId: catalogId,
			message: 'Internal inventory mode enabled for catalog',
			before: { inventoryMode: previousInventoryMode },
			after: { inventoryMode: CATALOG_INVENTORY_MODE_INTERNAL },
			changes: [
				{
					field: 'settings.inventoryMode',
					oldValue: previousInventoryMode,
					newValue: CATALOG_INVENTORY_MODE_INTERNAL
				}
			],
			targets: [
				{
					targetType: 'CATALOG',
					targetId: catalogId,
					catalogId
				}
			]
		})
	}

	private resolveAuditActor(
		reqOrActor: AuthRequest | SessionUser | null
	): SessionUser | null {
		if (!reqOrActor) return null
		if ('headers' in reqOrActor) return reqOrActor.user ?? null
		return reqOrActor
	}

	private resolveAuditRequest(
		reqOrActor: AuthRequest | SessionUser | null
	): AuthRequest | null {
		if (!reqOrActor) return null
		return 'headers' in reqOrActor ? reqOrActor : null
	}

	private async loadCatalogSettingsSnapshot(catalogId: string) {
		const catalog = await this.repo.getById(catalogId, {
			settings: {
				select: {
					defaultMode: true,
					allowedModes: true,
					inventoryMode: true,
					address: true,
					checkout: true
				}
			},
			type: {
				select: {
					code: true
				}
			}
		})

		if (!catalog) {
			throw new NotFoundException('Catalog not found')
		}

		return catalog.settings
			? {
					...catalog.settings,
					typeCode: catalog.type?.code ?? null
				}
			: null
	}

	private async assertCatalogSettingsEntitlements(
		dto: UpdateCatalogDtoReq,
		catalogId: string
	): Promise<void> {
		if (dto.inventoryMode !== CATALOG_INVENTORY_MODE_INTERNAL) return

		await this.featureAssertions.assertCanUseInternalInventory(catalogId)
	}

	private async applyCatalogIdentityUpdates(
		data: CatalogUpdateInput,
		dto: UpdateCatalogDtoReq,
		catalogId: string
	): Promise<void> {
		if (dto.slug !== undefined) {
			const normalizedSlug = normalizeCatalogSlug(dto.slug)
			await this.ensureSlugAvailable(normalizedSlug, catalogId)
			data.slug = normalizedSlug
		}

		if (dto.domain !== undefined) {
			const normalizedDomain = normalizeCatalogDomain(dto.domain)
			if (normalizedDomain) {
				await this.ensureDomainAvailable(normalizedDomain, catalogId)
			}
			data.domain = normalizedDomain
		}
	}

	private async resolveConfigMediaIds(
		dto: UpdateCatalogDtoReq,
		catalogId: string
	): Promise<{ logoMediaId?: string; bgMediaId?: string }> {
		const mediaIds: { logoMediaId?: string; bgMediaId?: string } = {}

		if (dto.logoMediaId !== undefined) {
			const logoMediaId = normalizeRequiredString(dto.logoMediaId, 'logoMediaId')
			await ensureMediaInCatalog(this.mediaRepo, logoMediaId, catalogId)
			mediaIds.logoMediaId = logoMediaId
		}

		if (dto.bgMediaId !== undefined) {
			const bgMediaId = normalizeRequiredString(dto.bgMediaId, 'bgMediaId')
			await ensureMediaInCatalog(this.mediaRepo, bgMediaId, catalogId)
			mediaIds.bgMediaId = bgMediaId
		}

		return mediaIds
	}

	private async loadCurrentCatalog(catalogId: string) {
		const shell = await this.loadCurrentCatalogShell(catalogId, false)
		const type = shell.typeId
			? await this.loadCatalogTypeSchema(shell.typeId, false)
			: null

		return this.withResolvedCheckout(
			{
				...shell,
				type,
				features: await this.buildCatalogFeatures(
					catalogId,
					this.readInventoryMode(shell)
				)
			},
			type
		)
	}

	private async buildCatalogFeatures(
		catalogId: string,
		inventoryMode?: CatalogInventoryMode | null
	) {
		const capabilities =
			await this.featureReader.getCatalogCapabilities(catalogId)
		return {
			inventoryMode: inventoryMode ?? 'NONE',
			...capabilities.flags,
			raw: capabilities.raw,
			effective: capabilities.effective,
			definitions: capabilities.definitions,
			items: capabilities.items
		}
	}

	private buildCatalogRuntime(
		shell: CatalogCurrent,
		type: CatalogRuntimeTypeSchema | null,
		features: Record<string, unknown>
	): CatalogRuntimeDto {
		const settings = shell.settings ?? null
		const defaultMode = settings?.defaultMode ?? CATALOG_EXPERIENCE_MODE_DEFAULT
		const allowedModes =
			Array.isArray(settings?.allowedModes) && settings.allowedModes.length > 0
				? settings.allowedModes
				: [defaultMode]
		const {
			inventoryMode: _inventoryMode,
			raw,
			effective,
			definitions,
			items,
			...flags
		} = features

		return {
			schemaVersion: CATALOG_RUNTIME_SCHEMA_VERSION,
			catalog: {
				id: shell.id,
				slug: shell.slug,
				domain: shell.domain ?? null,
				name: shell.name,
				typeId: shell.typeId ?? null
			},
			type: type
				? {
						id: type.id,
						code: type.code,
						name: type.name
					}
				: null,
			presentation: {
				mode: settings?.presentationMode ?? CATALOG_PRESENTATION_MODE_DEFAULT,
				defaultMode,
				allowedModes
			},
			checkout: resolveCatalogCheckoutConfig({
				checkout: settings?.checkout,
				typeCode: type?.code ?? null
			}),
			inventory: {
				mode: settings?.inventoryMode ?? CATALOG_INVENTORY_MODE_NONE
			},
			capabilities: {
				flags: flags as CatalogRuntimeDto['capabilities']['flags'],
				raw: (raw ?? {}) as CatalogRuntimeDto['capabilities']['raw'],
				effective: (effective ??
					{}) as CatalogRuntimeDto['capabilities']['effective'],
				definitions: (definitions ??
					[]) as CatalogRuntimeDto['capabilities']['definitions'],
				items: (items ?? []) as CatalogRuntimeDto['capabilities']['items']
			}
		}
	}

	private mapCatalog<T>(catalog: T) {
		return mapCatalogRecord(catalog, media => this.mediaUrl.mapMedia(media))
	}

	private readInventoryMode(
		catalog: CatalogWithCheckoutSettings
	): CatalogInventoryMode | null {
		return catalog.settings?.inventoryMode ?? null
	}

	private withResolvedCheckout<T extends CatalogWithCheckoutSettings>(
		catalog: T,
		type?: { code?: string | null } | null
	): T {
		const settings = catalog.settings
		if (!settings) return catalog

		return {
			...catalog,
			settings: {
				...settings,
				checkout: resolveCatalogCheckoutConfig({
					checkout: settings.checkout,
					typeCode: type?.code ?? null
				})
			}
		}
	}

	private mapCatalogType<T>(type: T) {
		return (this.mapCatalog({ type }) as { type?: T | null }).type ?? null
	}

	private async generateCatalogSlug(name: string): Promise<string> {
		const base = slugifyCatalogValue(name) || CATALOG_SLUG_FALLBACK
		return this.ensureUniqueCatalogSlug(base)
	}

	private async ensureUniqueCatalogSlug(base: string): Promise<string> {
		let candidate = applyCatalogSlugSuffix(base, 0)
		let suffix = 1

		while (
			!isCatalogSlugAllowed(candidate) ||
			(await this.repo.existsSlug(candidate))
		) {
			candidate = applyCatalogSlugSuffix(base, suffix)
			suffix += 1
		}

		return candidate
	}

	private async ensureSlugAvailable(
		slug: string,
		excludeId?: string
	): Promise<void> {
		ensureCatalogSlugAllowed(slug)
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

	private async loadCurrentCatalogShell(
		catalogId: string,
		useCache = true
	): Promise<Omit<CatalogCurrent, 'type'>> {
		const cacheKey =
			useCache && this.cacheTtlSec
				? await this.buildCatalogShellCacheKey(catalogId)
				: undefined

		if (cacheKey) {
			const cached =
				await this.cache.getJson<Omit<CatalogCurrent, 'type'>>(cacheKey)
			if (cached !== null) return cached
		}

		const shell = await this.repo.getCurrentShellById(catalogId)
		if (!shell) throw new NotFoundException('Каталог не найден')
		const mapped = this.mapCatalog(shell)

		if (cacheKey) {
			await this.cache.setJson(cacheKey, mapped, this.cacheTtlSec)
		}

		return mapped
	}

	private async loadCatalogTypeSchema(typeId: string, useCache = true) {
		const cacheKey =
			useCache && this.cacheTtlSec
				? await this.buildCatalogTypeCacheKey(typeId)
				: undefined

		if (cacheKey) {
			const cached = await this.cache.getJson<CatalogCurrent['type']>(cacheKey)
			if (cached !== null) return cached
		}

		const type = await this.repo.getTypeByIdWithAttributes(typeId)
		const mapped = type ? this.mapCatalogType(type) : null

		if (cacheKey) {
			await this.cache.setJson(cacheKey, mapped, this.cacheTtlSec)
		}

		return mapped
	}

	private async buildCatalogShellCacheKey(catalogId: string): Promise<string> {
		const catalogVersion = await this.cache.getVersion(
			CATALOG_CACHE_VERSION,
			catalogId
		)

		return this.cache.buildKey([
			'catalog',
			catalogId,
			'current',
			'shell',
			`v${catalogVersion}`
		])
	}

	private async buildCatalogTypeCacheKey(typeId: string): Promise<string> {
		const typeVersion = await this.cache.getVersion(
			CATALOG_TYPE_CACHE_VERSION,
			typeId
		)

		return this.cache.buildKey([
			'catalog',
			'type',
			typeId,
			'schema',
			`t${typeVersion}`
		])
	}

	private async invalidateCatalogCache(catalogId: string): Promise<void> {
		if (!this.cacheTtlSec) return
		if (this.events) {
			await this.events.dispatch(
				createDomainEvent({
					type: 'catalog.cache_invalidated',
					catalogId,
					scopes: [{ name: 'catalog' }]
				})
			)
			return
		}

		await this.cache.bumpVersion(CATALOG_CACHE_VERSION, catalogId)
	}
}

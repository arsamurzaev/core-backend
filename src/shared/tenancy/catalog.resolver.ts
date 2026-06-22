import { CatalogDomainStatus } from '@generated/enums'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

export type ResolvedCatalog = {
	catalogId: string
	slug: string
	typeId: string
	presentationMode: 'CATALOG' | 'BUSINESS_CARD'

	ownerUserId?: string | null
	parentId?: string | null
}

type CacheEntry = { value: ResolvedCatalog | null; expiresAt: number }

function normalizeDomainHost(raw: string): string {
	let host = raw.split(',')[0]?.trim().toLowerCase() ?? ''
	host = host.replace(/^https?:\/\//, '')
	host = host.split('/')[0] ?? host
	host = host.split(':')[0] ?? host
	if (host.startsWith('www.')) host = host.slice(4)
	return host
}

@Injectable()
export class CatalogResolver {
	private readonly cache = new Map<string, CacheEntry>()
	private readonly cacheMs =
		Number(process.env.CATALOG_RESOLVE_CACHE_MS ?? 0) || 0

	constructor(private readonly prisma: PrismaService) {}

	private getCached(key: string): ResolvedCatalog | null | undefined {
		if (!this.cacheMs) return undefined

		const entry = this.cache.get(key)
		if (!entry) return undefined

		if (Date.now() > entry.expiresAt) {
			this.cache.delete(key)
			return undefined
		}
		return entry.value
	}

	private setCached(key: string, value: ResolvedCatalog | null): void {
		if (!this.cacheMs) return
		if (value === null) return
		this.cache.set(key, { value, expiresAt: Date.now() + this.cacheMs })
	}

	private async withFreshPresentationMode(
		catalog: ResolvedCatalog | null
	): Promise<ResolvedCatalog | null> {
		if (!catalog) return null

		const settings = await this.prisma.catalogSettings.findUnique({
			where: { catalogId: catalog.catalogId },
			select: { presentationMode: true }
		})

		return {
			...catalog,
			presentationMode: settings?.presentationMode ?? 'CATALOG'
		}
	}

	async resolveBySlug(slug: string): Promise<ResolvedCatalog | null> {
		const key = `slug:${slug}`
		const cached = this.getCached(key)
		if (cached !== undefined) return this.withFreshPresentationMode(cached)

		const catalog = await this.prisma.catalog.findFirst({
			where: { slug, deleteAt: null },
			select: {
				id: true,
				slug: true,
				typeId: true,
				userId: true,
				parentId: true,
				settings: {
					select: {
						presentationMode: true
					}
				}
			}
		})

		const value = catalog
			? {
					catalogId: catalog.id,
					slug: catalog.slug,
					typeId: catalog.typeId,
					presentationMode: catalog.settings?.presentationMode ?? 'CATALOG',
					ownerUserId: catalog.userId ?? null,
					parentId: catalog.parentId ?? null
				}
			: null

		this.setCached(key, value)
		return value
	}

	async resolveByDomain(domain: string): Promise<ResolvedCatalog | null> {
		const normalizedDomain = normalizeDomainHost(domain)
		if (!normalizedDomain) return null

		const key = `domain:${normalizedDomain}`
		const cached = this.getCached(key)
		if (cached !== undefined) return this.withFreshPresentationMode(cached)

		const catalogDomain = await this.prisma.catalogDomain.findFirst({
			where: {
				hostname: normalizedDomain,
				status: CatalogDomainStatus.ACTIVE,
				catalog: { deleteAt: null }
			},
			select: {
				catalog: {
					select: {
						id: true,
						slug: true,
						typeId: true,
						userId: true,
						parentId: true,
						settings: {
							select: {
								presentationMode: true
							}
						}
					}
				}
			}
		})

		const catalog =
			catalogDomain?.catalog ??
			(await this.prisma.catalog.findFirst({
				where: { domain: normalizedDomain, deleteAt: null },
				select: {
					id: true,
					slug: true,
					typeId: true,
					userId: true,
					parentId: true,
					settings: {
						select: {
							presentationMode: true
						}
					}
				}
			}))

		const value = catalog
			? {
					catalogId: catalog.id,
					slug: catalog.slug,
					typeId: catalog.typeId,
					presentationMode: catalog.settings?.presentationMode ?? 'CATALOG',
					ownerUserId: catalog.userId ?? null,
					parentId: catalog.parentId ?? null
				}
			: null

		this.setCached(key, value)
		return value
	}
}

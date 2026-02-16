import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

export type ResolvedCatalog = {
	catalogId: string
	slug: string
	typeId: string

	ownerUserId?: string | null
}

type CacheEntry = { value: ResolvedCatalog | null; expiresAt: number }

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
		this.cache.set(key, { value, expiresAt: Date.now() + this.cacheMs })
	}

	async resolveBySlug(slug: string): Promise<ResolvedCatalog | null> {
		const key = `slug:${slug}`
		const cached = this.getCached(key)
		if (cached !== undefined) return cached

		const catalog = await this.prisma.catalog.findFirst({
			where: { slug, deleteAt: null },
			select: { id: true, slug: true, typeId: true, userId: true }
		})

		const value = catalog
			? {
					catalogId: catalog.id,
					slug: catalog.slug,
					typeId: catalog.typeId,
					ownerUserId: catalog.userId ?? null
				}
			: null

		this.setCached(key, value)
		return value
	}

	async resolveByDomain(domain: string): Promise<ResolvedCatalog | null> {
		const key = `domain:${domain}`
		const cached = this.getCached(key)
		if (cached !== undefined) return cached

		// Лучше если domain в Prisma: domain String? @unique
		const catalog = await this.prisma.catalog.findFirst({
			where: { domain, deleteAt: null },
			select: { id: true, slug: true, typeId: true, userId: true }
		})

		const value = catalog
			? {
					catalogId: catalog.id,
					slug: catalog.slug,
					typeId: catalog.typeId,
					ownerUserId: catalog.userId ?? null
				}
			: null

		this.setCached(key, value)
		return value
	}
}

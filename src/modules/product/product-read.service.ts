import { SeoEntityType } from '@generated/enums'
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash } from 'crypto'

import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_PRODUCTS_CACHE_TTL_SEC,
	CATALOG_TYPE_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	CATEGORY_PRODUCTS_FIRST_PAGE_CACHE_TTL_SEC,
	CATEGORY_PRODUCTS_NEXT_PAGE_CACHE_TTL_SEC,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import {
	MEDIA_DETAIL_VARIANT_NAMES,
	MEDIA_LIST_VARIANT_NAMES,
	MediaUrlService
} from '@/shared/media/media-url.service'
import type { MediaDto } from '@/shared/media/dto/media.dto.res'
import { ProductMediaMapper } from '@/shared/media/product-media.mapper'
import { mustCatalogId, mustTypeId } from '@/shared/tenancy/ctx'

import { SeoRepository } from '../seo/seo.repository'

import {
	type DecodedInfiniteCursor,
	decodeProductInfiniteCursor,
	encodeProductDefaultCursor,
	encodeProductSeedCursor,
	type ParsedAttributeFilter,
	type ParsedProductInfiniteQuery,
	parseProductInfiniteQuery,
	resolveProductAttributeFilter,
	uniqueNonEmptyValues
} from './product-query.utils'
import {
	type AttributeFilterMeta,
	type DiscountAttributeIds,
	type ProductAttributeFilter,
	type ProductFilterQueryBase,
	type ProductDetailsItem,
	ProductRepository
} from './product.repository'

export type ProductReadOptions = {
	includeInactive?: boolean
}

type ProductSeoRecord = NonNullable<
	Awaited<ReturnType<SeoRepository['findByEntity']>>
>

type ProductSeoMapped = Omit<ProductSeoRecord, 'ogMedia' | 'twitterMedia'> & {
	ogMedia: MediaDto | null
	twitterMedia: MediaDto | null
}

type ProductInfiniteDefaultRow = Awaited<
	ReturnType<ProductRepository['findFilteredProductIdsPageDefault']>
>[number]
type ProductInfiniteSeededRow = Awaited<
	ReturnType<ProductRepository['findFilteredProductIdsPageSeeded']>
>[number]
type ProductInfiniteRow = ProductInfiniteDefaultRow | ProductInfiniteSeededRow

type ProductInfinitePage = {
	pageRows: ProductInfiniteRow[]
	hasMore: boolean
}

const PRODUCT_INFINITE_DEFAULT_LIMIT = 24
const PRODUCT_INFINITE_MAX_LIMIT = 50

function normalizeSlug(value: string): string {
	return value.trim().toLowerCase()
}

@Injectable()
export class ProductReadService {
	private readonly cacheTtlSec = CATALOG_PRODUCTS_CACHE_TTL_SEC
	private readonly uncategorizedFirstPageCacheTtlSec =
		CATEGORY_PRODUCTS_FIRST_PAGE_CACHE_TTL_SEC
	private readonly uncategorizedNextPageCacheTtlSec =
		CATEGORY_PRODUCTS_NEXT_PAGE_CACHE_TTL_SEC

	constructor(
		private readonly repo: ProductRepository,
		private readonly cache: CacheService,
		private readonly mapper: ProductMediaMapper,
		private readonly seoRepo: SeoRepository,
		private readonly mediaUrl: MediaUrlService
	) {}

	// ─── Public read methods ─────────────────────────────────────────────────

	async getAll(options?: ProductReadOptions) {
		const catalogId = mustCatalogId()
		const includeInactive = options?.includeInactive === true

		if (includeInactive || !this.cacheTtlSec) {
			const products = await this.repo.findAll(catalogId, includeInactive)
			return products.map(p => this.mapper.mapProduct(p, MEDIA_LIST_VARIANT_NAMES))
		}

		const key = await this.buildCatalogProductsCacheKey(catalogId)
		return this.withCache(key, async () => {
			const products = await this.repo.findAll(catalogId, false)
			return products.map(p => this.mapper.mapProduct(p, MEDIA_LIST_VARIANT_NAMES))
		}, this.cacheTtlSec)
	}

	async getPopular(options?: ProductReadOptions) {
		const catalogId = mustCatalogId()
		const includeInactive = options?.includeInactive === true

		if (includeInactive || !this.cacheTtlSec) {
			const products = await this.repo.findPopular(catalogId, includeInactive)
			return products.map(p => this.mapper.mapProduct(p, MEDIA_LIST_VARIANT_NAMES))
		}

		const key = await this.buildCatalogPopularProductsCacheKey(catalogId)
		return this.withCache(key, async () => {
			const products = await this.repo.findPopular(catalogId, false)
			return products.map(p => this.mapper.mapProduct(p, MEDIA_LIST_VARIANT_NAMES))
		}, this.cacheTtlSec)
	}

	async getPopularCards(options?: ProductReadOptions) {
		const catalogId = mustCatalogId()
		const includeInactive = options?.includeInactive === true

		if (includeInactive || !this.cacheTtlSec) {
			const products = await this.repo.findPopularCards(catalogId, includeInactive)
			return products.map(p => this.mapper.mapProduct(p, MEDIA_LIST_VARIANT_NAMES))
		}

		const key = await this.buildCatalogPopularProductCardsCacheKey(catalogId)
		return this.withCache(key, async () => {
			const products = await this.repo.findPopularCards(catalogId, false)
			return products.map(p => this.mapper.mapProduct(p, MEDIA_LIST_VARIANT_NAMES))
		}, this.cacheTtlSec)
	}

	async getInfinite(
		query: Record<string, unknown>,
		options?: ProductReadOptions
	) {
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		const includeInactive = options?.includeInactive === true
		const parsed = parseProductInfiniteQuery(query, {
			defaultLimit: PRODUCT_INFINITE_DEFAULT_LIMIT,
			maxLimit: PRODUCT_INFINITE_MAX_LIMIT
		})
		const decodedCursor = decodeProductInfiniteCursor(parsed.cursor)
		const seed = this.resolveInfiniteSeed(parsed, decodedCursor)

		const attributeFilters = await this.resolveAttributeFilters(
			typeId,
			parsed.attributeFilters
		)
		const discountAttributeIds = parsed.isDiscount
			? await this.resolveDiscountAttributeIds(typeId)
			: undefined

		const baseQuery = this.buildInfiniteBaseQuery(
			catalogId,
			parsed,
			attributeFilters,
			discountAttributeIds,
			includeInactive
		)
		const rows = await this.loadInfiniteRows(baseQuery, seed, decodedCursor)
		const { pageRows, hasMore } = this.buildInfinitePage(rows, parsed.limit)

		return {
			items: await this.loadInfiniteItems(pageRows, catalogId, includeInactive),
			nextCursor: this.buildInfiniteNextCursor(pageRows, hasMore, seed),
			seed: seed ?? null
		}
	}

	async getInfiniteCards(
		query: Record<string, unknown>,
		options?: ProductReadOptions
	) {
		return this.loadInfiniteCardsPage(query, options, 'catalog')
	}

	async getRecommendationsInfinite(
		query: Record<string, unknown>,
		options?: ProductReadOptions
	) {
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		const includeInactive = options?.includeInactive === true
		const parsed = parseProductInfiniteQuery(query, {
			defaultLimit: PRODUCT_INFINITE_DEFAULT_LIMIT,
			maxLimit: PRODUCT_INFINITE_MAX_LIMIT
		})
		const decodedCursor = decodeProductInfiniteCursor(parsed.cursor)
		const seed = this.resolveInfiniteSeed(parsed, decodedCursor)

		const attributeFilters = await this.resolveAttributeFilters(
			typeId,
			parsed.attributeFilters
		)
		const discountAttributeIds = parsed.isDiscount
			? await this.resolveDiscountAttributeIds(typeId)
			: undefined

		if (!this.hasRecommendationFilters(parsed, attributeFilters)) {
			return { items: [], nextCursor: null, seed: seed ?? null }
		}

		const baseQuery = this.buildInfiniteBaseQuery(
			catalogId,
			parsed,
			attributeFilters,
			discountAttributeIds,
			includeInactive
		)
		const rows = await this.loadRecommendationRows(baseQuery, seed, decodedCursor)
		const { pageRows, hasMore } = this.buildInfinitePage(rows, parsed.limit)

		return {
			items: await this.loadInfiniteItems(pageRows, catalogId, includeInactive),
			nextCursor: this.buildInfiniteNextCursor(pageRows, hasMore, seed),
			seed: seed ?? null
		}
	}

	async getRecommendationsInfiniteCards(
		query: Record<string, unknown>,
		options?: ProductReadOptions
	) {
		return this.loadInfiniteCardsPage(query, options, 'recommendations')
	}

	async getUncategorizedInfinite(options?: {
		cursor?: string
		limit?: number | string
		includeInactive?: boolean
	}) {
		const catalogId = mustCatalogId()
		const includeInactive = options?.includeInactive === true
		const parsed = parseProductInfiniteQuery(
			{ cursor: options?.cursor, limit: options?.limit },
			{ defaultLimit: PRODUCT_INFINITE_DEFAULT_LIMIT, maxLimit: PRODUCT_INFINITE_MAX_LIMIT }
		)
		const cacheTtlSec = parsed.cursor
			? this.uncategorizedNextPageCacheTtlSec
			: this.uncategorizedFirstPageCacheTtlSec
		const key =
			!includeInactive && cacheTtlSec > 0
				? await this.buildUncategorizedProductsCacheKey(
						catalogId,
						parsed.cursor,
						parsed.limit
					)
				: undefined

		return this.withCache(
			key,
			async () => {
				const decodedCursor = decodeProductInfiniteCursor(parsed.cursor)
				const rows = await this.repo.findUncategorizedPage(catalogId, {
					cursor:
						decodedCursor?.mode === 'default' ? decodedCursor.cursor : undefined,
					take: parsed.limit + 1,
					includeInactive
				})
				const hasMore = rows.length > parsed.limit
				const pageRows = hasMore ? rows.slice(0, parsed.limit) : rows
				const lastRow = pageRows[pageRows.length - 1]

				return {
					items: pageRows.map(p =>
						this.mapper.mapProduct(p, MEDIA_LIST_VARIANT_NAMES)
					),
					nextCursor:
						hasMore && lastRow
							? encodeProductDefaultCursor({
									id: lastRow.id,
									updatedAt: lastRow.updatedAt
								})
							: null
				}
			},
			cacheTtlSec
		)
	}

	async getUncategorizedInfiniteCards(options?: {
		cursor?: string
		limit?: number | string
		includeInactive?: boolean
	}) {
		const catalogId = mustCatalogId()
		const includeInactive = options?.includeInactive === true
		const parsed = parseProductInfiniteQuery(
			{ cursor: options?.cursor, limit: options?.limit },
			{ defaultLimit: PRODUCT_INFINITE_DEFAULT_LIMIT, maxLimit: PRODUCT_INFINITE_MAX_LIMIT }
		)
		const cacheTtlSec = parsed.cursor
			? this.uncategorizedNextPageCacheTtlSec
			: this.uncategorizedFirstPageCacheTtlSec
		const key =
			!includeInactive && cacheTtlSec > 0
				? await this.buildUncategorizedProductCardsCacheKey(
						catalogId,
						parsed.cursor,
						parsed.limit
					)
				: undefined

		return this.withCache(
			key,
			async () => {
				const decodedCursor = decodeProductInfiniteCursor(parsed.cursor)
				const rows = await this.repo.findUncategorizedCardsPage(catalogId, {
					cursor:
						decodedCursor?.mode === 'default' ? decodedCursor.cursor : undefined,
					take: parsed.limit + 1,
					includeInactive
				})
				const hasMore = rows.length > parsed.limit
				const pageRows = hasMore ? rows.slice(0, parsed.limit) : rows
				const lastRow = pageRows[pageRows.length - 1]

				return {
					items: pageRows.map(p =>
						this.mapper.mapProduct(p, MEDIA_LIST_VARIANT_NAMES)
					),
					nextCursor:
						hasMore && lastRow
							? encodeProductDefaultCursor({
									id: lastRow.id,
									updatedAt: lastRow.updatedAt
								})
							: null
				}
			},
			cacheTtlSec
		)
	}

	async getById(id: string, options?: ProductReadOptions) {
		const catalogId = mustCatalogId()
		const product = await this.repo.findById(
			id,
			catalogId,
			options?.includeInactive === true
		)
		if (!product) throw new NotFoundException('Товар не найден')
		return this.mapProductWithSeo(product, catalogId)
	}

	async getBySlug(slug: string, options?: ProductReadOptions) {
		const catalogId = mustCatalogId()
		const product = await this.repo.findBySlug(
			normalizeSlug(slug),
			catalogId,
			options?.includeInactive === true
		)
		if (!product) throw new NotFoundException('Товар не найден')
		return this.mapProductWithSeo(product, catalogId)
	}

	// ─── Private helpers ─────────────────────────────────────────────────────

	private async withCache<T>(
		key: string | undefined,
		loader: () => Promise<T>,
		ttl: number
	): Promise<T> {
		if (key) {
			const cached = await this.cache.getJson<T>(key)
			if (cached !== null) return cached
		}
		const data = await loader()
		if (key) {
			await this.cache.setJson(key, data, ttl)
		}
		return data
	}

	private async buildVersionedCacheKey(
		scope: string,
		catalogId: string,
		parts: string[]
	): Promise<string> {
		const version = await this.cache.getVersion(scope, catalogId)
		return this.cache.buildKey([...parts, `v${version}`])
	}

	private buildCatalogProductsCacheKey(catalogId: string): Promise<string> {
		return this.buildVersionedCacheKey(PRODUCTS_CACHE_VERSION, catalogId, [
			'catalog', catalogId, 'products', 'list'
		])
	}

	private buildCatalogPopularProductsCacheKey(catalogId: string): Promise<string> {
		return this.buildVersionedCacheKey(PRODUCTS_CACHE_VERSION, catalogId, [
			'catalog', catalogId, 'products', 'popular'
		])
	}

	private buildCatalogPopularProductCardsCacheKey(catalogId: string): Promise<string> {
		return this.buildVersionedCacheKey(PRODUCTS_CACHE_VERSION, catalogId, [
			'catalog', catalogId, 'products', 'popular', 'cards'
		])
	}

	private async buildInfiniteCardsCacheKey(
		catalogId: string,
		typeId: string,
		parsed: ParsedProductInfiniteQuery,
		seed: string | undefined,
		kind: 'catalog' | 'recommendations'
	): Promise<string> {
		const [version, typeVersion] = await Promise.all([
			this.cache.getVersion(PRODUCTS_CACHE_VERSION, catalogId),
			this.cache.getVersion(CATALOG_TYPE_CACHE_VERSION, typeId)
		])
		const fingerprint = this.buildInfiniteCardsQueryFingerprint(parsed, seed)
		return this.cache.buildKey([
			'catalog',
			catalogId,
			'products',
			kind === 'recommendations' ? 'recommendations' : 'infinite',
			'cards',
			fingerprint,
			`v${version}`,
			`t${typeVersion}`
		])
	}

	private buildInfiniteCardsQueryFingerprint(
		parsed: ParsedProductInfiniteQuery,
		seed: string | undefined
	): string {
		const payload = {
			limit: parsed.limit,
			seed: seed ?? null,
			categoryIds: [...parsed.categoryIds].sort(),
			brandIds: [...parsed.brandIds].sort(),
			minPrice: parsed.minPrice ?? null,
			maxPrice: parsed.maxPrice ?? null,
			searchTerm: parsed.searchTerm ?? null,
			isPopular: parsed.isPopular ?? null,
			isDiscount: parsed.isDiscount ?? null,
			attributeFilters: [...parsed.attributeFilters]
				.map(filter => ({
					key: filter.key,
					values: [...filter.values].sort(),
					min: filter.min ?? null,
					max: filter.max ?? null,
					bool: filter.bool ?? null
				}))
				.sort((a, b) => a.key.localeCompare(b.key))
		}
		return createHash('sha1')
			.update(JSON.stringify(payload))
			.digest('hex')
			.slice(0, 16)
	}

	private buildUncategorizedProductsCacheKey(
		catalogId: string,
		cursor: string | undefined,
		limit: number
	): Promise<string> {
		return this.buildVersionedCacheKey(
			CATEGORY_PRODUCTS_CACHE_VERSION,
			catalogId,
			[
				'catalog', catalogId, 'products', 'uncategorized', 'infinite',
				`limit-${limit}`,
				cursor ? `cursor-${encodeURIComponent(cursor)}` : 'cursor-first'
			]
		)
	}

	private buildUncategorizedProductCardsCacheKey(
		catalogId: string,
		cursor: string | undefined,
		limit: number
	): Promise<string> {
		return this.buildVersionedCacheKey(
			CATEGORY_PRODUCTS_CACHE_VERSION,
			catalogId,
			[
				'catalog', catalogId, 'products', 'uncategorized', 'cards', 'infinite',
				`limit-${limit}`,
				cursor ? `cursor-${encodeURIComponent(cursor)}` : 'cursor-first'
			]
		)
	}

	private resolveInfiniteSeed(
		parsed: ParsedProductInfiniteQuery,
		decodedCursor: DecodedInfiniteCursor | null
	): string | undefined {
		if (parsed.seed) return parsed.seed
		if (decodedCursor?.mode === 'seed') return decodedCursor.seed
		return undefined
	}

	private buildInfiniteBaseQuery(
		catalogId: string,
		parsed: ParsedProductInfiniteQuery,
		attributeFilters: ProductAttributeFilter[],
		discountAttributeIds?: DiscountAttributeIds,
		includeInactive = false
	): ProductFilterQueryBase {
		return {
			catalogId,
			categoryIds: parsed.categoryIds,
			brandIds: parsed.brandIds,
			minPrice: parsed.minPrice,
			maxPrice: parsed.maxPrice,
			searchTerm: parsed.searchTerm,
			isPopular: parsed.isPopular,
			isDiscount: parsed.isDiscount,
			attributeFilters,
			discountAttributeIds,
			includeInactive,
			take: parsed.limit + 1
		}
	}

	private async loadInfiniteRows(
		baseQuery: ProductFilterQueryBase,
		seed: string | undefined,
		decodedCursor: DecodedInfiniteCursor | null
	): Promise<ProductInfiniteRow[]> {
		if (seed) {
			return this.repo.findFilteredProductIdsPageSeeded({
				...baseQuery,
				seed,
				cursor:
					decodedCursor?.mode === 'seed' && decodedCursor.seed === seed
						? decodedCursor.cursor
						: undefined
			})
		}
		return this.repo.findFilteredProductIdsPageDefault({
			...baseQuery,
			cursor: decodedCursor?.mode === 'default' ? decodedCursor.cursor : undefined
		})
	}

	private async loadRecommendationRows(
		baseQuery: ProductFilterQueryBase,
		seed: string | undefined,
		decodedCursor: DecodedInfiniteCursor | null
	): Promise<ProductInfiniteRow[]> {
		if (seed) {
			return this.repo.findRecommendedProductIdsPageSeeded({
				...baseQuery,
				seed,
				cursor:
					decodedCursor?.mode === 'seed' && decodedCursor.seed === seed
						? decodedCursor.cursor
						: undefined
			})
		}
		return this.repo.findRecommendedProductIdsPageDefault({
			...baseQuery,
			cursor: decodedCursor?.mode === 'default' ? decodedCursor.cursor : undefined
		})
	}

	private buildInfinitePage(
		rows: ProductInfiniteRow[],
		limit: number
	): ProductInfinitePage {
		const hasMore = rows.length > limit
		return { hasMore, pageRows: hasMore ? rows.slice(0, limit) : rows }
	}

	private async loadInfiniteItems(
		rows: ProductInfiniteRow[],
		catalogId: string,
		includeInactive = false
	) {
		const ids = rows.map(row => row.id)
		const products = await this.repo.findByIdsWithAttributes(ids, catalogId, includeInactive)
		const byId = new Map(products.map(p => [p.id, this.mapper.mapProduct(p, MEDIA_LIST_VARIANT_NAMES)] as const))
		return ids.map(id => byId.get(id)).filter((p): p is NonNullable<typeof p> => p !== undefined)
	}

	private async loadInfiniteCardItems(
		rows: ProductInfiniteRow[],
		catalogId: string,
		includeInactive = false
	) {
		const ids = rows.map(row => row.id)
		const products = await this.repo.findByIds(ids, catalogId, includeInactive)
		const byId = new Map(products.map(p => [p.id, this.mapper.mapProduct(p, MEDIA_LIST_VARIANT_NAMES)] as const))
		return ids.map(id => byId.get(id)).filter((p): p is NonNullable<typeof p> => p !== undefined)
	}

	private buildInfiniteNextCursor(
		pageRows: ProductInfiniteRow[],
		hasMore: boolean,
		seed?: string
	): string | null {
		const lastRow = pageRows[pageRows.length - 1]
		if (!hasMore || !lastRow) return null

		if (seed) {
			const row = lastRow as ProductInfiniteSeededRow
			return encodeProductSeedCursor(seed, { id: row.id, score: row.score })
		}

		const row = lastRow as ProductInfiniteDefaultRow
		return encodeProductDefaultCursor({ id: row.id, updatedAt: row.updatedAt })
	}

	private async resolveAttributeFilters(
		typeId: string,
		filters: ParsedAttributeFilter[]
	): Promise<ProductAttributeFilter[]> {
		if (!filters.length) return []

		const keys = uniqueNonEmptyValues(filters.map(f => f.key))
		const meta: AttributeFilterMeta[] = await this.repo.findAttributesByTypeAndKeys(typeId, keys)
		const metaByKey = new Map(meta.map(item => [item.key.toLowerCase(), item] as const))

		const missing = keys.filter(key => !metaByKey.has(key))
		if (missing.length) {
			throw new BadRequestException(
				`Неизвестные атрибуты фильтра: ${missing.join(', ')}`
			)
		}

		return filters.map(filter => {
			const item = metaByKey.get(filter.key)
			if (!item) {
				throw new BadRequestException(`Неизвестный атрибут фильтра: ${filter.key}`)
			}
			if (item.isHidden || !item.isFilterable) {
				throw new BadRequestException(
					`Атрибут ${item.key} недоступен для фильтрации`
				)
			}
			return resolveProductAttributeFilter(item, filter)
		})
	}

	private async resolveDiscountAttributeIds(
		typeId: string
	): Promise<DiscountAttributeIds> {
		const attrs = await this.repo.findAttributesByTypeAndKeys(typeId, [
			'discount',
			'discountStartAt',
			'discountEndAt'
		])
		const byKey = new Map(attrs.map(a => [a.key.toLowerCase(), a.id] as const))
		return {
			discountId: byKey.get('discount'),
			discountStartAtId: byKey.get('discountstartat'),
			discountEndAtId: byKey.get('discountendat')
		}
	}

	private hasRecommendationFilters(
		parsed: ParsedProductInfiniteQuery,
		attributeFilters: ProductAttributeFilter[]
	): boolean {
		return (
			parsed.categoryIds.length > 0 ||
			parsed.brandIds.length > 0 ||
			parsed.minPrice !== undefined ||
			parsed.maxPrice !== undefined ||
			parsed.searchTerm !== undefined ||
			parsed.isPopular !== undefined ||
			parsed.isDiscount === true ||
			attributeFilters.length > 0
		)
	}

	private async mapProductWithSeo(
		product: ProductDetailsItem,
		catalogId: string
	) {
		const seo = await this.seoRepo.findByEntity(
			catalogId,
			SeoEntityType.PRODUCT,
			product.id
		)

		return {
			...this.mapper.mapProduct(product, MEDIA_DETAIL_VARIANT_NAMES),
			seo: this.mapSeo(seo)
		}
	}

	private mapSeo(seo?: ProductSeoRecord | null): ProductSeoMapped | null {
		if (!seo) return null

		return {
			...seo,
			ogMedia: seo.ogMedia ? this.mediaUrl.mapMedia(seo.ogMedia) : null,
			twitterMedia: seo.twitterMedia
				? this.mediaUrl.mapMedia(seo.twitterMedia)
				: null
		}
	}

	private async loadInfiniteCardsPage(
		query: Record<string, unknown>,
		options: ProductReadOptions | undefined,
		kind: 'catalog' | 'recommendations'
	) {
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		const includeInactive = options?.includeInactive === true
		const parsed = parseProductInfiniteQuery(query, {
			defaultLimit: PRODUCT_INFINITE_DEFAULT_LIMIT,
			maxLimit: PRODUCT_INFINITE_MAX_LIMIT
		})
		const decodedCursor = decodeProductInfiniteCursor(parsed.cursor)
		const seed = this.resolveInfiniteSeed(parsed, decodedCursor)

		const attributeFilters = await this.resolveAttributeFilters(
			typeId,
			parsed.attributeFilters
		)
		const discountAttributeIds = parsed.isDiscount
			? await this.resolveDiscountAttributeIds(typeId)
			: undefined

		if (kind === 'recommendations' && !this.hasRecommendationFilters(parsed, attributeFilters)) {
			return { items: [], nextCursor: null, seed: seed ?? null }
		}

		const key =
			!includeInactive && !parsed.cursor && this.cacheTtlSec > 0
				? await this.buildInfiniteCardsCacheKey(
						catalogId,
						typeId,
						parsed,
						seed,
						kind
					)
				: undefined

		return this.withCache(
			key,
			async () => {
				const baseQuery = this.buildInfiniteBaseQuery(
					catalogId,
					parsed,
					attributeFilters,
					discountAttributeIds,
					includeInactive
				)
				const rows =
					kind === 'recommendations'
						? await this.loadRecommendationRows(baseQuery, seed, decodedCursor)
						: await this.loadInfiniteRows(baseQuery, seed, decodedCursor)
				const { pageRows, hasMore } = this.buildInfinitePage(rows, parsed.limit)

				return {
					items: await this.loadInfiniteCardItems(pageRows, catalogId, includeInactive),
					nextCursor: this.buildInfiniteNextCursor(pageRows, hasMore, seed),
					seed: seed ?? null
				}
			},
			this.cacheTtlSec
		)
	}
}

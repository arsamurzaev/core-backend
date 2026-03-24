import { ProductStatus } from '@generated/enums'
import type { IntegrationProvider } from '@generated/enums'
import { ProductCreateInput, ProductUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import { createHash } from 'crypto'
import slugify from 'slugify'

import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_TYPE_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	CATEGORY_PRODUCTS_FIRST_PAGE_CACHE_TTL_SEC,
	CATEGORY_PRODUCTS_NEXT_PAGE_CACHE_TTL_SEC,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import type { MediaDto } from '@/shared/media/dto/media.dto.res'
import type { MediaRecord } from '@/shared/media/media-url.service'
import {
	MEDIA_DETAIL_VARIANT_NAMES,
	MEDIA_LIST_VARIANT_NAMES,
	MediaUrlService
} from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { mustCatalogId, mustTypeId } from '@/shared/tenancy/ctx'
import {
	assertHasUpdateFields,
	normalizeNullableTrimmedString,
	normalizeRequiredString
} from '@/shared/utils'

import { S3Service } from '../s3/s3.service'

import { CreateProductDtoReq } from './dto/requests/create-product.dto.req'
import { ProductVariantUpdateDtoReq } from './dto/requests/product-variant-update.dto.req'
import { ProductVariantDtoReq } from './dto/requests/product-variant.dto.req'
import { SetProductVariantsDtoReq } from './dto/requests/set-product-variants.dto.req'
import { UpdateProductCategoryPositionDtoReq } from './dto/requests/update-product-category-position.dto.req'
import { UpdateProductDtoReq } from './dto/requests/update-product.dto.req'
import {
	ProductAttributeBuilder,
	type ProductAttributeValueData
} from './product-attribute.builder'
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
	ProductVariantBuilder,
	type ProductVariantData
} from './product-variant.builder'
import {
	type AttributeFilterMeta,
	type DiscountAttributeIds,
	type ProductAttributeFilter,
	type ProductDetailsItem,
	type ProductFilterQueryBase,
	ProductRepository,
	type ProductVariantUpdateData
} from './product.repository'

type ProductMapped<T> = Omit<T, 'media' | 'categoryProducts' | 'integrationLinks'> & {
	media: { position: number; kind?: string | null; media: MediaDto }[]
	categories: { id: string; name: string; position: number }[]
	integration: {
		provider: IntegrationProvider
		externalId: string
		externalCode: string | null
		lastSyncedAt: Date | string | null
	} | null
}

type ProductList = ProductMapped<
	Awaited<ReturnType<ProductRepository['findAll']>>[number]
>[]
type PopularProductList = ProductMapped<
	Awaited<ReturnType<ProductRepository['findPopular']>>[number]
>[]
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

type ProductReadOptions = {
	includeInactive?: boolean
}

type ProductIntegrationLinkRecord = {
	externalId: string
	externalCode?: string | null
	lastSyncedAt?: Date | string | null
	integration?: { provider: IntegrationProvider } | null
}

type PreparedProductCreatePayload = {
	data: ProductCreateInput
	attributes: ProductAttributeValueData[]
	variants?: ProductVariantData[]
	categoryIds: string[]
}

type PreparedProductUpdatePayload = {
	data: ProductUpdateInput
	attributes?: ProductAttributeValueData[]
	removeAttributeIds?: string[]
	variants?: ProductVariantUpdateData[]
	mediaIds?: string[]
	categoryIds?: string[]
	categoryId?: string
	categoryPosition: number
}

const PRODUCTS_CACHE_TTL_SEC =
	Number(process.env.CATALOG_PRODUCTS_CACHE_TTL_SEC ?? 0) || 0
const PRODUCT_INFINITE_DEFAULT_LIMIT = 24
const PRODUCT_INFINITE_MAX_LIMIT = 50
const PRODUCT_NAME_MAX_LENGTH = 255
const SLUG_MAX_LENGTH = 255
const SKU_MAX_LENGTH = 100
const PRODUCT_SLUG_FALLBACK = 'product'
const PRODUCT_SKU_FALLBACK = 'SKU'
const PRODUCT_DUPLICATE_SUFFIX = ' (копия)'

function normalizeSlug(value: string): string {
	return value.trim().toLowerCase()
}

function normalizeVariantKey(value: string): string {
	return value.trim()
}

function slugifyValue(value: string, lower: boolean): string {
	const slug = slugify(value, { lower, strict: true, trim: true })
	return slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
}

function buildSlugBase(value: string): string {
	return slugifyValue(value, true)
}

function buildSkuBase(value: string): string {
	return slugifyValue(value, false).toUpperCase()
}

function applySuffix(base: string, suffix: number, maxLength: number): string {
	const suffixPart = suffix > 0 ? `-${suffix}` : ''
	const headLength = Math.max(0, maxLength - suffixPart.length)
	const head = base.slice(0, headLength).replace(/-+$/g, '')
	return `${head}${suffixPart}`
}

function buildDuplicateNameCandidate(name: string, copyIndex = 1): string {
	const suffixPart = copyIndex > 1 ? ` ${copyIndex}` : ''
	const headLength = Math.max(
		0,
		PRODUCT_NAME_MAX_LENGTH - PRODUCT_DUPLICATE_SUFFIX.length - suffixPart.length
	)
	const head = name.slice(0, headLength).trimEnd()
	return `${head}${PRODUCT_DUPLICATE_SUFFIX}${suffixPart}`
}

function buildHashedSku(base: string): string {
	const hash = createHash('sha1')
		.update(base)
		.digest('hex')
		.slice(0, 8)
		.toUpperCase()
	const separator = base ? '-' : ''
	const maxBaseLength = SKU_MAX_LENGTH - hash.length - separator.length
	const head = maxBaseLength > 0 ? base.slice(0, maxBaseLength) : ''
	return `${head}${separator}${hash}`
}

@Injectable()
export class ProductService {
	private readonly cacheTtlSec = PRODUCTS_CACHE_TTL_SEC
	private readonly uncategorizedFirstPageCacheTtlSec =
		CATEGORY_PRODUCTS_FIRST_PAGE_CACHE_TTL_SEC
	private readonly uncategorizedNextPageCacheTtlSec =
		CATEGORY_PRODUCTS_NEXT_PAGE_CACHE_TTL_SEC

	constructor(
		private readonly repo: ProductRepository,
		private readonly cache: CacheService,
		private readonly attributeBuilder: ProductAttributeBuilder,
		private readonly variantBuilder: ProductVariantBuilder,
		private readonly mediaRepo: MediaRepository,
		private readonly mediaUrl: MediaUrlService,
		private readonly s3Service: S3Service
	) {}

	async getAll(options?: ProductReadOptions) {
		const catalogId = mustCatalogId()
		const includeInactive = options?.includeInactive === true

		if (includeInactive || !this.cacheTtlSec) {
			const products = await this.repo.findAll(catalogId, includeInactive)
			return products.map(product =>
				this.mapProductMedia(product, MEDIA_LIST_VARIANT_NAMES)
			)
		}

		const cacheKey = await this.buildCatalogProductsCacheKey(catalogId)
		const cached = await this.cache.getJson<ProductList>(cacheKey)
		if (cached !== null) return cached

		const products = await this.repo.findAll(catalogId, false)
		const mapped = products.map(product =>
			this.mapProductMedia(product, MEDIA_LIST_VARIANT_NAMES)
		)
		await this.cache.setJson(cacheKey, mapped, this.cacheTtlSec)
		return mapped
	}

	async getPopular(options?: ProductReadOptions) {
		const catalogId = mustCatalogId()
		const includeInactive = options?.includeInactive === true

		if (includeInactive || !this.cacheTtlSec) {
			const products = await this.repo.findPopular(catalogId, includeInactive)
			return products.map(product =>
				this.mapProductMedia(product, MEDIA_LIST_VARIANT_NAMES)
			)
		}

		const cacheKey = await this.buildCatalogPopularProductsCacheKey(catalogId)
		const cached = await this.cache.getJson<PopularProductList>(cacheKey)
		if (cached !== null) return cached

		const products = await this.repo.findPopular(catalogId, false)
		const mapped = products.map(product =>
			this.mapProductMedia(product, MEDIA_LIST_VARIANT_NAMES)
		)
		await this.cache.setJson(cacheKey, mapped, this.cacheTtlSec)
		return mapped
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
		const items = await this.loadInfiniteItems(
			pageRows,
			catalogId,
			includeInactive
		)
		const nextCursor = this.buildInfiniteNextCursor(pageRows, hasMore, seed)

		return {
			items,
			nextCursor,
			seed: seed ?? null
		}
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
			return {
				items: [],
				nextCursor: null,
				seed: seed ?? null
			}
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
		const items = await this.loadInfiniteItems(
			pageRows,
			catalogId,
			includeInactive
		)
		const nextCursor = this.buildInfiniteNextCursor(pageRows, hasMore, seed)

		return {
			items,
			nextCursor,
			seed: seed ?? null
		}
	}

	async getUncategorizedInfinite(options?: {
		cursor?: string
		limit?: number | string
		includeInactive?: boolean
	}) {
		const catalogId = mustCatalogId()
		const includeInactive = options?.includeInactive === true
		const parsed = parseProductInfiniteQuery(
			{
				cursor: options?.cursor,
				limit: options?.limit
			},
			{
				defaultLimit: PRODUCT_INFINITE_DEFAULT_LIMIT,
				maxLimit: PRODUCT_INFINITE_MAX_LIMIT
			}
		)
		const cacheTtlSec = parsed.cursor
			? this.uncategorizedNextPageCacheTtlSec
			: this.uncategorizedFirstPageCacheTtlSec
		const cacheKey =
			!includeInactive && cacheTtlSec > 0
				? await this.buildUncategorizedProductsCacheKey(
						catalogId,
						parsed.cursor,
						parsed.limit
					)
				: undefined

		if (cacheKey) {
			const cached = await this.cache.getJson<{
				items: ProductList
				nextCursor: string | null
			}>(cacheKey)
			if (cached !== null) return cached
		}

		const decodedCursor = decodeProductInfiniteCursor(parsed.cursor)
		const rows = await this.repo.findUncategorizedPage(catalogId, {
			cursor: decodedCursor?.mode === 'default' ? decodedCursor.cursor : undefined,
			take: parsed.limit + 1,
			includeInactive
		})
		const hasMore = rows.length > parsed.limit
		const pageRows = hasMore ? rows.slice(0, parsed.limit) : rows
		const lastRow = pageRows[pageRows.length - 1]
		const page = {
			items: pageRows.map(product =>
				this.mapProductMedia(product, MEDIA_LIST_VARIANT_NAMES)
			),
			nextCursor:
				hasMore && lastRow
					? encodeProductDefaultCursor({
							id: lastRow.id,
							updatedAt: lastRow.updatedAt
						})
					: null
		}

		if (cacheKey) {
			await this.cache.setJson(cacheKey, page, cacheTtlSec)
		}

		return page
	}

	async getById(id: string, options?: ProductReadOptions) {
		const catalogId = mustCatalogId()
		const product = await this.repo.findById(
			id,
			catalogId,
			options?.includeInactive === true
		)
		if (!product) throw new NotFoundException('Товар не найден')
		return this.mapProductMedia(product, MEDIA_DETAIL_VARIANT_NAMES)
	}

	async getBySlug(slug: string, options?: ProductReadOptions) {
		const catalogId = mustCatalogId()
		const product = await this.repo.findBySlug(
			normalizeSlug(slug),
			catalogId,
			options?.includeInactive === true
		)
		if (!product) throw new NotFoundException('Товар не найден')
		return this.mapProductMedia(product, MEDIA_DETAIL_VARIANT_NAMES)
	}

	async create(dto: CreateProductDtoReq) {
		const { mediaIds, attributes, brandId, categories, variants, ...rest } = dto
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		const payload = await this.prepareCreatePayload(
			{ mediaIds, attributes, brandId, categories, variants, ...rest },
			catalogId,
			typeId
		)

		const product = await this.repo.create(
			payload.data,
			payload.attributes,
			payload.variants
		)
		await this.assignProductToCategories(
			product.id,
			payload.categoryIds,
			catalogId
		)
		const created = await this.repo.findById(product.id, catalogId, true)
		if (!created) throw new NotFoundException('РўРѕРІР°СЂ РЅРµ РЅР°Р№РґРµРЅ')

		await this.invalidateCatalogProductsCache(catalogId)
		await this.invalidateCategoryProductsCache(catalogId)
		if (
			payload.variants?.some(variant =>
				variant.attributes.some(attribute => Boolean(attribute.value))
			)
		) {
			await this.cache.bumpVersion(CATALOG_TYPE_CACHE_VERSION, typeId)
		}
		return {
			ok: true,
			...this.mapProductMedia(created, MEDIA_DETAIL_VARIANT_NAMES)
		}
	}

	async duplicate(id: string) {
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		const source = await this.repo.findById(id, catalogId, true)
		if (!source) throw new NotFoundException('Товар не найден')

		const duplicatedName = await this.generateDuplicatedProductName(
			source.name,
			catalogId
		)
		const duplicatedSlug = await this.generateProductSlug(
			duplicatedName,
			catalogId
		)
		const duplicatedSku = await this.generateProductSku(duplicatedName)
		const duplicatedVariants = source.variants.length
			? await this.variantBuilder.build(
					typeId,
					this.buildDuplicatedVariantInputs(source),
					duplicatedSku
				)
			: undefined
		const duplicatedCategoryIds = uniqueNonEmptyValues(
			source.categoryProducts.map(item => item.category?.id?.trim() ?? '')
		)
		const brandId = source.brand?.id
			? await this.resolveExistingBrandId(source.brand.id, catalogId)
			: null

		const product = await this.repo.create(
			this.buildDuplicatedProductData(
				source,
				catalogId,
				duplicatedName,
				duplicatedSlug,
				duplicatedSku,
				brandId
			),
			this.buildDuplicatedProductAttributes(source),
			duplicatedVariants
		)
		await this.assignProductToCategories(
			product.id,
			duplicatedCategoryIds,
			catalogId
		)

		const duplicated = await this.repo.findById(product.id, catalogId, true)
		if (!duplicated) throw new NotFoundException('Товар не найден')

		await this.invalidateCatalogProductsCache(catalogId)
		await this.invalidateCategoryProductsCache(catalogId)
		return {
			ok: true,
			...this.mapProductMedia(duplicated, MEDIA_DETAIL_VARIANT_NAMES)
		}
	}

	async update(id: string, dto: UpdateProductDtoReq) {
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		const payload = await this.prepareUpdatePayload(id, dto, catalogId, typeId)

		const product = await this.repo.update(
			id,
			payload.data,
			catalogId,
			payload.attributes,
			payload.removeAttributeIds,
			payload.variants,
			payload.mediaIds
		)
		if (!product) throw new NotFoundException('Товар не найден')

		if (payload.categoryIds !== undefined) {
			await this.repo.syncProductCategories(id, catalogId, payload.categoryIds)
		}

		if (payload.categoryId) {
			await this.repo.upsertCategoryProductPosition(
				id,
				payload.categoryId,
				catalogId,
				payload.categoryPosition
			)
		}

		await this.invalidateCatalogProductsCache(catalogId)
		await this.invalidateCategoryProductsCache(catalogId)
		return {
			ok: true,
			...this.mapProductMedia(product, MEDIA_DETAIL_VARIANT_NAMES)
		}
	}

	async toggleStatus(id: string) {
		const catalogId = mustCatalogId()
		const product = await this.repo.toggleStatus(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')

		await this.invalidateCatalogProductsCache(catalogId)
		await this.invalidateCategoryProductsCache(catalogId)
		return {
			ok: true,
			...this.mapProductMedia(product, MEDIA_DETAIL_VARIANT_NAMES)
		}
	}

	async togglePopular(id: string) {
		const catalogId = mustCatalogId()
		const product = await this.repo.togglePopular(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')

		await this.invalidateCatalogProductsCache(catalogId)
		await this.invalidateCategoryProductsCache(catalogId)
		return {
			ok: true,
			...this.mapProductMedia(product, MEDIA_DETAIL_VARIANT_NAMES)
		}
	}

	async updateCategoryPosition(
		id: string,
		dto: UpdateProductCategoryPositionDtoReq
	) {
		return this.update(id, {
			categoryId: dto.categoryId,
			categoryPosition: dto.position
		})
	}

	private async prepareCreatePayload(
		dto: CreateProductDtoReq,
		catalogId: string,
		typeId: string
	): Promise<PreparedProductCreatePayload> {
		const { mediaIds, attributes, brandId, categories, variants, ...rest } = dto
		const normalizedName = normalizeRequiredString(dto.name, 'name')
		await this.ensureUniqueName(normalizedName, catalogId)
		const resolvedSlug = await this.generateProductSlug(normalizedName, catalogId)
		const resolvedSku = await this.generateProductSku(normalizedName)

		const normalizedMediaIds = this.normalizeMediaIds(mediaIds)
		await this.ensureMediaIds(normalizedMediaIds, catalogId)

		const normalizedBrandId = normalizeNullableTrimmedString(brandId)
		if (normalizedBrandId) {
			await this.ensureBrandExists(normalizedBrandId, catalogId)
		}

		const normalizedCategoryIds = this.normalizeCategoryIds(categories)
		await this.ensureCategoriesExist(normalizedCategoryIds, catalogId)
		const preparedVariants =
			variants !== undefined
				? await this.prepareCreateVariants(typeId, resolvedSku, variants)
				: undefined

		return {
			data: {
				...rest,
				name: normalizedName,
				slug: resolvedSlug,
				sku: resolvedSku,
				catalog: { connect: { id: catalogId } },
				...(normalizedBrandId
					? { brand: { connect: { id: normalizedBrandId } } }
					: {}),
				...(normalizedMediaIds.length
					? {
							media: {
								create: normalizedMediaIds.map((mediaId, index) => ({
									position: index,
									media: { connect: { id: mediaId } }
								}))
							}
						}
					: {})
			},
			attributes: await this.attributeBuilder.buildForCreate(typeId, attributes),
			variants: preparedVariants,
			categoryIds: normalizedCategoryIds
		}
	}

	private async prepareUpdatePayload(
		id: string,
		dto: UpdateProductDtoReq,
		catalogId: string,
		typeId: string
	): Promise<PreparedProductUpdatePayload> {
		const data = await this.buildUpdateData(id, dto, catalogId)
		const mediaIds =
			dto.mediaIds !== undefined ? this.normalizeMediaIds(dto.mediaIds) : undefined
		const categoryIds =
			dto.categories !== undefined
				? this.normalizeCategoryIds(dto.categories)
				: undefined
		if (categoryIds !== undefined) {
			await this.ensureCategoriesExist(categoryIds, catalogId)
		}
		const categoryId = await this.resolveUpdatedCategoryId(
			dto,
			catalogId,
			categoryIds
		)
		const hasAttributeChanges = dto.attributes !== undefined
		const hasRemovedAttributeChanges = dto.removeAttributeIds !== undefined
		const hasVariantChanges = dto.variants !== undefined
		const hasMediaChanges = mediaIds !== undefined
		const hasCategoryChanges =
			categoryIds !== undefined || dto.categoryId !== undefined

		if (
			!hasAttributeChanges &&
			!hasRemovedAttributeChanges &&
			!hasVariantChanges &&
			!hasMediaChanges &&
			!hasCategoryChanges
		) {
			assertHasUpdateFields(data)
		}

		if (mediaIds !== undefined) {
			await this.ensureMediaIds(mediaIds, catalogId)
		}

		const attributes = hasAttributeChanges
			? await this.attributeBuilder.buildForUpdate(typeId, dto.attributes ?? [])
			: undefined
		const removeAttributeIds = hasRemovedAttributeChanges
			? await this.attributeBuilder.prepareRemovedAttributeIdsForUpdate(
					typeId,
					dto.removeAttributeIds ?? []
				)
			: undefined
		const variants = hasVariantChanges
			? this.prepareVariantUpdates(dto.variants ?? [])
			: undefined

		this.assertNoAttributeRemovalConflicts(attributes, removeAttributeIds)

		return {
			data,
			attributes,
			removeAttributeIds,
			variants,
			mediaIds,
			categoryIds,
			categoryId,
			categoryPosition: dto.categoryPosition ?? 0
		}
	}

	async setVariants(id: string, dto: SetProductVariantsDtoReq) {
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()

		const product = await this.repo.findSkuById(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')

		const variantAttributeId = String(dto.variantAttributeId).trim()
		if (!variantAttributeId) {
			throw new BadRequestException('variantAttributeId обязателен')
		}

		const productPrice =
			typeof product.price === 'number' ? product.price : Number(product.price)
		const defaultPrice = Number.isFinite(productPrice) ? productPrice : undefined

		const inputs = (dto.items ?? []).map(item => ({
			price: item.price,
			stock: item.stock,
			status: item.status,
			attributes: [
				{
					attributeId: variantAttributeId,
					enumValueId: item.enumValueId,
					value: item.value
				}
			]
		}))

		const variants = await this.variantBuilder.build(
			typeId,
			inputs,
			product.sku,
			{ variantAttributeId, defaultPrice }
		)
		const hasCustomVariantValues = variants.some(variant =>
			variant.attributes.some(attribute => Boolean(attribute.value))
		)
		const updated = await this.repo.setVariants(id, catalogId, variants)
		if (!updated) throw new NotFoundException('Товар не найден')

		await this.invalidateCatalogProductsCache(catalogId)
		if (hasCustomVariantValues) {
			await this.cache.bumpVersion(CATALOG_TYPE_CACHE_VERSION, typeId)
		}
		return {
			ok: true,
			...this.mapProductMedia(updated, MEDIA_DETAIL_VARIANT_NAMES)
		}
	}

	async remove(id: string) {
		const catalogId = mustCatalogId()
		const product = await this.repo.softDelete(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')

		if (product.mediaIds.length) {
			const orphanedMedia = await this.mediaRepo.findOrphanedByIds(
				product.mediaIds,
				catalogId
			)
			const s3Keys = this.collectS3MediaKeys(orphanedMedia)
			if (s3Keys.length) {
				await this.s3Service.deleteObjectsByKeys(s3Keys)
			}
			if (orphanedMedia.length) {
				await this.mediaRepo.deleteOrphanedByIds(
					orphanedMedia.map(media => media.id),
					catalogId
				)
			}
		}

		await this.invalidateCatalogProductsCache(catalogId)
		await this.invalidateCategoryProductsCache(catalogId)
		return { ok: true }
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
		return {
			hasMore,
			pageRows: hasMore ? rows.slice(0, limit) : rows
		}
	}

	private async loadInfiniteItems(
		rows: ProductInfiniteRow[],
		catalogId: string,
		includeInactive = false
	): Promise<ProductList> {
		const ids = rows.map(row => row.id)
		const products = await this.repo.findByIdsWithAttributes(
			ids,
			catalogId,
			includeInactive
		)
		const productById = new Map(
			products.map(
				product =>
					[
						product.id,
						this.mapProductMedia(product, MEDIA_LIST_VARIANT_NAMES)
					] as const
			)
		)

		return ids
			.map(id => productById.get(id))
			.filter((item): item is NonNullable<typeof item> => Boolean(item))
	}

	private buildInfiniteNextCursor(
		pageRows: ProductInfiniteRow[],
		hasMore: boolean,
		seed?: string
	): string | null {
		const lastRow = pageRows[pageRows.length - 1]
		if (!hasMore || !lastRow) {
			return null
		}

		if (seed) {
			const row = lastRow as ProductInfiniteSeededRow
			return encodeProductSeedCursor(seed, {
				id: row.id,
				score: row.score
			})
		}

		const row = lastRow as ProductInfiniteDefaultRow
		return encodeProductDefaultCursor({
			id: row.id,
			updatedAt: row.updatedAt
		})
	}

	private async resolveAttributeFilters(
		typeId: string,
		filters: ParsedAttributeFilter[]
	): Promise<ProductAttributeFilter[]> {
		if (!filters.length) return []

		const keys = uniqueNonEmptyValues(filters.map(filter => filter.key))
		const meta: AttributeFilterMeta[] =
			await this.repo.findAttributesByTypeAndKeys(typeId, keys)
		const metaByKey = new Map<string, AttributeFilterMeta>(
			meta.map(item => [item.key.toLowerCase(), item] as const)
		)

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
		const attrs: AttributeFilterMeta[] =
			await this.repo.findAttributesByTypeAndKeys(typeId, [
				'discount',
				'discountStartAt',
				'discountEndAt'
			])
		const byKey = new Map<string, string>(
			attrs.map(attr => [attr.key.toLowerCase(), attr.id] as const)
		)

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

	private mapProductMedia<
		T extends {
			media: { position: number; kind?: string | null; media: MediaRecord }[]
			categoryProducts?: {
				position: number
				category?: { id: string; name: string } | null
			}[]
			integrationLinks?: ProductIntegrationLinkRecord[]
		}
	>(product: T, variantNames?: readonly string[]) {
		const { media, categoryProducts, integrationLinks, ...rest } = product

		return {
			...rest,
			media: (media ?? []).map(item => ({
				position: item.position,
				kind: item.kind ?? null,
				media: this.mediaUrl.mapMedia(item.media, { variantNames })
			})),
			categories: (categoryProducts ?? [])
				.map(item =>
					item.category
						? {
								id: item.category.id,
								name: item.category.name,
								position: item.position
							}
						: null
				)
				.filter((item): item is NonNullable<typeof item> => Boolean(item)),
			integration: this.mapProductIntegration(integrationLinks)
		}
	}

	private mapProductIntegration(
		integrationLinks?: ProductIntegrationLinkRecord[]
	) {
		const link = integrationLinks?.[0]
		if (!link?.integration?.provider) {
			return null
		}

		return {
			provider: link.integration.provider,
			externalId: link.externalId,
			externalCode: link.externalCode ?? null,
			lastSyncedAt: link.lastSyncedAt ?? null
		}
	}

	private collectS3MediaKeys(
		media: Array<{
			key: string
			storage: string
			variants: { key: string; storage: string }[]
		}>
	): string[] {
		const keys = new Set<string>()

		for (const item of media) {
			if (item.storage === 's3' && item.key.trim()) {
				keys.add(item.key.trim())
			}
			for (const variant of item.variants) {
				if (variant.storage === 's3' && variant.key.trim()) {
					keys.add(variant.key.trim())
				}
			}
		}

		return [...keys]
	}

	private normalizeMediaIds(value?: string[]): string[] {
		if (!value) return []
		const normalized = value.map(item => String(item).trim())
		if (normalized.some(item => item.length === 0)) {
			throw new BadRequestException('mediaId не может быть пустым')
		}
		const unique = new Set(normalized)
		if (unique.size !== normalized.length) {
			throw new BadRequestException('Нельзя передавать дублирующиеся mediaId')
		}
		return normalized
	}

	private normalizeCategoryIds(value?: string[]): string[] {
		if (!value) return []
		const normalized = value.map(item => String(item).trim())
		if (normalized.some(item => item.length === 0)) {
			throw new BadRequestException(
				'Массив categories не может содержать пустые значения'
			)
		}
		const unique = new Set(normalized)
		if (unique.size !== normalized.length) {
			throw new BadRequestException(
				'Нельзя передавать дублирующиеся значения в categories'
			)
		}
		return normalized
	}

	private async buildUpdateData(
		id: string,
		dto: UpdateProductDtoReq,
		catalogId: string
	): Promise<ProductUpdateInput> {
		const data: ProductUpdateInput = {}

		if (dto.name !== undefined) {
			const normalizedName = normalizeRequiredString(dto.name, 'name')
			await this.ensureUniqueName(normalizedName, catalogId, id)
			data.name = normalizedName
		}
		if (dto.price !== undefined) {
			data.price = dto.price
		}
		if (dto.isPopular !== undefined) {
			data.isPopular = dto.isPopular
		}
		if (dto.status !== undefined) {
			data.status = dto.status
		}
		if (dto.position !== undefined) {
			data.position = dto.position
		}
		if (dto.brandId !== undefined) {
			if (dto.brandId === null) {
				data.brand = { disconnect: true }
			} else {
				const brandId = normalizeRequiredString(dto.brandId, 'brandId')
				await this.ensureBrandExists(brandId, catalogId)
				data.brand = { connect: { id: brandId } }
			}
		}

		return data
	}

	private async resolveUpdatedCategoryId(
		dto: UpdateProductDtoReq,
		catalogId: string,
		categoryIds?: string[]
	): Promise<string | undefined> {
		const hasCategoryChanges = dto.categoryId !== undefined
		if (dto.categoryPosition !== undefined && !hasCategoryChanges) {
			throw new BadRequestException(
				'categoryPosition можно передать только вместе с categoryId'
			)
		}

		if (!hasCategoryChanges) {
			return undefined
		}

		const normalizedCategoryId = normalizeRequiredString(
			dto.categoryId ?? '',
			'categoryId'
		)
		await this.ensureCategoryExists(normalizedCategoryId, catalogId)
		if (
			categoryIds !== undefined &&
			!categoryIds.includes(normalizedCategoryId)
		) {
			throw new BadRequestException(
				'categoryId должен входить в categories, если они переданы вместе'
			)
		}
		return normalizedCategoryId
	}

	private async ensureMediaIds(ids: string[], catalogId: string): Promise<void> {
		if (!ids.length) return
		const found = await this.mediaRepo.findByIds(ids, catalogId)
		const foundSet = new Set(found.map(item => item.id))
		const missing = ids.filter(id => !foundSet.has(id))
		if (missing.length) {
			throw new BadRequestException(
				`Медиа не найдены в каталоге: ${missing.join(', ')}`
			)
		}
	}

	private async ensureUniqueName(
		name: string,
		catalogId: string,
		excludeProductId?: string
	): Promise<void> {
		const exists = await this.repo.existsName(name, catalogId, excludeProductId)
		if (exists) {
			throw new BadRequestException('Товар с таким названием уже существует')
		}
	}

	private async ensureBrandExists(
		brandId: string,
		catalogId: string
	): Promise<void> {
		const brand = await this.repo.findBrandById(brandId, catalogId)
		if (!brand) {
			throw new BadRequestException(`Бренд ${brandId} не найден в каталоге`)
		}
	}

	private async resolveExistingBrandId(
		brandId: string,
		catalogId: string
	): Promise<string | null> {
		const brand = await this.repo.findBrandById(brandId, catalogId)
		return brand ? brand.id : null
	}

	private async ensureCategoryExists(
		categoryId: string,
		catalogId: string
	): Promise<void> {
		const category = await this.repo.findCategoryById(categoryId, catalogId)
		if (!category) {
			throw new BadRequestException(
				`Категория ${categoryId} не найдена в каталоге`
			)
		}
	}

	private async ensureCategoriesExist(
		categoryIds: string[],
		catalogId: string
	): Promise<void> {
		if (!categoryIds.length) return
		const found: { id: string }[] = await this.repo.findCategoriesByIds(
			categoryIds,
			catalogId
		)
		const foundSet = new Set(found.map(item => item.id))
		const missing = categoryIds.filter(id => !foundSet.has(id))
		if (missing.length) {
			throw new BadRequestException(
				`Категории не найдены в каталоге: ${missing.join(', ')}`
			)
		}
	}

	private async assignProductToCategories(
		productId: string,
		categoryIds: string[],
		catalogId: string
	): Promise<void> {
		if (!categoryIds.length) return

		await Promise.all(
			categoryIds.map(categoryId =>
				this.repo.upsertCategoryProductPosition(productId, categoryId, catalogId, 0)
			)
		)
	}

	private assertNoAttributeRemovalConflicts(
		attributes?: ProductAttributeValueData[],
		removeAttributeIds?: string[]
	): void {
		if (!attributes?.length || !removeAttributeIds?.length) {
			return
		}

		const updatedAttributeIds = new Set(
			attributes.map(attribute => attribute.attributeId)
		)
		const conflictingAttributeIds = removeAttributeIds.filter(attributeId =>
			updatedAttributeIds.has(attributeId)
		)

		if (conflictingAttributeIds.length) {
			throw new BadRequestException(
				`Атрибуты нельзя одновременно обновлять и удалять: ${conflictingAttributeIds.join(
					', '
				)}`
			)
		}
	}

	private async prepareCreateVariants(
		typeId: string,
		sku: string,
		variants: ProductVariantDtoReq[]
	): Promise<ProductVariantData[]> {
		return this.variantBuilder.build(typeId, variants, sku)
	}

	private prepareVariantUpdates(variants: ProductVariantUpdateDtoReq[]): {
		variantKey: string
		price?: number
		stock?: number
		status?: ProductVariantUpdateDtoReq['status']
	}[] {
		if (!variants.length) return []

		const keySet = new Set<string>()

		return variants.map(variant => {
			const variantKey = normalizeVariantKey(variant.variantKey)
			if (keySet.has(variantKey)) {
				throw new BadRequestException(`Дублирующийся ключ варианта: ${variantKey}`)
			}
			keySet.add(variantKey)

			if (
				variant.price === undefined &&
				variant.stock === undefined &&
				variant.status === undefined
			) {
				throw new BadRequestException(
					`Для варианта ${variantKey} нужно указать цену, остаток или статус`
				)
			}

			return {
				variantKey,
				price: variant.price,
				stock: variant.stock,
				status: variant.status
			}
		})
	}

	private async generateProductSlug(
		name: string,
		catalogId: string
	): Promise<string> {
		const base = buildSlugBase(name) || PRODUCT_SLUG_FALLBACK
		return this.ensureUniqueSlug(base, catalogId)
	}

	private async generateProductSku(name: string): Promise<string> {
		const base = buildSkuBase(name) || PRODUCT_SKU_FALLBACK
		const normalizedBase =
			base.length > SKU_MAX_LENGTH ? buildHashedSku(base) : base
		return this.ensureUniqueSku(normalizedBase)
	}

	private async generateDuplicatedProductName(
		name: string,
		catalogId: string
	): Promise<string> {
		const normalizedName = normalizeRequiredString(name, 'name')
		let copyIndex = 1
		let candidate = buildDuplicateNameCandidate(normalizedName, copyIndex)

		while (await this.repo.existsName(candidate, catalogId)) {
			copyIndex += 1
			candidate = buildDuplicateNameCandidate(normalizedName, copyIndex)
		}

		return candidate
	}

	private buildDuplicatedProductData(
		source: ProductDetailsItem,
		catalogId: string,
		name: string,
		slug: string,
		sku: string,
		brandId: string | null
	): ProductCreateInput {
		const price =
			typeof source.price === 'number' ? source.price : Number(source.price)

		return {
			name,
			slug,
			sku,
			price,
			isPopular: source.isPopular,
			status: ProductStatus.HIDDEN,
			position: source.position,
			catalog: { connect: { id: catalogId } },
			...(brandId ? { brand: { connect: { id: brandId } } } : {}),
			...(source.media.length
				? {
						media: {
							create: source.media.map(item => ({
								position: item.position,
								kind: item.kind ?? null,
								media: { connect: { id: item.media.id } }
							}))
						}
					}
				: {})
		}
	}

	private buildDuplicatedProductAttributes(
		source: ProductDetailsItem
	): ProductAttributeValueData[] {
		return source.productAttributes.map(attribute => ({
			attributeId: attribute.attributeId,
			enumValueId: attribute.enumValueId ?? null,
			valueString: attribute.valueString ?? null,
			valueInteger: attribute.valueInteger ?? null,
			valueDecimal:
				attribute.valueDecimal === null ? null : Number(attribute.valueDecimal),
			valueBoolean: attribute.valueBoolean ?? null,
			valueDateTime: attribute.valueDateTime
				? new Date(attribute.valueDateTime)
				: null
		}))
	}

	private buildDuplicatedVariantInputs(
		source: ProductDetailsItem
	): ProductVariantDtoReq[] {
		return source.variants.map(variant => ({
			price:
				typeof variant.price === 'number' ? variant.price : Number(variant.price),
			stock: variant.stock,
			status: variant.status,
			attributes: variant.attributes.map(attribute => ({
				attributeId: attribute.attributeId,
				enumValueId: attribute.enumValueId
			}))
		}))
	}

	private async ensureUniqueSlug(
		base: string,
		catalogId: string
	): Promise<string> {
		let candidate = applySuffix(base, 0, SLUG_MAX_LENGTH)
		let suffix = 1
		while (await this.repo.existsSlug(candidate, catalogId)) {
			candidate = applySuffix(base, suffix, SLUG_MAX_LENGTH)
			suffix += 1
		}
		return candidate
	}

	private async ensureUniqueSku(base: string): Promise<string> {
		let candidate = applySuffix(base, 0, SKU_MAX_LENGTH)
		let suffix = 1
		while (await this.repo.existsSku(candidate)) {
			candidate = applySuffix(base, suffix, SKU_MAX_LENGTH)
			suffix += 1
		}
		return candidate
	}

	private async buildCatalogProductsCacheKey(
		catalogId: string
	): Promise<string> {
		const version = await this.cache.getVersion(PRODUCTS_CACHE_VERSION, catalogId)
		return this.cache.buildKey([
			'catalog',
			catalogId,
			'products',
			'list',
			`v${version}`
		])
	}

	private async buildCatalogPopularProductsCacheKey(
		catalogId: string
	): Promise<string> {
		const version = await this.cache.getVersion(PRODUCTS_CACHE_VERSION, catalogId)
		return this.cache.buildKey([
			'catalog',
			catalogId,
			'products',
			'popular',
			`v${version}`
		])
	}

	private async buildUncategorizedProductsCacheKey(
		catalogId: string,
		cursor: string | undefined,
		limit: number
	): Promise<string> {
		const version = await this.cache.getVersion(
			CATEGORY_PRODUCTS_CACHE_VERSION,
			catalogId
		)
		return this.cache.buildKey([
			'catalog',
			catalogId,
			'products',
			'uncategorized',
			'infinite',
			`limit-${limit}`,
			cursor ? `cursor-${encodeURIComponent(cursor)}` : 'cursor-first',
			`v${version}`
		])
	}

	private async invalidateCatalogProductsCache(
		catalogId: string
	): Promise<void> {
		await this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId)
	}

	private async invalidateCategoryProductsCache(
		catalogId: string
	): Promise<void> {
		await this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId)
	}
}

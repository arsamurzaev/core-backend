import { DataType } from '@generated/enums'
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
	normalizeOptionalId,
	normalizeRequiredString
} from '@/shared/utils'

import { CreateProductDtoReq } from './dto/requests/create-product.dto.req'
import { ProductVariantUpdateDtoReq } from './dto/requests/product-variant-update.dto.req'
import { SetProductVariantsDtoReq } from './dto/requests/set-product-variants.dto.req'
import { UpdateProductDtoReq } from './dto/requests/update-product.dto.req'
import { ProductAttributeBuilder } from './product-attribute.builder'
import { ProductVariantBuilder } from './product-variant.builder'
import {
	type AttributeFilterMeta,
	type DiscountAttributeIds,
	type ProductAttributeFilter,
	type ProductDefaultPageCursor,
	ProductRepository,
	type ProductSeededPageCursor
} from './product.repository'

type ProductMediaMapped<T> = Omit<T, 'media'> & {
	media: { position: number; kind?: string | null; media: MediaDto }[]
}

type ProductList = ProductMediaMapped<
	Awaited<ReturnType<ProductRepository['findAll']>>[number]
>[]
type PopularProductList = ProductMediaMapped<
	Awaited<ReturnType<ProductRepository['findPopular']>>[number]
>[]
type ProductInfiniteDefaultRow = Awaited<
	ReturnType<ProductRepository['findFilteredProductIdsPageDefault']>
>[number]
type ProductInfiniteSeededRow = Awaited<
	ReturnType<ProductRepository['findFilteredProductIdsPageSeeded']>
>[number]
type ProductInfiniteRow = ProductInfiniteDefaultRow | ProductInfiniteSeededRow

type ParsedAttributeFilter = {
	key: string
	values: string[]
	min?: string
	max?: string
	bool?: boolean
}

type RawAttributeFilterState = {
	values: string[]
	min?: string
	max?: string
	bool?: boolean
}

type ParsedProductInfiniteQuery = {
	cursor?: string
	limit: number
	seed?: string
	categoryIds: string[]
	brandIds: string[]
	minPrice?: number
	maxPrice?: number
	searchTerm?: string
	isPopular?: boolean
	isDiscount?: boolean
	attributeFilters: ParsedAttributeFilter[]
}

type DecodedInfiniteCursor =
	| {
			mode: 'default'
			cursor: ProductDefaultPageCursor
	  }
	| {
			mode: 'seed'
			seed: string
			cursor: ProductSeededPageCursor
	  }

const PRODUCTS_CACHE_TTL_SEC =
	Number(process.env.CATALOG_PRODUCTS_CACHE_TTL_SEC ?? 0) || 0
const PRODUCT_INFINITE_DEFAULT_LIMIT = 24
const PRODUCT_INFINITE_MAX_LIMIT = 50
const SLUG_MAX_LENGTH = 255
const SKU_MAX_LENGTH = 100
const PRODUCT_SLUG_FALLBACK = 'product'
const PRODUCT_SKU_FALLBACK = 'SKU'

function isScalarQueryValue(
	value: unknown
): value is string | number | boolean | bigint {
	return (
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	)
}

function normalizeScalarQueryValue(
	value: string | number | boolean | bigint
): string {
	return String(value).trim()
}

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

	constructor(
		private readonly repo: ProductRepository,
		private readonly cache: CacheService,
		private readonly attributeBuilder: ProductAttributeBuilder,
		private readonly variantBuilder: ProductVariantBuilder,
		private readonly mediaRepo: MediaRepository,
		private readonly mediaUrl: MediaUrlService
	) {}

	async getAll() {
		const catalogId = mustCatalogId()
		if (!this.cacheTtlSec) {
			const products = await this.repo.findAll(catalogId)
			return products.map(product =>
				this.mapProductMedia(product, MEDIA_LIST_VARIANT_NAMES)
			)
		}

		const cacheKey = await this.buildCatalogProductsCacheKey(catalogId)
		const cached = await this.cache.getJson<ProductList>(cacheKey)
		if (cached !== null) return cached

		const products = await this.repo.findAll(catalogId)
		const mapped = products.map(product =>
			this.mapProductMedia(product, MEDIA_LIST_VARIANT_NAMES)
		)
		await this.cache.setJson(cacheKey, mapped, this.cacheTtlSec)
		return mapped
	}

	async getPopular() {
		const catalogId = mustCatalogId()
		if (!this.cacheTtlSec) {
			const products = await this.repo.findPopular(catalogId)
			return products.map(product =>
				this.mapProductMedia(product, MEDIA_LIST_VARIANT_NAMES)
			)
		}

		const cacheKey = await this.buildCatalogPopularProductsCacheKey(catalogId)
		const cached = await this.cache.getJson<PopularProductList>(cacheKey)
		if (cached !== null) return cached

		const products = await this.repo.findPopular(catalogId)
		const mapped = products.map(product =>
			this.mapProductMedia(product, MEDIA_LIST_VARIANT_NAMES)
		)
		await this.cache.setJson(cacheKey, mapped, this.cacheTtlSec)
		return mapped
	}

	async getInfinite(query: Record<string, unknown>) {
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		const parsed = this.parseInfiniteQuery(query)
		const decodedCursor = this.decodeInfiniteCursor(parsed.cursor)

		let seed = parsed.seed
		if (!seed && decodedCursor?.mode === 'seed') {
			seed = decodedCursor.seed
		}

		const attributeFilters = await this.resolveAttributeFilters(
			typeId,
			parsed.attributeFilters
		)
		const discountAttributeIds = parsed.isDiscount
			? await this.resolveDiscountAttributeIds(typeId)
			: undefined

		const take = parsed.limit + 1
		const baseQuery = {
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
			take
		}

		const rows: ProductInfiniteRow[] = seed
			? await this.repo.findFilteredProductIdsPageSeeded({
					...baseQuery,
					seed,
					cursor:
						decodedCursor?.mode === 'seed' && decodedCursor.seed === seed
							? decodedCursor.cursor
							: undefined
				})
			: await this.repo.findFilteredProductIdsPageDefault({
					...baseQuery,
					cursor:
						decodedCursor?.mode === 'default' ? decodedCursor.cursor : undefined
				})

		const hasMore = rows.length > parsed.limit
		const pageRows = hasMore ? rows.slice(0, parsed.limit) : rows
		const ids: string[] = pageRows.map(row => row.id)

		const products = await this.repo.findByIdsWithAttributes(ids, catalogId)
		const productById = new Map(
			products.map(
				product =>
					[
						product.id,
						this.mapProductMedia(product, MEDIA_LIST_VARIANT_NAMES)
					] as const
			)
		)
		const items = ids
			.map(id => productById.get(id))
			.filter((item): item is NonNullable<typeof item> => Boolean(item))

		const lastRow = pageRows[pageRows.length - 1]
		let nextCursor: string | null = null
		if (hasMore && lastRow) {
			if (seed) {
				const row = lastRow as { id: string; score: string }
				nextCursor = this.encodeSeedCursor(seed, {
					id: row.id,
					score: row.score
				})
			} else {
				const row = lastRow as { id: string; updatedAt: Date }
				nextCursor = this.encodeDefaultCursor({
					id: row.id,
					updatedAt: row.updatedAt
				})
			}
		}

		return {
			items,
			nextCursor,
			seed: seed ?? null
		}
	}

	async getById(id: string) {
		const catalogId = mustCatalogId()
		const product = await this.repo.findById(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')
		return this.mapProductMedia(product, MEDIA_DETAIL_VARIANT_NAMES)
	}

	async getBySlug(slug: string) {
		const catalogId = mustCatalogId()
		const product = await this.repo.findBySlug(normalizeSlug(slug), catalogId)
		if (!product) throw new NotFoundException('Товар не найден')
		return this.mapProductMedia(product, MEDIA_DETAIL_VARIANT_NAMES)
	}

	async create(dto: CreateProductDtoReq) {
		const { mediaIds, attributes, brandId, categories, ...rest } = dto
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		const normalizedName = normalizeRequiredString(dto.name, 'name')
		const resolvedSlug = await this.generateProductSlug(normalizedName, catalogId)
		const resolvedSku = await this.generateProductSku(normalizedName)

		const normalizedMediaIds = this.normalizeMediaIds(mediaIds)
		await this.ensureMediaIds(normalizedMediaIds, catalogId)
		const normalizedBrandId = normalizeOptionalId(brandId)
		if (normalizedBrandId) {
			await this.ensureBrandExists(normalizedBrandId, catalogId)
		}
		const normalizedCategoryIds = this.normalizeCategoryIds(categories)
		await this.ensureCategoriesExist(normalizedCategoryIds, catalogId)

		const data: ProductCreateInput = {
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
		}

		const builtAttributes = await this.attributeBuilder.buildForCreate(
			typeId,
			attributes
		)

		const product = await this.repo.create(data, builtAttributes)
		if (normalizedCategoryIds.length) {
			await Promise.all(
				normalizedCategoryIds.map(categoryId =>
					this.repo.upsertCategoryProductPosition(
						product.id,
						categoryId,
						catalogId,
						0
					)
				)
			)
		}
		await this.invalidateCatalogProductsCache(catalogId)
		await this.invalidateCategoryProductsCache(catalogId)
		return { ok: true, id: product.id, slug: product.slug }
	}

	async update(id: string, dto: UpdateProductDtoReq) {
		const data: ProductUpdateInput = {}
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		const mediaIds =
			dto.mediaIds !== undefined ? this.normalizeMediaIds(dto.mediaIds) : undefined
		const hasCategoryChanges = dto.categoryId !== undefined

		if (dto.categoryPosition !== undefined && !hasCategoryChanges) {
			throw new BadRequestException(
				'categoryPosition можно передать только вместе с categoryId'
			)
		}

		const normalizedCategoryId = hasCategoryChanges
			? normalizeRequiredString(dto.categoryId ?? '', 'categoryId')
			: undefined
		if (normalizedCategoryId) {
			await this.ensureCategoryExists(normalizedCategoryId, catalogId)
		}

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

		const hasAttributeChanges = dto.attributes !== undefined
		const hasVariantChanges = dto.variants !== undefined
		const hasMediaChanges = mediaIds !== undefined
		if (
			!hasAttributeChanges &&
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
		const variants = hasVariantChanges
			? this.prepareVariantUpdates(dto.variants ?? [])
			: undefined

		const product = await this.repo.update(
			id,
			data,
			catalogId,
			attributes,
			variants,
			mediaIds
		)
		if (!product) throw new NotFoundException('Товар не найден')

		if (normalizedCategoryId) {
			await this.repo.upsertCategoryProductPosition(
				id,
				normalizedCategoryId,
				catalogId,
				dto.categoryPosition ?? 0
			)
		}

		await this.invalidateCatalogProductsCache(catalogId)
		await this.invalidateCategoryProductsCache(catalogId)
		return {
			ok: true,
			...this.mapProductMedia(product, MEDIA_DETAIL_VARIANT_NAMES)
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

		await this.invalidateCatalogProductsCache(catalogId)
		await this.invalidateCategoryProductsCache(catalogId)
		return { ok: true }
	}

	private parseInfiniteQuery(
		query: Record<string, unknown>
	): ParsedProductInfiniteQuery {
		const limit = this.normalizeInfiniteLimit(
			this.getSingleQueryValue(query.limit)
		)
		const seedRaw = this.getSingleQueryValue(query.seed)
		const seed = seedRaw ? seedRaw : undefined
		const minPrice = this.parseOptionalNumber(
			this.getSingleQueryValue(query.minPrice),
			'minPrice'
		)
		const maxPrice = this.parseOptionalNumber(
			this.getSingleQueryValue(query.maxPrice),
			'maxPrice'
		)
		if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
			throw new BadRequestException('minPrice не может быть больше maxPrice')
		}

		return {
			cursor: this.getSingleQueryValue(query.cursor),
			limit,
			seed,
			categoryIds: this.extractCsvValues(query.categories),
			brandIds: this.extractCsvValues(query.brands),
			minPrice,
			maxPrice,
			searchTerm: this.getSingleQueryValue(query.searchTerm),
			isPopular: this.parseOptionalBoolean(
				this.getSingleQueryValue(query.isPopular),
				'isPopular'
			),
			isDiscount: this.parseOptionalBoolean(
				this.getSingleQueryValue(query.isDiscount),
				'isDiscount'
			),
			attributeFilters: this.parseAttributeFilters(query)
		}
	}

	private parseAttributeFilters(
		query: Record<string, unknown>
	): ParsedAttributeFilter[] {
		const stateByKey = new Map<string, RawAttributeFilterState>()
		const rawAttributesJson = this.getSingleQueryValue(query.attributes)

		if (rawAttributesJson) {
			let parsed: unknown
			try {
				parsed = JSON.parse(rawAttributesJson)
			} catch {
				throw new BadRequestException(
					'attributes должен быть валидным JSON-объектом'
				)
			}

			if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
				throw new BadRequestException(
					'attributes должен быть JSON-объектом вида {"key": value}'
				)
			}

			for (const [rawKey, rawValue] of Object.entries(parsed)) {
				const key = this.normalizeAttributeKey(rawKey)
				const state = this.ensureAttributeState(stateByKey, key)
				this.applyAttributeJsonValue(state, rawValue)
			}
		}

		for (const [rawKey, rawValue] of Object.entries(query)) {
			if (rawKey.startsWith('attr.')) {
				const key = this.normalizeAttributeKey(rawKey.slice('attr.'.length))
				const state = this.ensureAttributeState(stateByKey, key)
				state.values.push(...this.extractCsvValues(rawValue))
				continue
			}

			if (rawKey.startsWith('attrMin.')) {
				const key = this.normalizeAttributeKey(rawKey.slice('attrMin.'.length))
				const state = this.ensureAttributeState(stateByKey, key)
				state.min = this.getSingleQueryValue(rawValue)
				continue
			}

			if (rawKey.startsWith('attrMax.')) {
				const key = this.normalizeAttributeKey(rawKey.slice('attrMax.'.length))
				const state = this.ensureAttributeState(stateByKey, key)
				state.max = this.getSingleQueryValue(rawValue)
				continue
			}

			if (rawKey.startsWith('attrBool.')) {
				const key = this.normalizeAttributeKey(rawKey.slice('attrBool.'.length))
				const state = this.ensureAttributeState(stateByKey, key)
				state.bool = this.parseOptionalBoolean(
					this.getSingleQueryValue(rawValue),
					`attrBool.${key}`
				)
			}
		}

		return Array.from(stateByKey.entries())
			.map(([key, state]) => ({
				key,
				values: this.uniqueNonEmpty(state.values.map(value => value.trim())),
				min: state.min?.trim() || undefined,
				max: state.max?.trim() || undefined,
				bool: state.bool
			}))
			.filter(
				state =>
					state.values.length > 0 ||
					state.min !== undefined ||
					state.max !== undefined ||
					state.bool !== undefined
			)
	}

	private async resolveAttributeFilters(
		typeId: string,
		filters: ParsedAttributeFilter[]
	): Promise<ProductAttributeFilter[]> {
		if (!filters.length) return []

		const keys = this.uniqueNonEmpty(filters.map(filter => filter.key))
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
			return this.resolveSingleAttributeFilter(item, filter)
		})
	}

	private resolveSingleAttributeFilter(
		meta: {
			id: string
			key: string
			dataType: DataType
			isVariantAttribute: boolean
		},
		filter: ParsedAttributeFilter
	): ProductAttributeFilter {
		switch (meta.dataType) {
			case DataType.ENUM: {
				if (
					filter.bool !== undefined ||
					filter.min !== undefined ||
					filter.max !== undefined
				) {
					throw new BadRequestException(
						`Для ENUM-атрибута ${meta.key} поддерживаются только значения`
					)
				}
				const values = this.uniqueNonEmpty(filter.values.map(v => v.trim()))
				if (!values.length) {
					throw new BadRequestException(
						`Для атрибута ${meta.key} нужно передать значения`
					)
				}
				return meta.isVariantAttribute
					? { kind: 'variant-enum', attributeId: meta.id, values }
					: { kind: 'enum', attributeId: meta.id, values }
			}
			case DataType.STRING: {
				if (
					filter.bool !== undefined ||
					filter.min !== undefined ||
					filter.max !== undefined
				) {
					throw new BadRequestException(
						`Для STRING-атрибута ${meta.key} поддерживаются только значения`
					)
				}
				const values = this.uniqueNonEmpty(filter.values.map(v => v.trim()))
				if (!values.length) {
					throw new BadRequestException(
						`Для атрибута ${meta.key} нужно передать значения`
					)
				}
				return { kind: 'string', attributeId: meta.id, values }
			}
			case DataType.BOOLEAN: {
				if (filter.min !== undefined || filter.max !== undefined) {
					throw new BadRequestException(
						`Для BOOLEAN-атрибута ${meta.key} min/max не поддерживаются`
					)
				}
				if (filter.values.length > 1) {
					throw new BadRequestException(
						`Для BOOLEAN-атрибута ${meta.key} нужно одно значение`
					)
				}
				const value =
					filter.bool ??
					(filter.values.length
						? this.parseBooleanStrict(filter.values[0], `attr.${meta.key}`)
						: undefined)
				if (value === undefined) {
					throw new BadRequestException(
						`Для атрибута ${meta.key} нужно передать true или false`
					)
				}
				return { kind: 'boolean', attributeId: meta.id, value }
			}
			case DataType.INTEGER: {
				if (filter.bool !== undefined) {
					throw new BadRequestException(
						`Для INTEGER-атрибута ${meta.key} bool не поддерживается`
					)
				}
				const values = filter.values.map(value =>
					this.parseInteger(value, `attr.${meta.key}`)
				)
				const min =
					filter.min !== undefined
						? this.parseInteger(filter.min, `attrMin.${meta.key}`)
						: undefined
				const max =
					filter.max !== undefined
						? this.parseInteger(filter.max, `attrMax.${meta.key}`)
						: undefined
				if (!values.length && min === undefined && max === undefined) {
					throw new BadRequestException(
						`Для атрибута ${meta.key} нужно передать value, min или max`
					)
				}
				if (min !== undefined && max !== undefined && min > max) {
					throw new BadRequestException(
						`attrMin.${meta.key} не может быть больше attrMax.${meta.key}`
					)
				}
				return { kind: 'integer', attributeId: meta.id, values, min, max }
			}
			case DataType.DECIMAL: {
				if (filter.bool !== undefined) {
					throw new BadRequestException(
						`Для DECIMAL-атрибута ${meta.key} bool не поддерживается`
					)
				}
				const values = filter.values.map(value =>
					this.parseDecimal(value, `attr.${meta.key}`)
				)
				const min =
					filter.min !== undefined
						? this.parseDecimal(filter.min, `attrMin.${meta.key}`)
						: undefined
				const max =
					filter.max !== undefined
						? this.parseDecimal(filter.max, `attrMax.${meta.key}`)
						: undefined
				if (!values.length && min === undefined && max === undefined) {
					throw new BadRequestException(
						`Для атрибута ${meta.key} нужно передать value, min или max`
					)
				}
				if (min !== undefined && max !== undefined && min > max) {
					throw new BadRequestException(
						`attrMin.${meta.key} не может быть больше attrMax.${meta.key}`
					)
				}
				return { kind: 'decimal', attributeId: meta.id, values, min, max }
			}
			case DataType.DATETIME: {
				if (filter.bool !== undefined) {
					throw new BadRequestException(
						`Для DATETIME-атрибута ${meta.key} bool не поддерживается`
					)
				}
				const values = filter.values.map(value =>
					this.parseDate(value, `attr.${meta.key}`)
				)
				const min =
					filter.min !== undefined
						? this.parseDate(filter.min, `attrMin.${meta.key}`)
						: undefined
				const max =
					filter.max !== undefined
						? this.parseDate(filter.max, `attrMax.${meta.key}`)
						: undefined
				if (!values.length && min === undefined && max === undefined) {
					throw new BadRequestException(
						`Для атрибута ${meta.key} нужно передать value, min или max`
					)
				}
				if (
					min !== undefined &&
					max !== undefined &&
					min.getTime() > max.getTime()
				) {
					throw new BadRequestException(
						`attrMin.${meta.key} не может быть больше attrMax.${meta.key}`
					)
				}
				return { kind: 'datetime', attributeId: meta.id, values, min, max }
			}
			default:
				throw new BadRequestException(
					`Тип атрибута ${meta.key} не поддерживается в фильтре`
				)
		}
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

	private decodeInfiniteCursor(raw?: string): DecodedInfiniteCursor | null {
		if (!raw) return null

		try {
			const decoded = Buffer.from(raw, 'base64').toString('utf8')
			const payload = JSON.parse(decoded) as {
				mode?: unknown
				id?: unknown
				updatedAt?: unknown
				score?: unknown
				seed?: unknown
			}

			if (payload.mode === 'default') {
				const id = typeof payload.id === 'string' ? payload.id.trim() : ''
				const updatedAtRaw =
					typeof payload.updatedAt === 'string'
						? payload.updatedAt.trim()
						: undefined
				if (!id || !updatedAtRaw) return null
				const updatedAt = new Date(updatedAtRaw)
				if (Number.isNaN(updatedAt.getTime())) return null
				return {
					mode: 'default',
					cursor: { id, updatedAt }
				}
			}

			if (payload.mode === 'seed') {
				const id = typeof payload.id === 'string' ? payload.id.trim() : ''
				const score = typeof payload.score === 'string' ? payload.score.trim() : ''
				const seed = typeof payload.seed === 'string' ? payload.seed.trim() : ''
				if (!id || !score || !seed) return null
				return {
					mode: 'seed',
					seed,
					cursor: { id, score }
				}
			}

			return null
		} catch {
			return null
		}
	}

	private encodeDefaultCursor(cursor: ProductDefaultPageCursor): string {
		return Buffer.from(
			JSON.stringify({
				mode: 'default',
				id: cursor.id,
				updatedAt: cursor.updatedAt.toISOString()
			})
		).toString('base64')
	}

	private encodeSeedCursor(
		seed: string,
		cursor: ProductSeededPageCursor
	): string {
		return Buffer.from(
			JSON.stringify({
				mode: 'seed',
				id: cursor.id,
				score: cursor.score,
				seed
			})
		).toString('base64')
	}

	private normalizeInfiniteLimit(value?: string): number {
		if (!value) return PRODUCT_INFINITE_DEFAULT_LIMIT
		const parsed = Number(value)
		if (!Number.isFinite(parsed)) return PRODUCT_INFINITE_DEFAULT_LIMIT
		const normalized = Math.floor(parsed)
		if (normalized <= 0) return PRODUCT_INFINITE_DEFAULT_LIMIT
		return Math.min(normalized, PRODUCT_INFINITE_MAX_LIMIT)
	}

	private getSingleQueryValue(raw: unknown): string | undefined {
		if (Array.isArray(raw)) {
			for (const item of raw) {
				const normalized = this.getSingleQueryValue(item)
				if (normalized) return normalized
			}
			return undefined
		}
		if (!isScalarQueryValue(raw)) return undefined
		const normalized = normalizeScalarQueryValue(raw)
		return normalized || undefined
	}

	private extractCsvValues(raw: unknown): string[] {
		if (Array.isArray(raw)) {
			return this.uniqueNonEmpty(raw.flatMap(item => this.extractCsvValues(item)))
		}
		if (!isScalarQueryValue(raw)) return []
		return this.uniqueNonEmpty(
			normalizeScalarQueryValue(raw)
				.split(',')
				.map(item => item.trim())
		)
	}

	private parseOptionalBoolean(
		value: string | undefined,
		field: string
	): boolean | undefined {
		if (value === undefined) return undefined
		return this.parseBooleanStrict(value, field)
	}

	private parseBooleanStrict(value: string, field: string): boolean {
		const normalized = value.trim().toLowerCase()
		if (normalized === 'true' || normalized === '1') return true
		if (normalized === 'false' || normalized === '0') return false
		throw new BadRequestException(`Поле ${field} должно быть true/false`)
	}

	private parseOptionalNumber(
		value: string | undefined,
		field: string
	): number | undefined {
		if (value === undefined) return undefined
		const parsed = Number(value)
		if (!Number.isFinite(parsed)) {
			throw new BadRequestException(`Поле ${field} должно быть числом`)
		}
		return parsed
	}

	private parseInteger(value: string, field: string): number {
		const parsed = Number(value)
		if (!Number.isInteger(parsed)) {
			throw new BadRequestException(`Поле ${field} должно быть целым числом`)
		}
		return parsed
	}

	private parseDecimal(value: string, field: string): number {
		const parsed = Number(value)
		if (!Number.isFinite(parsed)) {
			throw new BadRequestException(`Поле ${field} должно быть числом`)
		}
		return parsed
	}

	private parseDate(value: string, field: string): Date {
		const parsed = new Date(value)
		if (Number.isNaN(parsed.getTime())) {
			throw new BadRequestException(`Поле ${field} должно быть датой`)
		}
		return parsed
	}

	private normalizeAttributeKey(value: string): string {
		const normalized = value.trim().toLowerCase()
		if (!normalized) {
			throw new BadRequestException('Ключ атрибута фильтра не может быть пустым')
		}
		return normalized
	}

	private ensureAttributeState(
		map: Map<string, RawAttributeFilterState>,
		key: string
	): RawAttributeFilterState {
		let state = map.get(key)
		if (!state) {
			state = { values: [] }
			map.set(key, state)
		}
		return state
	}

	private applyAttributeJsonValue(
		state: RawAttributeFilterState,
		value: unknown
	): void {
		if (value === null || value === undefined) return

		if (Array.isArray(value)) {
			state.values.push(
				...value
					.map(item =>
						item === null || item === undefined || !isScalarQueryValue(item)
							? ''
							: normalizeScalarQueryValue(item)
					)
					.filter(Boolean)
			)
			return
		}

		if (typeof value === 'boolean') {
			state.bool = value
			return
		}

		if (typeof value === 'number' || typeof value === 'string') {
			state.values.push(String(value))
			return
		}

		if (typeof value === 'object') {
			const payload = value as {
				values?: unknown
				value?: unknown
				min?: unknown
				max?: unknown
				bool?: unknown
			}

			if (payload.values !== undefined) {
				state.values.push(...this.extractCsvValues(payload.values))
			}
			if (payload.value !== undefined) {
				state.values.push(...this.extractCsvValues(payload.value))
			}
			if (payload.min !== undefined && payload.min !== null) {
				const min = this.getSingleQueryValue(payload.min)
				if (min === undefined) {
					throw new BadRequestException(
						'Поле attributes.min должно быть строкой, числом или boolean'
					)
				}
				state.min = min
			}
			if (payload.max !== undefined && payload.max !== null) {
				const max = this.getSingleQueryValue(payload.max)
				if (max === undefined) {
					throw new BadRequestException(
						'Поле attributes.max должно быть строкой, числом или boolean'
					)
				}
				state.max = max
			}
			if (payload.bool !== undefined && payload.bool !== null) {
				const bool = this.getSingleQueryValue(payload.bool)
				if (bool === undefined) {
					throw new BadRequestException(
						'Поле attributes.bool должно быть строкой, числом или boolean'
					)
				}
				state.bool = this.parseBooleanStrict(bool, 'attributes.bool')
			}
		}
	}

	private uniqueNonEmpty(values: string[]): string[] {
		return Array.from(new Set(values.filter(Boolean)))
	}

	private mapProductMedia<
		T extends {
			media: { position: number; kind?: string | null; media: MediaRecord }[]
		}
	>(product: T, variantNames?: readonly string[]) {
		return {
			...product,
			media: (product.media ?? []).map(item => ({
				position: item.position,
				kind: item.kind ?? null,
				media: this.mediaUrl.mapMedia(item.media, { variantNames })
			}))
		}
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

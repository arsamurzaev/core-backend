import {
	ProductVariantKind,
	ProductVariantStatus,
	SeoEntityType
} from '@generated/enums'
import {
	BadRequestException,
	Inject,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import { createHash } from 'crypto'

import type { CatalogCapabilityFlags } from '@/modules/capability/public'
import {
	CAPABILITY_READER_PORT,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_PRODUCTS_CACHE_TTL_SEC,
	CATALOG_TYPE_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	CATEGORY_PRODUCTS_FIRST_PAGE_CACHE_TTL_SEC,
	CATEGORY_PRODUCTS_NEXT_PAGE_CACHE_TTL_SEC,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import type { MediaDto } from '@/shared/media/dto/media.dto.res'
import {
	MEDIA_DETAIL_VARIANT_NAMES,
	MEDIA_LIST_VARIANT_NAMES,
	MediaUrlService
} from '@/shared/media/media-url.service'
import {
	type ProductMappableRecord,
	ProductMediaMapper
} from '@/shared/media/product-media.mapper'
import { effectiveCatalogId, mustTypeId } from '@/shared/tenancy/ctx'

import { SeoRepository } from '@/modules/seo/public'

import {
	PRODUCT_SELLABLE_READER_PORT,
	type ProductSellableReader
} from './contracts'
import {
	applyProductCommercialFields,
	type ProductCommercialFields,
	toProductCommercialFields,
	toProductCommercialFieldsMap
} from './product-commercial-fields.mapper'
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
	type ProductDetailsItem,
	type ProductFilterQueryBase,
	type ProductPublicDetailsItem,
	ProductRepository,
	type ProductVariantPickerOptionRecord,
	type ProductVariantSummaryRecord
} from './product.repository'
import { resolveProductSaleUnitsForRead } from './product-sale-units-read.utils'

export type ProductReadOptions = {
	includeInactive?: boolean
	includeVariantIntegration?: boolean
}

type ProductReadFeatures = Pick<
	CatalogCapabilityFlags,
	| 'canUseProductTypes'
	| 'canUseProductVariants'
	| 'canUseCatalogSaleUnits'
	| 'canUseMoySkladIntegration'
	| 'canUseIikoIntegration'
>

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

type ProductVariantSummary = Omit<ProductVariantSummaryRecord, 'productId'>
type ProductVariantPickerOption = {
	id: string
	label: string
	price: string | null
	stock: number | null
	status: ProductVariantPickerOptionRecord['status']
	isAvailable: boolean
	saleUnitId: string | null
	saleUnitPrice: string | null
	maxQuantity: number | null
}
type ProductVariantPickerSource = Omit<
	ProductVariantPickerOptionRecord,
	'productId'
> & {
	productId?: string
}

type ProductListMappableRecord = ProductMappableRecord & {
	id: string
	price?: unknown
	productType?: { id?: string | null } | null
}

const PRODUCT_INFINITE_DEFAULT_LIMIT = 24
const PRODUCT_INFINITE_MAX_LIMIT = 50
const EMPTY_VARIANT_SUMMARY: ProductVariantSummary = {
	minPrice: null,
	maxPrice: null,
	activeCount: 0,
	totalStock: 0,
	singleVariantId: null
}
const FALLBACK_VARIANT_LABEL = 'Вариация'
const DEFAULT_VARIANT_KEY = 'default'

function normalizeSlug(value: string): string {
	return value.trim().toLowerCase()
}

function toSafeString(value: unknown): string {
	if (typeof value === 'string') return value
	if (
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	) {
		return String(value)
	}
	if (value instanceof Date) return value.toISOString()
	if (value && typeof value === 'object') {
		const toString = (value as { toString?: () => string }).toString
		if (
			typeof toString === 'function' &&
			toString !== Object.prototype.toString
		) {
			return toString.call(value) as string
		}
	}
	return ''
}

function toNumberValue(value: unknown): number | null {
	if (value === null || value === undefined) return null
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null
	}

	const parsed = Number(toSafeString(value))
	return Number.isFinite(parsed) ? parsed : null
}

function toDecimalString(value: unknown): string | null {
	if (value === null || value === undefined) return null
	if (typeof value === 'string') return value
	if (typeof value === 'number') return value.toFixed(2)
	const normalized = toSafeString(value)
	if (normalized) return normalized

	return null
}

type SaleUnitPickerSource = {
	id: string
	price: unknown
	baseQuantity: unknown
	isDefault?: boolean | null
	displayOrder?: number | null
}

function resolveDefaultSaleUnit(
	variant: { saleUnits?: SaleUnitPickerSource[] | null } | null | undefined
): SaleUnitPickerSource | null {
	const saleUnits = Array.isArray(variant?.saleUnits)
		? variant.saleUnits.filter(
				(unit): unit is SaleUnitPickerSource =>
					Boolean(unit) && typeof unit.id === 'string'
			)
		: []
	if (!saleUnits.length) return null

	return (
		saleUnits
			.slice()
			.sort(
				(left, right) =>
					Number(Boolean(right.isDefault)) - Number(Boolean(left.isDefault)) ||
					Number(left.displayOrder ?? 0) - Number(right.displayOrder ?? 0)
			)[0] ?? null
	)
}

function resolveVariantDisplayPrice(variant: ProductVariantPickerSource): unknown {
	return resolveDefaultSaleUnit(variant)?.price ?? variant.price
}

function resolveVariantMaxQuantity(
	variant: ProductVariantPickerSource,
	saleUnit: SaleUnitPickerSource | null
): number | null {
	if (variant.stock === null) return null

	const stock = Math.max(0, variant.stock)
	const baseQuantity = toNumberValue(saleUnit?.baseQuantity)
	if (baseQuantity === null || baseQuantity <= 0) return stock

	return Math.floor(stock / baseQuantity)
}

function shouldBuildVariantPickerOptions(
	summary: ProductVariantSummary
): boolean {
	const activeCount = Math.max(0, summary.activeCount)
	const singleVariantId = summary.singleVariantId?.trim()

	return activeCount > 0 && !(activeCount === 1 && singleVariantId)
}

function hasCurrentProductType(
	product: { productType?: { id?: string | null } | null } | null | undefined
): boolean {
	return Boolean(product?.productType?.id)
}

function shouldExposeProductVariantsForProduct(
	features: ProductReadFeatures,
	product: { productType?: { id?: string | null } | null } | null | undefined
): boolean {
	return (
		features.canUseProductTypes &&
		features.canUseProductVariants &&
		hasCurrentProductType(product)
	)
}

function buildVariantPickerLabel(variant: ProductVariantPickerSource): string {
	const values = variant.attributes
		.slice()
		.sort(
			(left, right) =>
				left.attribute.displayOrder - right.attribute.displayOrder ||
				(left.enumValue?.displayOrder ?? 0) - (right.enumValue?.displayOrder ?? 0)
		)
		.map(
			attribute =>
				attribute.enumValue?.displayName?.trim() ||
				attribute.enumValue?.value.trim()
		)
		.filter((value): value is string => Boolean(value))

	return (
		values.join(', ') ||
		variant.sku.trim() ||
		variant.variantKey.trim() ||
		FALLBACK_VARIANT_LABEL
	)
}

function isDefaultVariant(variant: ProductVariantPickerSource): boolean {
	return (
		variant.kind === ProductVariantKind.DEFAULT ||
		variant.variantKey === DEFAULT_VARIANT_KEY
	)
}

function compareVariantPickerOptions(
	left: ProductVariantPickerSource,
	right: ProductVariantPickerSource
): number {
	const leftAttribute = left.attributes[0]
	const rightAttribute = right.attributes[0]

	return (
		(leftAttribute?.attribute.displayOrder ?? 0) -
			(rightAttribute?.attribute.displayOrder ?? 0) ||
		(leftAttribute?.enumValue?.displayOrder ?? 0) -
			(rightAttribute?.enumValue?.displayOrder ?? 0) ||
		buildVariantPickerLabel(left).localeCompare(buildVariantPickerLabel(right)) ||
		left.id.localeCompare(right.id)
	)
}

function mapVariantPickerOption(
	variant: ProductVariantPickerSource
): ProductVariantPickerOption {
	const defaultSaleUnit = resolveDefaultSaleUnit(variant)
	const displayPrice = resolveVariantDisplayPrice(variant)

	return {
		id: variant.id,
		label: buildVariantPickerLabel(variant),
		price: toDecimalString(displayPrice),
		stock: variant.stock,
		status: variant.status,
		isAvailable: variant.isAvailable,
		saleUnitId: defaultSaleUnit?.id ?? null,
		saleUnitPrice: toDecimalString(defaultSaleUnit?.price),
		maxQuantity: resolveVariantMaxQuantity(variant, defaultSaleUnit)
	}
}

function resolveVariantTotalStock(
	variants: ProductVariantPickerSource[]
): number | null {
	if (!variants.length) return 0
	if (variants.some(variant => variant.stock === null)) return null
	return variants.reduce(
		(sum, variant) => sum + Math.max(0, variant.stock ?? 0),
		0
	)
}

function buildVariantSummaryFromVariants(
	variants: ProductVariantPickerSource[]
): ProductVariantSummary {
	const activeVariants = variants.filter(
		variant =>
			!isDefaultVariant(variant) &&
			variant.status !== ProductVariantStatus.DISABLED
	)

	if (!activeVariants.length) {
		return { ...EMPTY_VARIANT_SUMMARY }
	}

	const prices = activeVariants
		.map(variant => toNumberValue(resolveVariantDisplayPrice(variant)))
		.filter((price): price is number => price !== null)
	if (!prices.length) {
		return {
			...EMPTY_VARIANT_SUMMARY,
			activeCount: activeVariants.length,
			totalStock: resolveVariantTotalStock(activeVariants),
			singleVariantId: activeVariants.length === 1 ? activeVariants[0].id : null
		}
	}
	const minPrice = Math.min(...prices)
	const maxPrice = Math.max(...prices)

	return {
		minPrice: minPrice.toFixed(2),
		maxPrice: maxPrice.toFixed(2),
		activeCount: activeVariants.length,
		totalStock: resolveVariantTotalStock(activeVariants),
		singleVariantId: activeVariants.length === 1 ? activeVariants[0].id : null
	}
}

function buildVariantPickerOptionsFromVariants(
	variants: ProductVariantPickerSource[],
	summary: ProductVariantSummary
): ProductVariantPickerOption[] {
	if (!shouldBuildVariantPickerOptions(summary)) {
		return []
	}

	return variants
		.filter(
			variant =>
				!isDefaultVariant(variant) &&
				variant.status !== ProductVariantStatus.DISABLED
		)
		.slice()
		.sort(compareVariantPickerOptions)
		.map(mapVariantPickerOption)
}

function sanitizeVariantForReadFeatures<T extends Record<string, unknown>>(
	variant: T,
	features: ProductReadFeatures
): T {
	const sanitized: Record<string, unknown> = { ...variant }

	if (!features.canUseCatalogSaleUnits && 'saleUnits' in sanitized) {
		sanitized.saleUnits = []
	}

	if (
		!features.canUseMoySkladIntegration &&
		!features.canUseIikoIntegration &&
		'integration' in sanitized
	) {
		sanitized.integration = null
	}

	return sanitized as T
}

function sanitizeProductAttributesForReadFeatures(
	value: unknown,
	features: ProductReadFeatures
): unknown[] {
	if (!Array.isArray(value)) return []
	const attributes = value as unknown[]
	if (features.canUseProductTypes) return attributes

	return attributes.filter(attributeValue => {
		if (!attributeValue || typeof attributeValue !== 'object') return false

		const meta = (
			attributeValue as {
				attribute?: {
					isHidden?: boolean | null
					isVariantAttribute?: boolean | null
				} | null
			}
		).attribute

		return meta?.isHidden !== true && meta?.isVariantAttribute !== true
	})
}

function sanitizeProductForReadFeatures<T extends Record<string, unknown>>(
	product: T,
	features: ProductReadFeatures,
	shouldExposeVariants: boolean
): T {
	const sanitized: Record<string, unknown> = { ...product }

	if (!features.canUseProductTypes) {
		if ('productType' in sanitized) sanitized.productType = null
		if ('productAttributes' in sanitized) {
			sanitized.productAttributes = sanitizeProductAttributesForReadFeatures(
				sanitized.productAttributes,
				features
			)
		}
	}

	if (
		!features.canUseMoySkladIntegration &&
		!features.canUseIikoIntegration &&
		'integration' in sanitized
	) {
		sanitized.integration = null
	}

	if (!features.canUseCatalogSaleUnits && 'saleUnits' in sanitized) {
		sanitized.saleUnits = []
	}

	if ('variantSummary' in sanitized && !shouldExposeVariants) {
		sanitized.variantSummary = { ...EMPTY_VARIANT_SUMMARY }
	}

	if ('variantPickerOptions' in sanitized && !shouldExposeVariants) {
		sanitized.variantPickerOptions = []
	}

	if ('variants' in sanitized) {
		if (!shouldExposeVariants || !Array.isArray(sanitized.variants)) {
			sanitized.variants = []
		} else {
			const variants = sanitized.variants as unknown[]

			sanitized.variants = variants.map((variant): unknown =>
				typeof variant === 'object' && variant !== null
					? sanitizeVariantForReadFeatures(
							variant as Record<string, unknown>,
							features
						)
					: variant
			)
		}
	}

	return sanitized as T
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
		private readonly mediaUrl: MediaUrlService,
		@Inject(CAPABILITY_READER_PORT)
		private readonly capabilities: CapabilityReaderPort,
		@Inject(PRODUCT_SELLABLE_READER_PORT)
		private readonly sellableReader: ProductSellableReader
	) {}

	// ─── Public read methods ─────────────────────────────────────────────────

	async getAll(options?: ProductReadOptions) {
		const catalogId = effectiveCatalogId()
		const includeInactive = options?.includeInactive === true
		const readFeatures = await this.getReadFeatures(catalogId)

		if (includeInactive || !this.cacheTtlSec) {
			const products = await this.repo.findAll(catalogId, includeInactive)
			return this.mapProductsWithVariantSummary(
				products,
				MEDIA_LIST_VARIANT_NAMES,
				catalogId,
				readFeatures
			)
		}

		const key = await this.buildCatalogProductsCacheKey(catalogId, readFeatures)
		return this.withCache(
			key,
			async () => {
				const products = await this.repo.findAll(catalogId, false)
				return this.mapProductsWithVariantSummary(
					products,
					MEDIA_LIST_VARIANT_NAMES,
					catalogId,
					readFeatures
				)
			},
			this.cacheTtlSec
		)
	}

	async getPopular(options?: ProductReadOptions) {
		const catalogId = effectiveCatalogId()
		const includeInactive = options?.includeInactive === true
		const readFeatures = await this.getReadFeatures(catalogId)

		if (includeInactive || !this.cacheTtlSec) {
			const products = await this.repo.findPopular(catalogId, includeInactive)
			return this.mapProductsWithVariantSummary(
				products,
				MEDIA_LIST_VARIANT_NAMES,
				catalogId,
				readFeatures
			)
		}

		const key = await this.buildCatalogPopularProductsCacheKey(
			catalogId,
			readFeatures
		)
		return this.withCache(
			key,
			async () => {
				const products = await this.repo.findPopular(catalogId, false)
				return this.mapProductsWithVariantSummary(
					products,
					MEDIA_LIST_VARIANT_NAMES,
					catalogId,
					readFeatures
				)
			},
			this.cacheTtlSec
		)
	}

	async getPopularCards(options?: ProductReadOptions) {
		const catalogId = effectiveCatalogId()
		const includeInactive = options?.includeInactive === true
		const readFeatures = await this.getReadFeatures(catalogId)

		if (includeInactive || !this.cacheTtlSec) {
			const products = await this.repo.findPopularCards(catalogId, includeInactive)
			return this.mapProductsWithVariantSummary(
				products,
				MEDIA_LIST_VARIANT_NAMES,
				catalogId,
				readFeatures
			)
		}

		const key = await this.buildCatalogPopularProductCardsCacheKey(
			catalogId,
			readFeatures
		)
		return this.withCache(
			key,
			async () => {
				const products = await this.repo.findPopularCards(catalogId, false)
				return this.mapProductsWithVariantSummary(
					products,
					MEDIA_LIST_VARIANT_NAMES,
					catalogId,
					readFeatures
				)
			},
			this.cacheTtlSec
		)
	}

	async getInfinite(
		query: Record<string, unknown>,
		options?: ProductReadOptions
	) {
		const catalogId = effectiveCatalogId()
		const typeId = mustTypeId()
		const includeInactive = options?.includeInactive === true
		const readFeatures = await this.getReadFeatures(catalogId)
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
			items: await this.loadInfiniteItems(
				pageRows,
				catalogId,
				includeInactive,
				readFeatures
			),
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
		const catalogId = effectiveCatalogId()
		const typeId = mustTypeId()
		const includeInactive = options?.includeInactive === true
		const readFeatures = await this.getReadFeatures(catalogId)
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
			items: await this.loadInfiniteItems(
				pageRows,
				catalogId,
				includeInactive,
				readFeatures
			),
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
		const catalogId = effectiveCatalogId()
		const includeInactive = options?.includeInactive === true
		const readFeatures = await this.getReadFeatures(catalogId)
		const parsed = parseProductInfiniteQuery(
			{ cursor: options?.cursor, limit: options?.limit },
			{
				defaultLimit: PRODUCT_INFINITE_DEFAULT_LIMIT,
				maxLimit: PRODUCT_INFINITE_MAX_LIMIT
			}
		)
		const cacheTtlSec = parsed.cursor
			? this.uncategorizedNextPageCacheTtlSec
			: this.uncategorizedFirstPageCacheTtlSec
		const key =
			!includeInactive && cacheTtlSec > 0
				? await this.buildUncategorizedProductsCacheKey(
						catalogId,
						parsed.cursor,
						parsed.limit,
						readFeatures
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
					items: await this.mapProductsWithVariantSummary(
						pageRows,
						MEDIA_LIST_VARIANT_NAMES,
						catalogId,
						readFeatures
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
		const catalogId = effectiveCatalogId()
		const includeInactive = options?.includeInactive === true
		const readFeatures = await this.getReadFeatures(catalogId)
		const parsed = parseProductInfiniteQuery(
			{ cursor: options?.cursor, limit: options?.limit },
			{
				defaultLimit: PRODUCT_INFINITE_DEFAULT_LIMIT,
				maxLimit: PRODUCT_INFINITE_MAX_LIMIT
			}
		)
		const cacheTtlSec = parsed.cursor
			? this.uncategorizedNextPageCacheTtlSec
			: this.uncategorizedFirstPageCacheTtlSec
		const key =
			!includeInactive && cacheTtlSec > 0
				? await this.buildUncategorizedProductCardsCacheKey(
						catalogId,
						parsed.cursor,
						parsed.limit,
						readFeatures
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
					items: await this.mapProductsWithVariantSummary(
						pageRows,
						MEDIA_LIST_VARIANT_NAMES,
						catalogId,
						readFeatures
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
		const catalogId = effectiveCatalogId()
		const readFeatures = await this.getReadFeatures(catalogId)
		const product =
			options?.includeVariantIntegration === true
				? await this.repo.findById(id, catalogId, options?.includeInactive === true)
				: await this.repo.findPublicById(
						id,
						catalogId,
						options?.includeInactive === true
					)
		if (!product) throw new NotFoundException('Товар не найден')
		return this.mapProductWithSeo(product, catalogId, readFeatures)
	}

	async getBySlug(slug: string, options?: ProductReadOptions) {
		const catalogId = effectiveCatalogId()
		const readFeatures = await this.getReadFeatures(catalogId)
		const normalizedSlug = normalizeSlug(slug)
		const product =
			options?.includeVariantIntegration === true
				? await this.repo.findBySlug(
						normalizedSlug,
						catalogId,
						options?.includeInactive === true
					)
				: await this.repo.findPublicBySlug(
						normalizedSlug,
						catalogId,
						options?.includeInactive === true
					)
		if (!product) throw new NotFoundException('Товар не найден')
		return this.mapProductWithSeo(product, catalogId, readFeatures)
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

	private getReadFeatures(catalogId: string): Promise<ProductReadFeatures> {
		return this.capabilities.getCurrentFeatures(catalogId)
	}

	private async buildVersionedCacheKey(
		scope: string,
		catalogId: string,
		parts: string[]
	): Promise<string> {
		const version = await this.cache.getVersion(scope, catalogId)
		return this.cache.buildKey([...parts, `v${version}`])
	}

	private buildCatalogProductsCacheKey(
		catalogId: string,
		readFeatures: ProductReadFeatures
	): Promise<string> {
		return this.buildVersionedCacheKey(PRODUCTS_CACHE_VERSION, catalogId, [
			'catalog',
			catalogId,
			'products',
			'list',
			this.buildReadFeaturesCachePart(readFeatures)
		])
	}

	private buildCatalogPopularProductsCacheKey(
		catalogId: string,
		readFeatures: ProductReadFeatures
	): Promise<string> {
		return this.buildVersionedCacheKey(PRODUCTS_CACHE_VERSION, catalogId, [
			'catalog',
			catalogId,
			'products',
			'popular',
			this.buildReadFeaturesCachePart(readFeatures)
		])
	}

	private buildCatalogPopularProductCardsCacheKey(
		catalogId: string,
		readFeatures: ProductReadFeatures
	): Promise<string> {
		return this.buildVersionedCacheKey(PRODUCTS_CACHE_VERSION, catalogId, [
			'catalog',
			catalogId,
			'products',
			'popular',
			'cards',
			this.buildReadFeaturesCachePart(readFeatures)
		])
	}

	private async buildInfiniteCardsCacheKey(
		catalogId: string,
		typeId: string,
		parsed: ParsedProductInfiniteQuery,
		seed: string | undefined,
		kind: 'catalog' | 'recommendations',
		readFeatures: ProductReadFeatures
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
			this.buildReadFeaturesCachePart(readFeatures),
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
			productTypeId: parsed.productTypeId ?? null,
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

	private buildReadFeaturesCachePart(features: ProductReadFeatures) {
		return [
			features.canUseProductTypes ? 'types-on' : 'types-off',
			features.canUseProductVariants ? 'variants-on' : 'variants-off',
			features.canUseCatalogSaleUnits ? 'sale-units-on' : 'sale-units-off',
			features.canUseMoySkladIntegration ? 'moysklad-on' : 'moysklad-off',
			features.canUseIikoIntegration ? 'iiko-on' : 'iiko-off'
		].join(':')
	}

	private buildUncategorizedProductsCacheKey(
		catalogId: string,
		cursor: string | undefined,
		limit: number,
		readFeatures: ProductReadFeatures
	): Promise<string> {
		return this.buildVersionedCacheKey(
			CATEGORY_PRODUCTS_CACHE_VERSION,
			catalogId,
			[
				'catalog',
				catalogId,
				'products',
				'uncategorized',
				'infinite',
				this.buildReadFeaturesCachePart(readFeatures),
				`limit-${limit}`,
				cursor ? `cursor-${encodeURIComponent(cursor)}` : 'cursor-first'
			]
		)
	}

	private buildUncategorizedProductCardsCacheKey(
		catalogId: string,
		cursor: string | undefined,
		limit: number,
		readFeatures: ProductReadFeatures
	): Promise<string> {
		return this.buildVersionedCacheKey(
			CATEGORY_PRODUCTS_CACHE_VERSION,
			catalogId,
			[
				'catalog',
				catalogId,
				'products',
				'uncategorized',
				'cards',
				'infinite',
				this.buildReadFeaturesCachePart(readFeatures),
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
			productTypeId: parsed.productTypeId,
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
		includeInactive = false,
		readFeatures: ProductReadFeatures
	) {
		const ids = rows.map(row => row.id)
		const products = await this.repo.findByIdsWithAttributes(
			ids,
			catalogId,
			includeInactive
		)
		const mapped = await this.mapProductsWithVariantSummary(
			products,
			MEDIA_LIST_VARIANT_NAMES,
			catalogId,
			readFeatures
		)
		const byId = new Map(mapped.map(product => [product.id, product] as const))
		return ids
			.map(id => byId.get(id))
			.filter((p): p is NonNullable<typeof p> => p !== undefined)
	}

	private async loadInfiniteCardItems(
		rows: ProductInfiniteRow[],
		catalogId: string,
		includeInactive = false,
		readFeatures: ProductReadFeatures
	) {
		const ids = rows.map(row => row.id)
		const products = await this.repo.findByIds(ids, catalogId, includeInactive)
		const mapped = await this.mapProductsWithVariantSummary(
			products,
			MEDIA_LIST_VARIANT_NAMES,
			catalogId,
			readFeatures
		)
		const byId = new Map(mapped.map(product => [product.id, product] as const))
		return ids
			.map(id => byId.get(id))
			.filter((p): p is NonNullable<typeof p> => p !== undefined)
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
		const meta: AttributeFilterMeta[] =
			await this.repo.findAttributesByTypeAndKeys(typeId, keys)
		const metaByKey = new Map(
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
			parsed.productTypeId !== undefined ||
			parsed.isPopular !== undefined ||
			parsed.isDiscount === true ||
			attributeFilters.length > 0
		)
	}

	private async mapProductWithSeo(
		product: ProductDetailsItem | ProductPublicDetailsItem,
		catalogId: string,
		readFeatures: ProductReadFeatures
	) {
		const seo = await this.seoRepo.findByEntity(
			catalogId,
			SeoEntityType.PRODUCT,
			product.id
		)
		const variantSources = product.variants as ProductVariantPickerSource[]
		const shouldExposeVariants = shouldExposeProductVariantsForProduct(
			readFeatures,
			product
		)
		const variantSummary = shouldExposeVariants
			? buildVariantSummaryFromVariants(variantSources)
			: { ...EMPTY_VARIANT_SUMMARY }
		const commercial = await this.resolveCommercialProjection(catalogId, product.id)
		const mappedProduct = applyProductCommercialFields(
			this.mapper.mapProduct(product, MEDIA_DETAIL_VARIANT_NAMES),
			commercial
		)

		return sanitizeProductForReadFeatures(
			{
				...mappedProduct,
				saleUnits: resolveProductSaleUnitsForRead(
					mappedProduct,
					{
						canUseCatalogSaleUnits: readFeatures.canUseCatalogSaleUnits,
						shouldExposeVariants
					}
				),
				variantSummary,
				variantPickerOptions: shouldExposeVariants
					? buildVariantPickerOptionsFromVariants(variantSources, variantSummary)
					: [],
				seo: this.mapSeo(seo)
			},
			readFeatures,
			shouldExposeVariants
		)
	}

	private async mapProductsWithVariantSummary<
		T extends ProductListMappableRecord
	>(
		products: T[],
		variantNames: readonly string[],
		catalogId: string,
		readFeatures: ProductReadFeatures
	) {
		if (!products.length) return []

		const productIds = products
			.filter(product =>
				shouldExposeProductVariantsForProduct(readFeatures, product)
			)
			.map(product => product.id)
		const summaryMap = productIds.length
			? await this.loadVariantSummaryMap(productIds)
			: new Map<string, ProductVariantSummary>()
		const variantPickerProductIds = productIds.filter(productId =>
			shouldBuildVariantPickerOptions(
				summaryMap.get(productId) ?? { ...EMPTY_VARIANT_SUMMARY }
			)
		)
		const variantPickerOptionsMap = variantPickerProductIds.length
			? await this.loadVariantPickerOptionsMap(variantPickerProductIds)
			: new Map<string, ProductVariantPickerOption[]>()
		const commercialMap = await this.resolveCommercialProjectionMap(
			catalogId,
			products
		)

		return products.map(product => {
			const shouldExposeVariants = shouldExposeProductVariantsForProduct(
				readFeatures,
				product
			)
			const variantSummary = shouldExposeVariants
				? (summaryMap.get(product.id) ?? { ...EMPTY_VARIANT_SUMMARY })
				: { ...EMPTY_VARIANT_SUMMARY }
			const mappedProduct = applyProductCommercialFields(
				this.mapper.mapProduct(product, variantNames),
				commercialMap.get(product.id)
			)
			const saleUnits = resolveProductSaleUnitsForRead(mappedProduct, {
				canUseCatalogSaleUnits: readFeatures.canUseCatalogSaleUnits,
				shouldExposeVariants
			})
			const mappedProductWithoutVariants = { ...mappedProduct } as typeof mappedProduct & {
				variants?: unknown
			}
			delete mappedProductWithoutVariants.variants

			return sanitizeProductForReadFeatures(
				{
					...mappedProductWithoutVariants,
					saleUnits,
					variantSummary,
					variantPickerOptions: variantPickerOptionsMap.get(product.id) ?? []
				},
				readFeatures,
				shouldExposeVariants
			)
		})
	}

	private async loadVariantSummaryMap(productIds: string[]) {
		const summaries = await this.repo.findVariantSummaries(productIds)
		return new Map(
			summaries.map(summary => {
				const { productId, ...rest } = summary
				return [productId, rest] as const
			})
		)
	}

	private async loadVariantPickerOptionsMap(productIds: string[]) {
		const variants = await this.repo.findVariantPickerOptions(productIds)
		const map = new Map<string, ProductVariantPickerOption[]>()

		for (const variant of variants.slice().sort(compareVariantPickerOptions)) {
			const options = map.get(variant.productId) ?? []
			options.push(mapVariantPickerOption(variant))
			map.set(variant.productId, options)
		}

		return map
	}

	private async resolveCommercialProjectionMap(
		catalogId: string,
		products: Array<{ id: string }>
	): Promise<Map<string, ProductCommercialFields>> {
		const projections = await this.sellableReader.resolveProductsSellable(
			catalogId,
			products.map(product => product.id)
		)
		return toProductCommercialFieldsMap(projections)
	}

	private async resolveCommercialProjection(
		catalogId: string,
		productId: string
	): Promise<ProductCommercialFields> {
		const projection = await this.sellableReader.resolveProductSellable(
			catalogId,
			productId
		)

		return toProductCommercialFields(projection)
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
		const catalogId = effectiveCatalogId()
		const typeId = mustTypeId()
		const includeInactive = options?.includeInactive === true
		const readFeatures = await this.getReadFeatures(catalogId)
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

		if (
			kind === 'recommendations' &&
			!this.hasRecommendationFilters(parsed, attributeFilters)
		) {
			return { items: [], nextCursor: null, seed: seed ?? null }
		}

		const key =
			!includeInactive && !parsed.cursor && this.cacheTtlSec > 0
				? await this.buildInfiniteCardsCacheKey(
						catalogId,
						typeId,
						parsed,
						seed,
						kind,
						readFeatures
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
					items: await this.loadInfiniteCardItems(
						pageRows,
						catalogId,
						includeInactive,
						readFeatures
					),
					nextCursor: this.buildInfiniteNextCursor(pageRows, hasMore, seed),
					seed: seed ?? null
				}
			},
			this.cacheTtlSec
		)
	}
}

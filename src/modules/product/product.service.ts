import { SeoEntityType } from '@generated/enums'
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
import {
	MEDIA_DETAIL_VARIANT_NAMES,
	MediaUrlService
} from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { ProductMediaMapper } from '@/shared/media/product-media.mapper'
import { mustCatalogId, mustTypeId } from '@/shared/tenancy/ctx'
import {
	assertHasUpdateFields,
	normalizeNullableTrimmedString,
	normalizeRequiredString
} from '@/shared/utils'

import { S3Service } from '../s3/s3.service'
import { SeoRepository } from '../seo/seo.repository'

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
	type ProductReadOptions,
	ProductReadService
} from './product-read.service'
import { ProductSeoSyncService } from './product-seo-sync.service'
import {
	ProductVariantBuilder,
	type ProductVariantData
} from './product-variant.builder'
import {
	type ProductDetailsItem,
	ProductRepository,
	type ProductVariantUpdateData
} from './product.repository'

type ProductSeoRecord = NonNullable<
	Awaited<ReturnType<SeoRepository['findByEntity']>>
>

type ProductSeoMapped = Omit<ProductSeoRecord, 'ogMedia' | 'twitterMedia'> & {
	ogMedia: MediaDto | null
	twitterMedia: MediaDto | null
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

const PRODUCT_NAME_MAX_LENGTH = 255
const SLUG_MAX_LENGTH = 255
const SKU_MAX_LENGTH = 100
const PRODUCT_SLUG_FALLBACK = 'product'
const PRODUCT_SKU_FALLBACK = 'SKU'
const PRODUCT_DUPLICATE_SUFFIX = ' (копия)'

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
	constructor(
		private readonly repo: ProductRepository,
		private readonly reads: ProductReadService,
		private readonly cache: CacheService,
		private readonly attributeBuilder: ProductAttributeBuilder,
		private readonly variantBuilder: ProductVariantBuilder,
		private readonly mediaRepo: MediaRepository,
		private readonly mediaUrl: MediaUrlService,
		private readonly mapper: ProductMediaMapper,
		private readonly s3Service: S3Service,
		private readonly productSeoSync: ProductSeoSyncService,
		private readonly seoRepo: SeoRepository
	) {}

	// ─── Read delegation ─────────────────────────────────────────────────────

	getAll(options?: ProductReadOptions) {
		return this.reads.getAll(options)
	}

	getPopular(options?: ProductReadOptions) {
		return this.reads.getPopular(options)
	}

	getPopularCards(options?: ProductReadOptions) {
		return this.reads.getPopularCards(options)
	}

	getInfinite(query: Record<string, unknown>, options?: ProductReadOptions) {
		return this.reads.getInfinite(query, options)
	}

	getInfiniteCards(
		query: Record<string, unknown>,
		options?: ProductReadOptions
	) {
		return this.reads.getInfiniteCards(query, options)
	}

	getRecommendationsInfinite(
		query: Record<string, unknown>,
		options?: ProductReadOptions
	) {
		return this.reads.getRecommendationsInfinite(query, options)
	}

	getRecommendationsInfiniteCards(
		query: Record<string, unknown>,
		options?: ProductReadOptions
	) {
		return this.reads.getRecommendationsInfiniteCards(query, options)
	}

	getUncategorizedInfinite(options?: {
		cursor?: string
		limit?: number | string
		includeInactive?: boolean
	}) {
		return this.reads.getUncategorizedInfinite(options)
	}

	getUncategorizedInfiniteCards(options?: {
		cursor?: string
		limit?: number | string
		includeInactive?: boolean
	}) {
		return this.reads.getUncategorizedInfiniteCards(options)
	}

	getById(id: string, options?: ProductReadOptions) {
		return this.reads.getById(id, options)
	}

	getBySlug(slug: string, options?: ProductReadOptions) {
		return this.reads.getBySlug(slug, options)
	}

	// ─── Write methods ───────────────────────────────────────────────────────

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
		if (!created) throw new NotFoundException('Товар не найден')
		await this.productSeoSync.syncProduct(created, catalogId)

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
			...(await this.mapProductWithSeo(created, catalogId))
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
		const duplicatedCategoryIds = [
			...new Set(
				source.categoryProducts
					.map(item => item.category?.id?.trim() ?? '')
					.filter(Boolean)
			)
		]
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
		await this.productSeoSync.syncProduct(duplicated, catalogId)

		await this.invalidateCatalogProductsCache(catalogId)
		await this.invalidateCategoryProductsCache(catalogId)
		return {
			ok: true,
			...(await this.mapProductWithSeo(duplicated, catalogId))
		}
	}

	async update(id: string, dto: UpdateProductDtoReq) {
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		const payload = await this.prepareUpdatePayload(id, dto, catalogId, typeId)

		const updated = await this.repo.update(
			id,
			payload.data,
			catalogId,
			payload.attributes,
			payload.removeAttributeIds,
			payload.variants,
			payload.mediaIds
		)
		if (!updated) throw new NotFoundException('Товар не найден')

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

		const product =
			payload.categoryIds !== undefined || payload.categoryId
				? await this.repo.findById(id, catalogId, true)
				: updated
		if (!product) throw new NotFoundException('Товар не найден')
		await this.productSeoSync.syncProduct(product, catalogId)

		await this.invalidateCatalogProductsCache(catalogId)
		await this.invalidateCategoryProductsCache(catalogId)
		return {
			ok: true,
			...(await this.mapProductWithSeo(product, catalogId))
		}
	}

	async toggleStatus(id: string) {
		const catalogId = mustCatalogId()
		const product = await this.repo.toggleStatus(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')
		await this.productSeoSync.syncProduct(product, catalogId)

		await this.invalidateCatalogProductsCache(catalogId)
		await this.invalidateCategoryProductsCache(catalogId)
		return {
			ok: true,
			...(await this.mapProductWithSeo(product, catalogId))
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
			...(await this.mapProductWithSeo(product, catalogId))
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

	async setVariants(id: string, dto: SetProductVariantsDtoReq) {
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()

		const product = await this.repo.findSkuById(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')

		const variantAttributeId = String(dto.variantAttributeId).trim()
		if (!variantAttributeId) {
			throw new BadRequestException('Поле variantAttributeId обязательно')
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
			{
				variantAttributeId,
				defaultPrice
			}
		)
		const hasCustomVariantValues = variants.some(variant =>
			variant.attributes.some(attribute => Boolean(attribute.value))
		)
		const updated = await this.repo.setVariants(id, catalogId, variants)
		if (!updated) throw new NotFoundException('Товар не найден')
		await this.productSeoSync.syncProduct(updated, catalogId)

		await this.invalidateCatalogProductsCache(catalogId)
		if (hasCustomVariantValues) {
			await this.cache.bumpVersion(CATALOG_TYPE_CACHE_VERSION, typeId)
		}
		return {
			ok: true,
			...(await this.mapProductWithSeo(updated, catalogId))
		}
	}

	async remove(id: string) {
		const catalogId = mustCatalogId()
		const product = await this.repo.softDelete(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')
		await this.productSeoSync.removeProduct(id, catalogId)

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
					orphanedMedia.map(m => m.id),
					catalogId
				)
			}
		}

		await this.invalidateCatalogProductsCache(catalogId)
		await this.invalidateCategoryProductsCache(catalogId)
		return { ok: true }
	}

	// ─── Prepare payloads ────────────────────────────────────────────────────

	private async prepareCreatePayload(
		dto: CreateProductDtoReq,
		catalogId: string,
		typeId: string
	): Promise<PreparedProductCreatePayload> {
		const { mediaIds, attributes, brandId, categories, variants, ...rest } = dto
		const normalizedName = normalizeRequiredString(dto.name, 'name')
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

	// ─── Validation helpers ──────────────────────────────────────────────────

	private normalizeMediaIds(value?: string[]): string[] {
		if (!value) return []
		const normalized = value.map(item => String(item).trim())
		if (normalized.some(item => item.length === 0)) {
			throw new BadRequestException('Поле mediaId не может быть пустым')
		}
		const unique = new Set(normalized)
		if (unique.size !== normalized.length) {
			throw new BadRequestException('Значения mediaId не должны повторяться')
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
			data.name = normalizedName
		}
		if (dto.price !== undefined) data.price = dto.price
		if (dto.isPopular !== undefined) data.isPopular = dto.isPopular
		if (dto.status !== undefined) data.status = dto.status
		if (dto.position !== undefined) data.position = dto.position
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
		if (dto.categoryPosition !== undefined && dto.categoryId === undefined) {
			throw new BadRequestException(
				'categoryPosition можно передать только вместе с categoryId'
			)
		}
		if (dto.categoryId === undefined) return undefined

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
		const found: Awaited<ReturnType<ProductRepository['findCategoriesByIds']>> =
			await this.repo.findCategoriesByIds(categoryIds, catalogId)
		const foundSet = new Set<string>(found.map((item: { id: string }) => item.id))
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
		await this.repo.prependProductToCategories(productId, catalogId, categoryIds)
	}

	private assertNoAttributeRemovalConflicts(
		attributes?: ProductAttributeValueData[],
		removeAttributeIds?: string[]
	): void {
		if (!attributes?.length || !removeAttributeIds?.length) return

		const updatedIds = new Set(attributes.map(a => a.attributeId))
		const conflicts = removeAttributeIds.filter(id => updatedIds.has(id))
		if (conflicts.length) {
			throw new BadRequestException(
				`Атрибуты нельзя одновременно обновлять и удалять: ${conflicts.join(', ')}`
			)
		}
	}

	// ─── Variant helpers ─────────────────────────────────────────────────────

	private async prepareCreateVariants(
		typeId: string,
		sku: string,
		variants: ProductVariantDtoReq[]
	): Promise<ProductVariantData[]> {
		return this.variantBuilder.build(typeId, variants, sku)
	}

	private prepareVariantUpdates(variants: ProductVariantUpdateDtoReq[]) {
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

	// ─── Slug / SKU generation ────────────────────────────────────────────────

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

	// ─── Duplicate helpers ───────────────────────────────────────────────────

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
			status: source.status,
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

	// ─── SEO helpers ─────────────────────────────────────────────────────────

	async mapProductWithSeo(product: ProductDetailsItem, catalogId: string) {
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

	async expireScheduledDiscounts(now = new Date()) {
		const expiredProducts = await this.repo.expireScheduledDiscounts(now)
		if (!expiredProducts.length) {
			return {
				updatedProducts: 0,
				affectedCatalogs: 0
			}
		}

		const productIdsByCatalog = new Map<string, string[]>()
		for (const item of expiredProducts) {
			const bucket = productIdsByCatalog.get(item.catalogId)
			if (bucket) {
				bucket.push(item.productId)
				continue
			}

			productIdsByCatalog.set(item.catalogId, [item.productId])
		}

		for (const catalogId of productIdsByCatalog.keys()) {
			await this.invalidateCatalogProductsCache(catalogId)
			await this.invalidateCategoryProductsCache(catalogId)
		}

		for (const [catalogId, productIds] of productIdsByCatalog) {
			const products = await this.repo.findByIdsWithDetails(productIds, catalogId)
			for (const product of products) {
				await this.productSeoSync.syncProduct(product, catalogId)
			}
		}

		return {
			updatedProducts: expiredProducts.length,
			affectedCatalogs: productIdsByCatalog.size
		}
	}

	async rebuildSeoForCatalog(catalogId: string) {
		const batchSize = 100
		let cursorId: string | undefined
		let rebuiltProducts = 0

		for (;;) {
			const productIds = await this.repo.findIdsByCatalog(
				catalogId,
				batchSize,
				cursorId
			)
			if (!productIds.length) break

			const products = await this.repo.findByIdsWithDetails(
				productIds.map(item => item.id),
				catalogId
			)
			for (const product of products) {
				await this.productSeoSync.syncProduct(product, catalogId)
			}

			rebuiltProducts += products.length
			cursorId = productIds[productIds.length - 1]?.id
			if (productIds.length < batchSize) break
		}

		return { rebuiltProducts }
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

	// ─── Media / S3 helpers ──────────────────────────────────────────────────

	private collectS3MediaKeys(
		media: Array<{
			key: string
			storage: string
			variants: { key: string; storage: string }[]
		}>
	): string[] {
		const keys = new Set<string>()
		for (const item of media) {
			if (item.storage === 's3' && item.key.trim()) keys.add(item.key.trim())
			for (const variant of item.variants) {
				if (variant.storage === 's3' && variant.key.trim())
					keys.add(variant.key.trim())
			}
		}
		return [...keys]
	}

	// ─── Cache invalidation ──────────────────────────────────────────────────

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

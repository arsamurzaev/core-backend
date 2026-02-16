﻿import { ProductCreateInput, ProductUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import { createHash } from 'crypto'
import slugify from 'slugify'

import { CacheService } from '@/shared/cache/cache.service'
import { CATALOG_TYPE_CACHE_VERSION } from '@/shared/cache/catalog-cache.constants'
import type { MediaDto } from '@/shared/media/dto/media.dto.res'
import { MediaRepository } from '@/shared/media/media.repository'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { mustCatalogId, mustTypeId } from '@/shared/tenancy/ctx'

import { CreateProductDtoReq } from './dto/requests/create-product.dto.req'
import { ProductVariantUpdateDtoReq } from './dto/requests/product-variant-update.dto.req'
import { SetProductVariantsDtoReq } from './dto/requests/set-product-variants.dto.req'
import { UpdateProductDtoReq } from './dto/requests/update-product.dto.req'
import { ProductAttributeBuilder } from './product-attribute.builder'
import { ProductVariantBuilder } from './product-variant.builder'
import { ProductRepository } from './product.repository'

type ProductMediaMapped<T> = Omit<T, 'media'> & {
	media: { position: number; kind?: string | null; media: MediaDto }[]
}

type ProductList = ProductMediaMapped<
	Awaited<ReturnType<ProductRepository['findAll']>>[number]
>[]
type PopularProductList = ProductMediaMapped<
	Awaited<ReturnType<ProductRepository['findPopular']>>[number]
>[]

const PRODUCTS_CACHE_TTL_SEC =
	Number(process.env.CATALOG_PRODUCTS_CACHE_TTL_SEC ?? 0) || 0
const PRODUCTS_CACHE_VERSION = 'products'
const SLUG_MAX_LENGTH = 255
const SKU_MAX_LENGTH = 100
const PRODUCT_SLUG_FALLBACK = 'product'
const PRODUCT_SKU_FALLBACK = 'SKU'

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
			return products.map(product => this.mapProductMedia(product))
		}

		const cacheKey = await this.buildCatalogProductsCacheKey(catalogId)
		const cached = await this.cache.getJson<ProductList>(cacheKey)
		if (cached !== null) return cached

		const products = await this.repo.findAll(catalogId)
		const mapped = products.map(product => this.mapProductMedia(product))
		await this.cache.setJson(cacheKey, mapped, this.cacheTtlSec)
		return mapped
	}

	async getPopular() {
		const catalogId = mustCatalogId()
		if (!this.cacheTtlSec) {
			const products = await this.repo.findPopular(catalogId)
			return products.map(product => this.mapProductMedia(product))
		}

		const cacheKey = await this.buildCatalogPopularProductsCacheKey(catalogId)
		const cached = await this.cache.getJson<PopularProductList>(cacheKey)
		if (cached !== null) return cached

		const products = await this.repo.findPopular(catalogId)
		const mapped = products.map(product => this.mapProductMedia(product))
		await this.cache.setJson(cacheKey, mapped, this.cacheTtlSec)
		return mapped
	}

	async getById(id: string) {
		const catalogId = mustCatalogId()
		const product = await this.repo.findById(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')
		return this.mapProductMedia(product)
	}

	async getBySlug(slug: string) {
		const catalogId = mustCatalogId()
		const product = await this.repo.findBySlug(normalizeSlug(slug), catalogId)
		if (!product) throw new NotFoundException('Товар не найден')
		return this.mapProductMedia(product)
	}

	async create(dto: CreateProductDtoReq) {
		const { mediaIds, attributes, ...rest } = dto
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		const resolvedSlug = await this.generateProductSlug(dto.name, catalogId)
		const resolvedSku = await this.generateProductSku(dto.name)

		const normalizedMediaIds = this.normalizeMediaIds(mediaIds)
		await this.ensureMediaIds(normalizedMediaIds, catalogId)

		const data: ProductCreateInput = {
			...rest,
			slug: resolvedSlug,
			sku: resolvedSku,
			catalog: { connect: { id: catalogId } },
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
		await this.invalidateCatalogProductsCache(catalogId)
		return { ok: true, id: product.id, slug: product.slug }
	}

	async update(id: string, dto: UpdateProductDtoReq) {
		const data: ProductUpdateInput = {}
		const mediaIds =
			dto.mediaIds !== undefined ? this.normalizeMediaIds(dto.mediaIds) : undefined

		if (dto.name !== undefined) {
			data.name = dto.name
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

		const hasAttributeChanges = dto.attributes !== undefined
		const hasVariantChanges = dto.variants !== undefined
		const hasMediaChanges = mediaIds !== undefined
		if (
			Object.keys(data).length === 0 &&
			!hasAttributeChanges &&
			!hasVariantChanges &&
			!hasMediaChanges
		) {
			throw new BadRequestException('Нет полей для обновления')
		}

		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
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

		await this.invalidateCatalogProductsCache(catalogId)
		return { ok: true, ...this.mapProductMedia(product) }
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
		return { ok: true, ...this.mapProductMedia(updated) }
	}

	async remove(id: string) {
		const catalogId = mustCatalogId()
		const product = await this.repo.softDelete(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')

		await this.invalidateCatalogProductsCache(catalogId)
		return { ok: true }
	}

	private mapProductMedia<T extends { media: { position: number; kind?: string | null; media: any }[] }>(
		product: T
	) {
		return {
			...product,
			media: (product.media ?? []).map(item => ({
				position: item.position,
				kind: item.kind ?? null,
				media: this.mediaUrl.mapMedia(item.media)
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
				throw new BadRequestException(
					`Дублирующийся ключ варианта: ${variantKey}`
				)
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

	private async ensureSlugAvailable(
		slug: string,
		catalogId: string,
		excludeId?: string
	): Promise<void> {
		const exists = await this.repo.existsSlug(slug, catalogId, excludeId)
		if (exists) {
			throw new BadRequestException('Слаг товара уже используется')
		}
	}

	private async ensureSkuAvailable(
		sku: string,
		excludeId?: string
	): Promise<void> {
		const exists = await this.repo.existsSku(sku, excludeId)
		if (exists) {
			throw new BadRequestException('SKU товара уже используется')
		}
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
		if (!this.cacheTtlSec) return
		await this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId)
	}
}

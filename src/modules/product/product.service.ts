import { ProductCreateInput, ProductUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { CacheService } from '@/shared/cache/cache.service'
import { mustCatalogId, mustTypeId } from '@/shared/tenancy/ctx'

import { CreateProductDtoReq } from './dto/requests/create-product.dto.req'
import { UpdateProductDtoReq } from './dto/requests/update-product.dto.req'
import { ProductAttributeBuilder } from './product-attribute.builder'
import { ProductRepository } from './product.repository'

type ProductList = Awaited<ReturnType<ProductRepository['findAll']>>

const PRODUCTS_CACHE_TTL_SEC =
	Number(process.env.CATALOG_PRODUCTS_CACHE_TTL_SEC ?? 0) || 0
const PRODUCTS_CACHE_VERSION = 'products'

function normalizeSlug(value: string): string {
	return value.trim().toLowerCase()
}

function normalizeSku(value: string): string {
	return value.trim()
}

@Injectable()
export class ProductService {
	private readonly cacheTtlSec = PRODUCTS_CACHE_TTL_SEC

	constructor(
		private readonly repo: ProductRepository,
		private readonly cache: CacheService,
		private readonly attributeBuilder: ProductAttributeBuilder
	) {}

	async getAll() {
		const catalogId = mustCatalogId()
		if (!this.cacheTtlSec) {
			return this.repo.findAll(catalogId)
		}

		const cacheKey = await this.buildCatalogProductsCacheKey(catalogId)
		const cached = await this.cache.getJson<ProductList>(cacheKey)
		if (cached !== null) return cached

		const products = await this.repo.findAll(catalogId)
		await this.cache.setJson(cacheKey, products, this.cacheTtlSec)
		return products
	}

	async getById(id: string) {
		const catalogId = mustCatalogId()
		const product = await this.repo.findById(id, catalogId)
		if (!product) throw new NotFoundException('Product not found')
		return product
	}

	async getBySlug(slug: string) {
		const catalogId = mustCatalogId()
		const product = await this.repo.findBySlug(normalizeSlug(slug), catalogId)
		if (!product) throw new NotFoundException('Product not found')
		return product
	}

	async create(dto: CreateProductDtoReq) {
		const { imagesUrls, slug, sku, attributes, ...rest } = dto
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()

		const data: ProductCreateInput = {
			...rest,
			slug: normalizeSlug(slug),
			sku: normalizeSku(sku),
			imagesUrls: imagesUrls ?? [],
			catalog: { connect: { id: catalogId } }
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

		if (dto.slug !== undefined) {
			data.slug = normalizeSlug(dto.slug)
		}
		if (dto.sku !== undefined) {
			data.sku = normalizeSku(dto.sku)
		}
		if (dto.name !== undefined) {
			data.name = dto.name
		}
		if (dto.price !== undefined) {
			data.price = dto.price
		}
		if (dto.imagesUrls !== undefined) {
			data.imagesUrls = dto.imagesUrls
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
		if (Object.keys(data).length === 0 && !hasAttributeChanges) {
			throw new BadRequestException('No fields to update')
		}

		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		const attributes = hasAttributeChanges
			? await this.attributeBuilder.buildForUpdate(typeId, dto.attributes ?? [])
			: undefined

		const product = await this.repo.update(id, data, catalogId, attributes)
		if (!product) throw new NotFoundException('Product not found')

		await this.invalidateCatalogProductsCache(catalogId)
		return product
	}

	async remove(id: string) {
		const catalogId = mustCatalogId()
		const product = await this.repo.softDelete(id, catalogId)
		if (!product) throw new NotFoundException('Product not found')

		await this.invalidateCatalogProductsCache(catalogId)
		return { ok: true }
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

	private async invalidateCatalogProductsCache(
		catalogId: string
	): Promise<void> {
		if (!this.cacheTtlSec) return
		await this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId)
	}
}

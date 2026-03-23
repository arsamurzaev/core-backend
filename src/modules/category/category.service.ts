import { CategoryCreateInput, CategoryUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { CacheService } from '@/shared/cache/cache.service'
import {
	CATEGORY_PRODUCTS_CACHE_VERSION,
	CATEGORY_PRODUCTS_FIRST_PAGE_CACHE_TTL_SEC,
	CATEGORY_PRODUCTS_NEXT_PAGE_CACHE_TTL_SEC
} from '@/shared/cache/catalog-cache.constants'
import type { MediaRecord } from '@/shared/media/media-url.service'
import {
	MEDIA_LIST_VARIANT_NAMES,
	MediaUrlService
} from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { ensureMediaInCatalog } from '@/shared/media/media.validation'
import { mustCatalogId } from '@/shared/tenancy/ctx'
import {
	assertHasUpdateFields,
	normalizeOptionalId,
	normalizeRequiredString
} from '@/shared/utils'

import {
	buildCategoryProductsPage,
	type CategoryProductInput,
	type CategoryProductsPage as CategoryProductsPagePayload,
	normalizeCategoryName,
	normalizeCategoryProducts,
	normalizeCategoryProductsLimit,
	resolveCategoryProductPositions
} from './category-products.utils'
import { CategoryRepository } from './category.repository'
import { CreateCategoryDtoReq } from './dto/requests/create-category.dto.req'
import { UpdateCategoryDtoReq } from './dto/requests/update-category.dto.req'

type CategoryProductsPage = CategoryProductsPagePayload<unknown>

@Injectable()
export class CategoryService {
	private readonly firstPageCacheTtlSec =
		CATEGORY_PRODUCTS_FIRST_PAGE_CACHE_TTL_SEC
	private readonly nextPageCacheTtlSec =
		CATEGORY_PRODUCTS_NEXT_PAGE_CACHE_TTL_SEC

	constructor(
		private readonly repo: CategoryRepository,
		private readonly cache: CacheService,
		private readonly mediaRepo: MediaRepository,
		private readonly mediaUrl: MediaUrlService
	) {}

	async getAll() {
		const catalogId = mustCatalogId()
		const categories = await this.repo.findAll(catalogId)
		return categories.map(category => this.mapCategory(category))
	}

	async getById(id: string) {
		const catalogId = mustCatalogId()
		const category = await this.repo.findById(id, catalogId, true)
		if (!category) throw new NotFoundException('Категория не найдена')
		return this.mapCategoryWithRelations(category)
	}

	async getProductsByCategory(
		id: string,
		options?: {
			cursor?: string
			limit?: number | string
			includeInactive?: boolean
		}
	) {
		const catalogId = mustCatalogId()
		const category = await this.repo.findById(id, catalogId)
		if (!category) throw new NotFoundException('Категория не найдена')

		const includeInactive = options?.includeInactive === true
		const limit = normalizeCategoryProductsLimit(options?.limit)
		const cursor = options?.cursor?.trim() || undefined
		const cacheTtlSec = cursor
			? this.nextPageCacheTtlSec
			: this.firstPageCacheTtlSec
		const cacheKey =
			!includeInactive && cacheTtlSec > 0
				? await this.buildCategoryProductsCacheKey(id, catalogId, cursor, limit)
				: undefined

		if (cacheKey) {
			const cached = await this.cache.getJson<CategoryProductsPage>(cacheKey)
			if (cached !== null) return cached
		}

		const items = await this.repo.findCategoryProductsPage(id, catalogId, {
			cursor,
			take: limit + 1,
			includeInactive
		})

		const page: CategoryProductsPage = buildCategoryProductsPage(
			items,
			limit,
			product => this.mapProductMedia(product)
		)

		if (cacheKey) {
			await this.cache.setJson(cacheKey, page, cacheTtlSec)
		}

		return page
	}

	async create(dto: CreateCategoryDtoReq) {
		const catalogId = mustCatalogId()
		const parentId = dto.parentId ?? null
		const imageMediaId = normalizeOptionalId(dto.imageMediaId)

		if (parentId) {
			const parent = await this.repo.findById(parentId, catalogId)
			if (!parent)
				throw new BadRequestException('Родительская категория не найдена')
		}

		const categoryProductsInput = await this.prepareCategoryProductsForWrite(
			catalogId,
			dto.products
		)

		if (imageMediaId) {
			await ensureMediaInCatalog(this.mediaRepo, imageMediaId, catalogId)
		}

		const data: CategoryCreateInput = {
			name: normalizeCategoryName(dto.name),
			descriptor: dto.descriptor ?? null,
			discount: dto.discount ?? null,
			position: dto.position ?? 0,
			catalog: { connect: { id: catalogId } },
			...(imageMediaId ? { imageMedia: { connect: { id: imageMediaId } } } : {})
		}

		if (parentId) {
			data.parent = { connect: { id: parentId } }
		}

		if (categoryProductsInput.length) {
			data.categoryProducts = {
				create: categoryProductsInput
			}
		}

		const category = await this.repo.create(data)
		if (categoryProductsInput.length) {
			await this.invalidateCategoryProductsCache(catalogId)
		}

		return category
	}

	async update(id: string, dto: UpdateCategoryDtoReq) {
		const catalogId = mustCatalogId()
		const data: CategoryUpdateInput = {}
		const hasProductChanges = dto.products !== undefined

		if (dto.name !== undefined) {
			data.name = normalizeCategoryName(dto.name)
		}
		if (dto.imageMediaId !== undefined) {
			const imageMediaId = normalizeRequiredString(
				dto.imageMediaId,
				'imageMediaId'
			)
			await ensureMediaInCatalog(this.mediaRepo, imageMediaId, catalogId)
			data.imageMedia = { connect: { id: imageMediaId } }
		}
		if (dto.descriptor !== undefined) {
			data.descriptor = dto.descriptor ?? null
		}
		if (dto.discount !== undefined) {
			data.discount = dto.discount ?? null
		}
		if (dto.position !== undefined) {
			data.position = dto.position
		}

		if (dto.parentId !== undefined) {
			if (dto.parentId === null) {
				data.parent = { disconnect: true }
			} else {
				if (dto.parentId === id) {
					throw new BadRequestException(
						'Категория не может быть сама себе родителем'
					)
				}
				const parent = await this.repo.findById(dto.parentId, catalogId)
				if (!parent)
					throw new BadRequestException('Родительская категория не найдена')
				data.parent = { connect: { id: dto.parentId } }
			}
		}

		if (hasProductChanges) {
			const categoryProductsInput = await this.prepareCategoryProductsForWrite(
				catalogId,
				dto.products,
				id
			)
			const categoryProducts = { deleteMany: {} } as NonNullable<
				CategoryUpdateInput['categoryProducts']
			>
			if (categoryProductsInput.length) {
				categoryProducts.create = categoryProductsInput
			}
			data.categoryProducts = categoryProducts
		}

		assertHasUpdateFields(data)

		const category = await this.repo.update(id, catalogId, data)
		if (!category) throw new NotFoundException('Категория не найдена')

		const mapped = this.mapCategoryWithRelations(category)
		if (hasProductChanges) {
			await this.invalidateCategoryProductsCache(catalogId)
		}

		return mapped
	}

	async remove(id: string) {
		const catalogId = mustCatalogId()
		const category = await this.repo.softDelete(id, catalogId)
		if (!category) throw new NotFoundException('Категория не найдена')

		await this.invalidateCategoryProductsCache(catalogId)
		return { ok: true }
	}

	private mapCategory<T extends { imageMedia?: MediaRecord | null }>(
		category: T
	) {
		return {
			...category,
			imageMedia: category.imageMedia
				? this.mediaUrl.mapMedia(category.imageMedia)
				: null
		}
	}

	private mapCategoryWithRelations(category: {
		imageMedia?: MediaRecord | null
		children?: { imageMedia?: MediaRecord | null }[]
	}) {
		return {
			...this.mapCategory(category),
			children: (category.children ?? []).map(child => this.mapCategory(child))
		}
	}

	private mapProductMedia<
		T extends {
			media: { position: number; kind?: string | null; media: MediaRecord }[]
		}
	>(product: T) {
		return {
			...product,
			media: (product.media ?? []).map(item => ({
				position: item.position,
				kind: item.kind ?? null,
				media: this.mediaUrl.mapMedia(item.media, {
					variantNames: MEDIA_LIST_VARIANT_NAMES
				})
			}))
		}
	}

	private async prepareCategoryProductsForWrite(
		catalogId: string,
		products?: CategoryProductInput[],
		categoryId?: string
	): Promise<
		{
			product: { connect: { id: string } }
			position: number
		}[]
	> {
		const normalizedProducts = normalizeCategoryProducts(products)
		const productIds = normalizedProducts.map(product => product.productId)
		const validProductIds = await this.ensureProductsInCatalog(
			productIds,
			catalogId
		)
		if (!validProductIds.length) return []

		const existingPositionById = categoryId
			? await this.getExistingCategoryProductPositionMap(
					categoryId,
					catalogId,
					validProductIds
				)
			: undefined
		const positionById = new Map(
			resolveCategoryProductPositions(normalizedProducts, existingPositionById)
		)

		return validProductIds.map(productId => ({
			product: { connect: { id: productId } },
			position: positionById.get(productId) ?? 0
		}))
	}

	private async getExistingCategoryProductPositionMap(
		categoryId: string,
		catalogId: string,
		productIds: string[]
	): Promise<Map<string, number>> {
		const existingCategoryProducts = await this.repo.findCategoryProductPositions(
			categoryId,
			catalogId,
			productIds
		)
		return new Map(
			existingCategoryProducts.map(item => [item.productId, item.position])
		)
	}

	private async ensureProductsInCatalog(
		productIds: string[],
		catalogId: string
	): Promise<string[]> {
		if (!productIds.length) return []
		const products = await this.repo.findProductsByIds(productIds, catalogId)
		const found = new Set(products.map(product => product.id))
		const missing = productIds.filter(id => !found.has(id))
		if (missing.length) {
			throw new BadRequestException(
				`Товары не найдены в каталоге: ${missing.join(', ')}`
			)
		}
		return productIds
	}

	private async buildCategoryProductsCacheKey(
		categoryId: string,
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
			'category',
			categoryId,
			'products',
			'infinite',
			`limit-${limit}`,
			cursor ? `cursor-${encodeURIComponent(cursor)}` : 'cursor-first',
			`v${version}`
		])
	}

	private async invalidateCategoryProductsCache(catalogId: string) {
		await this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId)
	}
}

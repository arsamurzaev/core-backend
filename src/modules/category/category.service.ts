import { CategoryCreateInput, CategoryUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { CacheService } from '@/shared/cache/cache.service'
import {
	CATEGORY_LIST_CACHE_TTL_SEC,
	CATEGORY_LIST_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	CATEGORY_PRODUCTS_FIRST_PAGE_CACHE_TTL_SEC,
	CATEGORY_PRODUCTS_NEXT_PAGE_CACHE_TTL_SEC
} from '@/shared/cache/catalog-cache.constants'
import type { MediaDto } from '@/shared/media/dto/media.dto.res'
import type { MediaRecord } from '@/shared/media/media-url.service'
import {
	MEDIA_LIST_VARIANT_NAMES,
	MediaUrlService
} from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { ensureMediaInCatalog } from '@/shared/media/media.validation'
import {
	type ProductMappableRecord,
	ProductMediaMapper
} from '@/shared/media/product-media.mapper'
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
import { UpdateCategoryPositionDtoReq } from './dto/requests/update-category-position.dto.req'
import { UpdateCategoryDtoReq } from './dto/requests/update-category.dto.req'

type CategoryProductsPage = CategoryProductsPagePayload<unknown>
type CategoryOrderItem = Awaited<
	ReturnType<CategoryRepository['findAll']>
>[number]

@Injectable()
export class CategoryService {
	private readonly listCacheTtlSec = CATEGORY_LIST_CACHE_TTL_SEC
	private readonly firstPageCacheTtlSec =
		CATEGORY_PRODUCTS_FIRST_PAGE_CACHE_TTL_SEC
	private readonly nextPageCacheTtlSec =
		CATEGORY_PRODUCTS_NEXT_PAGE_CACHE_TTL_SEC

	constructor(
		private readonly repo: CategoryRepository,
		private readonly cache: CacheService,
		private readonly mediaRepo: MediaRepository,
		private readonly mediaUrl: MediaUrlService,
		private readonly productMapper: ProductMediaMapper
	) {}

	async getAll() {
		const catalogId = mustCatalogId()
		const cacheKey =
			this.listCacheTtlSec > 0
				? await this.buildCategoryListCacheKey(catalogId)
				: undefined

		if (cacheKey) {
			const cached = await this.cache.getJson<CategoryListResponse>(cacheKey)
			if (cached !== null) return cached
		}

		const categories = await this.repo.findAll(catalogId)
		const mapped = this.normalizeCategoryListForRead(categories).map(category =>
			this.mapCategory(category)
		)

		if (cacheKey) {
			await this.cache.setJson(cacheKey, mapped, this.listCacheTtlSec)
		}

		return mapped
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

	async getProductCardsByCategory(
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
				? await this.buildCategoryProductCardsCacheKey(id, catalogId, cursor, limit)
				: undefined

		if (cacheKey) {
			const cached = await this.cache.getJson<CategoryProductsPage>(cacheKey)
			if (cached !== null) return cached
		}

		const items = await this.repo.findCategoryProductCardsPage(id, catalogId, {
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

		const created = await this.repo.create(data)
		await this.rebuildCategoryPositions(catalogId, {
			targetId: created.id,
			targetPosition: dto.position ?? 0
		})
		const category = await this.repo.findById(created.id, catalogId)
		await this.invalidateCategoryListCache(catalogId)
		if (categoryProductsInput.length) {
			await this.invalidateCategoryProductsCache(catalogId)
		}

		return this.mapCategory(category ?? created)
	}

	async update(id: string, dto: UpdateCategoryDtoReq) {
		const catalogId = mustCatalogId()
		const existing = await this.repo.findById(id, catalogId)
		if (!existing) throw new NotFoundException('Категория не найдена')

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

		const shouldRebuildPositions =
			dto.position !== undefined || dto.parentId !== undefined
		const hasDataChanges = Object.keys(data).length > 0

		if (!hasDataChanges && !hasProductChanges && !shouldRebuildPositions) {
			assertHasUpdateFields(data)
		}

		let category =
			hasDataChanges || hasProductChanges
				? await this.repo.update(id, catalogId, data)
				: null
		if ((hasDataChanges || hasProductChanges) && !category) {
			throw new NotFoundException('Категория не найдена')
		}

		if (shouldRebuildPositions) {
			await this.rebuildCategoryPositions(catalogId, {
				targetId: id,
				targetPosition: dto.position ?? existing.position
			})
			category = await this.repo.findById(id, catalogId, true)
			if (!category) throw new NotFoundException('Категория не найдена')
		} else if (!category) {
			category = await this.repo.findById(id, catalogId, true)
			if (!category) throw new NotFoundException('Категория не найдена')
		}

		const mapped = this.mapCategoryWithRelations(category)
		await this.invalidateCategoryListCache(catalogId)
		if (hasProductChanges) {
			await this.invalidateCategoryProductsCache(catalogId)
		}

		return mapped
	}

	async updatePosition(id: string, dto: UpdateCategoryPositionDtoReq) {
		return this.update(id, { position: dto.position })
	}

	async remove(id: string) {
		const catalogId = mustCatalogId()
		const categoryToRemove = await this.repo.findById(id, catalogId)
		if (!categoryToRemove) throw new NotFoundException('Категория не найдена')

		const category = await this.repo.softDelete(id, catalogId)
		if (!category) throw new NotFoundException('Категория не найдена')
		await this.rebuildCategoryPositions(catalogId)

		await this.invalidateCategoryListCache(catalogId)
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

	private normalizeCategoryListForRead(categories: CategoryOrderItem[]) {
		return this.getOrderedCategories(categories).map((category, index) =>
			category.position === index
				? category
				: {
						...category,
						position: index
					}
		)
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

	private mapProductMedia<T extends ProductMappableRecord>(product: T) {
		return this.productMapper.mapProduct(product, MEDIA_LIST_VARIANT_NAMES)
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

	private async buildCategoryProductCardsCacheKey(
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
			'cards',
			'infinite',
			`limit-${limit}`,
			cursor ? `cursor-${encodeURIComponent(cursor)}` : 'cursor-first',
			`v${version}`
		])
	}

	private async buildCategoryListCacheKey(catalogId: string): Promise<string> {
		const version = await this.cache.getVersion(
			CATEGORY_LIST_CACHE_VERSION,
			catalogId
		)
		return this.cache.buildKey([
			'catalog',
			catalogId,
			'category',
			'list',
			`v${version}`
		])
	}

	private async invalidateCategoryListCache(catalogId: string) {
		await this.cache.bumpVersion(CATEGORY_LIST_CACHE_VERSION, catalogId)
	}

	private async invalidateCategoryProductsCache(catalogId: string) {
		await this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId)
	}

	private async rebuildCategoryPositions(
		catalogId: string,
		params: {
			targetId?: string
			targetPosition?: number
		} = {}
	) {
		const categories = await this.repo.findAll(catalogId)
		const updates = this.buildCategoryPositionUpdates(categories, {
			targetId: params.targetId,
			targetPosition: params.targetPosition
		})
		const changed = await this.persistCategoryPositionUpdates(categories, updates)
		if (!changed.length) return categories
		return this.repo.findAll(catalogId)
	}

	private buildCategoryPositionUpdates(
		categories: CategoryOrderItem[],
		options?: {
			targetId?: string
			targetPosition?: number
		}
	) {
		const ordered = this.getOrderedCategories(categories)
		if (!ordered.length) return []

		if (options?.targetId) {
			const targetIndex = ordered.findIndex(
				category => category.id === options.targetId
			)
			if (targetIndex !== -1) {
				const [target] = ordered.splice(targetIndex, 1)
				const boundedPosition = this.normalizeCategoryTargetPosition(
					options.targetPosition,
					ordered.length
				)
				ordered.splice(boundedPosition, 0, target)
			}
		}

		return ordered.map((category, index) => ({
			id: category.id,
			position: index
		}))
	}

	private getOrderedCategories(categories: CategoryOrderItem[]) {
		return [...categories].sort((left, right) => {
			if (left.position !== right.position) {
				return left.position - right.position
			}
			return (
				left.name.localeCompare(right.name, 'ru') || left.id.localeCompare(right.id)
			)
		})
	}

	private normalizeCategoryTargetPosition(
		position: number | undefined,
		maxPosition: number
	) {
		if (position === undefined || !Number.isInteger(position) || position < 0) {
			return 0
		}
		return Math.min(position, maxPosition)
	}

	private async persistCategoryPositionUpdates(
		categories: CategoryOrderItem[],
		updates: { id: string; position: number }[]
	) {
		const currentPositionById = new Map(
			categories.map(category => [category.id, category.position])
		)
		const uniqueUpdates = new Map<string, number>()
		for (const update of updates) {
			uniqueUpdates.set(update.id, update.position)
		}

		const changed = [...uniqueUpdates.entries()]
			.map(([id, position]) => ({ id, position }))
			.filter(update => currentPositionById.get(update.id) !== update.position)

		if (!changed.length) return []
		await this.repo.updatePositions(changed)
		return changed
	}
}

type CategoryListResponse = Array<
	Omit<CategoryOrderItem, 'imageMedia'> & { imageMedia: MediaDto | null }
>

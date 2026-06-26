import { CategoryCreateInput, CategoryUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Inject,
	Injectable,
	NotFoundException,
	Optional
} from '@nestjs/common'

import {
	CAPABILITY_READER_PORT,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'
import {
	PRODUCT_CATEGORY_READ_PROJECTOR_PORT,
	PRODUCT_COMMAND_PORT,
	type ProductCategoryReadProjectorPort,
	type ProductCommandPort
} from '@/modules/product/public'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATEGORY_LIST_CACHE_TTL_SEC,
	CATEGORY_LIST_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	CATEGORY_PRODUCTS_FIRST_PAGE_CACHE_TTL_SEC,
	CATEGORY_PRODUCTS_NEXT_PAGE_CACHE_TTL_SEC
} from '@/shared/cache/catalog-cache.constants'
import { createDomainEvent } from '@/shared/domain-events/domain-event.utils'
import {
	DOMAIN_EVENT_DISPATCHER,
	type DomainEventDispatcher
} from '@/shared/domain-events/domain-events.contract'
import type { MediaRecord } from '@/shared/media/media-url.service'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { ensureMediaInCatalog } from '@/shared/media/media.validation'
import type { ProductMappableRecord } from '@/shared/media/product-media.mapper'
import {
	assertCurrentCatalogCanManageCatalogContent,
	ctx,
	effectiveCatalogId,
	mustCatalogId
} from '@/shared/tenancy/ctx'
import {
	assertHasUpdateFields,
	normalizeOptionalId,
	normalizeRequiredString
} from '@/shared/utils'

import {
	type CategoryProductInput,
	type CategoryProductsPageItem,
	encodeCategoryProductsCursor,
	normalizeCategoryName,
	normalizeCategoryProducts,
	normalizeCategoryProductsLimit,
	resolveCategoryProductPositions
} from './category-products.utils'
import { CategoryRepository } from './category.repository'
import type {
	CategoryCommandPort,
	CategoryListOptions,
	CategoryProductsReadOptions,
	CategoryProductsReadPage,
	CategoryReaderPort,
	CategoryReadItem,
	CategoryRemoveOptions
} from './contracts'
import { CreateCategoryDtoReq } from './dto/requests/create-category.dto.req'
import { UpdateCategoryPositionDtoReq } from './dto/requests/update-category-position.dto.req'
import { UpdateCategoryPositionsDtoReq } from './dto/requests/update-category-positions.dto.req'
import { UpdateCategoryDtoReq } from './dto/requests/update-category.dto.req'

type CategoryOrderItem = Awaited<
	ReturnType<CategoryRepository['findAll']>
>[number]
type CategoryProductRef = Awaited<
	ReturnType<CategoryRepository['findCategoryProductRefs']>
>[number]
type CategoryProductsReadMode = {
	applyPriceList: boolean
	canUseCatalogPriceLists: boolean
	canUseCatalogSaleUnits: boolean
	enforcePriceListVisibility: boolean
}

@Injectable()
export class CategoryService
	implements CategoryReaderPort, CategoryCommandPort
{
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
		@Inject(PRODUCT_COMMAND_PORT)
		private readonly productCommands: ProductCommandPort,
		@Inject(PRODUCT_CATEGORY_READ_PROJECTOR_PORT)
		private readonly productCategoryReads: ProductCategoryReadProjectorPort,
		@Optional()
		@Inject(CAPABILITY_READER_PORT)
		private readonly capabilities?: CapabilityReaderPort,
		@Optional()
		@Inject(DOMAIN_EVENT_DISPATCHER)
		private readonly events?: DomainEventDispatcher
	) {}

	async getAll(options: CategoryListOptions = {}) {
		const catalogId = effectiveCatalogId()
		const includeEmpty = options.includeEmpty !== false
		const includeInactive = options.includeInactive === true
		const buyerCatalogId = mustCatalogId()
		const enforcePriceListVisibility = this.shouldEnforcePriceListVisibility({
			includeInactive
		})
		const canUseCatalogPriceLists =
			await this.canUseCatalogPriceLists(buyerCatalogId)
		const canUseCatalogSaleUnits =
			await this.canUseCatalogSaleUnits(buyerCatalogId)
		const cacheKey =
			this.listCacheTtlSec > 0
				? await this.buildCategoryListCacheKey(catalogId, {
						includeEmpty,
						includeInactive,
						readMode: {
							applyPriceList: true,
							canUseCatalogPriceLists,
							canUseCatalogSaleUnits,
							enforcePriceListVisibility
						}
					})
				: undefined

		if (cacheKey) {
			const cached = await this.cache.getJson<CategoryListResponse>(cacheKey)
			if (cached !== null) return cached
		}

		const categories = await this.repo.findAll(catalogId, { includeInactive })
		const orderedCategories = this.normalizeCategoryListForRead(categories)
		const productCountOverrides = await this.resolveCategoryProductCountOverrides(
			{
				catalogId,
				buyerCatalogId,
				categories: orderedCategories,
				includeInactive,
				enforcePriceListVisibility
			}
		)
		const mapped = orderedCategories
			.map(category =>
				this.mapCategory(category, productCountOverrides?.get(category.id))
			)
			.filter(category => includeEmpty || category.productCount > 0)

		if (cacheKey) {
			await this.cache.setJson(cacheKey, mapped, this.listCacheTtlSec)
		}

		return mapped
	}

	async getById(id: string) {
		const catalogId = effectiveCatalogId()
		const category = await this.repo.findById(id, catalogId, true)
		if (!category) throw new NotFoundException('Категория не найдена')
		return this.mapCategoryWithRelations(category)
	}

	async getProductsByCategory(
		id: string,
		options?: CategoryProductsReadOptions
	) {
		const catalogId = effectiveCatalogId()
		const category = await this.repo.findById(id, catalogId)
		if (!category) throw new NotFoundException('Категория не найдена')

		const includeInactive = options?.includeInactive === true
		const limit = normalizeCategoryProductsLimit(options?.limit)
		const cursor = options?.cursor?.trim() || undefined
		const cacheTtlSec = cursor
			? this.nextPageCacheTtlSec
			: this.firstPageCacheTtlSec
		const applyPriceList = this.shouldApplyPriceList(options)
		const enforcePriceListVisibility =
			this.shouldEnforcePriceListVisibility(options)
		const buyerCatalogId = mustCatalogId()
		const canUseCatalogPriceLists =
			await this.canUseCatalogPriceLists(buyerCatalogId)
		const canUseCatalogSaleUnits =
			await this.canUseCatalogSaleUnits(buyerCatalogId)
		const cacheKey =
			!includeInactive && cacheTtlSec > 0
				? await this.buildCategoryProductsCacheKey(id, catalogId, cursor, limit, {
						applyPriceList,
						canUseCatalogPriceLists,
						canUseCatalogSaleUnits,
						enforcePriceListVisibility
					})
				: undefined

		if (cacheKey) {
			const cached = await this.cache.getJson<CategoryProductsReadPage>(cacheKey)
			if (cached !== null) return cached
		}

		const page = await this.loadVisibleCategoryProductsPage({
			catalogId,
			buyerCatalogId,
			canUseCatalogSaleUnits,
			cursor,
			includeInactive,
			limit,
			applyPriceList,
			enforcePriceListVisibility,
			loadItems: (pageCursor, take) =>
				this.repo.findCategoryProductsPage(id, catalogId, {
					cursor: pageCursor,
					take,
					includeInactive
				})
		})

		if (cacheKey) {
			await this.cache.setJson(cacheKey, page, cacheTtlSec)
		}

		return page
	}

	async getProductCardsByCategory(
		id: string,
		options?: CategoryProductsReadOptions
	) {
		const catalogId = effectiveCatalogId()
		const category = await this.repo.findById(id, catalogId)
		if (!category) throw new NotFoundException('Категория не найдена')

		const includeInactive = options?.includeInactive === true
		const limit = normalizeCategoryProductsLimit(options?.limit)
		const cursor = options?.cursor?.trim() || undefined
		const cacheTtlSec = cursor
			? this.nextPageCacheTtlSec
			: this.firstPageCacheTtlSec
		const applyPriceList = this.shouldApplyPriceList(options)
		const enforcePriceListVisibility =
			this.shouldEnforcePriceListVisibility(options)
		const buyerCatalogId = mustCatalogId()
		const canUseCatalogPriceLists =
			await this.canUseCatalogPriceLists(buyerCatalogId)
		const canUseCatalogSaleUnits =
			await this.canUseCatalogSaleUnits(buyerCatalogId)
		const cacheKey =
			!includeInactive && cacheTtlSec > 0
				? await this.buildCategoryProductCardsCacheKey(
						id,
						catalogId,
						cursor,
						limit,
						{
							applyPriceList,
							canUseCatalogPriceLists,
							canUseCatalogSaleUnits,
							enforcePriceListVisibility
						}
					)
				: undefined

		if (cacheKey) {
			const cached = await this.cache.getJson<CategoryProductsReadPage>(cacheKey)
			if (cached !== null) return cached
		}

		const page = await this.loadVisibleCategoryProductsPage({
			catalogId,
			buyerCatalogId,
			canUseCatalogSaleUnits,
			cursor,
			includeInactive,
			limit,
			applyPriceList,
			enforcePriceListVisibility,
			loadItems: (pageCursor, take) =>
				this.repo.findCategoryProductCardsPage(id, catalogId, {
					cursor: pageCursor,
					take,
					includeInactive
				})
		})

		if (cacheKey) {
			await this.cache.setJson(cacheKey, page, cacheTtlSec)
		}

		return page
	}

	async create(dto: CreateCategoryDtoReq) {
		assertCurrentCatalogCanManageCatalogContent()
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
		assertCurrentCatalogCanManageCatalogContent()
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

	async updatePositions(dto: UpdateCategoryPositionsDtoReq) {
		assertCurrentCatalogCanManageCatalogContent()
		const catalogId = mustCatalogId()
		const categories = await this.repo.findAll(catalogId)
		const categoryById = new Map(
			categories.map(category => [category.id, category])
		)
		const seenIds = new Set<string>()

		for (const category of dto.categories) {
			if (seenIds.has(category.id)) {
				throw new BadRequestException('Список категорий содержит дубликаты')
			}
			if (!categoryById.has(category.id)) {
				throw new BadRequestException('Категория не найдена в текущем каталоге')
			}
			seenIds.add(category.id)
		}

		const requestedOrder = [...dto.categories]
			.sort((left, right) => left.position - right.position)
			.map(category => category.id)
		const requestedIds = new Set(requestedOrder)
		const orderedCategories = this.getOrderedCategories(categories)
		const missingIds = orderedCategories
			.map(category => category.id)
			.filter(id => !requestedIds.has(id))

		const finalIds = [...requestedOrder, ...missingIds]
		const updates = finalIds.map((id, position) => ({ id, position }))
		const changed = await this.persistCategoryPositionUpdates(categories, updates)

		if (changed.length) {
			await this.invalidateCategoryListCache(catalogId)
		}

		return this.getAll()
	}

	async remove(id: string, options: CategoryRemoveOptions = {}) {
		assertCurrentCatalogCanManageCatalogContent()
		const catalogId = mustCatalogId()
		const categoryToRemove = await this.repo.findById(id, catalogId)
		if (!categoryToRemove) throw new NotFoundException('Категория не найдена')

		if (options.deleteProducts) {
			const productIds = await this.repo.findProductIdsByCategory(id, catalogId)
			for (const productId of productIds) {
				await this.productCommands.remove(productId)
			}
		}

		const category = await this.repo.softDelete(id, catalogId)
		if (!category) throw new NotFoundException('Категория не найдена')
		await this.rebuildCategoryPositions(catalogId)

		await this.invalidateCategoryListCache(catalogId)
		await this.invalidateCategoryProductsCache(catalogId)
		return { ok: true }
	}

	private mapCategory<
		T extends {
			id?: string
			_count?: { categoryProducts?: number }
			imageMedia?: MediaRecord | null
		}
	>(category: T, productCountOverride?: number) {
		const { _count, ...rest } = category

		return {
			...rest,
			productCount: productCountOverride ?? _count?.categoryProducts ?? 0,
			imageMedia: category.imageMedia
				? this.mediaUrl.mapMedia(category.imageMedia)
				: null
		}
	}

	private async resolveCategoryProductCountOverrides(params: {
		catalogId: string
		buyerCatalogId: string
		categories: CategoryOrderItem[]
		includeInactive: boolean
		enforcePriceListVisibility: boolean
	}): Promise<Map<string, number> | null> {
		if (!params.enforcePriceListVisibility) return null

		const activePriceListVisibility =
			await this.productCategoryReads.resolveVisibleCategoryProductIds({
				catalogId: params.catalogId,
				buyerCatalogId: params.buyerCatalogId,
				productIds: []
			})
		if (activePriceListVisibility === null) return null

		const categoryIds = params.categories.map(category => category.id)
		const refs = await this.repo.findCategoryProductRefs(
			params.catalogId,
			categoryIds,
			{ includeInactive: params.includeInactive }
		)
		const visibleProductIds =
			await this.productCategoryReads.resolveVisibleCategoryProductIds({
				catalogId: params.catalogId,
				buyerCatalogId: params.buyerCatalogId,
				productIds: refs.map(ref => ref.productId)
			})
		if (visibleProductIds === null) return null

		return this.countVisibleCategoryProducts(params, refs, visibleProductIds)
	}

	private countVisibleCategoryProducts(
		params: {
			categories: CategoryOrderItem[]
		},
		refs: CategoryProductRef[],
		visibleProductIds: ReadonlySet<string>
	): Map<string, number> {
		const counts = new Map<string, number>(
			params.categories.map(category => [category.id, 0] as const)
		)

		for (const ref of refs) {
			if (!visibleProductIds.has(ref.productId)) continue
			counts.set(ref.categoryId, (counts.get(ref.categoryId) ?? 0) + 1)
		}

		return counts
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

	private async loadVisibleCategoryProductsPage<
		T extends ProductMappableRecord & { id: string; price?: unknown }
	>(params: {
		catalogId: string
		buyerCatalogId: string
		canUseCatalogSaleUnits: boolean
		cursor: string | undefined
		includeInactive: boolean
		limit: number
		applyPriceList: boolean
		enforcePriceListVisibility: boolean
		loadItems: (
			cursor: string | undefined,
			take: number
		) => Promise<CategoryProductsPageItem<T>[]>
	}): Promise<CategoryProductsReadPage> {
		const take = params.limit + 1
		const visibleItems: CategoryProductsReadPage['items'] = []
		let cursor = params.cursor
		let nextCursor: string | null = null

		while (visibleItems.length <= params.limit) {
			const items = await params.loadItems(cursor, take)
			if (!items.length) break

			const mappedItems = await this.mapCategoryProductItems({
				catalogId: params.catalogId,
				buyerCatalogId: params.buyerCatalogId,
				canUseCatalogSaleUnits: params.canUseCatalogSaleUnits,
				items,
				applyPriceList: params.applyPriceList,
				enforcePriceListVisibility: params.enforcePriceListVisibility
			})

			for (const item of mappedItems) {
				if (visibleItems.length >= params.limit) {
					const lastVisible = visibleItems[visibleItems.length - 1]
					nextCursor = lastVisible
						? encodeCategoryProductsCursor({
								position: lastVisible.position,
								productId: lastVisible.productId
							})
						: null
					break
				}
				visibleItems.push(item)
			}

			if (nextCursor) break

			const lastRawItem = items[items.length - 1]
			if (!lastRawItem || items.length < take) break

			cursor = encodeCategoryProductsCursor({
				position: lastRawItem.position,
				productId: lastRawItem.productId
			})
		}

		return {
			items: visibleItems,
			nextCursor
		}
	}

	private async mapCategoryProductItems<
		T extends ProductMappableRecord & { id: string; price?: unknown }
	>(params: {
		catalogId: string
		buyerCatalogId: string
		canUseCatalogSaleUnits: boolean
		items: CategoryProductsPageItem<T>[]
		applyPriceList: boolean
		enforcePriceListVisibility: boolean
	}): Promise<CategoryProductsReadPage['items']> {
		const products = params.items.map(item => item.product)
		const mappedProducts = await this.productCategoryReads.mapCategoryProducts({
			catalogId: params.catalogId,
			buyerCatalogId: params.buyerCatalogId,
			products,
			canUseCatalogSaleUnits: params.canUseCatalogSaleUnits,
			applyPriceList: params.applyPriceList,
			enforcePriceListVisibility: params.enforcePriceListVisibility
		})

		return params.items.flatMap(({ product: _product, ...item }, index) => {
			const mappedProduct = mappedProducts[index] ?? null

			return mappedProduct === null
				? []
				: [
						{
							...item,
							product: mappedProduct
						}
					]
		})
	}

	private shouldApplyPriceList(options?: { applyPriceList?: boolean }): boolean {
		return options?.applyPriceList ?? true
	}

	private shouldEnforcePriceListVisibility(options?: {
		enforcePriceListVisibility?: boolean
		includeInactive?: boolean
	}): boolean {
		return (
			options?.enforcePriceListVisibility ??
			(this.isChildCatalogRead() || options?.includeInactive !== true)
		)
	}

	private isChildCatalogRead(): boolean {
		const store = ctx()
		return Boolean(store.parentId && store.parentId !== store.catalogId)
	}

	private async canUseCatalogSaleUnits(catalogId: string): Promise<boolean> {
		return this.capabilities?.canUseCatalogSaleUnits(catalogId) ?? true
	}

	private async canUseCatalogPriceLists(catalogId: string): Promise<boolean> {
		return this.capabilities?.canUseCatalogPriceLists(catalogId) ?? false
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
		limit: number,
		readMode: CategoryProductsReadMode
	): Promise<string> {
		const versionParts = await this.buildCategoryProductsVersionParts(catalogId)
		return this.cache.buildKey([
			'catalog',
			catalogId,
			'category',
			categoryId,
			'products',
			'infinite',
			...this.buildCategoryProductsReadModeParts(readMode),
			`limit-${limit}`,
			cursor ? `cursor-${encodeURIComponent(cursor)}` : 'cursor-first',
			...versionParts
		])
	}

	private async buildCategoryProductCardsCacheKey(
		categoryId: string,
		catalogId: string,
		cursor: string | undefined,
		limit: number,
		readMode: CategoryProductsReadMode
	): Promise<string> {
		const versionParts = await this.buildCategoryProductsVersionParts(catalogId)
		return this.cache.buildKey([
			'catalog',
			catalogId,
			'category',
			categoryId,
			'products',
			'cards',
			'infinite',
			...this.buildCategoryProductsReadModeParts(readMode),
			`limit-${limit}`,
			cursor ? `cursor-${encodeURIComponent(cursor)}` : 'cursor-first',
			...versionParts
		])
	}

	private buildCategoryProductsReadModeParts(
		readMode: CategoryProductsReadMode
	): string[] {
		return [
			readMode.canUseCatalogPriceLists ? 'price-lists-on' : 'price-lists-off',
			readMode.applyPriceList ? 'price-list-apply-on' : 'price-list-apply-off',
			readMode.enforcePriceListVisibility ? 'price-filter-on' : 'price-filter-off',
			readMode.canUseCatalogSaleUnits ? 'sale-units-on' : 'sale-units-off'
		]
	}

	private async buildCategoryProductsVersionParts(
		catalogId: string
	): Promise<string[]> {
		const buyerCatalogId = mustCatalogId()
		const version = await this.cache.getVersion(
			CATEGORY_PRODUCTS_CACHE_VERSION,
			catalogId
		)
		const buyerVersion =
			buyerCatalogId === catalogId
				? null
				: await this.cache.getVersion(
						CATEGORY_PRODUCTS_CACHE_VERSION,
						buyerCatalogId
					)

		return [
			`buyer-${buyerCatalogId}`,
			`v${version}`,
			`bv${buyerVersion ?? version}`
		]
	}

	private async buildCategoryListCacheKey(
		catalogId: string,
		options: {
			includeEmpty: boolean
			includeInactive: boolean
			readMode: CategoryProductsReadMode
		}
	): Promise<string> {
		const buyerCatalogId = mustCatalogId()
		const listVersion = await this.cache.getVersion(
			CATEGORY_LIST_CACHE_VERSION,
			catalogId
		)
		const productsVersion = await this.cache.getVersion(
			CATEGORY_PRODUCTS_CACHE_VERSION,
			catalogId
		)
		const buyerProductsVersion =
			buyerCatalogId === catalogId
				? null
				: await this.cache.getVersion(
						CATEGORY_PRODUCTS_CACHE_VERSION,
						buyerCatalogId
					)
		return this.cache.buildKey([
			'catalog',
			catalogId,
			'category',
			'list',
			`buyer-${buyerCatalogId}`,
			...this.buildCategoryProductsReadModeParts(options.readMode),
			options.includeEmpty ? 'include-empty' : 'non-empty',
			options.includeInactive ? 'include-inactive' : 'active-only',
			`lv${listVersion}`,
			`pv${productsVersion}`,
			`bpv${buyerProductsVersion ?? productsVersion}`
		])
	}

	private async invalidateCategoryListCache(catalogId: string) {
		if (this.events) {
			await this.events.dispatch(
				createDomainEvent({
					type: 'product.changed',
					catalogId,
					productId: '*',
					changes: ['category_list']
				})
			)
			return
		}

		await this.cache.bumpVersion(CATEGORY_LIST_CACHE_VERSION, catalogId)
	}

	private async invalidateCategoryProductsCache(catalogId: string) {
		if (this.events) {
			await this.events.dispatch(
				createDomainEvent({
					type: 'product.changed',
					catalogId,
					productId: '*',
					changes: ['category_products']
				})
			)
			return
		}

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

type CategoryListResponse = CategoryReadItem[]

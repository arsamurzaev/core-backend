import { CategoryCreateInput, CategoryUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { MediaRepository } from '@/shared/media/media.repository'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { mustCatalogId } from '@/shared/tenancy/ctx'

import { CategoryRepository } from './category.repository'
import { CreateCategoryDtoReq } from './dto/requests/create-category.dto.req'
import { UpdateCategoryDtoReq } from './dto/requests/update-category.dto.req'

const CATEGORY_PRODUCTS_DEFAULT_LIMIT = 20
const CATEGORY_PRODUCTS_MAX_LIMIT = 100

function normalizeName(value: string): string {
	return value.trim()
}

@Injectable()
export class CategoryService {
	constructor(
		private readonly repo: CategoryRepository,
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
		options?: { cursor?: string; limit?: number | string }
	) {
		const catalogId = mustCatalogId()
		const category = await this.repo.findById(id, catalogId)
		if (!category) throw new NotFoundException('Категория не найдена')

		const limit = this.normalizeLimit(options?.limit)
		const cursor = options?.cursor?.trim() || undefined

		const items = await this.repo.findCategoryProductsPage(id, catalogId, {
			cursor,
			take: limit + 1
		})

		const hasMore = items.length > limit
		const pageItems = hasMore ? items.slice(0, limit) : items
		const nextCursor =
			hasMore && pageItems.length
				? this.encodeCursor({
						position: pageItems[pageItems.length - 1].position,
						productId: pageItems[pageItems.length - 1].productId
					})
				: null

		return {
			items: pageItems.map(item => ({
				...item,
				product: this.mapProductMedia(item.product)
			})),
			nextCursor
		}
	}

	async create(dto: CreateCategoryDtoReq) {
		const catalogId = mustCatalogId()
		const products = this.normalizeCategoryProducts(dto.products)
		const productIds = products.map(product => product.productId)
		const parentId = dto.parentId ?? null
		const imageMediaId = this.normalizeOptionalId(dto.imageMediaId)

		if (parentId) {
			const parent = await this.repo.findById(parentId, catalogId)
			if (!parent) throw new BadRequestException('Родительская категория не найдена')
		}

		const validProductIds = await this.ensureProductsInCatalog(
			productIds,
			catalogId
		)

		if (imageMediaId) {
			await this.ensureMediaInCatalog(imageMediaId, catalogId)
		}

		const data: CategoryCreateInput = {
			name: normalizeName(dto.name),
			descriptor: dto.descriptor ?? null,
			discount: dto.discount ?? null,
			position: dto.position ?? 0,
			catalog: { connect: { id: catalogId } },
			...(imageMediaId
				? { imageMedia: { connect: { id: imageMediaId } } }
				: {})
		}

		if (parentId) {
			data.parent = { connect: { id: parentId } }
		}

		if (validProductIds.length) {
			const positionById = new Map(
				products.map(product => [product.productId, product.position])
			)
			data.categoryProducts = {
				create: validProductIds.map(productId => ({
					product: { connect: { id: productId } },
					position: positionById.get(productId) ?? 0
				}))
			}
		}

		return this.repo.create(data)
	}

	async update(id: string, dto: UpdateCategoryDtoReq) {
		const catalogId = mustCatalogId()
		const data: CategoryUpdateInput = {}
		const hasProductChanges = dto.products !== undefined

		if (dto.name !== undefined) {
			data.name = normalizeName(dto.name)
		}
		if (dto.imageMediaId !== undefined) {
			const imageMediaId = this.normalizeRequiredId(
				dto.imageMediaId,
				'imageMediaId'
			)
			await this.ensureMediaInCatalog(imageMediaId, catalogId)
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
					throw new BadRequestException('Категория не может быть сама себе родителем')
				}
				const parent = await this.repo.findById(dto.parentId, catalogId)
				if (!parent)
					throw new BadRequestException('Родительская категория не найдена')
				data.parent = { connect: { id: dto.parentId } }
			}
		}

		if (hasProductChanges) {
			const products = this.normalizeCategoryProducts(dto.products)
			const productIds = products.map(product => product.productId)
			const validProductIds = await this.ensureProductsInCatalog(
				productIds,
				catalogId
			)
			const positionById = new Map(
				products.map(product => [product.productId, product.position])
			)
			const categoryProducts = { deleteMany: {} } as NonNullable<
				CategoryUpdateInput['categoryProducts']
			>
			if (validProductIds.length) {
				categoryProducts.create = validProductIds.map(productId => ({
					product: { connect: { id: productId } },
					position: positionById.get(productId) ?? 0
				}))
			}
			data.categoryProducts = categoryProducts
		}

		if (Object.keys(data).length === 0) {
			throw new BadRequestException('Нет полей для обновления')
		}

		const category = await this.repo.update(id, catalogId, data)
		if (!category) throw new NotFoundException('Категория не найдена')

		return this.mapCategoryWithRelations(category)
	}

	async remove(id: string) {
		const catalogId = mustCatalogId()
		const category = await this.repo.softDelete(id, catalogId)
		if (!category) throw new NotFoundException('Категория не найдена')

		return { ok: true }
	}

	private mapCategory<T extends { imageMedia?: any | null }>(category: T) {
		return {
			...category,
			imageMedia: category.imageMedia
				? this.mediaUrl.mapMedia(category.imageMedia)
				: null
		}
	}

	private mapCategoryWithRelations(
		category: { imageMedia?: any | null; children?: { imageMedia?: any | null }[] }
	) {
		return {
			...this.mapCategory(category),
			children: (category.children ?? []).map(child => this.mapCategory(child))
		}
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

	private normalizeOptionalId(value?: string): string | undefined {
		if (value === undefined) return undefined
		const normalized = String(value).trim()
		if (!normalized) return undefined
		return normalized
	}

	private normalizeRequiredId(value: string, name: string): string {
		const normalized = String(value).trim()
		if (!normalized) {
			throw new BadRequestException(`Поле ${name} обязательно`)
		}
		return normalized
	}

	private async ensureMediaInCatalog(
		mediaId: string,
		catalogId: string
	): Promise<void> {
		const existing = await this.mediaRepo.findById(mediaId, catalogId)
		if (!existing) {
			throw new BadRequestException(`Медиа ${mediaId} не найдено в каталоге`)
		}
	}

	private normalizeCategoryProducts(
		products?: { productId: string; position?: number }[]
	): { productId: string; position: number }[] {
		if (!products) return []
		const normalized = products.map((product, index) => {
			const productId = product.productId?.trim()
			if (!productId) {
				throw new BadRequestException('productId обязателен')
			}
			const position =
				Number.isInteger(product.position) && product.position >= 0
					? product.position
					: index
			return { productId, position }
		})
		const unique = new Set(normalized.map(product => product.productId))
		if (unique.size !== normalized.length) {
			throw new BadRequestException('Дублирующиеся productId')
		}
		return normalized
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

	private normalizeLimit(value?: number | string): number {
		const raw =
			typeof value === 'string' ? Number(value.trim()) : (value as number)
		if (!Number.isFinite(raw)) return CATEGORY_PRODUCTS_DEFAULT_LIMIT
		const normalized = Math.floor(raw)
		if (normalized <= 0) return CATEGORY_PRODUCTS_DEFAULT_LIMIT
		return Math.min(normalized, CATEGORY_PRODUCTS_MAX_LIMIT)
	}

	private encodeCursor(value: { position: number; productId: string }): string {
		return Buffer.from(JSON.stringify(value)).toString('base64')
	}
}

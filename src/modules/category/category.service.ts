import { CategoryCreateInput, CategoryUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { mustCatalogId } from '@/shared/tenancy/ctx'

import type {
	CategorySelect,
	CategorySelectWithRelations
} from './category.repository'
import { CategoryRepository } from './category.repository'
import { CreateCategoryDtoReq } from './dto/requests/create-category.dto.req'
import { UpdateCategoryDtoReq } from './dto/requests/update-category.dto.req'

function normalizeName(value: string): string {
	return value.trim()
}

function normalizeImageUrl(value: string): string {
	return value.trim()
}

@Injectable()
export class CategoryService {
	constructor(private readonly repo: CategoryRepository) {}

	async getAll() {
		const catalogId = mustCatalogId()
		return this.repo.findAll(catalogId)
	}

	async getById(id: string) {
		const catalogId = mustCatalogId()
		const category = await this.repo.findById(id, catalogId, true)
		if (!category) throw new NotFoundException('Category not found')
		return this.mapCategoryRelations(category)
	}

	async create(dto: CreateCategoryDtoReq) {
		const catalogId = mustCatalogId()
		const products = this.normalizeCategoryProducts(dto.products)
		const productIds = products.map(product => product.productId)
		const parentId = dto.parentId ?? null

		if (parentId) {
			const parent = await this.repo.findById(parentId, catalogId)
			if (!parent) throw new BadRequestException('Parent category not found')
		}

		const validProductIds = await this.ensureProductsInCatalog(
			productIds,
			catalogId
		)

		const data: CategoryCreateInput = {
			name: normalizeName(dto.name),
			imageUrl: dto.imageUrl ? normalizeImageUrl(dto.imageUrl) : '',
			descriptor: dto.descriptor ?? null,
			discount: dto.discount ?? null,
			position: dto.position ?? 0,
			catalog: { connect: { id: catalogId } }
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
		if (dto.imageUrl !== undefined) {
			data.imageUrl = normalizeImageUrl(dto.imageUrl)
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
					throw new BadRequestException('Category cannot be its own parent')
				}
				const parent = await this.repo.findById(dto.parentId, catalogId)
				if (!parent) throw new BadRequestException('Parent category not found')
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
			throw new BadRequestException('No fields to update')
		}

		const category = await this.repo.update(id, catalogId, data)
		if (!category) throw new NotFoundException('Category not found')

		return this.mapCategoryRelations(category)
	}

	async remove(id: string) {
		const catalogId = mustCatalogId()
		const category = await this.repo.softDelete(id, catalogId)
		if (!category) throw new NotFoundException('Category not found')

		return { ok: true }
	}

	private normalizeCategoryProducts(
		products?: { productId: string; position?: number }[]
	): { productId: string; position: number }[] {
		if (!products) return []
		const normalized = products.map((product, index) => {
			const productId = product.productId?.trim()
			if (!productId) {
				throw new BadRequestException('Product id is required')
			}
			const position =
				Number.isInteger(product.position) && product.position >= 0
					? product.position
					: index
			return { productId, position }
		})
		const unique = new Set(normalized.map(product => product.productId))
		if (unique.size !== normalized.length) {
			throw new BadRequestException('Duplicate product ids')
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
				`Products not found in catalog: ${missing.join(', ')}`
			)
		}
		return productIds
	}

	private mapCategoryRelations(
		category: CategorySelect | CategorySelectWithRelations | null
	) {
		if (!category || !('categoryProducts' in category)) return category
		const { categoryProducts, ...rest } = category
		return {
			...rest,
			products: categoryProducts.map(item => ({
				productId: item.productId,
				position: item.position
			}))
		}
	}
}

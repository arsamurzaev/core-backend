import type { Prisma } from '@generated/client'
import { Prisma as PrismaSql } from '@generated/client'
import { DataType, ProductStatus, ProductVariantStatus } from '@generated/enums'
import { ProductCreateInput, ProductUpdateInput } from '@generated/models'
import { BadRequestException, Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import type { ProductAttributeValueData } from './product-attribute.builder'
import type {
	ProductVariantAttributeInput,
	ProductVariantData
} from './product-variant.builder'

export type ProductVariantUpdateData = {
	variantKey: string
	price?: number
	stock?: number
	status?: ProductVariantStatus
}

export type AttributeFilterMeta = {
	id: string
	key: string
	dataType: DataType
	isVariantAttribute: boolean
	isFilterable: boolean
	isHidden: boolean
}

export type ProductAttributeFilter =
	| {
			kind: 'enum'
			attributeId: string
			values: string[]
	  }
	| {
			kind: 'variant-enum'
			attributeId: string
			values: string[]
	  }
	| {
			kind: 'string'
			attributeId: string
			values: string[]
	  }
	| {
			kind: 'boolean'
			attributeId: string
			value: boolean
	  }
	| {
			kind: 'integer'
			attributeId: string
			values: number[]
			min?: number
			max?: number
	  }
	| {
			kind: 'decimal'
			attributeId: string
			values: number[]
			min?: number
			max?: number
	  }
	| {
			kind: 'datetime'
			attributeId: string
			values: Date[]
			min?: Date
			max?: Date
	  }

export type DiscountAttributeIds = {
	discountId?: string
	discountStartAtId?: string
	discountEndAtId?: string
}

export type ProductFilterQueryBase = {
	catalogId: string
	categoryIds: string[]
	brandIds: string[]
	minPrice?: number
	maxPrice?: number
	searchTerm?: string
	isPopular?: boolean
	isDiscount?: boolean
	attributeFilters: ProductAttributeFilter[]
	discountAttributeIds?: DiscountAttributeIds
	includeInactive?: boolean
	take: number
}

export type ProductDefaultPageCursor = {
	updatedAt: Date
	id: string
}

export type ProductSeededPageCursor = {
	score: string
	id: string
}

const productSelect = {
	id: true,
	sku: true,
	name: true,
	slug: true,
	price: true,
	brand: {
		select: {
			id: true,
			name: true,
			slug: true
		}
	},
	media: {
		select: {
			position: true,
			kind: true,
			media: {
				select: {
					id: true,
					originalName: true,
					mimeType: true,
					size: true,
					width: true,
					height: true,
					status: true,
					storage: true,
					key: true,
					variants: {
						select: {
							id: true,
							kind: true,
							mimeType: true,
							size: true,
							width: true,
							height: true,
							storage: true,
							key: true
						},
						orderBy: [{ width: 'desc' as const }, { kind: 'asc' as const }]
					}
				}
			}
		},
		orderBy: { position: 'asc' as const }
	},
	categoryProducts: {
		where: {
			category: {
				deleteAt: null
			}
		},
		select: {
			position: true,
			category: {
				select: {
					id: true,
					name: true
				}
			}
		},
		orderBy: { position: 'asc' as const }
	},
	isPopular: true,
	status: true,
	position: true,
	createdAt: true,
	updatedAt: true
}

const attributeRefSelect = {
	id: true,
	key: true,
	displayName: true,
	dataType: true,
	isRequired: true,
	isVariantAttribute: true,
	isFilterable: true,
	displayOrder: true,
	isHidden: true
}

const attributeEnumValueSelect = {
	id: true,
	value: true,
	displayName: true,
	displayOrder: true,
	businessId: true
}

const productAttributeSelect = {
	id: true,
	attributeId: true,
	enumValueId: true,
	valueString: true,
	valueInteger: true,
	valueDecimal: true,
	valueBoolean: true,
	valueDateTime: true,
	attribute: {
		select: attributeRefSelect
	},
	enumValue: {
		select: attributeEnumValueSelect
	}
}

const variantAttributeSelect = {
	id: true,
	attributeId: true,
	enumValueId: true,
	attribute: {
		select: attributeRefSelect
	},
	enumValue: {
		select: attributeEnumValueSelect
	}
}

const productVariantSelect = {
	id: true,
	sku: true,
	variantKey: true,
	stock: true,
	price: true,
	status: true,
	isAvailable: true,
	createdAt: true,
	updatedAt: true,
	attributes: {
		where: { deleteAt: null },
		select: variantAttributeSelect,
		orderBy: { attributeId: 'asc' as const }
	}
}

const productSelectWithAttributes = {
	...productSelect,
	productAttributes: {
		where: { deleteAt: null },
		select: productAttributeSelect,
		orderBy: { attributeId: 'asc' as const }
	}
}

const productSelectWithDetails = {
	...productSelectWithAttributes,
	variants: {
		where: { deleteAt: null },
		select: productVariantSelect,
		orderBy: [{ status: 'asc' as const }, { createdAt: 'desc' as const }]
	}
}

export type ProductListItem = Prisma.ProductGetPayload<{
	select: typeof productSelect
}>

export type ProductWithAttributesItem = Prisma.ProductGetPayload<{
	select: typeof productSelectWithAttributes
}>

export type ProductDetailsItem = Prisma.ProductGetPayload<{
	select: typeof productSelectWithDetails
}>

type ProductReadExecutor =
	| Pick<PrismaService, 'product'>
	| Pick<Prisma.TransactionClient, 'product'>

type ProductUpdateChanges = {
	hasData: boolean
	hasBrandChanges: boolean
	hasAttributeChanges: boolean
	hasRemovedAttributeChanges: boolean
	hasVariantChanges: boolean
	hasMediaChanges: boolean
}

type ExistingVariantBySku = {
	id: string
	sku: string
	productId: string
}

type ExistingVariantKeyRow = {
	sku: string
	variantKey: string
}

type ExistingVariantUpdateRow = {
	id: string
	variantKey: string
	status: ProductVariantStatus
}

type ResolvedVariantAttribute = {
	attributeId: string
	enumValueId: string
}

type DiscountBoundaryClauses = {
	missing: Prisma.Sql
	valid: Prisma.Sql
}

function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, char => `\\${char}`)
}

@Injectable()
export class ProductRepository {
	constructor(private readonly prisma: PrismaService) {}

	findAll(
		catalogId: string,
		includeInactive = false
	): Promise<ProductListItem[]> {
		return this.prisma.product.findMany({
			where: {
				deleteAt: null,
				catalogId,
				...(includeInactive ? {} : { status: ProductStatus.ACTIVE })
			},
			select: productSelect,
			orderBy: { createdAt: 'desc' }
		})
	}

	findPopular(
		catalogId: string,
		includeInactive = false
	): Promise<ProductDetailsItem[]> {
		return this.prisma.product.findMany({
			where: {
				deleteAt: null,
				catalogId,
				isPopular: true,
				...(includeInactive ? {} : { status: ProductStatus.ACTIVE })
			},
			select: productSelectWithDetails,
			orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
		})
	}

	findById(
		id: string,
		catalogId: string,
		includeInactive = false
	): Promise<ProductDetailsItem | null> {
		return this.prisma.product.findFirst({
			where: {
				id,
				catalogId,
				deleteAt: null,
				...(includeInactive ? {} : { status: ProductStatus.ACTIVE })
			},
			select: productSelectWithDetails
		})
	}

	findBySlug(
		slug: string,
		catalogId: string,
		includeInactive = false
	): Promise<ProductDetailsItem | null> {
		return this.prisma.product.findFirst({
			where: {
				slug,
				catalogId,
				deleteAt: null,
				...(includeInactive ? {} : { status: ProductStatus.ACTIVE })
			},
			select: productSelectWithDetails
		})
	}

	findByIdsWithAttributes(
		ids: string[],
		catalogId: string,
		includeInactive = false
	): Promise<ProductWithAttributesItem[]> {
		if (!ids.length) return Promise.resolve<ProductWithAttributesItem[]>([])

		return this.prisma.product.findMany({
			where: {
				id: { in: ids },
				catalogId,
				deleteAt: null,
				...(includeInactive ? {} : { status: ProductStatus.ACTIVE })
			},
			select: productSelectWithAttributes
		})
	}

	findUncategorizedPage(
		catalogId: string,
		options: {
			cursor?: ProductDefaultPageCursor
			take: number
			includeInactive?: boolean
		}
	): Promise<ProductWithAttributesItem[]> {
		const { cursor, take, includeInactive } = options

		return this.prisma.product.findMany({
			where: {
				catalogId,
				deleteAt: null,
				...(includeInactive ? {} : { status: ProductStatus.ACTIVE }),
				categoryProducts: {
					none: {
						category: {
							catalogId,
							deleteAt: null
						}
					}
				},
				...(cursor
					? {
							OR: [
								{ updatedAt: { lt: cursor.updatedAt } },
								{
									updatedAt: cursor.updatedAt,
									id: { lt: cursor.id }
								}
							]
						}
					: {})
			},
			select: productSelectWithAttributes,
			orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
			take
		})
	}

	findAttributesByTypeAndKeys(
		typeId: string,
		keys: string[]
	): Promise<AttributeFilterMeta[]> {
		if (!keys.length) return Promise.resolve<AttributeFilterMeta[]>([])
		const byKey = keys.map(key => key.trim()).filter(Boolean)

		return this.prisma.attribute.findMany({
			where: {
				deleteAt: null,
				OR: byKey.map(key => ({
					key: { equals: key, mode: 'insensitive' as const }
				})),
				types: { some: { id: typeId } }
			},
			select: {
				id: true,
				key: true,
				dataType: true,
				isVariantAttribute: true,
				isFilterable: true,
				isHidden: true
			}
		})
	}

	findFilteredProductIdsPageDefault(
		query: ProductFilterQueryBase & { cursor?: ProductDefaultPageCursor }
	): Promise<Array<{ id: string; updatedAt: Date }>> {
		const whereClauses = this.buildDefaultPageWhereClauses(query, query.cursor)
		return this.executeDefaultProductIdsPageQuery(whereClauses, query.take)
	}

	findRecommendedProductIdsPageDefault(
		query: ProductFilterQueryBase & { cursor?: ProductDefaultPageCursor }
	): Promise<Array<{ id: string; updatedAt: Date }>> {
		const whereClauses = this.buildRecommendationPageWhereClauses(
			query,
			query.cursor
		)
		return this.executeDefaultProductIdsPageQuery(whereClauses, query.take)
	}

	findFilteredProductIdsPageSeeded(
		query: ProductFilterQueryBase & {
			seed: string
			cursor?: ProductSeededPageCursor
		}
	): Promise<Array<{ id: string; score: string }>> {
		const scoreExpr = this.buildSeededScoreExpression(query.seed)
		const whereClauses = this.buildSeededPageWhereClauses(
			query,
			scoreExpr,
			query.cursor
		)
		return this.executeSeededProductIdsPageQuery(
			whereClauses,
			scoreExpr,
			query.take
		)
	}

	findRecommendedProductIdsPageSeeded(
		query: ProductFilterQueryBase & {
			seed: string
			cursor?: ProductSeededPageCursor
		}
	): Promise<Array<{ id: string; score: string }>> {
		const scoreExpr = this.buildSeededScoreExpression(query.seed)
		const whereClauses = this.buildRecommendationSeededPageWhereClauses(
			query,
			scoreExpr,
			query.cursor
		)
		return this.executeSeededProductIdsPageQuery(
			whereClauses,
			scoreExpr,
			query.take
		)
	}

	findSkuById(id: string, catalogId: string) {
		return this.prisma.product.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: { id: true, sku: true, price: true }
		})
	}

	findBrandById(id: string, catalogId: string) {
		return this.prisma.brand.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: { id: true }
		})
	}

	findCategoryById(id: string, catalogId: string) {
		return this.prisma.category.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: { id: true }
		})
	}

	findCategoriesByIds(
		ids: string[],
		catalogId: string
	): Promise<{ id: string }[] | []> {
		if (!ids.length) return Promise.resolve([])

		return this.prisma.category.findMany({
			where: { id: { in: ids }, catalogId, deleteAt: null },
			select: { id: true }
		})
	}

	async existsSlug(
		slug: string,
		catalogId: string,
		excludeId?: string
	): Promise<boolean> {
		const product = await this.prisma.product.findFirst({
			where: {
				slug,
				catalogId,
				...(excludeId ? { id: { not: excludeId } } : {})
			},
			select: { id: true }
		})
		return Boolean(product)
	}

	async existsName(
		name: string,
		catalogId: string,
		excludeId?: string
	): Promise<boolean> {
		const product = await this.prisma.product.findFirst({
			where: {
				name,
				catalogId,
				...(excludeId ? { id: { not: excludeId } } : {})
			},
			select: { id: true }
		})
		return Boolean(product)
	}

	async existsSku(sku: string, excludeId?: string): Promise<boolean> {
		const product = await this.prisma.product.findUnique({
			where: { sku },
			select: { id: true }
		})
		if (!product) return false
		if (!excludeId) return true
		return product.id !== excludeId
	}

	create(
		data: ProductCreateInput,
		attributes?: ProductAttributeValueData[],
		variants?: ProductVariantData[]
	) {
		if (!attributes?.length && !variants?.length) {
			return this.prisma.product.create({ data, select: productSelect })
		}

		return this.prisma.$transaction(tx =>
			this.createWithRelations(tx, data, attributes, variants)
		)
	}

	async update(
		id: string,
		data: ProductUpdateInput,
		catalogId: string,
		attributes?: ProductAttributeValueData[],
		removeAttributeIds?: string[],
		variantUpdates?: ProductVariantUpdateData[],
		mediaIds?: string[]
	) {
		const changes = this.describeUpdateChanges(
			data,
			attributes,
			removeAttributeIds,
			variantUpdates,
			mediaIds
		)

		if (this.canUpdateDirectly(changes)) {
			return this.updateWithoutRelations(id, data, catalogId, changes.hasData)
		}

		return this.prisma.$transaction(async tx => {
			const existing = await this.findActiveProductRef(tx, id, catalogId)
			if (!existing) return null

			await this.applyProductDataUpdate(tx, id, data, changes.hasData)
			await this.removeProductAttributes(tx, id, removeAttributeIds)
			await this.upsertProductAttributes(tx, id, attributes)
			await this.replaceProductMedia(tx, id, mediaIds)

			if (variantUpdates?.length) {
				await this.applyVariantUpdates(tx, id, variantUpdates)
			}

			return this.findProductWithDetails(tx, id, catalogId)
		})
	}

	async softDelete(id: string, catalogId: string) {
		return this.prisma.$transaction(async tx => {
			const existing = await tx.product.findFirst({
				where: { id, catalogId, deleteAt: null },
				select: {
					id: true,
					media: {
						select: {
							mediaId: true
						}
					}
				}
			})
			if (!existing) return null

			await tx.productMedia.deleteMany({
				where: { productId: id }
			})

			await tx.product.update({
				where: { id },
				data: { deleteAt: new Date(), brandId: null }
			})

			return {
				id: existing.id,
				mediaIds: [...new Set(existing.media.map(item => item.mediaId))]
			}
		})
	}

	async toggleStatus(
		id: string,
		catalogId: string
	): Promise<ProductDetailsItem | null> {
		const existing = await this.prisma.product.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: { id: true, status: true }
		})
		if (!existing) return null

		await this.prisma.product.update({
			where: { id },
			data: {
				status:
					existing.status === ProductStatus.ACTIVE
						? ProductStatus.HIDDEN
						: ProductStatus.ACTIVE
			}
		})

		return this.findProductWithDetails(this.prisma, id, catalogId)
	}

	async togglePopular(
		id: string,
		catalogId: string
	): Promise<ProductDetailsItem | null> {
		const existing = await this.prisma.product.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: { id: true, isPopular: true }
		})
		if (!existing) return null

		await this.prisma.product.update({
			where: { id },
			data: {
				isPopular: !existing.isPopular
			}
		})

		return this.findProductWithDetails(this.prisma, id, catalogId)
	}

	async setVariants(
		id: string,
		catalogId: string,
		variants: ProductVariantData[]
	) {
		return this.prisma.$transaction(async tx => {
			const existing = await this.findActiveProductRef(tx, id, catalogId)
			if (!existing) return null

			await this.applyVariants(tx, id, variants)

			return this.findProductWithDetails(tx, id, catalogId)
		})
	}

	private describeUpdateChanges(
		data: ProductUpdateInput,
		attributes?: ProductAttributeValueData[],
		removeAttributeIds?: string[],
		variantUpdates?: ProductVariantUpdateData[],
		mediaIds?: string[]
	): ProductUpdateChanges {
		return {
			hasData: Object.keys(data).length > 0,
			hasBrandChanges: Object.hasOwn(data, 'brand'),
			hasAttributeChanges: attributes !== undefined,
			hasRemovedAttributeChanges: removeAttributeIds !== undefined,
			hasVariantChanges: variantUpdates !== undefined,
			hasMediaChanges: mediaIds !== undefined
		}
	}

	private canUpdateDirectly(changes: ProductUpdateChanges): boolean {
		return (
			!changes.hasAttributeChanges &&
			!changes.hasRemovedAttributeChanges &&
			!changes.hasVariantChanges &&
			!changes.hasMediaChanges &&
			!changes.hasBrandChanges
		)
	}

	private async createWithRelations(
		tx: Prisma.TransactionClient,
		data: ProductCreateInput,
		attributes?: ProductAttributeValueData[],
		variants?: ProductVariantData[]
	) {
		const product = await tx.product.create({
			data,
			select: productSelect
		})

		await this.createProductAttributes(tx, product.id, attributes)

		if (variants?.length) {
			await this.applyVariants(tx, product.id, variants)
		}

		return product
	}

	private async createProductAttributes(
		tx: Prisma.TransactionClient,
		productId: string,
		attributes?: ProductAttributeValueData[]
	): Promise<void> {
		if (!attributes?.length) return

		await tx.productAttribute.createMany({
			data: attributes.map(attribute => ({
				...attribute,
				productId
			}))
		})
	}

	private async updateWithoutRelations(
		id: string,
		data: ProductUpdateInput,
		catalogId: string,
		hasData: boolean
	): Promise<ProductDetailsItem | null> {
		if (hasData) {
			const result = await this.prisma.product.updateMany({
				where: { id, catalogId, deleteAt: null },
				data
			})
			if (!result.count) return null
		} else {
			const existing = await this.findActiveProductRef(this.prisma, id, catalogId)
			if (!existing) return null
		}

		return this.findProductWithDetails(this.prisma, id, catalogId)
	}

	private async findActiveProductRef(
		db: ProductReadExecutor,
		id: string,
		catalogId: string
	): Promise<{ id: string } | null> {
		return db.product.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: { id: true }
		})
	}

	private async findProductWithAttributes(
		db: ProductReadExecutor,
		id: string,
		catalogId: string
	): Promise<ProductWithAttributesItem | null> {
		return db.product.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: productSelectWithAttributes
		})
	}

	private async findProductWithDetails(
		db: ProductReadExecutor,
		id: string,
		catalogId: string
	): Promise<ProductDetailsItem | null> {
		return db.product.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: productSelectWithDetails
		})
	}

	private async applyProductDataUpdate(
		tx: Prisma.TransactionClient,
		id: string,
		data: ProductUpdateInput,
		hasData: boolean
	): Promise<void> {
		if (!hasData) return

		await tx.product.update({
			where: { id },
			data
		})
	}

	private async removeProductAttributes(
		tx: Prisma.TransactionClient,
		productId: string,
		removeAttributeIds?: string[]
	): Promise<void> {
		if (!removeAttributeIds?.length) return

		await tx.productAttribute.updateMany({
			where: {
				productId,
				attributeId: { in: removeAttributeIds },
				deleteAt: null
			},
			data: {
				deleteAt: new Date()
			}
		})
	}

	private async upsertProductAttributes(
		tx: Prisma.TransactionClient,
		productId: string,
		attributes?: ProductAttributeValueData[]
	): Promise<void> {
		if (!attributes?.length) return

		for (const attribute of attributes) {
			await tx.productAttribute.upsert({
				where: {
					productId_attributeId: {
						productId,
						attributeId: attribute.attributeId
					}
				},
				create: {
					...attribute,
					productId
				},
				update: {
					...attribute,
					deleteAt: null
				}
			})
		}
	}

	private async replaceProductMedia(
		tx: Prisma.TransactionClient,
		productId: string,
		mediaIds?: string[]
	): Promise<void> {
		if (mediaIds === undefined) return

		await tx.productMedia.deleteMany({ where: { productId } })

		if (!mediaIds.length) return

		await tx.productMedia.createMany({
			data: mediaIds.map((mediaId, index) => ({
				productId,
				mediaId,
				position: index
			}))
		})
	}

	async syncProductCategories(
		productId: string,
		catalogId: string,
		categoryIds: string[]
	) {
		await this.prisma.$transaction(async tx => {
			const existing = await tx.categoryProduct.findMany({
				where: {
					productId,
					category: { catalogId, deleteAt: null }
				},
				select: {
					categoryId: true,
					position: true
				}
			})

			const nextCategoryIds = new Set(categoryIds)
			const existingByCategoryId = new Map(
				existing.map(item => [item.categoryId, item] as const)
			)

			for (const current of existing) {
				if (nextCategoryIds.has(current.categoryId)) {
					continue
				}

				await tx.categoryProduct.updateMany({
					where: {
						categoryId: current.categoryId,
						position: { gt: current.position }
					},
					data: { position: { decrement: 1 } }
				})
				await tx.categoryProduct.delete({
					where: {
						categoryId_productId: {
							categoryId: current.categoryId,
							productId
						}
					}
				})
			}

			for (const categoryId of categoryIds) {
				if (existingByCategoryId.has(categoryId)) {
					continue
				}

				await tx.categoryProduct.updateMany({
					where: { categoryId, position: { gte: 0 } },
					data: { position: { increment: 1 } }
				})
				await tx.categoryProduct.create({
					data: { categoryId, productId, position: 0 }
				})
			}
		})
	}

	async upsertCategoryProductPosition(
		productId: string,
		categoryId: string,
		catalogId: string,
		position: number
	) {
		const normalizedPosition =
			Number.isInteger(position) && position >= 0 ? position : 0

		await this.prisma.$transaction(async tx => {
			const [category, product] = await Promise.all([
				tx.category.findFirst({
					where: { id: categoryId, catalogId, deleteAt: null },
					select: { id: true }
				}),
				tx.product.findFirst({
					where: { id: productId, catalogId, deleteAt: null },
					select: { id: true }
				})
			])

			if (!category) {
				throw new BadRequestException('Категория не найдена')
			}
			if (!product) {
				throw new BadRequestException('Товар не найден')
			}

			const current = await tx.categoryProduct.findUnique({
				where: {
					categoryId_productId: {
						categoryId,
						productId
					}
				},
				select: { position: true }
			})
			const siblingCount = await tx.categoryProduct.count({
				where: {
					categoryId,
					...(current ? { productId: { not: productId } } : {})
				}
			})
			const targetPosition = Math.min(normalizedPosition, siblingCount)

			if (!current) {
				await tx.categoryProduct.updateMany({
					where: { categoryId, position: { gte: targetPosition } },
					data: { position: { increment: 1 } }
				})
				await tx.categoryProduct.create({
					data: { categoryId, productId, position: targetPosition }
				})
				return
			}

			if (current.position === targetPosition) return

			if (current.position < targetPosition) {
				await tx.categoryProduct.updateMany({
					where: {
						categoryId,
						position: { gt: current.position, lte: targetPosition }
					},
					data: { position: { decrement: 1 } }
				})
			} else {
				await tx.categoryProduct.updateMany({
					where: {
						categoryId,
						position: { gte: targetPosition, lt: current.position }
					},
					data: { position: { increment: 1 } }
				})
			}

			await tx.categoryProduct.update({
				where: {
					categoryId_productId: {
						categoryId,
						productId
					}
				},
				data: { position: targetPosition }
			})
		})
	}

	private buildBaseFilterClauses(query: ProductFilterQueryBase): Prisma.Sql[] {
		return [
			...this.buildDefaultFilterClauses(
				query.catalogId,
				query.includeInactive === true
			),
			...this.buildActiveFilterClauses(query)
		]
	}

	private buildActiveFilterClauses(query: ProductFilterQueryBase): Prisma.Sql[] {
		return [
			...this.buildPriceFilterClauses(query.minPrice, query.maxPrice),
			...[
				this.buildCategoryFilterClause(query.categoryIds),
				this.buildBrandFilterClause(query.brandIds),
				this.buildSearchFilterClause(query.searchTerm),
				this.buildPopularityFilterClause(query.isPopular),
				query.isDiscount
					? this.buildDiscountActiveClause(query.discountAttributeIds)
					: null,
				...this.buildAttributeFilterClauses(query.attributeFilters)
			].filter((clause): clause is Prisma.Sql => clause !== null)
		]
	}

	private buildDefaultPageWhereClauses(
		query: ProductFilterQueryBase,
		cursor?: ProductDefaultPageCursor
	): Prisma.Sql[] {
		const whereClauses = this.buildBaseFilterClauses(query)
		const cursorClause = this.buildDefaultPageCursorClause(cursor)
		if (cursorClause) {
			whereClauses.push(cursorClause)
		}
		return whereClauses
	}

	private buildRecommendationPageWhereClauses(
		query: ProductFilterQueryBase,
		cursor?: ProductDefaultPageCursor
	): Prisma.Sql[] {
		const whereClauses = [
			...this.buildDefaultFilterClauses(
				query.catalogId,
				query.includeInactive === true
			),
			this.buildRecommendationFilterClause(query)
		]
		const cursorClause = this.buildDefaultPageCursorClause(cursor)
		if (cursorClause) {
			whereClauses.push(cursorClause)
		}
		return whereClauses
	}

	private buildSeededPageWhereClauses(
		query: ProductFilterQueryBase,
		scoreExpr: Prisma.Sql,
		cursor?: ProductSeededPageCursor
	): Prisma.Sql[] {
		const whereClauses = this.buildBaseFilterClauses(query)
		const cursorClause = this.buildSeededPageCursorClause(scoreExpr, cursor)
		if (cursorClause) {
			whereClauses.push(cursorClause)
		}
		return whereClauses
	}

	private buildRecommendationSeededPageWhereClauses(
		query: ProductFilterQueryBase,
		scoreExpr: Prisma.Sql,
		cursor?: ProductSeededPageCursor
	): Prisma.Sql[] {
		const whereClauses = [
			...this.buildDefaultFilterClauses(
				query.catalogId,
				query.includeInactive === true
			),
			this.buildRecommendationFilterClause(query)
		]
		const cursorClause = this.buildSeededPageCursorClause(scoreExpr, cursor)
		if (cursorClause) {
			whereClauses.push(cursorClause)
		}
		return whereClauses
	}

	private buildRecommendationFilterClause(
		query: ProductFilterQueryBase
	): Prisma.Sql {
		const activeClauses = this.buildActiveFilterClauses(query)
		if (!activeClauses.length) {
			return PrismaSql.sql`FALSE`
		}

		const normalizedClauses = activeClauses.map(
			clause => PrismaSql.sql`COALESCE((${clause}), FALSE)`
		)
		return PrismaSql.sql`NOT (${PrismaSql.join(normalizedClauses, ' AND ')})`
	}

	private buildDefaultPageCursorClause(
		cursor?: ProductDefaultPageCursor
	): Prisma.Sql | null {
		if (!cursor) return null

		return PrismaSql.sql`(
			p.updated_at < ${cursor.updatedAt}
			OR (
				p.updated_at = ${cursor.updatedAt}
				AND p.id < ${cursor.id}::uuid
			)
		)`
	}

	private buildSeededScoreExpression(seed: string): Prisma.Sql {
		return PrismaSql.sql`md5(${seed} || p.id::text)`
	}

	private buildSeededPageCursorClause(
		scoreExpr: Prisma.Sql,
		cursor?: ProductSeededPageCursor
	): Prisma.Sql | null {
		if (!cursor) return null

		return PrismaSql.sql`(
			${scoreExpr} > ${cursor.score}
			OR (
				${scoreExpr} = ${cursor.score}
				AND p.id > ${cursor.id}::uuid
			)
		)`
	}

	private executeDefaultProductIdsPageQuery(
		whereClauses: Prisma.Sql[],
		take: number
	): Promise<Array<{ id: string; updatedAt: Date }>> {
		return this.prisma.$queryRaw<Array<{ id: string; updatedAt: Date }>>(
			PrismaSql.sql`
				SELECT p.id, p.updated_at AS "updatedAt"
				FROM products p
				WHERE ${PrismaSql.join(whereClauses, ' AND ')}
				ORDER BY p.updated_at DESC, p.id DESC
				LIMIT ${take}
			`
		)
	}

	private executeSeededProductIdsPageQuery(
		whereClauses: Prisma.Sql[],
		scoreExpr: Prisma.Sql,
		take: number
	): Promise<Array<{ id: string; score: string }>> {
		return this.prisma.$queryRaw<Array<{ id: string; score: string }>>(
			PrismaSql.sql`
				SELECT p.id, ${scoreExpr} AS score
				FROM products p
				WHERE ${PrismaSql.join(whereClauses, ' AND ')}
				ORDER BY ${scoreExpr} ASC, p.id ASC
				LIMIT ${take}
			`
		)
	}

	private buildDiscountActiveClause(ids?: DiscountAttributeIds): Prisma.Sql {
		if (!ids?.discountId) {
			return PrismaSql.sql`FALSE`
		}

		const now = new Date()
		const discountPositive = this.buildDiscountPositiveClause(ids.discountId)
		const activeWindow = this.buildDiscountWindowClause(ids, now)
		return PrismaSql.sql`(${discountPositive} AND ${activeWindow})`
	}

	private buildDiscountPositiveClause(attributeId: string): Prisma.Sql {
		return PrismaSql.sql`
			EXISTS (
				SELECT 1
				FROM product_attributes pa
				WHERE pa.product_id = p.id
					AND pa.delete_at IS NULL
					AND pa.attribute_id = ${attributeId}::uuid
					AND (
						(pa.value_decimal IS NOT NULL AND pa.value_decimal > 0)
						OR (pa.value_integer IS NOT NULL AND pa.value_integer > 0)
					)
			)
		`
	}

	private buildDiscountWindowClause(
		ids: DiscountAttributeIds,
		now: Date
	): Prisma.Sql {
		const start = this.buildDiscountBoundaryClauses(
			ids.discountStartAtId,
			now,
			'start'
		)
		const end = this.buildDiscountBoundaryClauses(ids.discountEndAtId, now, 'end')

		return PrismaSql.sql`
			(
				(${start.missing} AND ${end.missing})
				OR (${start.valid} AND ${end.missing})
				OR (${start.missing} AND ${end.valid})
				OR (${start.valid} AND ${end.valid})
			)
		`
	}

	private buildDiscountBoundaryClauses(
		attributeId: string | undefined,
		now: Date,
		kind: 'start' | 'end'
	): DiscountBoundaryClauses {
		if (!attributeId) {
			return {
				missing: PrismaSql.sql`TRUE`,
				valid: PrismaSql.sql`TRUE`
			}
		}

		return {
			missing: this.buildDiscountBoundaryMissingClause(attributeId),
			valid: this.buildDiscountBoundaryValidClause(attributeId, now, kind)
		}
	}

	private buildDiscountBoundaryMissingClause(attributeId: string): Prisma.Sql {
		return PrismaSql.sql`
			NOT EXISTS (
				SELECT 1
				FROM product_attributes pa
				WHERE pa.product_id = p.id
					AND pa.delete_at IS NULL
					AND pa.attribute_id = ${attributeId}::uuid
					AND pa.value_datetime IS NOT NULL
			)
		`
	}

	private buildDiscountBoundaryValidClause(
		attributeId: string,
		now: Date,
		kind: 'start' | 'end'
	): Prisma.Sql {
		if (kind === 'start') {
			return PrismaSql.sql`
				EXISTS (
					SELECT 1
					FROM product_attributes pa
					WHERE pa.product_id = p.id
						AND pa.delete_at IS NULL
						AND pa.attribute_id = ${attributeId}::uuid
						AND pa.value_datetime IS NOT NULL
						AND pa.value_datetime <= ${now}
				)
			`
		}

		return PrismaSql.sql`
			EXISTS (
				SELECT 1
				FROM product_attributes pa
				WHERE pa.product_id = p.id
					AND pa.delete_at IS NULL
					AND pa.attribute_id = ${attributeId}::uuid
					AND pa.value_datetime IS NOT NULL
					AND pa.value_datetime >= ${now}
			)
		`
	}

	private buildAttributeFilterClause(
		filter: ProductAttributeFilter
	): Prisma.Sql {
		switch (filter.kind) {
			case 'enum':
				return this.buildProductEnumAttributeFilterClause(
					filter.attributeId,
					filter.values
				)
			case 'variant-enum':
				return this.buildVariantEnumAttributeFilterClause(
					filter.attributeId,
					filter.values
				)
			case 'string':
				return this.buildStringAttributeFilterClause(
					filter.attributeId,
					filter.values
				)
			case 'boolean':
				return this.buildBooleanAttributeFilterClause(
					filter.attributeId,
					filter.value
				)
			case 'integer':
				return this.buildScalarAttributeFilterClause(
					filter.attributeId,
					this.buildRangeValueClauses(
						PrismaSql.sql`pa.value_integer`,
						filter.values,
						filter.min,
						filter.max
					)
				)
			case 'decimal':
				return this.buildScalarAttributeFilterClause(
					filter.attributeId,
					this.buildRangeValueClauses(
						PrismaSql.sql`pa.value_decimal`,
						filter.values,
						filter.min,
						filter.max
					)
				)
			case 'datetime':
				return this.buildScalarAttributeFilterClause(
					filter.attributeId,
					this.buildRangeValueClauses(
						PrismaSql.sql`pa.value_datetime`,
						filter.values,
						filter.min,
						filter.max
					)
				)
			default: {
				const _exhaustive: never = filter
				return _exhaustive
			}
		}
	}

	private buildDefaultFilterClauses(
		catalogId: string,
		includeInactive = false
	): Prisma.Sql[] {
		const clauses = [
			PrismaSql.sql`p.catalog_id = ${catalogId}::uuid`,
			PrismaSql.sql`p.delete_at IS NULL`
		]
		if (!includeInactive) {
			clauses.push(PrismaSql.sql`p.status::text = ${ProductStatus.ACTIVE}`)
		}
		return clauses
	}

	private buildCategoryFilterClause(categoryIds: string[]): Prisma.Sql | null {
		if (!categoryIds.length) return null

		const values = categoryIds.map(
			categoryId => PrismaSql.sql`${categoryId}::uuid`
		)
		return PrismaSql.sql`
			EXISTS (
				SELECT 1
				FROM category_products cp
				JOIN categories c ON c.id = cp.category_id
				WHERE cp.product_id = p.id
					AND cp.category_id IN (${PrismaSql.join(values)})
					AND c.catalog_id = p.catalog_id
					AND c.delete_at IS NULL
			)
		`
	}

	private buildBrandFilterClause(brandIds: string[]): Prisma.Sql | null {
		if (!brandIds.length) return null

		const values = brandIds.map(brandId => PrismaSql.sql`${brandId}::uuid`)
		return PrismaSql.sql`p.brand_id IN (${PrismaSql.join(values)})`
	}

	private buildPriceFilterClauses(
		minPrice?: number,
		maxPrice?: number
	): Prisma.Sql[] {
		const clauses: Prisma.Sql[] = []
		if (minPrice !== undefined) {
			clauses.push(PrismaSql.sql`p.price >= ${minPrice}`)
		}
		if (maxPrice !== undefined) {
			clauses.push(PrismaSql.sql`p.price <= ${maxPrice}`)
		}
		return clauses
	}

	private buildSearchFilterClause(searchTerm?: string): Prisma.Sql | null {
		if (!searchTerm) return null

		const pattern = `%${escapeLikePattern(searchTerm)}%`
		return PrismaSql.sql`p.name ILIKE ${pattern} ESCAPE '\'`
	}

	private buildPopularityFilterClause(isPopular?: boolean): Prisma.Sql | null {
		if (isPopular === undefined) return null
		return PrismaSql.sql`p.is_popular = ${isPopular}`
	}

	private buildAttributeFilterClauses(
		filters: ProductAttributeFilter[]
	): Prisma.Sql[] {
		return filters.map(filter => this.buildAttributeFilterClause(filter))
	}

	private buildProductEnumAttributeFilterClause(
		attributeId: string,
		values: string[]
	): Prisma.Sql {
		const serializedValues = values.map(value => PrismaSql.sql`${value}`)
		return PrismaSql.sql`
			EXISTS (
				SELECT 1
				FROM product_attributes pa
				JOIN attribute_enum_values aev ON aev.id = pa.enum_value_id
				WHERE pa.product_id = p.id
					AND pa.delete_at IS NULL
					AND aev.delete_at IS NULL
					AND pa.attribute_id = ${attributeId}::uuid
					AND aev.value IN (${PrismaSql.join(serializedValues)})
			)
		`
	}

	private buildVariantEnumAttributeFilterClause(
		attributeId: string,
		values: string[]
	): Prisma.Sql {
		const serializedValues = values.map(value => PrismaSql.sql`${value}`)
		return PrismaSql.sql`
			EXISTS (
				SELECT 1
				FROM product_variants pv
				JOIN variant_attributes va ON va.variant_id = pv.id
				JOIN attribute_enum_values aev ON aev.id = va.enum_value_id
				WHERE pv.product_id = p.id
					AND pv.delete_at IS NULL
					AND va.delete_at IS NULL
					AND aev.delete_at IS NULL
					AND va.attribute_id = ${attributeId}::uuid
					AND aev.value IN (${PrismaSql.join(serializedValues)})
			)
		`
	}

	private buildStringAttributeFilterClause(
		attributeId: string,
		values: string[]
	): Prisma.Sql {
		return this.buildScalarAttributeFilterClause(attributeId, [
			PrismaSql.sql`LOWER(pa.value_string) IN (${PrismaSql.join(
				values.map(value => PrismaSql.sql`${value.toLowerCase()}`)
			)})`
		])
	}

	private buildBooleanAttributeFilterClause(
		attributeId: string,
		value: boolean
	): Prisma.Sql {
		return this.buildScalarAttributeFilterClause(attributeId, [
			PrismaSql.sql`pa.value_boolean = ${value}`
		])
	}

	private buildScalarAttributeFilterClause(
		attributeId: string,
		valueClauses: Prisma.Sql[]
	): Prisma.Sql {
		return PrismaSql.sql`
			EXISTS (
				SELECT 1
				FROM product_attributes pa
				WHERE pa.product_id = p.id
					AND pa.delete_at IS NULL
					AND pa.attribute_id = ${attributeId}::uuid
					AND ${PrismaSql.join(valueClauses, ' AND ')}
			)
		`
	}

	private buildRangeValueClauses<T extends number | Date>(
		column: Prisma.Sql,
		values: readonly T[],
		min?: T,
		max?: T
	): Prisma.Sql[] {
		const clauses: Prisma.Sql[] = []
		if (values.length) {
			clauses.push(
				PrismaSql.sql`${column} IN (${PrismaSql.join(
					values.map(value => PrismaSql.sql`${value}`)
				)})`
			)
		}
		if (min !== undefined) {
			clauses.push(PrismaSql.sql`${column} >= ${min}`)
		}
		if (max !== undefined) {
			clauses.push(PrismaSql.sql`${column} <= ${max}`)
		}
		return clauses
	}

	private async applyVariants(
		tx: Prisma.TransactionClient,
		productId: string,
		variants: ProductVariantData[]
	): Promise<void> {
		const now = new Date()
		const enumValueCache = new Map<string, string>()
		if (!variants.length) {
			await this.archiveAllProductVariants(tx, productId, now)
			return
		}

		const skus = variants.map(variant => variant.sku)
		await this.archiveMissingVariants(tx, productId, skus, now)

		const existingBySku = await this.loadExistingVariantsBySku(tx, skus)
		this.assertVariantSkuOwnership(existingBySku, productId)

		const existingByKey = await this.loadExistingVariantKeyMap(
			tx,
			productId,
			skus
		)
		this.assertVariantKeyConflicts(variants, existingByKey)

		for (const variant of variants) {
			await this.upsertVariant(
				tx,
				productId,
				variant,
				existingBySku,
				enumValueCache,
				now
			)
		}
	}

	private async resolveVariantAttributes(
		tx: Prisma.TransactionClient,
		attributes: ProductVariantAttributeInput[],
		cache: Map<string, string>
	): Promise<ResolvedVariantAttribute[]> {
		if (!attributes.length) return []

		const resolved: ResolvedVariantAttribute[] = []
		for (const attribute of attributes) {
			const enumValueId = await this.resolveEnumValueId(tx, attribute, cache)
			resolved.push({ attributeId: attribute.attributeId, enumValueId })
		}

		return resolved
	}

	private async resolveEnumValueId(
		tx: Prisma.TransactionClient,
		attribute: ProductVariantAttributeInput,
		cache: Map<string, string>
	): Promise<string> {
		if (attribute.enumValueId) return attribute.enumValueId

		const value = attribute.value?.trim()
		if (!value) {
			throw new BadRequestException(
				`Для атрибута ${attribute.attributeId} нужно передать value`
			)
		}

		const cacheKey = `${attribute.attributeId}:${value}`
		const cached = cache.get(cacheKey)
		if (cached) return cached

		const existing = await tx.attributeEnumValue.findFirst({
			where: { attributeId: attribute.attributeId, value },
			select: { id: true, deleteAt: true }
		})

		const displayName = attribute.displayName?.trim()
		const normalizedDisplayName = displayName?.length ? displayName : null

		if (existing) {
			if (existing.deleteAt) {
				await tx.attributeEnumValue.update({
					where: { id: existing.id },
					data: {
						deleteAt: null,
						...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {})
					}
				})
			}
			cache.set(cacheKey, existing.id)
			return existing.id
		}

		const created = await tx.attributeEnumValue.create({
			data: {
				attributeId: attribute.attributeId,
				value,
				displayName: normalizedDisplayName,
				displayOrder: 0
			}
		})

		cache.set(cacheKey, created.id)
		return created.id
	}

	private async applyVariantUpdates(
		tx: Prisma.TransactionClient,
		productId: string,
		variants: ProductVariantUpdateData[]
	): Promise<void> {
		if (!variants.length) return

		const existingMap = await this.loadExistingVariantsForUpdate(
			tx,
			productId,
			variants
		)
		this.assertVariantUpdateTargetsExist(existingMap, variants)

		for (const variant of variants) {
			const current = existingMap.get(variant.variantKey)
			if (!current) continue

			const data = this.buildVariantUpdateData(variant, current.status)
			if (!Object.keys(data).length) continue

			await tx.productVariant.update({
				where: { id: current.id },
				data
			})
		}
	}

	private async archiveAllProductVariants(
		tx: Prisma.TransactionClient,
		productId: string,
		deleteAt: Date
	): Promise<void> {
		await tx.variantAttribute.updateMany({
			where: { variant: { productId }, deleteAt: null },
			data: { deleteAt }
		})
		await tx.productVariant.updateMany({
			where: { productId, deleteAt: null },
			data: { deleteAt }
		})
	}

	private async archiveMissingVariants(
		tx: Prisma.TransactionClient,
		productId: string,
		skus: string[],
		deleteAt: Date
	): Promise<void> {
		await tx.variantAttribute.updateMany({
			where: { variant: { productId, sku: { notIn: skus } }, deleteAt: null },
			data: { deleteAt }
		})
		await tx.productVariant.updateMany({
			where: { productId, deleteAt: null, sku: { notIn: skus } },
			data: { deleteAt }
		})
	}

	private async loadExistingVariantsBySku(
		tx: Prisma.TransactionClient,
		skus: string[]
	): Promise<Map<string, ExistingVariantBySku>> {
		const existing = await tx.productVariant.findMany({
			where: { sku: { in: skus } },
			select: { id: true, sku: true, productId: true }
		})

		return new Map(existing.map(variant => [variant.sku, variant]))
	}

	private assertVariantSkuOwnership(
		existingBySku: Map<string, ExistingVariantBySku>,
		productId: string
	): void {
		for (const existing of existingBySku.values()) {
			if (existing.productId !== productId) {
				throw new BadRequestException(
					`SKU варианта ${existing.sku} уже используется другим товаром`
				)
			}
		}
	}

	private async loadExistingVariantKeyMap(
		tx: Prisma.TransactionClient,
		productId: string,
		skus: string[]
	): Promise<Map<string, string>> {
		const existing = await tx.productVariant.findMany({
			where: { productId, deleteAt: null, sku: { in: skus } },
			select: { sku: true, variantKey: true }
		})

		return new Map(
			existing.map((variant: ExistingVariantKeyRow) => [
				variant.variantKey,
				variant.sku
			])
		)
	}

	private assertVariantKeyConflicts(
		variants: ProductVariantData[],
		existingByKey: Map<string, string>
	): void {
		for (const variant of variants) {
			const existingSku = existingByKey.get(variant.variantKey)
			if (existingSku && existingSku !== variant.sku) {
				throw new BadRequestException(
					`Вариант с набором ${variant.variantKey} уже существует`
				)
			}
		}
	}

	private async upsertVariant(
		tx: Prisma.TransactionClient,
		productId: string,
		variant: ProductVariantData,
		existingBySku: Map<string, ExistingVariantBySku>,
		enumValueCache: Map<string, string>,
		deleteAt: Date
	): Promise<void> {
		const resolvedAttributes = await this.resolveVariantAttributes(
			tx,
			variant.attributes,
			enumValueCache
		)
		const existing = existingBySku.get(variant.sku)

		if (existing?.productId === productId) {
			await this.updateExistingVariant(
				tx,
				existing.id,
				variant,
				resolvedAttributes,
				deleteAt
			)
			return
		}

		await this.createVariant(tx, productId, variant, resolvedAttributes)
	}

	private async updateExistingVariant(
		tx: Prisma.TransactionClient,
		variantId: string,
		variant: ProductVariantData,
		attributes: ResolvedVariantAttribute[],
		deleteAt: Date
	): Promise<void> {
		await tx.productVariant.update({
			where: { id: variantId },
			data: {
				variantKey: variant.variantKey,
				stock: variant.stock,
				price: variant.price,
				status: variant.status,
				isAvailable: variant.status === ProductVariantStatus.ACTIVE,
				deleteAt: null
			}
		})

		await this.syncVariantAttributes(tx, variantId, attributes, deleteAt)
	}

	private async syncVariantAttributes(
		tx: Prisma.TransactionClient,
		variantId: string,
		attributes: ResolvedVariantAttribute[],
		deleteAt: Date
	): Promise<void> {
		const attributeIds = attributes.map(attribute => attribute.attributeId)
		if (attributeIds.length) {
			await tx.variantAttribute.updateMany({
				where: {
					variantId,
					deleteAt: null,
					attributeId: { notIn: attributeIds }
				},
				data: { deleteAt }
			})
		}

		if (!attributes.length) return

		for (const attribute of attributes) {
			await tx.variantAttribute.upsert({
				where: {
					variantId_attributeId: {
						variantId,
						attributeId: attribute.attributeId
					}
				},
				create: {
					variantId,
					attributeId: attribute.attributeId,
					enumValueId: attribute.enumValueId
				},
				update: {
					enumValueId: attribute.enumValueId,
					deleteAt: null
				}
			})
		}
	}

	private async createVariant(
		tx: Prisma.TransactionClient,
		productId: string,
		variant: ProductVariantData,
		attributes: ResolvedVariantAttribute[]
	): Promise<void> {
		const created = await tx.productVariant.create({
			data: {
				productId,
				sku: variant.sku,
				variantKey: variant.variantKey,
				stock: variant.stock,
				price: variant.price,
				status: variant.status,
				isAvailable: variant.status === ProductVariantStatus.ACTIVE
			}
		})

		if (!attributes.length) return

		await tx.variantAttribute.createMany({
			data: attributes.map(attribute => ({
				variantId: created.id,
				attributeId: attribute.attributeId,
				enumValueId: attribute.enumValueId
			}))
		})
	}

	private async loadExistingVariantsForUpdate(
		tx: Prisma.TransactionClient,
		productId: string,
		variants: ProductVariantUpdateData[]
	): Promise<Map<string, ExistingVariantUpdateRow>> {
		const variantKeys = variants.map(variant => variant.variantKey)
		const existing = await tx.productVariant.findMany({
			where: { productId, variantKey: { in: variantKeys }, deleteAt: null },
			select: { id: true, variantKey: true, status: true }
		})

		return new Map(existing.map(variant => [variant.variantKey, variant]))
	}

	private assertVariantUpdateTargetsExist(
		existingMap: Map<string, ExistingVariantUpdateRow>,
		variants: ProductVariantUpdateData[]
	): void {
		for (const variant of variants) {
			if (!existingMap.has(variant.variantKey)) {
				throw new BadRequestException(
					`Вариант с ключом ${variant.variantKey} не найден`
				)
			}
		}
	}

	private buildVariantUpdateData(
		variant: ProductVariantUpdateData,
		currentStatus: ProductVariantStatus
	): Prisma.ProductVariantUpdateInput {
		const data: Prisma.ProductVariantUpdateInput = {}
		if (variant.price !== undefined) data.price = variant.price
		if (variant.stock !== undefined) data.stock = variant.stock

		const nextStatus =
			variant.status ??
			(variant.stock !== undefined
				? currentStatus === ProductVariantStatus.DISABLED
					? ProductVariantStatus.DISABLED
					: variant.stock > 0
						? ProductVariantStatus.ACTIVE
						: ProductVariantStatus.OUT_OF_STOCK
				: undefined)
		if (nextStatus !== undefined) {
			data.status = nextStatus
			data.isAvailable = nextStatus === ProductVariantStatus.ACTIVE
		}

		return data
	}
}

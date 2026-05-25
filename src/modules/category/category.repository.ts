import { type Prisma, Prisma as PrismaSql } from '@generated/client'
import { ProductStatus, ProductVariantKind } from '@generated/enums'
import { SortOrder } from '@generated/internal/prismaNamespace'
import { CategoryCreateInput, CategoryUpdateInput } from '@generated/models'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { buildMediaSelect } from '@/shared/media/media-select'
import { MEDIA_LIST_VARIANT_NAMES } from '@/shared/media/media-url.service'

import {
	type CategoryProductCursor,
	decodeCategoryProductsCursor
} from './category-products.utils'

const uuidRegex =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEFAULT_VARIANT_KEY = 'default'

function buildCategorySelect(includeInactive = false) {
	return {
		id: true,
		catalogId: true,
		parentId: true,
		position: true,
		_count: {
			select: {
				categoryProducts: {
					where: {
						product: {
							deleteAt: null,
							...(!includeInactive ? { status: ProductStatus.ACTIVE } : {})
						}
					}
				}
			}
		},
		name: true,
		imageMedia: {
			select: buildMediaSelect()
		},
		descriptor: true,
		discount: true,
		createdAt: true,
		updatedAt: true
	} satisfies Prisma.CategorySelect
}

const categorySelect = buildCategorySelect(false)

function buildProductMediaSelect() {
	return {
		select: {
			position: true,
			kind: true,
			media: {
				select: buildMediaSelect(MEDIA_LIST_VARIANT_NAMES)
			}
		},
		orderBy: { position: 'asc' as const }
	}
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
	productType: {
		select: {
			id: true,
			code: true,
			name: true
		}
	},
	media: buildProductMediaSelect(),
	integrationLinks: {
		select: {
			externalId: true,
			externalCode: true,
			lastSyncedAt: true,
			integration: {
				select: {
					provider: true
				}
			}
		},
		orderBy: { createdAt: 'asc' as const },
		take: 1
	},
	isPopular: true,
	status: true,
	position: true,
	createdAt: true,
	updatedAt: true
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
		select: {
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
	},
	enumValue: {
		select: {
			id: true,
			value: true,
			displayName: true,
			displayOrder: true,
			businessId: true
		}
	}
}

const productVariantSaleUnitSelect = {
	id: true,
	catalogSaleUnitId: true,
	code: true,
	name: true,
	baseQuantity: true,
	price: true,
	barcode: true,
	isDefault: true,
	isActive: true,
	displayOrder: true,
	catalogSaleUnit: {
		select: {
			id: true,
			code: true,
			name: true,
			defaultBaseQuantity: true
		}
	},
	createdAt: true,
	updatedAt: true
}

const productSaleUnitVariantSelect = {
	where: {
		deleteAt: null,
		OR: [
			{ kind: ProductVariantKind.DEFAULT },
			{ variantKey: DEFAULT_VARIANT_KEY }
		],
		saleUnits: {
			some: { deleteAt: null }
		}
	},
	select: {
		id: true,
		variantKey: true,
		kind: true,
		saleUnits: {
			where: { deleteAt: null },
			select: productVariantSaleUnitSelect,
			orderBy: [
				{ isDefault: 'desc' as const },
				{ displayOrder: 'asc' as const },
				{ code: 'asc' as const }
			]
		}
	},
	orderBy: { createdAt: 'asc' as const }
}

const productSelectWithAttributes = {
	...productSelect,
	productAttributes: {
		where: { deleteAt: null },
		select: productAttributeSelect,
		orderBy: { attributeId: SortOrder.asc }
	},
	variants: productSaleUnitVariantSelect
}

const categorySelectWithRelations = {
	...categorySelect,
	parent: {
		select: { id: true, name: true }
	},
	children: {
		where: { deleteAt: null },
		select: {
			id: true,
			parentId: true,
			position: true,
			name: true,
			imageMedia: {
				select: buildMediaSelect()
			}
		},
		orderBy: [{ position: SortOrder.asc }, { name: SortOrder.asc }]
	}
}

export type CategorySelect = Prisma.CategoryGetPayload<{
	select: typeof categorySelect
}>

export type CategorySelectWithRelations = Prisma.CategoryGetPayload<{
	select: typeof categorySelectWithRelations
}>

@Injectable()
export class CategoryRepository {
	constructor(private readonly prisma: PrismaService) {}

	findAll(catalogId: string, options: { includeInactive?: boolean } = {}) {
		return this.prisma.category.findMany({
			where: { catalogId, deleteAt: null },
			select: options.includeInactive ? buildCategorySelect(true) : categorySelect,
			orderBy: [{ position: SortOrder.asc }, { name: SortOrder.asc }]
		})
	}

	findById(
		id: string,
		catalogId: string,
		withRelations: true
	): Promise<CategorySelectWithRelations | null>
	findById(
		id: string,
		catalogId: string,
		withRelations?: false
	): Promise<CategorySelect | null>
	findById(
		id: string,
		catalogId: string,
		withRelations = false
	): Promise<CategorySelect | CategorySelectWithRelations | null> {
		return this.prisma.category.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: withRelations ? categorySelectWithRelations : categorySelect
		})
	}

	create(data: CategoryCreateInput) {
		return this.prisma.category.create({ data, select: categorySelect })
	}

	async updatePositions(updates: { id: string; position: number }[]) {
		if (!updates.length) return

		const values = updates.map(
			update =>
				PrismaSql.sql`(CAST(${update.id} AS uuid), CAST(${update.position} AS integer))`
		)

		await this.prisma.$executeRaw(PrismaSql.sql`
			UPDATE "categories" AS category
			SET
				"position" = input."position",
				"updated_at" = NOW()
			FROM (
				VALUES ${PrismaSql.join(values)}
			) AS input("id", "position")
			WHERE
				category."id" = input."id"
				AND category."delete_at" IS NULL
		`)
	}

	async update(
		id: string,
		catalogId: string,
		data: CategoryUpdateInput
	): Promise<CategorySelectWithRelations | null> {
		const existing = await this.prisma.category.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: { id: true }
		})
		if (!existing) return null

		await this.prisma.category.update({
			where: { id },
			data
		})

		return this.prisma.category.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: categorySelectWithRelations
		})
	}

	async softDelete(id: string, catalogId: string) {
		const result = await this.prisma.category.updateMany({
			where: { id, catalogId, deleteAt: null },
			data: { deleteAt: new Date() }
		})
		if (!result.count) return null

		return this.prisma.category.findFirst({
			where: { id, catalogId },
			select: categorySelect
		})
	}

	async findProductsByIds(productIds: string[], catalogId: string) {
		if (!productIds.length) return []

		return this.prisma.product.findMany({
			where: { id: { in: productIds }, catalogId, deleteAt: null },
			select: { id: true }
		})
	}

	async findProductIdsByCategory(categoryId: string, catalogId: string) {
		const links = await this.prisma.categoryProduct.findMany({
			where: {
				categoryId,
				category: { catalogId, deleteAt: null },
				product: { catalogId, deleteAt: null }
			},
			select: { productId: true },
			orderBy: [{ position: SortOrder.asc }, { productId: SortOrder.asc }]
		})

		return links.map(link => link.productId)
	}

	async findCategoryProductPositions(
		categoryId: string,
		catalogId: string,
		productIds: string[]
	) {
		if (!productIds.length) return []

		return this.prisma.categoryProduct.findMany({
			where: {
				categoryId,
				productId: { in: productIds },
				category: { catalogId, deleteAt: null },
				product: { catalogId, deleteAt: null }
			},
			select: { productId: true, position: true }
		})
	}

	async findCategoryProductsPage(
		categoryId: string,
		catalogId: string,
		options: { cursor?: string; take: number; includeInactive?: boolean }
	) {
		const { cursor, take, includeInactive } = options
		const after = await this.resolveCursor(categoryId, catalogId, cursor)
		const where: Prisma.CategoryProductWhereInput = {
			categoryId,
			category: { catalogId, deleteAt: null },
			product: {
				catalogId,
				deleteAt: null,
				...(includeInactive ? {} : { status: ProductStatus.ACTIVE })
			}
		}

		if (after) {
			where.OR = [
				{ position: { gt: after.position } },
				{
					position: after.position,
					productId: { gt: after.productId }
				}
			]
		}

		return this.prisma.categoryProduct.findMany({
			where,
			select: {
				productId: true,
				position: true,
				product: { select: productSelectWithAttributes }
			},
			orderBy: [{ position: SortOrder.asc }, { productId: SortOrder.asc }],
			take
		})
	}

	async findCategoryProductCardsPage(
		categoryId: string,
		catalogId: string,
		options: { cursor?: string; take: number; includeInactive?: boolean }
	) {
		const { cursor, take, includeInactive } = options
		const after = await this.resolveCursor(categoryId, catalogId, cursor)
		const where: Prisma.CategoryProductWhereInput = {
			categoryId,
			category: { catalogId, deleteAt: null },
			product: {
				catalogId,
				deleteAt: null,
				...(includeInactive ? {} : { status: ProductStatus.ACTIVE })
			}
		}

		if (after) {
			where.OR = [
				{ position: { gt: after.position } },
				{
					position: after.position,
					productId: { gt: after.productId }
				}
			]
		}

		return this.prisma.categoryProduct.findMany({
			where,
			select: {
				productId: true,
				position: true,
				product: { select: productSelectWithAttributes }
			},
			orderBy: [{ position: SortOrder.asc }, { productId: SortOrder.asc }],
			take
		})
	}

	private async resolveCursor(
		categoryId: string,
		catalogId: string,
		cursor?: string
	): Promise<CategoryProductCursor | null> {
		if (!cursor) return null

		const decoded = decodeCategoryProductsCursor(cursor)
		if (decoded) return decoded

		if (!uuidRegex.test(cursor)) return null

		const record = await this.prisma.categoryProduct.findFirst({
			where: {
				categoryId,
				productId: cursor,
				category: { catalogId, deleteAt: null },
				product: { catalogId, deleteAt: null }
			},
			select: { productId: true, position: true }
		})

		return record
			? { productId: record.productId, position: record.position }
			: null
	}
}

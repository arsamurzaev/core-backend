import type { Prisma } from '@generated/client'
import { Prisma as PrismaSql } from '@generated/client'
import {
	DataType,
	ProductStatus,
	ProductTypeScope,
	ProductVariantStatus
} from '@generated/enums'
import { ProductCreateInput, ProductUpdateInput } from '@generated/models'
import { BadRequestException, Injectable } from '@nestjs/common'
import slugify from 'slugify'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { buildMediaSelect } from '@/shared/media/media-select'
import {
	MEDIA_DETAIL_VARIANT_NAMES,
	MEDIA_LIST_VARIANT_NAMES
} from '@/shared/media/media-url.service'

import type { ProductAttributeValueData } from './product-attribute.builder'
import { tokenizeProductSearchTerm } from './product-search.utils'
import type {
	ProductVariantAttributeInput,
	ProductVariantData,
	ProductVariantSaleUnitInput
} from './product-variant.builder'

export type ProductVariantUpdateData = {
	variantKey: string
	price?: number | null
	stock?: number
	status?: ProductVariantStatus
	saleUnits?: ProductVariantSaleUnitInput[]
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
	productTypeId?: string
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

const DEFAULT_VARIANT_KEY = 'default'

const productIdSelect = {
	id: true
}

const productValidationRefSelect = {
	id: true,
	productTypeId: true,
	productAttributes: {
		where: { deleteAt: null },
		select: { attributeId: true }
	},
	variants: {
		where: { deleteAt: null },
		select: {
			variantKey: true,
			attributes: {
				where: { deleteAt: null },
				select: {
					attributeId: true,
					enumValueId: true
				}
			}
		}
	}
}

const productTypeCompatibilityAttributeSelect = {
	id: true,
	key: true,
	displayName: true,
	dataType: true,
	isVariantAttribute: true,
	isHidden: true,
	types: {
		select: { id: true }
	}
}

const productTypeCompatibilityPreviewSelect = {
	id: true,
	productTypeId: true,
	catalog: {
		select: { typeId: true }
	},
	productAttributes: {
		where: { deleteAt: null },
		select: {
			attributeId: true,
			attribute: {
				select: productTypeCompatibilityAttributeSelect
			}
		}
	},
	variants: {
		where: { deleteAt: null },
		select: {
			variantKey: true,
			attributes: {
				where: { deleteAt: null },
				select: {
					attributeId: true,
					attribute: {
						select: productTypeCompatibilityAttributeSelect
					}
				}
			}
		}
	}
}

const productTypeValidationSchemaSelect = {
	id: true,
	catalogId: true,
	attributes: {
		where: { attribute: { deleteAt: null } },
		select: {
			attributeId: true,
			isVariant: true,
			isRequired: true,
			displayOrder: true,
			attribute: {
				select: {
					id: true,
					key: true,
					dataType: true
				}
			}
		},
		orderBy: [{ displayOrder: 'asc' as const }, { attributeId: 'asc' as const }]
	}
}

function buildProductMediaSelect(variantNames?: readonly string[]) {
	return {
		select: {
			position: true,
			kind: true,
			media: {
				select: buildMediaSelect(variantNames)
			}
		},
		orderBy: { position: 'asc' as const }
	}
}

const integrationLinkPublicSelect = {
	externalId: true,
	externalCode: true,
	lastSyncedAt: true,
	integration: {
		select: {
			provider: true
		}
	}
}

function buildProductSelect(variantNames?: readonly string[]) {
	return {
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
		media: buildProductMediaSelect(variantNames),
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
		integrationLinks: {
			select: integrationLinkPublicSelect,
			orderBy: { createdAt: 'asc' as const },
			take: 1
		},
		isPopular: true,
		status: true,
		position: true,
		createdAt: true,
		updatedAt: true
	}
}

const productListSelect = buildProductSelect(MEDIA_LIST_VARIANT_NAMES)
const productDetailSelect = buildProductSelect(MEDIA_DETAIL_VARIANT_NAMES)

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
	},
	saleUnits: {
		where: { deleteAt: null },
		select: productVariantSaleUnitSelect,
		orderBy: [
			{ isDefault: 'desc' as const },
			{ displayOrder: 'asc' as const },
			{ code: 'asc' as const }
		]
	}
}

const productVariantPickerOptionSelect = {
	id: true,
	productId: true,
	sku: true,
	variantKey: true,
	stock: true,
	price: true,
	status: true,
	isAvailable: true,
	createdAt: true,
	attributes: {
		where: { deleteAt: null },
		select: variantAttributeSelect,
		orderBy: { attributeId: 'asc' as const }
	},
	saleUnits: {
		where: {
			deleteAt: null,
			isActive: true
		},
		select: {
			id: true,
			baseQuantity: true,
			price: true,
			isDefault: true,
			displayOrder: true
		},
		orderBy: [
			{ isDefault: 'desc' as const },
			{ displayOrder: 'asc' as const },
			{ createdAt: 'asc' as const }
		]
	}
}

const productVariantSelectWithIntegration = {
	...productVariantSelect,
	integrationLinks: {
		select: integrationLinkPublicSelect,
		orderBy: { createdAt: 'asc' as const },
		take: 1
	}
}

const productListSelectWithAttributes = {
	...productListSelect,
	productAttributes: {
		where: { deleteAt: null },
		select: productAttributeSelect,
		orderBy: { attributeId: 'asc' as const }
	}
}

const productDetailSelectWithAttributes = {
	...productDetailSelect,
	productAttributes: {
		where: { deleteAt: null },
		select: productAttributeSelect,
		orderBy: { attributeId: 'asc' as const }
	}
}

const productDetailSelectWithDetails = {
	...productDetailSelectWithAttributes,
	variants: {
		where: { deleteAt: null },
		select: productVariantSelectWithIntegration,
		orderBy: [{ status: 'asc' as const }, { createdAt: 'desc' as const }]
	}
}

const productPublicDetailSelectWithDetails = {
	...productDetailSelectWithAttributes,
	variants: {
		where: {
			deleteAt: null,
			status: { not: ProductVariantStatus.DISABLED }
		},
		select: productVariantSelect,
		orderBy: [{ status: 'asc' as const }, { createdAt: 'desc' as const }]
	}
}

export type ProductListItem = Prisma.ProductGetPayload<{
	select: typeof productListSelect
}>

export type ProductWithAttributesItem = Prisma.ProductGetPayload<{
	select: typeof productListSelectWithAttributes
}>

export type ProductPopularItem = Prisma.ProductGetPayload<{
	select: typeof productListSelectWithAttributes
}>

export type ProductDetailsItem = Prisma.ProductGetPayload<{
	select: typeof productDetailSelectWithDetails
}>

export type ProductPublicDetailsItem = Prisma.ProductGetPayload<{
	select: typeof productPublicDetailSelectWithDetails
}>

export type ProductValidationRef = Prisma.ProductGetPayload<{
	select: typeof productValidationRefSelect
}>

export type ProductTypeCompatibilityPreviewRef = Prisma.ProductGetPayload<{
	select: typeof productTypeCompatibilityPreviewSelect
}>

export type ProductTypeValidationSchema = Prisma.ProductTypeGetPayload<{
	select: typeof productTypeValidationSchemaSelect
}>

export type ProductVariantSummaryRecord = {
	productId: string
	minPrice: string | null
	maxPrice: string | null
	activeCount: number
	totalStock: number
	singleVariantId: string | null
}

export type ProductVariantPickerOptionRecord = Prisma.ProductVariantGetPayload<{
	select: typeof productVariantPickerOptionSelect
}>

export type ExpiredDiscountProductRef = {
	productId: string
	catalogId: string
}

type ProductReadExecutor =
	| Pick<PrismaService, 'product'>
	| Pick<Prisma.TransactionClient, 'product'>

type ProductVariantInvariantExecutor =
	| Pick<PrismaService, 'product' | 'productVariant'>
	| Pick<Prisma.TransactionClient, 'product' | 'productVariant'>

type ProductUpdateChanges = {
	hasData: boolean
	hasBrandChanges: boolean
	hasAttributeChanges: boolean
	hasRemovedAttributeChanges: boolean
	hasRemovedVariantAttributeChanges: boolean
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

type NormalizedVariantSaleUnit = {
	catalogSaleUnitId: string
	code: string
	name: string
	baseQuantity: number
	price: number
	barcode: string | null
	isDefault: boolean
	isActive: boolean
	displayOrder: number
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
	): Promise<ProductWithAttributesItem[]> {
		return this.prisma.product.findMany({
			where: {
				deleteAt: null,
				catalogId,
				...(includeInactive ? {} : { status: ProductStatus.ACTIVE })
			},
			select: productListSelectWithAttributes,
			orderBy: { createdAt: 'desc' }
		})
	}

	findPopular(
		catalogId: string,
		includeInactive = false
	): Promise<ProductPopularItem[]> {
		return this.prisma.product.findMany({
			where: {
				deleteAt: null,
				catalogId,
				isPopular: true,
				...(includeInactive ? {} : { status: ProductStatus.ACTIVE })
			},
			select: productListSelectWithAttributes,
			orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
		})
	}

	findPopularCards(
		catalogId: string,
		includeInactive = false
	): Promise<ProductWithAttributesItem[]> {
		return this.prisma.product.findMany({
			where: {
				deleteAt: null,
				catalogId,
				isPopular: true,
				...(includeInactive ? {} : { status: ProductStatus.ACTIVE })
			},
			select: productListSelectWithAttributes,
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
			select: productDetailSelectWithDetails
		})
	}

	findPublicById(
		id: string,
		catalogId: string,
		includeInactive = false
	): Promise<ProductPublicDetailsItem | null> {
		return this.prisma.product.findFirst({
			where: {
				id,
				catalogId,
				deleteAt: null,
				...(includeInactive ? {} : { status: ProductStatus.ACTIVE })
			},
			select: productPublicDetailSelectWithDetails
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
			select: productDetailSelectWithDetails
		})
	}

	findPublicBySlug(
		slug: string,
		catalogId: string,
		includeInactive = false
	): Promise<ProductPublicDetailsItem | null> {
		return this.prisma.product.findFirst({
			where: {
				slug,
				catalogId,
				deleteAt: null,
				...(includeInactive ? {} : { status: ProductStatus.ACTIVE })
			},
			select: productPublicDetailSelectWithDetails
		})
	}

	findByIds(
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
			select: productListSelectWithAttributes
		})
	}

	async findVariantSummaries(
		productIds: string[]
	): Promise<ProductVariantSummaryRecord[]> {
		const ids = [...new Set(productIds.filter(Boolean))]
		if (!ids.length) return []

		const rows = await this.prisma.$queryRaw<
			Array<{
				productId: string
				minPrice: string | null
				maxPrice: string | null
				activeCount: number
				totalStock: number
				singleVariantId: string | null
			}>
		>(PrismaSql.sql`
			SELECT
				product_id::text as "productId",
				MIN(price)::text as "minPrice",
				MAX(price)::text as "maxPrice",
				COUNT(*)::int as "activeCount",
				COALESCE(SUM(stock), 0)::int as "totalStock",
				CASE
					WHEN COUNT(*) = 1 THEN (ARRAY_AGG(id::text ORDER BY id::text))[1]
					ELSE NULL
				END as "singleVariantId"
			FROM product_variants
			WHERE delete_at IS NULL
				AND status::text <> ${ProductVariantStatus.DISABLED}
				AND product_id IN (${PrismaSql.join(ids.map(id => PrismaSql.sql`${id}::uuid`))})
			GROUP BY product_id
		`)

		return rows.map(row => ({
			productId: row.productId,
			minPrice: row.minPrice,
			maxPrice: row.maxPrice,
			activeCount: Number(row.activeCount),
			totalStock: Number(row.totalStock),
			singleVariantId: row.singleVariantId
		}))
	}

	findVariantPickerOptions(
		productIds: string[]
	): Promise<ProductVariantPickerOptionRecord[]> {
		const ids = [...new Set(productIds.filter(Boolean))]
		if (!ids.length)
			return Promise.resolve<ProductVariantPickerOptionRecord[]>([])

		return this.prisma.productVariant.findMany({
			where: {
				productId: { in: ids },
				deleteAt: null,
				status: { not: ProductVariantStatus.DISABLED }
			},
			select: productVariantPickerOptionSelect,
			orderBy: [
				{ productId: 'asc' },
				{ status: 'asc' },
				{ createdAt: 'asc' },
				{ id: 'asc' }
			]
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
			select: productListSelectWithAttributes
		})
	}

	findByIdsWithDetails(
		ids: string[],
		catalogId: string
	): Promise<ProductDetailsItem[]> {
		if (!ids.length) return Promise.resolve<ProductDetailsItem[]>([])

		return this.prisma.product.findMany({
			where: {
				id: { in: ids },
				catalogId,
				deleteAt: null
			},
			select: productDetailSelectWithDetails
		})
	}

	findIdsByCatalog(
		catalogId: string,
		take: number,
		cursorId?: string
	): Promise<Array<{ id: string }>> {
		return this.prisma.product.findMany({
			where: { catalogId, deleteAt: null },
			select: { id: true },
			orderBy: { id: 'asc' },
			take,
			...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {})
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
			select: productListSelectWithAttributes,
			orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
			take
		})
	}

	findUncategorizedCardsPage(
		catalogId: string,
		options: {
			cursor?: ProductDefaultPageCursor
			take: number
			includeInactive?: boolean
		}
	): Promise<ProductWithAttributesItem[]> {
		return this.findUncategorizedPage(catalogId, options)
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
			select: { id: true, sku: true, price: true, productTypeId: true }
		})
	}

	findProductValidationRef(
		id: string,
		catalogId: string
	): Promise<ProductValidationRef | null> {
		return this.prisma.product.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: productValidationRefSelect
		})
	}

	findProductTypeCompatibilityPreviewRef(
		id: string,
		catalogId: string
	): Promise<ProductTypeCompatibilityPreviewRef | null> {
		return this.prisma.product.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: productTypeCompatibilityPreviewSelect
		})
	}

	findBrandById(id: string, catalogId: string) {
		return this.prisma.brand.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: { id: true }
		})
	}

	findProductTypeById(id: string, catalogId: string) {
		return this.prisma.productType.findFirst({
			where: {
				id,
				catalogId,
				scope: ProductTypeScope.CATALOG,
				isActive: true,
				isArchived: false
			},
			select: { id: true }
		})
	}

	findProductTypeValidationSchemaById(
		id: string,
		catalogId: string,
		options: { includeArchived?: boolean } = {}
	): Promise<ProductTypeValidationSchema | null> {
		return this.prisma.productType.findFirst({
			where: {
				id,
				catalogId,
				scope: ProductTypeScope.CATALOG,
				...(options.includeArchived
					? {}
					: {
							isActive: true,
							isArchived: false
						})
			},
			select: productTypeValidationSchemaSelect
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

	async existsVariantSku(sku: string, excludeId?: string): Promise<boolean> {
		const variant = await this.prisma.productVariant.findUnique({
			where: { sku },
			select: { id: true }
		})
		if (!variant) return false
		if (!excludeId) return true
		return variant.id !== excludeId
	}

	create(
		catalogId: string,
		data: ProductCreateInput,
		attributes?: ProductAttributeValueData[],
		variants?: ProductVariantData[]
	) {
		return this.prisma.$transaction(tx =>
			this.createWithRelations(tx, catalogId, data, attributes, variants)
		)
	}

	async update(
		id: string,
		data: ProductUpdateInput,
		catalogId: string,
		attributes?: ProductAttributeValueData[],
		removeAttributeIds?: string[],
		variantUpdates?: ProductVariantUpdateData[],
		mediaIds?: string[],
		removeVariantAttributeIds?: string[]
	) {
		const changes = this.describeUpdateChanges(
			data,
			attributes,
			removeAttributeIds,
			variantUpdates,
			mediaIds,
			removeVariantAttributeIds
		)

		if (this.canUpdateDirectly(changes)) {
			return this.updateWithoutRelations(id, data, catalogId, changes.hasData)
		}

		return this.prisma.$transaction(async tx => {
			const existing = await this.findActiveProductRef(tx, id, catalogId)
			if (!existing) return null

			await this.applyProductDataUpdate(tx, id, data, changes.hasData)
			if (variantUpdates === undefined) {
				await this.syncSingleDefaultVariantPrice(tx, id, data)
			}
			await this.removeProductAttributes(tx, id, removeAttributeIds)
			await this.removeVariantAttributes(tx, id, removeVariantAttributeIds)
			await this.upsertProductAttributes(tx, id, attributes)
			await this.replaceProductMedia(tx, id, mediaIds)

			if (variantUpdates?.length) {
				await this.applyVariantUpdates(tx, catalogId, id, variantUpdates)
			}
			await this.assertActiveProductHasValidVariant(tx, id)

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
					},
					categoryProducts: {
						where: {
							category: { catalogId, deleteAt: null }
						},
						select: {
							categoryId: true,
							position: true
						}
					}
				}
			})
			if (!existing) return null

			const categoryIds = existing.categoryProducts.map(item => item.categoryId)
			await this.normalizeCategoryProductPositions(tx, categoryIds)
			const categoryProducts = categoryIds.length
				? await tx.categoryProduct.findMany({
						where: {
							productId: id,
							category: { catalogId, deleteAt: null }
						},
						select: {
							categoryId: true,
							position: true
						}
					})
				: []
			await this.closeCategoryProductGaps(tx, categoryProducts)

			await tx.categoryProduct.deleteMany({
				where: { productId: id }
			})

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
		return this.prisma.$transaction(async tx => {
			const existing = await tx.product.findFirst({
				where: { id, catalogId, deleteAt: null },
				select: { id: true, status: true }
			})
			if (!existing) return null

			const nextStatus =
				existing.status === ProductStatus.ACTIVE
					? ProductStatus.HIDDEN
					: ProductStatus.ACTIVE
			await this.assertActiveProductHasValidVariant(tx, id, nextStatus)

			await tx.product.update({
				where: { id },
				data: {
					status: nextStatus
				}
			})

			return this.findProductWithDetails(tx, id, catalogId)
		})
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

	async expireScheduledDiscounts(
		now: Date
	): Promise<ExpiredDiscountProductRef[]> {
		return this.prisma.$transaction(async tx => {
			const expiredProducts = await tx.product.findMany({
				where: {
					deleteAt: null,
					productAttributes: {
						some: {
							deleteAt: null,
							valueDateTime: { lte: now },
							attribute: {
								is: {
									key: 'discountEndAt'
								}
							}
						}
					}
				},
				select: {
					id: true,
					catalogId: true
				}
			})

			if (!expiredProducts.length) return []

			const productIds = expiredProducts.map(product => product.id)
			const resetAttributeValues = {
				enumValueId: null,
				valueString: null,
				valueInteger: null,
				valueDecimal: null,
				valueBoolean: null,
				valueDateTime: null
			}

			await Promise.all([
				tx.productAttribute.updateMany({
					where: {
						deleteAt: null,
						productId: { in: productIds },
						attribute: {
							is: {
								key: 'discount'
							}
						}
					},
					data: {
						...resetAttributeValues,
						valueInteger: 0
					}
				}),
				tx.productAttribute.updateMany({
					where: {
						deleteAt: null,
						productId: { in: productIds },
						attribute: {
							is: {
								key: 'discountedPrice'
							}
						}
					},
					data: resetAttributeValues
				}),
				tx.productAttribute.updateMany({
					where: {
						deleteAt: null,
						productId: { in: productIds },
						attribute: {
							is: {
								key: 'discountStartAt'
							}
						}
					},
					data: resetAttributeValues
				}),
				tx.productAttribute.updateMany({
					where: {
						deleteAt: null,
						productId: { in: productIds },
						attribute: {
							is: {
								key: 'discountEndAt'
							}
						}
					},
					data: resetAttributeValues
				})
			])

			return expiredProducts.map(product => ({
				productId: product.id,
				catalogId: product.catalogId
			}))
		})
	}

	async setVariants(
		id: string,
		catalogId: string,
		variants: ProductVariantData[]
	) {
		return this.prisma.$transaction(async tx => {
			const existing = await this.findActiveProductRef(tx, id, catalogId)
			if (!existing) return null

			await this.applyVariants(tx, catalogId, id, variants)
			await this.assertActiveProductHasValidVariant(tx, id)

			return this.findProductWithDetails(tx, id, catalogId)
		})
	}

	async applyProductTypeChange(
		id: string,
		catalogId: string,
		data: ProductUpdateInput,
		removeAttributeIds: string[],
		attributes?: ProductAttributeValueData[],
		variants?: ProductVariantData[]
	): Promise<ProductDetailsItem | null> {
		return this.prisma.$transaction(async tx => {
			const existing = await this.findActiveProductRef(tx, id, catalogId)
			if (!existing) return null

			await this.applyProductDataUpdate(tx, id, data, true)
			await this.removeProductAttributes(tx, id, removeAttributeIds)
			await this.upsertProductAttributes(tx, id, attributes)
			if (variants !== undefined) {
				await this.applyVariants(tx, catalogId, id, variants)
			}
			await this.assertActiveProductHasValidVariant(tx, id)

			return this.findProductWithDetails(tx, id, catalogId)
		})
	}

	private describeUpdateChanges(
		data: ProductUpdateInput,
		attributes?: ProductAttributeValueData[],
		removeAttributeIds?: string[],
		variantUpdates?: ProductVariantUpdateData[],
		mediaIds?: string[],
		removeVariantAttributeIds?: string[]
	): ProductUpdateChanges {
		return {
			hasData: Object.keys(data).length > 0,
			hasBrandChanges: Object.hasOwn(data, 'brand'),
			hasAttributeChanges: attributes !== undefined,
			hasRemovedAttributeChanges: removeAttributeIds !== undefined,
			hasRemovedVariantAttributeChanges: removeVariantAttributeIds !== undefined,
			hasVariantChanges: variantUpdates !== undefined,
			hasMediaChanges: mediaIds !== undefined
		}
	}

	private canUpdateDirectly(changes: ProductUpdateChanges): boolean {
		return (
			!changes.hasAttributeChanges &&
			!changes.hasRemovedAttributeChanges &&
			!changes.hasRemovedVariantAttributeChanges &&
			!changes.hasVariantChanges &&
			!changes.hasMediaChanges &&
			!changes.hasBrandChanges
		)
	}

	private async createWithRelations(
		tx: Prisma.TransactionClient,
		catalogId: string,
		data: ProductCreateInput,
		attributes?: ProductAttributeValueData[],
		variants?: ProductVariantData[]
	) {
		const product = await tx.product.create({
			data,
			select: productIdSelect
		})

		await this.createProductAttributes(tx, product.id, attributes)

		if (variants?.length) {
			await this.applyVariants(tx, catalogId, product.id, variants)
		}
		await this.assertActiveProductHasValidVariant(tx, product.id)

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
		return this.prisma.$transaction(async tx => {
			if (hasData) {
				const result = await tx.product.updateMany({
					where: { id, catalogId, deleteAt: null },
					data
				})
				if (!result.count) return null
				await this.syncSingleDefaultVariantPrice(tx, id, data)
			} else {
				const existing = await this.findActiveProductRef(tx, id, catalogId)
				if (!existing) return null
			}
			await this.assertActiveProductHasValidVariant(tx, id)

			return this.findProductWithDetails(tx, id, catalogId)
		})
	}

	private async assertActiveProductHasValidVariant(
		db: ProductVariantInvariantExecutor,
		productId: string,
		statusOverride?: ProductStatus
	): Promise<void> {
		const status =
			statusOverride ??
			(
				await db.product.findFirst({
					where: { id: productId, deleteAt: null },
					select: { status: true }
				})
			)?.status

		if (status !== ProductStatus.ACTIVE) return

		const variant = await db.productVariant.findFirst({
			where: {
				productId,
				deleteAt: null,
				OR: [
					{
						status: ProductVariantStatus.ACTIVE,
						isAvailable: true
					},
					{
						variantKey: DEFAULT_VARIANT_KEY,
						status: { not: ProductVariantStatus.DISABLED }
					}
				]
			},
			select: { id: true }
		})

		if (!variant) {
			throw new BadRequestException(
				'Активный товар должен иметь активный или default variant'
			)
		}
	}

	private async syncSingleDefaultVariantPrice(
		db: Prisma.TransactionClient | PrismaService,
		productId: string,
		data: ProductUpdateInput
	): Promise<void> {
		if (!Object.hasOwn(data, 'price')) return

		const rawPrice = (data as { price?: unknown }).price
		const price = rawPrice === null ? null : Number(rawPrice)
		if (price !== null && (!Number.isFinite(price) || price < 0)) return

		const variants = await db.productVariant.findMany({
			where: { productId, deleteAt: null },
			orderBy: { createdAt: 'asc' },
			take: 2,
			select: {
				id: true,
				variantKey: true,
				price: true,
				attributes: {
					where: { deleteAt: null },
					select: { id: true },
					take: 1
				},
				integrationLinks: {
					select: { id: true },
					take: 1
				}
			}
		})
		if (variants.length !== 1) return

		const [variant] = variants
		if (
			variant.variantKey !== DEFAULT_VARIANT_KEY ||
			variant.attributes.length > 0 ||
			variant.integrationLinks.length > 0 ||
			(price === null ? variant.price === null : Number(variant.price) === price)
		) {
			return
		}

		await db.productVariant.update({
			where: { id: variant.id },
			data: { price }
		})
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
			select: productListSelectWithAttributes
		})
	}

	private async findProductWithDetails(
		db: ProductReadExecutor,
		id: string,
		catalogId: string
	): Promise<ProductDetailsItem | null> {
		return db.product.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: productDetailSelectWithDetails
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

	private async removeVariantAttributes(
		tx: Prisma.TransactionClient,
		productId: string,
		removeAttributeIds?: string[]
	): Promise<void> {
		if (!removeAttributeIds?.length) return

		await tx.variantAttribute.updateMany({
			where: {
				attributeId: { in: removeAttributeIds },
				deleteAt: null,
				variant: { productId, deleteAt: null }
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
			const currentExisting = await tx.categoryProduct.findMany({
				where: {
					productId,
					category: { catalogId, deleteAt: null }
				},
				select: {
					categoryId: true,
					position: true
				}
			})
			await this.normalizeCategoryProductPositions(tx, [
				...new Set([
					...categoryIds,
					...currentExisting.map(item => item.categoryId)
				])
			])
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
			const removed = existing.filter(
				current => !nextCategoryIds.has(current.categoryId)
			)
			const added = categoryIds.filter(
				categoryId => !existingByCategoryId.has(categoryId)
			)

			if (removed.length) {
				await this.closeCategoryProductGaps(tx, removed)
				await tx.categoryProduct.deleteMany({
					where: {
						productId,
						categoryId: { in: removed.map(item => item.categoryId) }
					}
				})
			}

			if (added.length) {
				await this.shiftCategoryProductPositionsRight(tx, added, 0)
				await tx.categoryProduct.createMany({
					data: added.map(categoryId => ({
						categoryId,
						productId,
						position: 0
					}))
				})
			}
		})
	}

	async prependProductToCategories(
		productId: string,
		catalogId: string,
		categoryIds: string[]
	) {
		if (!categoryIds.length) return

		await this.prisma.$transaction(async tx => {
			const [product, categories] = await Promise.all([
				tx.product.findFirst({
					where: { id: productId, catalogId, deleteAt: null },
					select: { id: true }
				}),
				tx.category.findMany({
					where: {
						id: { in: categoryIds },
						catalogId,
						deleteAt: null
					},
					select: { id: true }
				})
			])

			if (!product) {
				throw new BadRequestException('Товар не найден')
			}

			const foundCategoryIds = new Set(categories.map(category => category.id))
			const missingCategoryIds = categoryIds.filter(
				categoryId => !foundCategoryIds.has(categoryId)
			)
			if (missingCategoryIds.length) {
				throw new BadRequestException(
					`Категории не найдены в каталоге: ${missingCategoryIds.join(', ')}`
				)
			}

			await this.normalizeCategoryProductPositions(tx, categoryIds)
			await this.shiftCategoryProductPositionsRight(tx, categoryIds, 0)
			await tx.categoryProduct.createMany({
				data: categoryIds.map(categoryId => ({
					categoryId,
					productId,
					position: 0
				}))
			})
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

			await this.normalizeCategoryProductPositions(tx, [categoryId])
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
					product: { deleteAt: null },
					...(current ? { productId: { not: productId } } : {})
				}
			})
			const targetPosition = Math.min(normalizedPosition, siblingCount)

			if (!current) {
				await this.shiftCategoryProductPositionsRight(
					tx,
					[categoryId],
					targetPosition
				)
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
						product: { deleteAt: null },
						position: { gt: current.position, lte: targetPosition }
					},
					data: { position: { decrement: 1 } }
				})
			} else {
				await tx.categoryProduct.updateMany({
					where: {
						categoryId,
						product: { deleteAt: null },
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

	private async normalizeCategoryProductPositions(
		tx: Prisma.TransactionClient,
		categoryIds: string[]
	) {
		const uniqueCategoryIds = [...new Set(categoryIds)].filter(Boolean)
		if (!uniqueCategoryIds.length) return

		const values = uniqueCategoryIds.map(
			categoryId => PrismaSql.sql`(CAST(${categoryId} AS uuid))`
		)

		await tx.$executeRaw(PrismaSql.sql`
			UPDATE "category_products" AS category_product
			SET "position" = ranked."normalized_position"::integer
			FROM (
				SELECT
					category_product."category_id",
					category_product."product_id",
					ROW_NUMBER() OVER (
						PARTITION BY category_product."category_id"
						ORDER BY category_product."position" ASC, category_product."product_id" ASC
					) - 1 AS "normalized_position"
				FROM "category_products" AS category_product
				INNER JOIN (
					VALUES ${PrismaSql.join(values)}
				) AS input("category_id")
					ON category_product."category_id" = input."category_id"
				INNER JOIN "products" AS active_product
					ON active_product."id" = category_product."product_id"
					AND active_product."delete_at" IS NULL
			) AS ranked
			WHERE
				category_product."category_id" = ranked."category_id"
				AND category_product."product_id" = ranked."product_id"
				AND category_product."position" <> ranked."normalized_position"::integer
		`)
	}

	private async shiftCategoryProductPositionsRight(
		tx: Prisma.TransactionClient,
		categoryIds: string[],
		fromPosition: number
	) {
		if (!categoryIds.length) return

		const values = categoryIds.map(
			categoryId => PrismaSql.sql`(CAST(${categoryId} AS uuid))`
		)

		await tx.$executeRaw(PrismaSql.sql`
			UPDATE "category_products" AS category_product
			SET "position" = category_product."position" + 1
			FROM (
				VALUES ${PrismaSql.join(values)}
			) AS input("category_id")
			WHERE
				category_product."category_id" = input."category_id"
				AND category_product."position" >= CAST(${fromPosition} AS integer)
				AND EXISTS (
					SELECT 1
					FROM "products" AS active_product
					WHERE
						active_product."id" = category_product."product_id"
						AND active_product."delete_at" IS NULL
				)
		`)
	}

	private async closeCategoryProductGaps(
		tx: Prisma.TransactionClient,
		removals: Array<{ categoryId: string; position: number }>
	) {
		if (!removals.length) return

		const values = removals.map(
			removal =>
				PrismaSql.sql`(CAST(${removal.categoryId} AS uuid), CAST(${removal.position} AS integer))`
		)

		await tx.$executeRaw(PrismaSql.sql`
			UPDATE "category_products" AS category_product
			SET "position" = category_product."position" - 1
			FROM (
				VALUES ${PrismaSql.join(values)}
			) AS input("category_id", "position")
			WHERE
				category_product."category_id" = input."category_id"
				AND category_product."position" > input."position"
				AND EXISTS (
					SELECT 1
					FROM "products" AS active_product
					WHERE
						active_product."id" = category_product."product_id"
						AND active_product."delete_at" IS NULL
				)
		`)
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
				this.buildProductTypeFilterClause(query.productTypeId),
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

	private buildProductTypeFilterClause(
		productTypeId?: string
	): Prisma.Sql | null {
		if (!productTypeId) return null
		return PrismaSql.sql`p.product_type_id = ${productTypeId}::uuid`
	}

	private buildSearchFilterClause(searchTerm?: string): Prisma.Sql | null {
		const tokens = tokenizeProductSearchTerm(searchTerm)
		if (!tokens.length) return null

		const clauses = tokens.map(token => this.buildSearchTokenClause(token))
		return PrismaSql.sql`(${PrismaSql.join(clauses, ' AND ')})`
	}

	private buildSearchTokenClause(token: string): Prisma.Sql {
		const pattern = `%${escapeLikePattern(token)}%`
		return PrismaSql.sql`
			(
				LOWER(p.name) LIKE ${pattern} ESCAPE '\'
				OR LOWER(p.sku) LIKE ${pattern} ESCAPE '\'
				OR LOWER(p.slug) LIKE ${pattern} ESCAPE '\'
			)
		`
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
		catalogId: string,
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
				catalogId,
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
		catalogId: string,
		attributes: ProductVariantAttributeInput[],
		cache: Map<string, string>
	): Promise<ResolvedVariantAttribute[]> {
		if (!attributes.length) return []

		const resolved: ResolvedVariantAttribute[] = []
		for (const attribute of attributes) {
			const enumValueId = await this.resolveEnumValueId(
				tx,
				catalogId,
				attribute,
				cache
			)
			resolved.push({ attributeId: attribute.attributeId, enumValueId })
		}

		return resolved
	}

	private async resolveEnumValueId(
		tx: Prisma.TransactionClient,
		catalogId: string,
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

		const cacheKey = `${catalogId}:${attribute.attributeId}:${value}`
		const cached = cache.get(cacheKey)
		if (cached) return cached

		const existing = await tx.attributeEnumValue.findFirst({
			where: { attributeId: attribute.attributeId, catalogId, value },
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
				catalogId,
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
		catalogId: string,
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
			if (Object.keys(data).length) {
				await tx.productVariant.update({
					where: { id: current.id },
					data
				})
			}
			if (variant.saleUnits !== undefined) {
				await this.syncVariantSaleUnits(
					tx,
					catalogId,
					current.id,
					variant.saleUnits
				)
			}
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
		catalogId: string,
		productId: string,
		variant: ProductVariantData,
		existingBySku: Map<string, ExistingVariantBySku>,
		enumValueCache: Map<string, string>,
		deleteAt: Date
	): Promise<void> {
		const resolvedAttributes = await this.resolveVariantAttributes(
			tx,
			catalogId,
			variant.attributes,
			enumValueCache
		)
		const existing = existingBySku.get(variant.sku)

		if (existing?.productId === productId) {
			await this.updateExistingVariant(
				tx,
				catalogId,
				existing.id,
				variant,
				resolvedAttributes,
				deleteAt
			)
			return
		}

		await this.createVariant(
			tx,
			catalogId,
			productId,
			variant,
			resolvedAttributes
		)
	}

	private async updateExistingVariant(
		tx: Prisma.TransactionClient,
		catalogId: string,
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
		await this.syncVariantSaleUnits(tx, catalogId, variantId, variant.saleUnits)
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

	private async syncVariantSaleUnits(
		tx: Prisma.TransactionClient,
		catalogId: string,
		variantId: string,
		saleUnits: ProductVariantSaleUnitInput[] | undefined
	): Promise<void> {
		if (saleUnits === undefined) {
			return
		}

		if (!saleUnits.length) {
			await tx.productVariantSaleUnit.updateMany({
				where: { variantId, deleteAt: null },
				data: { deleteAt: new Date(), isActive: false, isDefault: false }
			})
			return
		}

		const normalized = await this.normalizeVariantSaleUnits(
			tx,
			catalogId,
			saleUnits
		)
		const now = new Date()
		const keptIds: string[] = []

		await tx.productVariantSaleUnit.updateMany({
			where: { variantId, deleteAt: null },
			data: { isDefault: false }
		})

		for (const unit of normalized) {
			const existing = await tx.productVariantSaleUnit.findFirst({
				where: {
					variantId,
					OR: [
						{ catalogSaleUnitId: unit.catalogSaleUnitId },
						{ catalogSaleUnitId: null, code: unit.code }
					]
				},
				select: { id: true }
			})

			if (existing) {
				await tx.productVariantSaleUnit.update({
					where: { id: existing.id },
					data: {
						catalogSaleUnitId: unit.catalogSaleUnitId,
						code: unit.code,
						name: unit.name,
						baseQuantity: unit.baseQuantity,
						price: unit.price,
						barcode: unit.barcode,
						isDefault: unit.isDefault,
						isActive: unit.isActive,
						displayOrder: unit.displayOrder,
						deleteAt: null
					}
				})
				keptIds.push(existing.id)
				continue
			}

			const created = await tx.productVariantSaleUnit.create({
				data: {
					variantId,
					catalogSaleUnitId: unit.catalogSaleUnitId,
					code: unit.code,
					name: unit.name,
					baseQuantity: unit.baseQuantity,
					price: unit.price,
					barcode: unit.barcode,
					isDefault: unit.isDefault,
					isActive: unit.isActive,
					displayOrder: unit.displayOrder
				},
				select: { id: true }
			})
			keptIds.push(created.id)
		}

		await tx.productVariantSaleUnit.updateMany({
			where: {
				variantId,
				deleteAt: null,
				id: { notIn: keptIds }
			},
			data: { deleteAt: now, isActive: false, isDefault: false }
		})
	}

	private async normalizeVariantSaleUnits(
		tx: Prisma.TransactionClient,
		catalogId: string,
		saleUnits: ProductVariantSaleUnitInput[]
	): Promise<NormalizedVariantSaleUnit[]> {
		const seenCatalogSaleUnitIds = new Set<string>()
		const normalized: NormalizedVariantSaleUnit[] = []

		for (const [index, unit] of saleUnits.entries()) {
			const catalogSaleUnit = await this.resolveCatalogSaleUnit(
				tx,
				catalogId,
				unit,
				index
			)
			const baseQuantity = Number(
				unit.baseQuantity ?? catalogSaleUnit.defaultBaseQuantity
			)
			const price = Number(unit.price)
			const barcode =
				unit.barcode === undefined
					? (catalogSaleUnit.barcode ?? null)
					: unit.barcode === null
						? null
						: String(unit.barcode).trim() || null

			if (seenCatalogSaleUnitIds.has(catalogSaleUnit.id)) {
				throw new BadRequestException(
					`Единица продажи ${catalogSaleUnit.name} уже добавлена к варианту`
				)
			}
			if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) {
				throw new BadRequestException(
					`Некорректное количество внутри для единицы продажи ${catalogSaleUnit.name}`
				)
			}
			if (!Number.isFinite(price) || price < 0) {
				throw new BadRequestException(
					`Некорректная цена для единицы продажи ${catalogSaleUnit.name}`
				)
			}

			seenCatalogSaleUnitIds.add(catalogSaleUnit.id)
			normalized.push({
				catalogSaleUnitId: catalogSaleUnit.id,
				code: catalogSaleUnit.code,
				name: catalogSaleUnit.name,
				baseQuantity,
				price,
				barcode,
				isDefault: unit.isDefault ?? false,
				isActive: unit.isActive ?? true,
				displayOrder: unit.displayOrder ?? index
			})
		}

		const defaultUnits = normalized.filter(unit => unit.isDefault)
		if (defaultUnits.length === 0) {
			normalized[0].isDefault = true
		} else if (defaultUnits.length > 1) {
			throw new BadRequestException(
				'У варианта должна быть ровно одна default единица продажи'
			)
		}

		return normalized
	}

	private async resolveCatalogSaleUnit(
		tx: Prisma.TransactionClient,
		catalogId: string,
		unit: ProductVariantSaleUnitInput,
		index: number
	): Promise<{
		id: string
		code: string
		name: string
		defaultBaseQuantity: Prisma.Decimal | number
		barcode: string | null
	}> {
		const catalogSaleUnitId = unit.catalogSaleUnitId?.trim()

		if (catalogSaleUnitId) {
			const found = await tx.catalogSaleUnit.findFirst({
				where: {
					id: catalogSaleUnitId,
					catalogId,
					isActive: true,
					deleteAt: null
				},
				select: {
					id: true,
					code: true,
					name: true,
					defaultBaseQuantity: true,
					barcode: true
				}
			})
			if (!found) {
				throw new BadRequestException(
					'Единица продажи не найдена в текущем каталоге'
				)
			}
			return found
		}

		const name = String(unit.name ?? '').trim()
		if (!name) {
			throw new BadRequestException(
				'Выберите единицу продажи из справочника каталога или укажите название'
			)
		}

		const code = this.normalizeSaleUnitCode(unit.code, name, index, new Set())
		const existing = await tx.catalogSaleUnit.findUnique({
			where: { catalogId_code: { catalogId, code } },
			select: {
				id: true,
				code: true,
				name: true,
				defaultBaseQuantity: true,
				barcode: true,
				deleteAt: true
			}
		})

		if (existing) {
			if (existing.deleteAt) {
				await tx.catalogSaleUnit.update({
					where: { id: existing.id },
					data: { deleteAt: null, isActive: true, name }
				})
			}
			return {
				id: existing.id,
				code: existing.code,
				name: existing.deleteAt ? name : existing.name,
				defaultBaseQuantity: existing.defaultBaseQuantity,
				barcode: existing.barcode
			}
		}

		return tx.catalogSaleUnit.create({
			data: {
				catalogId,
				code,
				name,
				defaultBaseQuantity: this.resolveCatalogSaleUnitDefaultQuantity(unit),
				barcode:
					unit.barcode === undefined || unit.barcode === null
						? null
						: String(unit.barcode).trim() || null,
				displayOrder: index
			},
			select: {
				id: true,
				code: true,
				name: true,
				defaultBaseQuantity: true,
				barcode: true
			}
		})
	}

	private resolveCatalogSaleUnitDefaultQuantity(
		unit: ProductVariantSaleUnitInput
	): number {
		const quantity = Number(unit.baseQuantity ?? 1)
		return Number.isFinite(quantity) && quantity > 0 ? quantity : 1
	}

	private normalizeSaleUnitCode(
		code: string | undefined,
		name: string,
		index: number,
		seenCodes: Set<string>
	): string {
		const rawCode = code?.trim()
		const rawName = name.trim()
		const base =
			(rawCode
				? slugify(rawCode, { lower: true, strict: true, trim: true })
				: slugify(rawName, { lower: true, strict: true, trim: true })) ||
			`unit-${index + 1}`

		let candidate = base.slice(0, 100)
		let suffix = 2
		while (seenCodes.has(candidate)) {
			const suffixText = `-${suffix}`
			candidate = `${base.slice(0, 100 - suffixText.length)}${suffixText}`
			suffix += 1
		}
		seenCodes.add(candidate)
		return candidate
	}

	private async createVariant(
		tx: Prisma.TransactionClient,
		catalogId: string,
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

		await this.syncVariantSaleUnits(tx, catalogId, created.id, variant.saleUnits)

		if (attributes.length) {
			await tx.variantAttribute.createMany({
				data: attributes.map(attribute => ({
					variantId: created.id,
					attributeId: attribute.attributeId,
					enumValueId: attribute.enumValueId
				}))
			})
		}
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

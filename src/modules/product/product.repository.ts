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

function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, char => `\\${char}`)
}

@Injectable()
export class ProductRepository {
	constructor(private readonly prisma: PrismaService) {}

	findAll(catalogId: string): Promise<ProductListItem[]> {
		return this.prisma.product.findMany({
			where: { deleteAt: null, catalogId },
			select: productSelect,
			orderBy: { createdAt: 'desc' }
		})
	}

	findPopular(catalogId: string): Promise<ProductDetailsItem[]> {
		return this.prisma.product.findMany({
			where: { deleteAt: null, catalogId, isPopular: true },
			select: productSelectWithDetails,
			orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
		})
	}

	findById(id: string, catalogId: string): Promise<ProductDetailsItem | null> {
		return this.prisma.product.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: productSelectWithDetails
		})
	}

	findBySlug(
		slug: string,
		catalogId: string
	): Promise<ProductDetailsItem | null> {
		return this.prisma.product.findFirst({
			where: { slug, catalogId, deleteAt: null },
			select: productSelectWithDetails
		})
	}

	findByIdsWithAttributes(
		ids: string[],
		catalogId: string
	): Promise<ProductWithAttributesItem[]> {
		if (!ids.length) return Promise.resolve<ProductWithAttributesItem[]>([])

		return this.prisma.product.findMany({
			where: {
				id: { in: ids },
				catalogId,
				deleteAt: null,
				status: ProductStatus.ACTIVE
			},
			select: productSelectWithAttributes
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
		const whereClauses = this.buildBaseFilterClauses(query)

		if (query.cursor) {
			whereClauses.push(PrismaSql.sql`(
				p.updated_at < ${query.cursor.updatedAt}
				OR (
					p.updated_at = ${query.cursor.updatedAt}
					AND p.id < ${query.cursor.id}::uuid
				)
			)`)
		}

		return this.prisma.$queryRaw<Array<{ id: string; updatedAt: Date }>>(
			PrismaSql.sql`
				SELECT p.id, p.updated_at AS "updatedAt"
				FROM products p
				WHERE ${PrismaSql.join(whereClauses, ' AND ')}
				ORDER BY p.updated_at DESC, p.id DESC
				LIMIT ${query.take}
			`
		)
	}

	findFilteredProductIdsPageSeeded(
		query: ProductFilterQueryBase & {
			seed: string
			cursor?: ProductSeededPageCursor
		}
	): Promise<Array<{ id: string; score: string }>> {
		const whereClauses = this.buildBaseFilterClauses(query)
		const scoreExpr = PrismaSql.sql`md5(${query.seed} || p.id::text)`

		if (query.cursor) {
			whereClauses.push(PrismaSql.sql`(
				${scoreExpr} > ${query.cursor.score}
				OR (
					${scoreExpr} = ${query.cursor.score}
					AND p.id > ${query.cursor.id}::uuid
				)
			)`)
		}

		return this.prisma.$queryRaw<Array<{ id: string; score: string }>>(
			PrismaSql.sql`
				SELECT p.id, ${scoreExpr} AS score
				FROM products p
				WHERE ${PrismaSql.join(whereClauses, ' AND ')}
				ORDER BY ${scoreExpr} ASC, p.id ASC
				LIMIT ${query.take}
			`
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
		const hasAttributes = Boolean(attributes?.length)
		const hasVariants = Boolean(variants?.length)
		if (!hasAttributes && !hasVariants) {
			return this.prisma.product.create({ data, select: productSelect })
		}

		return this.prisma.$transaction(async tx => {
			const product = await tx.product.create({
				data,
				select: productSelect
			})

			if (hasAttributes) {
				await tx.productAttribute.createMany({
					data: attributes.map(attribute => ({
						...attribute,
						productId: product.id
					}))
				})
			}

			if (hasVariants) {
				await this.applyVariants(tx, product.id, variants)
			}

			return product
		})
	}

	async update(
		id: string,
		data: ProductUpdateInput,
		catalogId: string,
		attributes?: ProductAttributeValueData[],
		variantUpdates?: ProductVariantUpdateData[],
		mediaIds?: string[]
	) {
		const hasVariantChanges = variantUpdates !== undefined
		const hasAttributeChanges = attributes !== undefined
		const hasMediaChanges = mediaIds !== undefined
		const hasBrandChanges = Object.hasOwn(data, 'brand')
		const hasData = Object.keys(data).length > 0

		if (
			!hasAttributeChanges &&
			!hasVariantChanges &&
			!hasMediaChanges &&
			!hasBrandChanges
		) {
			if (hasData) {
				const result = await this.prisma.product.updateMany({
					where: { id, catalogId, deleteAt: null },
					data
				})
				if (!result.count) return null
			} else {
				const existing = await this.prisma.product.findFirst({
					where: { id, catalogId, deleteAt: null },
					select: { id: true }
				})
				if (!existing) return null
			}

			return this.prisma.product.findFirst({
				where: { id, catalogId, deleteAt: null },
				select: productSelectWithAttributes
			})
		}

		return this.prisma.$transaction(async tx => {
			const existing = await tx.product.findFirst({
				where: { id, catalogId, deleteAt: null },
				select: { id: true }
			})
			if (!existing) return null

			if (hasData) {
				await tx.product.update({
					where: { id },
					data
				})
			}

			if (attributes?.length) {
				for (const attribute of attributes) {
					await tx.productAttribute.upsert({
						where: {
							productId_attributeId: {
								productId: id,
								attributeId: attribute.attributeId
							}
						},
						create: {
							...attribute,
							productId: id
						},
						update: {
							...attribute,
							deleteAt: null
						}
					})
				}
			}

			if (mediaIds) {
				await tx.productMedia.deleteMany({ where: { productId: id } })
				if (mediaIds.length) {
					await tx.productMedia.createMany({
						data: mediaIds.map((mediaId, index) => ({
							productId: id,
							mediaId,
							position: index
						}))
					})
				}
			}

			if (variantUpdates?.length) {
				await this.applyVariantUpdates(tx, id, variantUpdates)
			}

			return tx.product.findFirst({
				where: { id, catalogId, deleteAt: null },
				select: productSelectWithAttributes
			})
		})
	}

	async softDelete(id: string, catalogId: string) {
		const result = await this.prisma.product.updateMany({
			where: { id, catalogId, deleteAt: null },
			data: { deleteAt: new Date(), brandId: null }
		})
		if (!result.count) return null

		return this.prisma.product.findFirst({
			where: { id, catalogId },
			select: productSelect
		})
	}

	async setVariants(
		id: string,
		catalogId: string,
		variants: ProductVariantData[]
	) {
		return this.prisma.$transaction(async tx => {
			const existing = await tx.product.findFirst({
				where: { id, catalogId, deleteAt: null },
				select: { id: true }
			})
			if (!existing) return null

			await this.applyVariants(tx, id, variants)

			return tx.product.findFirst({
				where: { id, catalogId, deleteAt: null },
				select: productSelectWithDetails
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
		const clauses: Prisma.Sql[] = [
			PrismaSql.sql`p.catalog_id = ${query.catalogId}::uuid`,
			PrismaSql.sql`p.delete_at IS NULL`,
			PrismaSql.sql`p.status::text = ${ProductStatus.ACTIVE}`
		]

		if (query.categoryIds.length) {
			const categoryIds = query.categoryIds.map(
				categoryId => PrismaSql.sql`${categoryId}::uuid`
			)
			clauses.push(PrismaSql.sql`
				EXISTS (
					SELECT 1
					FROM category_products cp
					JOIN categories c ON c.id = cp.category_id
					WHERE cp.product_id = p.id
						AND cp.category_id IN (${PrismaSql.join(categoryIds)})
						AND c.catalog_id = p.catalog_id
						AND c.delete_at IS NULL
				)
			`)
		}

		if (query.brandIds.length) {
			const brandIds = query.brandIds.map(
				brandId => PrismaSql.sql`${brandId}::uuid`
			)
			clauses.push(PrismaSql.sql`p.brand_id IN (${PrismaSql.join(brandIds)})`)
		}

		if (query.minPrice !== undefined) {
			clauses.push(PrismaSql.sql`p.price >= ${query.minPrice}`)
		}

		if (query.maxPrice !== undefined) {
			clauses.push(PrismaSql.sql`p.price <= ${query.maxPrice}`)
		}

		if (query.searchTerm) {
			const pattern = `%${escapeLikePattern(query.searchTerm)}%`
			clauses.push(PrismaSql.sql`p.name ILIKE ${pattern} ESCAPE '\'`)
		}

		if (query.isPopular !== undefined) {
			clauses.push(PrismaSql.sql`p.is_popular = ${query.isPopular}`)
		}

		if (query.isDiscount) {
			clauses.push(this.buildDiscountActiveClause(query.discountAttributeIds))
		}

		for (const filter of query.attributeFilters) {
			clauses.push(this.buildAttributeFilterClause(filter))
		}

		return clauses
	}

	private buildDiscountActiveClause(ids?: DiscountAttributeIds): Prisma.Sql {
		if (!ids?.discountId) {
			return PrismaSql.sql`FALSE`
		}

		const now = new Date()
		const discountPositive = PrismaSql.sql`
			EXISTS (
				SELECT 1
				FROM product_attributes pa
				WHERE pa.product_id = p.id
					AND pa.delete_at IS NULL
					AND pa.attribute_id = ${ids.discountId}::uuid
					AND (
						(pa.value_decimal IS NOT NULL AND pa.value_decimal > 0)
						OR (pa.value_integer IS NOT NULL AND pa.value_integer > 0)
					)
			)
		`

		const startMissing = ids.discountStartAtId
			? PrismaSql.sql`
				NOT EXISTS (
					SELECT 1
					FROM product_attributes pa
					WHERE pa.product_id = p.id
						AND pa.delete_at IS NULL
						AND pa.attribute_id = ${ids.discountStartAtId}::uuid
						AND pa.value_datetime IS NOT NULL
				)
			`
			: PrismaSql.sql`TRUE`

		const startValid = ids.discountStartAtId
			? PrismaSql.sql`
				EXISTS (
					SELECT 1
					FROM product_attributes pa
					WHERE pa.product_id = p.id
						AND pa.delete_at IS NULL
						AND pa.attribute_id = ${ids.discountStartAtId}::uuid
						AND pa.value_datetime IS NOT NULL
						AND pa.value_datetime <= ${now}
				)
			`
			: PrismaSql.sql`TRUE`

		const endMissing = ids.discountEndAtId
			? PrismaSql.sql`
				NOT EXISTS (
					SELECT 1
					FROM product_attributes pa
					WHERE pa.product_id = p.id
						AND pa.delete_at IS NULL
						AND pa.attribute_id = ${ids.discountEndAtId}::uuid
						AND pa.value_datetime IS NOT NULL
				)
			`
			: PrismaSql.sql`TRUE`

		const endValid = ids.discountEndAtId
			? PrismaSql.sql`
				EXISTS (
					SELECT 1
					FROM product_attributes pa
					WHERE pa.product_id = p.id
						AND pa.delete_at IS NULL
						AND pa.attribute_id = ${ids.discountEndAtId}::uuid
						AND pa.value_datetime IS NOT NULL
						AND pa.value_datetime >= ${now}
				)
			`
			: PrismaSql.sql`TRUE`

		const activeWindow = PrismaSql.sql`
			(
				(${startMissing} AND ${endMissing})
				OR (${startValid} AND ${endMissing})
				OR (${startMissing} AND ${endValid})
				OR (${startValid} AND ${endValid})
			)
		`

		return PrismaSql.sql`(${discountPositive} AND ${activeWindow})`
	}

	private buildAttributeFilterClause(
		filter: ProductAttributeFilter
	): Prisma.Sql {
		switch (filter.kind) {
			case 'enum': {
				const values = filter.values.map(value => PrismaSql.sql`${value}`)
				return PrismaSql.sql`
					EXISTS (
						SELECT 1
						FROM product_attributes pa
						JOIN attribute_enum_values aev ON aev.id = pa.enum_value_id
						WHERE pa.product_id = p.id
							AND pa.delete_at IS NULL
							AND aev.delete_at IS NULL
							AND pa.attribute_id = ${filter.attributeId}::uuid
							AND aev.value IN (${PrismaSql.join(values)})
					)
				`
			}
			case 'variant-enum': {
				const values = filter.values.map(value => PrismaSql.sql`${value}`)
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
							AND va.attribute_id = ${filter.attributeId}::uuid
							AND aev.value IN (${PrismaSql.join(values)})
					)
				`
			}
			case 'string': {
				const values = filter.values.map(
					value => PrismaSql.sql`${value.toLowerCase()}`
				)
				return PrismaSql.sql`
					EXISTS (
						SELECT 1
						FROM product_attributes pa
						WHERE pa.product_id = p.id
							AND pa.delete_at IS NULL
							AND pa.attribute_id = ${filter.attributeId}::uuid
							AND LOWER(pa.value_string) IN (${PrismaSql.join(values)})
					)
				`
			}
			case 'boolean': {
				return PrismaSql.sql`
					EXISTS (
						SELECT 1
						FROM product_attributes pa
						WHERE pa.product_id = p.id
							AND pa.delete_at IS NULL
							AND pa.attribute_id = ${filter.attributeId}::uuid
							AND pa.value_boolean = ${filter.value}
					)
				`
			}
			case 'integer': {
				const valueClauses: Prisma.Sql[] = []
				if (filter.values.length) {
					const values = filter.values.map(value => PrismaSql.sql`${value}`)
					valueClauses.push(
						PrismaSql.sql`pa.value_integer IN (${PrismaSql.join(values)})`
					)
				}
				if (filter.min !== undefined) {
					valueClauses.push(PrismaSql.sql`pa.value_integer >= ${filter.min}`)
				}
				if (filter.max !== undefined) {
					valueClauses.push(PrismaSql.sql`pa.value_integer <= ${filter.max}`)
				}

				return PrismaSql.sql`
					EXISTS (
						SELECT 1
						FROM product_attributes pa
						WHERE pa.product_id = p.id
							AND pa.delete_at IS NULL
							AND pa.attribute_id = ${filter.attributeId}::uuid
							AND ${PrismaSql.join(valueClauses, ' AND ')}
					)
				`
			}
			case 'decimal': {
				const valueClauses: Prisma.Sql[] = []
				if (filter.values.length) {
					const values = filter.values.map(value => PrismaSql.sql`${value}`)
					valueClauses.push(
						PrismaSql.sql`pa.value_decimal IN (${PrismaSql.join(values)})`
					)
				}
				if (filter.min !== undefined) {
					valueClauses.push(PrismaSql.sql`pa.value_decimal >= ${filter.min}`)
				}
				if (filter.max !== undefined) {
					valueClauses.push(PrismaSql.sql`pa.value_decimal <= ${filter.max}`)
				}

				return PrismaSql.sql`
					EXISTS (
						SELECT 1
						FROM product_attributes pa
						WHERE pa.product_id = p.id
							AND pa.delete_at IS NULL
							AND pa.attribute_id = ${filter.attributeId}::uuid
							AND ${PrismaSql.join(valueClauses, ' AND ')}
					)
				`
			}
			case 'datetime': {
				const valueClauses: Prisma.Sql[] = []
				if (filter.values.length) {
					const values = filter.values.map(value => PrismaSql.sql`${value}`)
					valueClauses.push(
						PrismaSql.sql`pa.value_datetime IN (${PrismaSql.join(values)})`
					)
				}
				if (filter.min !== undefined) {
					valueClauses.push(PrismaSql.sql`pa.value_datetime >= ${filter.min}`)
				}
				if (filter.max !== undefined) {
					valueClauses.push(PrismaSql.sql`pa.value_datetime <= ${filter.max}`)
				}

				return PrismaSql.sql`
					EXISTS (
						SELECT 1
						FROM product_attributes pa
						WHERE pa.product_id = p.id
							AND pa.delete_at IS NULL
							AND pa.attribute_id = ${filter.attributeId}::uuid
							AND ${PrismaSql.join(valueClauses, ' AND ')}
					)
				`
			}
			default: {
				const _exhaustive: never = filter
				return _exhaustive
			}
		}
	}

	private async applyVariants(
		tx: Prisma.TransactionClient,
		productId: string,
		variants: ProductVariantData[]
	): Promise<void> {
		const now = new Date()
		const enumValueCache = new Map<string, string>()
		if (!variants.length) {
			await tx.variantAttribute.updateMany({
				where: { variant: { productId }, deleteAt: null },
				data: { deleteAt: now }
			})
			await tx.productVariant.updateMany({
				where: { productId, deleteAt: null },
				data: { deleteAt: now }
			})
			return
		}

		const skus = variants.map(variant => variant.sku)
		await tx.variantAttribute.updateMany({
			where: { variant: { productId, sku: { notIn: skus } }, deleteAt: null },
			data: { deleteAt: now }
		})
		await tx.productVariant.updateMany({
			where: { productId, deleteAt: null, sku: { notIn: skus } },
			data: { deleteAt: now }
		})

		const existingBySku = await tx.productVariant.findMany({
			where: { sku: { in: skus } },
			select: { id: true, sku: true, productId: true }
		})
		const existingSkuMap = new Map(
			existingBySku.map(variant => [variant.sku, variant])
		)

		for (const existing of existingBySku) {
			if (existing.productId !== productId) {
				throw new BadRequestException(
					`SKU варианта ${existing.sku} уже используется другим товаром`
				)
			}
		}

		const existingVariants = await tx.productVariant.findMany({
			where: { productId, deleteAt: null, sku: { in: skus } },
			select: { sku: true, variantKey: true }
		})
		const existingByKey = new Map(
			existingVariants.map(variant => [variant.variantKey, variant.sku])
		)

		for (const variant of variants) {
			const existingSku = existingByKey.get(variant.variantKey)
			if (existingSku && existingSku !== variant.sku) {
				throw new BadRequestException(
					`Вариант с набором ${variant.variantKey} уже существует`
				)
			}
		}

		for (const variant of variants) {
			const resolvedAttributes = await this.resolveVariantAttributes(
				tx,
				variant.attributes,
				enumValueCache
			)
			const existing = existingSkuMap.get(variant.sku)
			if (existing?.productId === productId) {
				const attributeIds = resolvedAttributes.map(
					attribute => attribute.attributeId
				)
				await tx.productVariant.update({
					where: { id: existing.id },
					data: {
						variantKey: variant.variantKey,
						stock: variant.stock,
						price: variant.price,
						status: variant.status,
						isAvailable: variant.status === ProductVariantStatus.ACTIVE,
						deleteAt: null
					}
				})

				if (attributeIds.length) {
					await tx.variantAttribute.updateMany({
						where: {
							variantId: existing.id,
							deleteAt: null,
							attributeId: { notIn: attributeIds }
						},
						data: { deleteAt: new Date() }
					})
				}

				if (resolvedAttributes.length) {
					for (const attribute of resolvedAttributes) {
						await tx.variantAttribute.upsert({
							where: {
								variantId_attributeId: {
									variantId: existing.id,
									attributeId: attribute.attributeId
								}
							},
							create: {
								variantId: existing.id,
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
			} else {
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

				if (resolvedAttributes.length) {
					await tx.variantAttribute.createMany({
						data: resolvedAttributes.map(attribute => ({
							variantId: created.id,
							attributeId: attribute.attributeId,
							enumValueId: attribute.enumValueId
						}))
					})
				}
			}
		}
	}

	private async resolveVariantAttributes(
		tx: Prisma.TransactionClient,
		attributes: ProductVariantAttributeInput[],
		cache: Map<string, string>
	): Promise<{ attributeId: string; enumValueId: string }[]> {
		if (!attributes.length) return []

		const resolved: { attributeId: string; enumValueId: string }[] = []
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

		const variantKeys = variants.map(variant => variant.variantKey)
		const existing = await tx.productVariant.findMany({
			where: { productId, variantKey: { in: variantKeys }, deleteAt: null },
			select: { id: true, variantKey: true, status: true }
		})
		const existingMap = new Map(
			existing.map(variant => [variant.variantKey, variant])
		)

		for (const variantKey of variantKeys) {
			const current = existingMap.get(variantKey)
			if (!current) {
				throw new BadRequestException(`Вариант с ключом ${variantKey} не найден`)
			}
		}

		for (const variant of variants) {
			const current = existingMap.get(variant.variantKey)
			if (!current) continue

			const data: Prisma.ProductVariantUpdateInput = {}
			if (variant.price !== undefined) data.price = variant.price
			if (variant.stock !== undefined) data.stock = variant.stock

			const nextStatus =
				variant.status ??
				(variant.stock !== undefined
					? current.status === ProductVariantStatus.DISABLED
						? ProductVariantStatus.DISABLED
						: variant.stock > 0
							? ProductVariantStatus.ACTIVE
							: ProductVariantStatus.OUT_OF_STOCK
					: undefined)
			if (nextStatus !== undefined) {
				data.status = nextStatus
				data.isAvailable = nextStatus === ProductVariantStatus.ACTIVE
			}

			if (!Object.keys(data).length) continue

			await tx.productVariant.update({
				where: { id: current.id },
				data
			})
		}
	}
}

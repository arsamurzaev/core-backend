import type { Prisma } from '@generated/client'
import { AttributeEnumValueSource } from '@generated/enums'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { ProductTypeScope } from './product-type.constants'
import type { NormalizedProductTypeAttribute } from './product-type.utils'

const attributeSummarySelect = {
	id: true,
	key: true,
	displayName: true,
	dataType: true
}

const matrixEditorEnumValueSelect = {
	id: true,
	attributeId: true,
	catalogId: true,
	value: true,
	displayName: true,
	displayOrder: true,
	businessId: true,
	source: true,
	mergedIntoId: true,
	aliases: {
		where: { deleteAt: null },
		select: {
			id: true,
			attributeId: true,
			catalogId: true,
			enumValueId: true,
			value: true,
			displayName: true
		},
		orderBy: { value: 'asc' as const }
	}
}

function buildMatrixEditorEnumValueWhere(
	catalogId: string,
	productTypeId: string
): Prisma.AttributeEnumValueWhereInput {
	return {
		deleteAt: null,
		OR: [
			{ catalogId },
			{
				catalogId: null,
				OR: [
					{
						productAttributes: {
							some: {
								deleteAt: null,
								product: {
									catalogId,
									productTypeId,
									deleteAt: null
								}
							}
						}
					},
					{
						variantAttributes: {
							some: {
								deleteAt: null,
								variant: {
									deleteAt: null,
									product: {
										catalogId,
										productTypeId,
										deleteAt: null
									}
								}
							}
						}
					}
				]
			}
		]
	}
}

function buildMatrixEditorAttributeSelect(
	catalogId: string,
	productTypeId: string
) {
	return {
		id: true,
		key: true,
		displayName: true,
		dataType: true,
		isFilterable: true,
		isHidden: true,
		enumValues: {
			where: buildMatrixEditorEnumValueWhere(catalogId, productTypeId),
			select: matrixEditorEnumValueSelect,
			orderBy: [{ displayOrder: 'asc' as const }, { value: 'asc' as const }]
		}
	}
}

const productTypeAttributeSelect = {
	productTypeId: true,
	attributeId: true,
	isVariant: true,
	isRequired: true,
	displayOrder: true,
	attribute: {
		select: attributeSummarySelect
	},
	createdAt: true,
	updatedAt: true
}

function buildProductTypeMatrixEditorAttributeSelect(
	catalogId: string,
	productTypeId: string
) {
	return {
		productTypeId: true,
		attributeId: true,
		isVariant: true,
		isRequired: true,
		displayOrder: true,
		attribute: {
			select: buildMatrixEditorAttributeSelect(catalogId, productTypeId)
		}
	}
}

const productTypeSelect = {
	id: true,
	catalogId: true,
	scope: true,
	code: true,
	name: true,
	description: true,
	isActive: true,
	isArchived: true,
	archivedAt: true,
	attributes: {
		select: productTypeAttributeSelect,
		orderBy: [{ displayOrder: 'asc' as const }, { attributeId: 'asc' as const }]
	},
	createdAt: true,
	updatedAt: true
}

function buildProductTypeMatrixEditorSchemaSelect(
	catalogId: string,
	productTypeId: string
) {
	return {
		id: true,
		catalogId: true,
		scope: true,
		code: true,
		name: true,
		description: true,
		isActive: true,
		isArchived: true,
		archivedAt: true,
		createdAt: true,
		updatedAt: true,
		attributes: {
			where: { attribute: { deleteAt: null } },
			select: buildProductTypeMatrixEditorAttributeSelect(
				catalogId,
				productTypeId
			),
			orderBy: [{ displayOrder: 'asc' as const }, { attributeId: 'asc' as const }]
		}
	}
}

type ProductTypeMatrixEditorSchemaSelect = ReturnType<
	typeof buildProductTypeMatrixEditorSchemaSelect
>

export type ProductTypeAttributeSummaryRecord = Prisma.AttributeGetPayload<{
	select: typeof attributeSummarySelect
}>

export type ProductTypeRecord = Prisma.ProductTypeGetPayload<{
	select: typeof productTypeSelect
}>

export type ProductTypeMatrixEditorSchemaRecord = Prisma.ProductTypeGetPayload<{
	select: ProductTypeMatrixEditorSchemaSelect
}>

export type ProductTypeCreateData = {
	catalogId?: string | null
	scope: ProductTypeScope
	code: string
	name: string
	description?: string | null
	attributes?: NormalizedProductTypeAttribute[]
}

export type ProductTypeUpdateData = Partial<{
	code: string
	name: string
	description: string | null
	isActive: boolean
	isArchived: boolean
	archivedAt: Date | null
}>

export type ProductTypeSchemaUpdateImpact = {
	boundProductCount: number
	conflictingProductCount: number
	obsoleteProductAttributeProductCount: number
	obsoleteVariantAttributeProductCount: number
	missingRequiredProductAttributeProductCount: number
	missingRequiredVariantAttributeProductCount: number
}

@Injectable()
export class ProductTypeRepository {
	constructor(private readonly prisma: PrismaService) {}

	findCatalogTypes(catalogId: string, includeArchived = false) {
		return this.prisma.productType.findMany({
			where: {
				catalogId,
				scope: ProductTypeScope.CATALOG,
				...(includeArchived ? {} : { isActive: true, isArchived: false })
			},
			select: productTypeSelect,
			orderBy: [{ name: 'asc' }, { createdAt: 'desc' }]
		})
	}

	findCatalogTypeById(id: string, catalogId: string, includeArchived = false) {
		return this.prisma.productType.findFirst({
			where: {
				id,
				catalogId,
				scope: ProductTypeScope.CATALOG,
				...(includeArchived ? {} : { isArchived: false })
			},
			select: productTypeSelect
		})
	}

	findCatalogTypeMatrixEditorSchemaById(id: string, catalogId: string) {
		return this.prisma.productType.findFirst({
			where: {
				id,
				catalogId,
				scope: ProductTypeScope.CATALOG,
				isArchived: false
			},
			select: buildProductTypeMatrixEditorSchemaSelect(catalogId, id)
		})
	}

	async findImportedEnumAttributeIds(
		catalogId: string,
		attributeIds: string[]
	): Promise<string[]> {
		if (!attributeIds.length) return []

		const values = await this.prisma.attributeEnumValue.findMany({
			where: {
				attributeId: { in: attributeIds },
				source: AttributeEnumValueSource.IMPORTED,
				deleteAt: null,
				OR: [{ catalogId }, { catalogId: null }]
			},
			distinct: ['attributeId'],
			select: { attributeId: true }
		})
		return values.map(value => value.attributeId)
	}

	findSystemTemplates(includeArchived = false) {
		return this.prisma.productType.findMany({
			where: {
				scope: ProductTypeScope.SYSTEM_TEMPLATE,
				catalogId: null,
				...(includeArchived ? {} : { isActive: true, isArchived: false })
			},
			select: productTypeSelect,
			orderBy: [{ name: 'asc' }, { createdAt: 'desc' }]
		})
	}

	findSystemTemplateById(id: string, includeArchived = false) {
		return this.prisma.productType.findFirst({
			where: {
				id,
				scope: ProductTypeScope.SYSTEM_TEMPLATE,
				catalogId: null,
				...(includeArchived ? {} : { isArchived: false })
			},
			select: productTypeSelect
		})
	}

	create(data: ProductTypeCreateData) {
		const attributes = data.attributes ?? []

		return this.prisma.productType.create({
			data: {
				catalogId: data.catalogId ?? null,
				scope: data.scope,
				code: data.code,
				name: data.name,
				description: data.description ?? null,
				...(attributes.length
					? {
							attributes: {
								create: attributes.map(attribute => ({
									attribute: { connect: { id: attribute.attributeId } },
									isVariant: attribute.isVariant,
									isRequired: attribute.isRequired,
									displayOrder: attribute.displayOrder
								}))
							}
						}
					: {})
			},
			select: productTypeSelect
		})
	}

	async updateCatalogType(
		id: string,
		catalogId: string,
		data: ProductTypeUpdateData,
		attributes?: NormalizedProductTypeAttribute[]
	): Promise<ProductTypeRecord | null> {
		return this.prisma.$transaction(async tx => {
			const existing = await tx.productType.findFirst({
				where: {
					id,
					catalogId,
					scope: ProductTypeScope.CATALOG,
					isArchived: false
				},
				select: { id: true }
			})
			if (!existing) return null

			if (Object.keys(data).length) {
				await tx.productType.update({
					where: { id },
					data
				})
			}
			await this.replaceAttributesInTx(tx, id, attributes)

			return tx.productType.findFirst({
				where: { id, catalogId, scope: ProductTypeScope.CATALOG },
				select: productTypeSelect
			})
		})
	}

	async getCatalogTypeSchemaUpdateImpact(
		id: string,
		catalogId: string,
		attributes: NormalizedProductTypeAttribute[]
	): Promise<ProductTypeSchemaUpdateImpact> {
		const baseWhere: Prisma.ProductWhereInput = {
			catalogId,
			productTypeId: id,
			deleteAt: null
		}
		const nextProductAttributeIds = attributes
			.filter(attribute => !attribute.isVariant)
			.map(attribute => attribute.attributeId)
		const nextVariantAttributeIds = attributes
			.filter(attribute => attribute.isVariant)
			.map(attribute => attribute.attributeId)
		const requiredProductAttributeIds = attributes
			.filter(attribute => !attribute.isVariant && attribute.isRequired)
			.map(attribute => attribute.attributeId)
		const requiredVariantAttributeIds = attributes
			.filter(attribute => attribute.isVariant && attribute.isRequired)
			.map(attribute => attribute.attributeId)

		const productAttributeOutsideWhere: Prisma.ProductWhereInput =
			nextProductAttributeIds.length
				? {
						productAttributes: {
							some: {
								deleteAt: null,
								attributeId: { notIn: nextProductAttributeIds }
							}
						}
					}
				: { productAttributes: { some: { deleteAt: null } } }
		const variantAttributeOutsideWhere: Prisma.ProductWhereInput =
			nextVariantAttributeIds.length
				? {
						variants: {
							some: {
								deleteAt: null,
								attributes: {
									some: {
										deleteAt: null,
										attributeId: { notIn: nextVariantAttributeIds }
									}
								}
							}
						}
					}
				: {
						variants: {
							some: {
								deleteAt: null,
								attributes: { some: { deleteAt: null } }
							}
						}
					}
		const missingRequiredProductAttributeWhere: Prisma.ProductWhereInput[] =
			requiredProductAttributeIds.map(attributeId => ({
				productAttributes: {
					none: {
						deleteAt: null,
						attributeId
					}
				}
			}))
		const missingRequiredVariantAttributeWhere: Prisma.ProductWhereInput[] =
			requiredVariantAttributeIds.map(attributeId => ({
				OR: [
					{ variants: { none: { deleteAt: null } } },
					{
						variants: {
							some: {
								deleteAt: null,
								attributes: {
									none: {
										deleteAt: null,
										attributeId
									}
								}
							}
						}
					}
				]
			}))
		const conflictWhere: Prisma.ProductWhereInput[] = [
			productAttributeOutsideWhere,
			variantAttributeOutsideWhere,
			...missingRequiredProductAttributeWhere,
			...missingRequiredVariantAttributeWhere
		]

		const [
			boundProductCount,
			conflictingProductCount,
			obsoleteProductAttributeProductCount,
			obsoleteVariantAttributeProductCount,
			missingRequiredProductAttributeProductCount,
			missingRequiredVariantAttributeProductCount
		] = await Promise.all([
			this.prisma.product.count({ where: baseWhere }),
			this.prisma.product.count({
				where: { ...baseWhere, OR: conflictWhere }
			}),
			this.prisma.product.count({
				where: { ...baseWhere, ...productAttributeOutsideWhere }
			}),
			this.prisma.product.count({
				where: { ...baseWhere, ...variantAttributeOutsideWhere }
			}),
			missingRequiredProductAttributeWhere.length
				? this.prisma.product.count({
						where: {
							...baseWhere,
							OR: missingRequiredProductAttributeWhere
						}
					})
				: Promise.resolve(0),
			missingRequiredVariantAttributeWhere.length
				? this.prisma.product.count({
						where: {
							...baseWhere,
							OR: missingRequiredVariantAttributeWhere
						}
					})
				: Promise.resolve(0)
		])

		return {
			boundProductCount,
			conflictingProductCount,
			obsoleteProductAttributeProductCount,
			obsoleteVariantAttributeProductCount,
			missingRequiredProductAttributeProductCount,
			missingRequiredVariantAttributeProductCount
		}
	}

	async updateSystemTemplate(
		id: string,
		data: ProductTypeUpdateData,
		attributes?: NormalizedProductTypeAttribute[]
	): Promise<ProductTypeRecord | null> {
		return this.prisma.$transaction(async tx => {
			const existing = await tx.productType.findFirst({
				where: {
					id,
					catalogId: null,
					scope: ProductTypeScope.SYSTEM_TEMPLATE,
					isArchived: false
				},
				select: { id: true }
			})
			if (!existing) return null

			if (Object.keys(data).length) {
				await tx.productType.update({
					where: { id },
					data
				})
			}
			await this.replaceAttributesInTx(tx, id, attributes)

			return tx.productType.findFirst({
				where: { id, catalogId: null, scope: ProductTypeScope.SYSTEM_TEMPLATE },
				select: productTypeSelect
			})
		})
	}

	async archiveCatalogType(id: string, catalogId: string): Promise<boolean> {
		const result = await this.prisma.productType.updateMany({
			where: {
				id,
				catalogId,
				scope: ProductTypeScope.CATALOG,
				isArchived: false
			},
			data: {
				isActive: false,
				isArchived: true,
				archivedAt: new Date()
			}
		})
		return result.count > 0
	}

	async archiveSystemTemplate(id: string): Promise<boolean> {
		const result = await this.prisma.productType.updateMany({
			where: {
				id,
				catalogId: null,
				scope: ProductTypeScope.SYSTEM_TEMPLATE,
				isArchived: false
			},
			data: {
				isActive: false,
				isArchived: true,
				archivedAt: new Date()
			}
		})
		return result.count > 0
	}

	async existsCode(
		scope: ProductTypeScope,
		code: string,
		options: { catalogId?: string | null; excludeId?: string } = {}
	): Promise<boolean> {
		const productType = await this.prisma.productType.findFirst({
			where: {
				scope,
				code,
				...(scope === ProductTypeScope.CATALOG
					? { catalogId: options.catalogId }
					: { catalogId: null }),
				...(options.excludeId ? { id: { not: options.excludeId } } : {})
			},
			select: { id: true }
		})
		return Boolean(productType)
	}

	findCatalog(catalogId: string) {
		return this.prisma.catalog.findFirst({
			where: { id: catalogId, deleteAt: null },
			select: { id: true, typeId: true }
		})
	}

	findAttributesByIds(
		attributeIds: string[],
		catalogTypeId?: string
	): Promise<ProductTypeAttributeSummaryRecord[]> {
		if (!attributeIds.length) {
			return Promise.resolve<ProductTypeAttributeSummaryRecord[]>([])
		}

		return this.prisma.attribute.findMany({
			where: {
				id: { in: attributeIds },
				deleteAt: null,
				...(catalogTypeId
					? {
							types: {
								some: { id: catalogTypeId }
							}
						}
					: {})
			},
			select: attributeSummarySelect
		})
	}

	private async replaceAttributesInTx(
		tx: Prisma.TransactionClient,
		productTypeId: string,
		attributes?: NormalizedProductTypeAttribute[]
	): Promise<void> {
		if (attributes === undefined) return

		await tx.productTypeAttribute.deleteMany({
			where: { productTypeId }
		})

		if (!attributes.length) return
		await tx.productTypeAttribute.createMany({
			data: attributes.map(attribute => ({
				productTypeId,
				attributeId: attribute.attributeId,
				isVariant: attribute.isVariant,
				isRequired: attribute.isRequired,
				displayOrder: attribute.displayOrder
			}))
		})
	}
}

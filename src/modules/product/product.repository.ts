import type { Prisma } from '@generated/client'
import { ProductVariantStatus } from '@generated/enums'
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

@Injectable()
export class ProductRepository {
	constructor(private readonly prisma: PrismaService) {}

	findAll(catalogId: string) {
		return this.prisma.product.findMany({
			where: { deleteAt: null, catalogId },
			select: productSelect,
			orderBy: { createdAt: 'desc' }
		})
	}

	findPopular(catalogId: string) {
		return this.prisma.product.findMany({
			where: { deleteAt: null, catalogId, isPopular: true },
			select: productSelectWithDetails,
			orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
		})
	}

	findById(id: string, catalogId: string) {
		return this.prisma.product.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: productSelectWithDetails
		})
	}

	findBySlug(slug: string, catalogId: string) {
		return this.prisma.product.findFirst({
			where: { slug, catalogId, deleteAt: null },
			select: productSelectWithDetails
		})
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

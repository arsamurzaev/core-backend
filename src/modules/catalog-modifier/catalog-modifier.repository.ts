import type { Prisma } from '@generated/client'
import { ProductModifierScope } from '@generated/enums'
import { BadRequestException, Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

const catalogModifierOptionSelect = {
	id: true,
	catalogId: true,
	code: true,
	name: true,
	description: true,
	defaultPrice: true,
	isActive: true,
	displayOrder: true,
	deleteAt: true,
	createdAt: true,
	updatedAt: true
}

const catalogModifierGroupOptionSelect = {
	groupId: true,
	optionId: true,
	defaultPrice: true,
	isDefault: true,
	isActive: true,
	displayOrder: true,
	deleteAt: true,
	option: {
		select: catalogModifierOptionSelect
	}
}

const catalogModifierGroupSelect = {
	id: true,
	catalogId: true,
	code: true,
	name: true,
	description: true,
	isRequired: true,
	minSelected: true,
	maxSelected: true,
	isActive: true,
	displayOrder: true,
	deleteAt: true,
	createdAt: true,
	updatedAt: true,
	options: {
		select: catalogModifierGroupOptionSelect,
		orderBy: [
			{ displayOrder: 'asc' as const },
			{ option: { name: 'asc' as const } }
		]
	}
}

const productModifierOptionSelect = {
	id: true,
	productModifierGroupId: true,
	catalogModifierOptionId: true,
	code: true,
	name: true,
	price: true,
	maxQuantity: true,
	isDefault: true,
	isAvailable: true,
	displayOrder: true,
	deleteAt: true,
	createdAt: true,
	updatedAt: true
}

const productModifierGroupSelect = {
	id: true,
	productId: true,
	variantId: true,
	catalogModifierGroupId: true,
	scope: true,
	scopeKey: true,
	code: true,
	name: true,
	description: true,
	isRequired: true,
	minSelected: true,
	maxSelected: true,
	isActive: true,
	displayOrder: true,
	deleteAt: true,
	createdAt: true,
	updatedAt: true,
	options: {
		select: productModifierOptionSelect,
		orderBy: [
			{ displayOrder: 'asc' as const },
			{ name: 'asc' as const },
			{ id: 'asc' as const }
		]
	}
}

export type CatalogModifierOptionRecord =
	Prisma.CatalogModifierOptionGetPayload<{
		select: typeof catalogModifierOptionSelect
	}>

export type CatalogModifierGroupRecord = Prisma.CatalogModifierGroupGetPayload<{
	select: typeof catalogModifierGroupSelect
}>

export type ProductModifierGroupRecord = Prisma.ProductModifierGroupGetPayload<{
	select: typeof productModifierGroupSelect
}>

export type CatalogModifierOptionCreateData = {
	catalogId: string
	code: string
	name: string
	description?: string | null
	defaultPrice?: number
	isActive?: boolean
	displayOrder?: number
}

export type CatalogModifierOptionUpdateData = Partial<{
	code: string
	name: string
	description: string | null
	defaultPrice: number
	isActive: boolean
	displayOrder: number
	deleteAt: Date | null
}>

export type CatalogModifierGroupCreateData = {
	catalogId: string
	code: string
	name: string
	description?: string | null
	isRequired?: boolean
	minSelected?: number
	maxSelected?: number | null
	isActive?: boolean
	displayOrder?: number
}

export type CatalogModifierGroupUpdateData = Partial<{
	code: string
	name: string
	description: string | null
	isRequired: boolean
	minSelected: number
	maxSelected: number | null
	isActive: boolean
	displayOrder: number
	deleteAt: Date | null
}>

export type CatalogModifierGroupOptionInput = {
	optionId: string
	defaultPrice?: number | null
	isDefault?: boolean
	isActive?: boolean
	displayOrder?: number
}

export type ProductModifierOptionReplacement = {
	catalogModifierOptionId?: string | null
	code: string
	name: string
	price: number
	maxQuantity?: number | null
	isDefault?: boolean
	isAvailable?: boolean
	displayOrder?: number
	rawMeta?: Prisma.InputJsonValue
}

export type ProductModifierGroupReplacement = {
	variantId?: string | null
	catalogModifierGroupId?: string | null
	code: string
	name: string
	description?: string | null
	isRequired?: boolean
	minSelected?: number
	maxSelected?: number | null
	isActive?: boolean
	displayOrder?: number
	rawMeta?: Prisma.InputJsonValue
	options: ProductModifierOptionReplacement[]
}

export type CatalogModifierListOptions = {
	includeInactive?: boolean
	includeArchived?: boolean
}

@Injectable()
export class CatalogModifierRepository {
	constructor(private readonly prisma: PrismaService) {}

	findAllOptions(catalogId: string, options: CatalogModifierListOptions = {}) {
		return this.prisma.catalogModifierOption.findMany({
			where: this.catalogWhere(catalogId, options),
			select: catalogModifierOptionSelect,
			orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { createdAt: 'asc' }]
		})
	}

	findAllGroups(catalogId: string, options: CatalogModifierListOptions = {}) {
		return this.prisma.catalogModifierGroup.findMany({
			where: this.catalogWhere(catalogId, options),
			select: catalogModifierGroupSelect,
			orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { createdAt: 'asc' }]
		})
	}

	findOptionById(id: string, catalogId: string, includeArchived = false) {
		return this.prisma.catalogModifierOption.findFirst({
			where: {
				id,
				catalogId,
				...(includeArchived ? {} : { deleteAt: null })
			},
			select: catalogModifierOptionSelect
		})
	}

	findGroupById(id: string, catalogId: string, includeArchived = false) {
		return this.prisma.catalogModifierGroup.findFirst({
			where: {
				id,
				catalogId,
				...(includeArchived ? {} : { deleteAt: null })
			},
			select: catalogModifierGroupSelect
		})
	}

	findOptionByCode(catalogId: string, code: string) {
		return this.prisma.catalogModifierOption.findUnique({
			where: { catalogId_code: { catalogId, code } },
			select: catalogModifierOptionSelect
		})
	}

	findGroupByCode(catalogId: string, code: string) {
		return this.prisma.catalogModifierGroup.findUnique({
			where: { catalogId_code: { catalogId, code } },
			select: catalogModifierGroupSelect
		})
	}

	async existsOptionCode(
		catalogId: string,
		code: string,
		excludeId?: string
	): Promise<boolean> {
		const found = await this.prisma.catalogModifierOption.findUnique({
			where: { catalogId_code: { catalogId, code } },
			select: { id: true }
		})
		return Boolean(found && found.id !== excludeId)
	}

	async existsGroupCode(
		catalogId: string,
		code: string,
		excludeId?: string
	): Promise<boolean> {
		const found = await this.prisma.catalogModifierGroup.findUnique({
			where: { catalogId_code: { catalogId, code } },
			select: { id: true }
		})
		return Boolean(found && found.id !== excludeId)
	}

	createOption(data: CatalogModifierOptionCreateData) {
		return this.prisma.catalogModifierOption.create({
			data: {
				catalogId: data.catalogId,
				code: data.code,
				name: data.name,
				description: data.description ?? null,
				defaultPrice: data.defaultPrice ?? 0,
				isActive: data.isActive ?? true,
				displayOrder: data.displayOrder ?? 0
			},
			select: catalogModifierOptionSelect
		})
	}

	updateOption(
		id: string,
		catalogId: string,
		data: CatalogModifierOptionUpdateData
	) {
		return this.prisma.catalogModifierOption.updateManyAndReturn({
			where: { id, catalogId },
			data,
			select: catalogModifierOptionSelect
		})
	}

	async createGroup(
		data: CatalogModifierGroupCreateData,
		options: CatalogModifierGroupOptionInput[] = []
	) {
		const group = await this.prisma.catalogModifierGroup.create({
			data: {
				catalogId: data.catalogId,
				code: data.code,
				name: data.name,
				description: data.description ?? null,
				isRequired: data.isRequired ?? false,
				minSelected: data.minSelected ?? 0,
				maxSelected: data.maxSelected ?? null,
				isActive: data.isActive ?? true,
				displayOrder: data.displayOrder ?? 0
			},
			select: catalogModifierGroupSelect
		})

		if (!options.length) return group
		await this.replaceGroupOptions(group.id, data.catalogId, options)
		return this.findGroupById(group.id, data.catalogId, true)
	}

	updateGroup(
		id: string,
		catalogId: string,
		data: CatalogModifierGroupUpdateData
	) {
		return this.prisma.catalogModifierGroup.updateManyAndReturn({
			where: { id, catalogId },
			data,
			select: catalogModifierGroupSelect
		})
	}

	async replaceGroupOptions(
		groupId: string,
		catalogId: string,
		options: CatalogModifierGroupOptionInput[]
	): Promise<void> {
		await this.prisma.$transaction(async tx => {
			await this.assertCatalogOptionsExist(tx, catalogId, options)
			await tx.catalogModifierGroupOption.updateMany({
				where: { groupId },
				data: { deleteAt: new Date(), isActive: false }
			})

			for (const option of options) {
				await tx.catalogModifierGroupOption.upsert({
					where: {
						groupId_optionId: {
							groupId,
							optionId: option.optionId
						}
					},
					update: {
						defaultPrice: option.defaultPrice ?? null,
						isDefault: option.isDefault ?? false,
						isActive: option.isActive ?? true,
						displayOrder: option.displayOrder ?? 0,
						deleteAt: null
					},
					create: {
						groupId,
						optionId: option.optionId,
						defaultPrice: option.defaultPrice ?? null,
						isDefault: option.isDefault ?? false,
						isActive: option.isActive ?? true,
						displayOrder: option.displayOrder ?? 0
					}
				})
			}
		})
	}

	findProductModifiers(
		productId: string,
		catalogId: string,
		options: CatalogModifierListOptions = {}
	) {
		const includeArchived = options.includeArchived === true
		const includeInactive = includeArchived || options.includeInactive === true
		return this.prisma.productModifierGroup.findMany({
			where: {
				productId,
				product: { catalogId },
				...(includeArchived ? {} : { deleteAt: null }),
				...(includeInactive ? {} : { isActive: true })
			},
			select: productModifierGroupSelect,
			orderBy: [
				{ scope: 'asc' },
				{ displayOrder: 'asc' },
				{ name: 'asc' },
				{ createdAt: 'asc' }
			]
		})
	}

	async productExists(catalogId: string, productId: string): Promise<boolean> {
		const found = await this.prisma.product.findFirst({
			where: { id: productId, catalogId, deleteAt: null },
			select: { id: true }
		})
		return Boolean(found)
	}

	async replaceProductModifiers(
		catalogId: string,
		productId: string,
		groups: ProductModifierGroupReplacement[]
	): Promise<ProductModifierGroupRecord[]> {
		return this.prisma.$transaction(async tx => {
			const now = new Date()
			const product = await tx.product.findFirst({
				where: { id: productId, catalogId, deleteAt: null },
				select: {
					id: true,
					variants: {
						where: { deleteAt: null },
						select: { id: true }
					}
				}
			})
			if (!product) return []

			const variantIds = new Set(product.variants.map(variant => variant.id))
			for (const group of groups) {
				if (group.variantId && !variantIds.has(group.variantId)) {
					throw new BadRequestException('Вариация не принадлежит товару')
				}
			}

			const replacementKeys = new Set(
				groups.map(group => {
					const scopeKey = group.variantId ?? 'product'
					return `${scopeKey}:${group.code}`
				})
			)
			const existingGroups = await tx.productModifierGroup.findMany({
				where: { productId },
				select: {
					id: true,
					scopeKey: true,
					code: true
				}
			})
			const existingByKey = new Map(
				existingGroups.map(group => [`${group.scopeKey}:${group.code}`, group])
			)
			const staleGroupIds = existingGroups
				.filter(group => !replacementKeys.has(`${group.scopeKey}:${group.code}`))
				.map(group => group.id)
			if (staleGroupIds.length) {
				await tx.productModifierOption.updateMany({
					where: { productModifierGroupId: { in: staleGroupIds } },
					data: { deleteAt: now, isAvailable: false }
				})
				await tx.productModifierGroup.updateMany({
					where: { id: { in: staleGroupIds } },
					data: { deleteAt: now, isActive: false }
				})
			}

			for (const group of groups) {
				const scope = group.variantId
					? ProductModifierScope.VARIANT
					: ProductModifierScope.PRODUCT
				const scopeKey = group.variantId ?? 'product'
				const groupData = {
					productId,
					variantId: group.variantId ?? null,
					catalogModifierGroupId: group.catalogModifierGroupId ?? null,
					scope,
					scopeKey,
					code: group.code,
					name: group.name,
					description: group.description ?? null,
					isRequired: group.isRequired ?? false,
					minSelected: group.minSelected ?? 0,
					maxSelected: group.maxSelected ?? null,
					isActive: group.isActive ?? true,
					displayOrder: group.displayOrder ?? 0,
					rawMeta: group.rawMeta,
					deleteAt: null
				}
				const existing = existingByKey.get(`${scopeKey}:${group.code}`)
				const saved = existing
					? await tx.productModifierGroup.update({
							where: { id: existing.id },
							data: groupData,
							select: { id: true }
						})
					: await tx.productModifierGroup.create({
							data: groupData,
							select: { id: true }
						})

				await tx.productModifierOption.updateMany({
					where: { productModifierGroupId: saved.id },
					data: { deleteAt: now, isAvailable: false }
				})

				for (const option of group.options) {
					await tx.productModifierOption.upsert({
						where: {
							productModifierGroupId_code: {
								productModifierGroupId: saved.id,
								code: option.code
							}
						},
						update: {
							catalogModifierOptionId: option.catalogModifierOptionId ?? null,
							name: option.name,
							price: option.price,
							maxQuantity: option.maxQuantity ?? null,
							isDefault: option.isDefault ?? false,
							isAvailable: option.isAvailable ?? true,
							displayOrder: option.displayOrder ?? 0,
							rawMeta: option.rawMeta,
							deleteAt: null
						},
						create: {
							productModifierGroupId: saved.id,
							catalogModifierOptionId: option.catalogModifierOptionId ?? null,
							code: option.code,
							name: option.name,
							price: option.price,
							maxQuantity: option.maxQuantity ?? null,
							isDefault: option.isDefault ?? false,
							isAvailable: option.isAvailable ?? true,
							displayOrder: option.displayOrder ?? 0,
							rawMeta: option.rawMeta
						}
					})
				}
			}

			return tx.productModifierGroup.findMany({
				where: { productId, product: { catalogId }, deleteAt: null },
				select: productModifierGroupSelect,
				orderBy: [
					{ scope: 'asc' },
					{ displayOrder: 'asc' },
					{ name: 'asc' },
					{ createdAt: 'asc' }
				]
			})
		})
	}

	async findCatalogGroupsByIds(catalogId: string, ids: string[]) {
		if (!ids.length) return []
		return this.prisma.catalogModifierGroup.findMany({
			where: {
				id: { in: ids },
				catalogId,
				deleteAt: null
			},
			select: catalogModifierGroupSelect
		})
	}

	async findCatalogOptionsByIds(catalogId: string, ids: string[]) {
		if (!ids.length) return []
		return this.prisma.catalogModifierOption.findMany({
			where: {
				id: { in: ids },
				catalogId,
				deleteAt: null
			},
			select: catalogModifierOptionSelect
		})
	}

	private catalogWhere(catalogId: string, options: CatalogModifierListOptions) {
		const includeArchived = options.includeArchived === true
		const includeInactive = includeArchived || options.includeInactive === true
		return {
			catalogId,
			...(includeArchived ? {} : { deleteAt: null }),
			...(includeInactive ? {} : { isActive: true })
		}
	}

	private async assertCatalogOptionsExist(
		tx: Prisma.TransactionClient,
		catalogId: string,
		options: CatalogModifierGroupOptionInput[]
	): Promise<void> {
		const optionIds = Array.from(new Set(options.map(option => option.optionId)))
		if (!optionIds.length) return
		const count = await tx.catalogModifierOption.count({
			where: {
				id: { in: optionIds },
				catalogId,
				deleteAt: null
			}
		})
		if (count !== optionIds.length) {
			throw new BadRequestException('Опция модификатора не принадлежит каталогу')
		}
	}
}

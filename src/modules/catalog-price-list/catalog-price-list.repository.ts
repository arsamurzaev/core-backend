import type { Prisma } from '@generated/client'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

export const catalogPriceListSelect = {
	id: true,
	catalogId: true,
	code: true,
	name: true,
	description: true,
	isActive: true,
	displayOrder: true,
	deleteAt: true,
	createdAt: true,
	updatedAt: true
}

export const catalogPriceListPriceSelect = {
	id: true,
	priceListId: true,
	target: true,
	targetId: true,
	productId: true,
	variantId: true,
	saleUnitId: true,
	price: true,
	deleteAt: true,
	createdAt: true,
	updatedAt: true
}

export type CatalogPriceListRecord = Prisma.CatalogPriceListGetPayload<{
	select: typeof catalogPriceListSelect
}>

export type CatalogPriceListPriceRecord =
	Prisma.CatalogPriceListPriceGetPayload<{
		select: typeof catalogPriceListPriceSelect
	}>

export type CatalogPriceListListOptions = {
	includeInactive?: boolean
	includeArchived?: boolean
}

export type CatalogPriceListCreateData = {
	catalogId: string
	code: string
	name: string
	description?: string | null
	isActive?: boolean
	displayOrder?: number
}

export type CatalogPriceListUpdateData = Partial<{
	code: string
	name: string
	description: string | null
	isActive: boolean
	displayOrder: number
	deleteAt: Date | null
}>

@Injectable()
export class CatalogPriceListRepository {
	constructor(private readonly prisma: PrismaService) {}

	findCatalogContext(catalogId: string) {
		return this.prisma.catalog.findFirst({
			where: { id: catalogId, deleteAt: null },
			select: {
				id: true,
				parentId: true,
				settings: {
					select: { activePriceListId: true }
				}
			}
		})
	}

	findAll(catalogId: string, options: CatalogPriceListListOptions = {}) {
		return this.prisma.catalogPriceList.findMany({
			where: this.catalogWhere(catalogId, options),
			select: catalogPriceListSelect,
			orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { createdAt: 'asc' }]
		})
	}

	findById(id: string, catalogId: string, includeArchived = false) {
		return this.prisma.catalogPriceList.findFirst({
			where: {
				id,
				catalogId,
				...(includeArchived ? {} : { deleteAt: null })
			},
			select: catalogPriceListSelect
		})
	}

	findByCode(catalogId: string, code: string) {
		return this.prisma.catalogPriceList.findUnique({
			where: { catalogId_code: { catalogId, code } },
			select: catalogPriceListSelect
		})
	}

	async existsCode(
		catalogId: string,
		code: string,
		excludeId?: string
	): Promise<boolean> {
		const found = await this.prisma.catalogPriceList.findUnique({
			where: { catalogId_code: { catalogId, code } },
			select: { id: true }
		})
		return Boolean(found && found.id !== excludeId)
	}

	create(data: CatalogPriceListCreateData) {
		return this.prisma.catalogPriceList.create({
			data: {
				catalogId: data.catalogId,
				code: data.code,
				name: data.name,
				description: data.description ?? null,
				isActive: data.isActive ?? true,
				displayOrder: data.displayOrder ?? 0
			},
			select: catalogPriceListSelect
		})
	}

	update(id: string, catalogId: string, data: CatalogPriceListUpdateData) {
		return this.prisma.catalogPriceList.updateManyAndReturn({
			where: { id, catalogId },
			data,
			select: catalogPriceListSelect
		})
	}

	findPrices(priceListId: string, includeArchived = false) {
		return this.prisma.catalogPriceListPrice.findMany({
			where: {
				priceListId,
				...(includeArchived ? {} : { deleteAt: null })
			},
			select: catalogPriceListPriceSelect,
			orderBy: [{ productId: 'asc' }, { target: 'asc' }, { createdAt: 'asc' }]
		})
	}

	private catalogWhere(
		catalogId: string,
		options: CatalogPriceListListOptions
	): Prisma.CatalogPriceListWhereInput {
		const includeArchived = options.includeArchived === true
		const includeInactive = includeArchived || options.includeInactive === true
		return {
			catalogId,
			...(includeArchived ? {} : { deleteAt: null }),
			...(includeInactive ? {} : { isActive: true })
		}
	}
}

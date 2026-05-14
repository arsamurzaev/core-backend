import type { Prisma } from '@generated/client'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

const catalogSaleUnitSelect = {
	id: true,
	catalogId: true,
	code: true,
	name: true,
	defaultBaseQuantity: true,
	barcode: true,
	isActive: true,
	displayOrder: true,
	deleteAt: true,
	createdAt: true,
	updatedAt: true
}

export type CatalogSaleUnitRecord = Prisma.CatalogSaleUnitGetPayload<{
	select: typeof catalogSaleUnitSelect
}>

export type CatalogSaleUnitCreateData = {
	catalogId: string
	code: string
	name: string
	defaultBaseQuantity: number
	barcode?: string | null
	displayOrder?: number
}

export type CatalogSaleUnitUpdateData = Partial<{
	code: string
	name: string
	defaultBaseQuantity: number
	barcode: string | null
	isActive: boolean
	displayOrder: number
	deleteAt: Date | null
}>

@Injectable()
export class CatalogSaleUnitRepository {
	constructor(private readonly prisma: PrismaService) {}

	findAll(catalogId: string, includeArchived = false) {
		return this.prisma.catalogSaleUnit.findMany({
			where: {
				catalogId,
				...(includeArchived ? {} : { deleteAt: null, isActive: true })
			},
			select: catalogSaleUnitSelect,
			orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }, { createdAt: 'asc' }]
		})
	}

	findById(id: string, catalogId: string, includeArchived = false) {
		return this.prisma.catalogSaleUnit.findFirst({
			where: {
				id,
				catalogId,
				...(includeArchived ? {} : { deleteAt: null })
			},
			select: catalogSaleUnitSelect
		})
	}

	findByCode(catalogId: string, code: string) {
		return this.prisma.catalogSaleUnit.findUnique({
			where: { catalogId_code: { catalogId, code } },
			select: catalogSaleUnitSelect
		})
	}

	async existsCode(
		catalogId: string,
		code: string,
		excludeId?: string
	): Promise<boolean> {
		const found = await this.prisma.catalogSaleUnit.findUnique({
			where: { catalogId_code: { catalogId, code } },
			select: { id: true }
		})
		if (!found) return false
		return found.id !== excludeId
	}

	create(data: CatalogSaleUnitCreateData) {
		return this.prisma.catalogSaleUnit.create({
			data: {
				catalogId: data.catalogId,
				code: data.code,
				name: data.name,
				defaultBaseQuantity: data.defaultBaseQuantity,
				barcode: data.barcode ?? null,
				displayOrder: data.displayOrder ?? 0
			},
			select: catalogSaleUnitSelect
		})
	}

	update(id: string, catalogId: string, data: CatalogSaleUnitUpdateData) {
		return this.prisma.catalogSaleUnit.updateManyAndReturn({
			where: { id, catalogId },
			data,
			select: catalogSaleUnitSelect
		})
	}

	async syncVariantSnapshots(
		id: string,
		data: Pick<CatalogSaleUnitUpdateData, 'code' | 'name'>
	): Promise<void> {
		if (data.code === undefined && data.name === undefined) return

		await this.prisma.productVariantSaleUnit.updateMany({
			where: { catalogSaleUnitId: id, deleteAt: null },
			data
		})
	}
}

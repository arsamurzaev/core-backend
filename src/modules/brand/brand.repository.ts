import type { Prisma } from '@generated/client'
import { SortOrder } from '@generated/internal/prismaNamespace'
import { BrandCreateInput, BrandUpdateInput } from '@generated/models'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

const brandSelect = {
	id: true,
	catalogId: true,
	name: true,
	slug: true,
	createdAt: true,
	updatedAt: true
}

type BrandSelect = Prisma.BrandGetPayload<{
	select: typeof brandSelect
}>

@Injectable()
export class BrandRepository {
	constructor(private readonly prisma: PrismaService) {}

	findAll(catalogId: string) {
		return this.prisma.brand.findMany({
			where: { catalogId, deleteAt: null },
			select: brandSelect,
			orderBy: [{ name: SortOrder.asc }, { createdAt: SortOrder.desc }]
		})
	}

	findById(id: string, catalogId: string) {
		return this.prisma.brand.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: brandSelect
		})
	}

	create(data: BrandCreateInput) {
		return this.prisma.brand.create({ data, select: brandSelect })
	}

	async update(
		id: string,
		catalogId: string,
		data: BrandUpdateInput
	): Promise<BrandSelect | null> {
		const result = await this.prisma.brand.updateMany({
			where: { id, catalogId, deleteAt: null },
			data
		})
		if (!result.count) return null

		return this.prisma.brand.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: brandSelect
		})
	}

	async existsSlug(
		catalogId: string,
		slug: string,
		excludeId?: string
	): Promise<boolean> {
		const brand = await this.prisma.brand.findFirst({
			where: {
				catalogId,
				slug,
				...(excludeId ? { id: { not: excludeId } } : {})
			},
			select: { id: true }
		})
		return Boolean(brand)
	}

	async softDelete(id: string, catalogId: string) {
		const now = new Date()

		return this.prisma.$transaction(async tx => {
			const result = await tx.brand.updateMany({
				where: { id, catalogId, deleteAt: null },
				data: { deleteAt: now }
			})
			if (!result.count) return null

			await tx.product.updateMany({
				where: { catalogId, brandId: id, deleteAt: null },
				data: { brandId: null }
			})

			return tx.brand.findFirst({
				where: { id, catalogId },
				select: brandSelect
			})
		})
	}
}

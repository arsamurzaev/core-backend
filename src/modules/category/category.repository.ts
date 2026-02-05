import type { Prisma } from '@generated/client'
import { SortOrder } from '@generated/internal/prismaNamespace'
import { CategoryCreateInput, CategoryUpdateInput } from '@generated/models'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

const categorySelect = {
	id: true,
	catalogId: true,
	parentId: true,
	position: true,
	name: true,
	imageUrl: true,
	descriptor: true,
	discount: true,
	createdAt: true,
	updatedAt: true
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
			imageUrl: true
		},
		orderBy: [{ position: SortOrder.asc }, { name: SortOrder.asc }]
	},
	categoryProducts: {
		select: { productId: true, position: true },
		orderBy: [{ position: SortOrder.asc }, { productId: SortOrder.asc }]
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

	findAll(catalogId: string) {
		return this.prisma.category.findMany({
			where: { catalogId, deleteAt: null },
			select: categorySelect,
			orderBy: [{ position: SortOrder.asc }, { name: SortOrder.asc }]
		})
	}

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
}

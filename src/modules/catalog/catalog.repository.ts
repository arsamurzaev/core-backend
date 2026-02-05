import { Prisma } from '@generated/client'
import { CatalogCreateInput, CatalogUpdateInput } from '@generated/models'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

const catalogSelect = {
	id: true,
	slug: true,
	domain: true,
	name: true,
	typeId: true,
	parentId: true,
	userId: true,
	deleteAt: true,
	createdAt: true,
	updatedAt: true,
	config: {
		select: {
			status: true,
			about: true,
			description: true,
			currency: true,
			logoUrl: true,
			bgUrl: true
		}
	},
	settings: {
		select: {
			isActive: true
		}
	}
}

@Injectable()
export class CatalogRepository {
	constructor(private readonly prisma: PrismaService) {}
	async getAll() {
		return this.prisma.catalog.findMany({
			select: catalogSelect,
			orderBy: { createdAt: 'desc' }
		})
	}

	async getById(id: string, select?: Prisma.CatalogSelect) {
		return this.prisma.catalog.findUnique({
			where: { id },
			select: { ...catalogSelect, ...select }
		})
	}

	async getBySlug(slug: string) {
		return this.prisma.catalog.findUnique({
			where: { slug },
			select: catalogSelect
		})
	}

	async getByDomain(domain: string) {
		return this.prisma.catalog.findUnique({
			where: { domain },
			select: catalogSelect
		})
	}

	async create(data: CatalogCreateInput) {
		return this.prisma.catalog.create({ data, select: catalogSelect })
	}

	async update(id: string, data: CatalogUpdateInput) {
		return this.prisma.catalog.update({
			where: { id },
			data,
			select: catalogSelect
		})
	}
}

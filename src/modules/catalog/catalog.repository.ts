import { CatalogCreateInput } from '@generated/models'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

@Injectable()
export class CatalogRepository {
	constructor(private readonly prisma: PrismaService) {}
	async getAll() {
		return this.prisma.catalog.findMany()
	}

	async getById(id: string) {
		return this.prisma.catalog.findUnique({ where: { id } })
	}

	async getBySlug(slug: string) {
		return this.prisma.catalog.findUnique({ where: { slug } })
	}

	async create(data: CatalogCreateInput) {
		return this.prisma.catalog.create({ data })
	}
}

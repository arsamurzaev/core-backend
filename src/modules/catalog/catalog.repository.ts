import { Prisma } from '@generated/client'
import { CatalogCreateInput, CatalogUpdateInput } from '@generated/models'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

const mediaSelect = {
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

const enumValueSelect = {
	id: true,
	attributeId: true,
	value: true,
	displayName: true,
	displayOrder: true,
	businessId: true,
	createdAt: true,
	updatedAt: true
}

const attributeSelect = {
	id: true,
	key: true,
	displayName: true,
	dataType: true,
	isRequired: true,
	isVariantAttribute: true,
	isFilterable: true,
	displayOrder: true,
	isHidden: true,
	createdAt: true,
	updatedAt: true,
	types: {
		select: { id: true }
	}
}

const attributeSelectWithEnums = {
	...attributeSelect,
	enumValues: {
		where: { deleteAt: null },
		select: enumValueSelect,
		orderBy: [{ displayOrder: 'asc' as const }, { value: 'asc' as const }]
	}
}

const typeSelectWithAttributes = {
	id: true,
	code: true,
	name: true,
	attributes: {
		where: { deleteAt: null },
		select: attributeSelectWithEnums,
		orderBy: [{ displayOrder: 'asc' as const }, { key: 'asc' as const }]
	}
}

const catalogContactSelect = {
	id: true,
	type: true,
	position: true,
	value: true
}

const catalogSelect: Prisma.CatalogSelect = {
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
			logoMedia: { select: mediaSelect },
			bgMedia: { select: mediaSelect },
			note: true
		}
	},
	settings: {
		select: {
			isActive: true,
			googleVerification: true,
			yandexVerification: true
		}
	}
}

const catalogSelectWithType = {
	...catalogSelect,
	contacts: {
		where: { deleteAt: null },
		select: catalogContactSelect,
		orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }]
	},
	type: {
		select: typeSelectWithAttributes
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

	async getByIdWithType(id: string, select?: Prisma.CatalogSelect) {
		return this.prisma.catalog.findUnique({
			where: { id },
			select: { ...catalogSelectWithType, ...select }
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

	async existsSlug(slug: string, excludeId?: string): Promise<boolean> {
		const catalog = await this.prisma.catalog.findFirst({
			where: {
				slug,
				...(excludeId ? { id: { not: excludeId } } : {})
			},
			select: { id: true }
		})
		return Boolean(catalog)
	}

	async existsDomain(domain: string, excludeId?: string): Promise<boolean> {
		const catalog = await this.prisma.catalog.findFirst({
			where: {
				domain,
				...(excludeId ? { id: { not: excludeId } } : {})
			},
			select: { id: true }
		})
		return Boolean(catalog)
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

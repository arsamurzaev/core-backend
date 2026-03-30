import { Prisma } from '@generated/client'
import { SeoEntityType } from '@generated/enums'
import { CatalogCreateInput, CatalogUpdateInput } from '@generated/models'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { buildMediaSelect } from '@/shared/media/media-select'

const mediaSelect = buildMediaSelect()

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

const catalogSeoSelect = {
	id: true,
	catalogId: true,
	entityType: true,
	entityId: true,
	urlPath: true,
	canonicalUrl: true,
	title: true,
	description: true,
	keywords: true,
	h1: true,
	seoText: true,
	robots: true,
	isIndexable: true,
	isFollowable: true,
	ogTitle: true,
	ogDescription: true,
	ogMedia: { select: mediaSelect },
	ogType: true,
	ogUrl: true,
	ogSiteName: true,
	ogLocale: true,
	twitterCard: true,
	twitterTitle: true,
	twitterDescription: true,
	twitterMedia: { select: mediaSelect },
	twitterSite: true,
	twitterCreator: true,
	hreflang: true,
	structuredData: true,
	extras: true,
	sitemapPriority: true,
	sitemapChangeFreq: true,
	createdAt: true,
	updatedAt: true
}

const catalogSeoRelationSelect = {
	seoSettings: {
		where: {
			deleteAt: null,
			entityType: SeoEntityType.CATALOG
		},
		select: catalogSeoSelect,
		orderBy: [{ updatedAt: 'desc' as const }, { createdAt: 'desc' as const }],
		take: 1
	}
}

const catalogSelect: Prisma.CatalogSelect = {
	id: true,
	slug: true,
	domain: true,
	name: true,
	typeId: true,
	parentId: true,
	userId: true,
	subscriptionEndsAt: true,
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

const catalogCurrentSelect: Prisma.CatalogSelect = {
	...catalogSeoRelationSelect,
	createdAt: false,
	updatedAt: false,
	deleteAt: false
}

const catalogCurrentShellSelect = {
	...catalogSelect,
	...catalogSeoRelationSelect,
	createdAt: false,
	updatedAt: false,
	deleteAt: false,
	contacts: {
		where: { deleteAt: null },
		select: catalogContactSelect,
		orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }]
	}
}

const catalogTypeSelect = {
	id: true,
	code: true,
	name: true,
	attributes: {
		where: { deleteAt: null },
		select: attributeSelectWithEnums,
		orderBy: [{ displayOrder: 'asc' as const }, { key: 'asc' as const }]
	}
}

const catalogCurrentFallbackSelect = {
	...catalogCurrentSelect,
	type: {
		select: {
			id: true,
			code: true,
			name: true,
			attributes: {
				where: { deleteAt: null },
				select: {
					id: true,
					key: true,
					displayName: true,
					dataType: true,
					isRequired: true,
					isVariantAttribute: true,
					isFilterable: true,
					displayOrder: true,
					createdAt: true,
					updatedAt: true,
					typeId: true,
					enumValues: {
						where: { deleteAt: null },
						select: {
							id: true,
							attributeId: true,
							value: true,
							displayName: true,
							displayOrder: true,
							createdAt: true,
							updatedAt: true
						},
						orderBy: [{ displayOrder: 'asc' as const }, { value: 'asc' as const }]
					}
				},
				orderBy: [{ displayOrder: 'asc' as const }, { key: 'asc' as const }]
			}
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

	async getByIdWithType(id: string, select?: Prisma.CatalogSelect) {
		return this.prisma.catalog.findUnique({
			where: { id },
			select: { ...catalogSelectWithType, ...select }
		})
	}

	async getCurrentByIdWithType(id: string) {
		try {
			return await this.getByIdWithType(id, catalogCurrentSelect)
		} catch (error) {
			if (isUnknownAttributeTypesError(error)) {
				return this.getByIdWithType(id, catalogCurrentFallbackSelect)
			}
			throw error
		}
	}

	async getCurrentShellById(id: string) {
		return this.prisma.catalog.findUnique({
			where: { id },
			select: catalogCurrentShellSelect
		})
	}

	async getTypeByIdWithAttributes(id: string) {
		try {
			return await this.prisma.type.findUnique({
				where: { id },
				select: catalogTypeSelect
			})
		} catch (error) {
			if (isUnknownAttributeTypesError(error)) {
				return this.prisma.type.findUnique({
					where: { id },
					select: catalogCurrentFallbackSelect.type.select
				})
			}
			throw error
		}
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

function isUnknownAttributeTypesError(error: unknown): boolean {
	const message =
		typeof error === 'object' && error !== null && 'message' in error
			? String((error as { message?: string }).message)
			: ''
	return message.includes(
		'Unknown field `types` for select statement on model `Attribute`'
	)
}

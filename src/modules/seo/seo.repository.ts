import { SeoEntityType } from '@generated/enums'
import { SeoSettingCreateInput, SeoSettingUpdateInput } from '@generated/models'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

const seoSelect = {
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
	ogImage: true,
	ogType: true,
	ogUrl: true,
	ogSiteName: true,
	ogLocale: true,
	twitterCard: true,
	twitterTitle: true,
	twitterDescription: true,
	twitterImage: true,
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

@Injectable()
export class SeoRepository {
	constructor(private readonly prisma: PrismaService) {}

	findAll(catalogId: string) {
		return this.prisma.seoSetting.findMany({
			where: { catalogId, deleteAt: null },
			select: seoSelect,
			orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
		})
	}

	findById(id: string, catalogId: string) {
		return this.prisma.seoSetting.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: seoSelect
		})
	}

	findByEntity(catalogId: string, entityType: SeoEntityType, entityId: string) {
		return this.prisma.seoSetting.findFirst({
			where: { catalogId, entityType, entityId, deleteAt: null },
			select: seoSelect
		})
	}

	create(data: SeoSettingCreateInput) {
		return this.prisma.seoSetting.create({
			data,
			select: seoSelect
		})
	}

	async update(id: string, catalogId: string, data: SeoSettingUpdateInput) {
		const result = await this.prisma.seoSetting.updateMany({
			where: { id, catalogId, deleteAt: null },
			data
		})
		if (!result.count) return null

		return this.prisma.seoSetting.findFirst({
			where: { id, catalogId, deleteAt: null },
			select: seoSelect
		})
	}

	async softDelete(id: string, catalogId: string) {
		const result = await this.prisma.seoSetting.updateMany({
			where: { id, catalogId, deleteAt: null },
			data: { deleteAt: new Date() }
		})
		if (!result.count) return null

		return this.prisma.seoSetting.findFirst({
			where: { id, catalogId },
			select: seoSelect
		})
	}
}

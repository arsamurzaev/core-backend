import { Prisma } from '@generated/client'
import { CatalogDomainStatus } from '@generated/enums'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

const catalogDomainSelect = {
	id: true,
	catalogId: true,
	hostname: true,
	status: true,
	isPrimary: true,
	redirectToPrimary: true,
	includeWww: true,
	verificationToken: true,
	lastCheckedAt: true,
	lastError: true,
	createdAt: true,
	updatedAt: true
} as const satisfies Prisma.CatalogDomainSelect

@Injectable()
export class CatalogDomainRepository {
	constructor(private readonly prisma: PrismaService) {}

	listByCatalog(catalogId: string) {
		return this.prisma.catalogDomain.findMany({
			where: { catalogId },
			select: catalogDomainSelect,
			orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
		})
	}

	findById(id: string) {
		return this.prisma.catalogDomain.findUnique({
			where: { id },
			select: catalogDomainSelect
		})
	}

	findByHostname(hostname: string) {
		return this.prisma.catalogDomain.findUnique({
			where: { hostname },
			select: catalogDomainSelect
		})
	}

	findAllowedForTls(hostname: string) {
		return this.prisma.catalogDomain.findFirst({
			where: {
				hostname,
				status: CatalogDomainStatus.ACTIVE,
				catalog: { deleteAt: null }
			},
			select: { id: true, catalogId: true }
		})
	}

	findWwwAllowedForTls(hostname: string) {
		return this.prisma.catalogDomain.findFirst({
			where: {
				hostname,
				includeWww: true,
				status: CatalogDomainStatus.ACTIVE,
				catalog: { deleteAt: null }
			},
			select: { id: true, catalogId: true }
		})
	}

	create(data: Prisma.CatalogDomainCreateInput) {
		return this.prisma.catalogDomain.create({
			data,
			select: catalogDomainSelect
		})
	}

	async unsetPrimary(catalogId: string): Promise<void> {
		await this.prisma.catalogDomain.updateMany({
			where: { catalogId, isPrimary: true },
			data: { isPrimary: false }
		})
	}

	update(id: string, data: Prisma.CatalogDomainUpdateInput) {
		return this.prisma.catalogDomain.update({
			where: { id },
			data,
			select: catalogDomainSelect
		})
	}

	listPendingDns(limit: number) {
		return this.prisma.catalogDomain.findMany({
			where: {
				status: {
					in: [
						CatalogDomainStatus.PENDING_DNS,
						CatalogDomainStatus.DNS_VERIFIED,
						CatalogDomainStatus.FAILED
					]
				},
				catalog: { deleteAt: null }
			},
			select: catalogDomainSelect,
			orderBy: [
				{ lastCheckedAt: { sort: 'asc', nulls: 'first' } },
				{ createdAt: 'asc' }
			],
			take: limit
		})
	}
}

import type { Prisma } from '@generated/client'
import {
	IntegrationProvider,
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger,
	IntegrationSyncStatus,
	ProductStatus
} from '@generated/enums'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

const integrationSelect = {
	id: true,
	catalogId: true,
	provider: true,
	metadata: true,
	isActive: true,
	syncStartedAt: true,
	lastSyncAt: true,
	lastSyncStatus: true,
	lastSyncError: true,
	totalProducts: true,
	createdProducts: true,
	updatedProducts: true,
	deletedProducts: true,
	deleteAt: true,
	createdAt: true,
	updatedAt: true
}

const productLinkSelect = {
	id: true,
	integrationId: true,
	productId: true,
	externalId: true,
	externalCode: true,
	externalUpdatedAt: true,
	lastSyncedAt: true,
	rawMeta: true,
	createdAt: true,
	updatedAt: true
}

const productSyncSelect = {
	id: true,
	catalogId: true,
	name: true,
	sku: true,
	slug: true,
	price: true,
	status: true,
	deleteAt: true
}

const syncRunSelect = {
	id: true,
	integrationId: true,
	catalogId: true,
	provider: true,
	mode: true,
	trigger: true,
	status: true,
	jobId: true,
	productId: true,
	externalId: true,
	error: true,
	metadata: true,
	totalProducts: true,
	createdProducts: true,
	updatedProducts: true,
	deletedProducts: true,
	imagesImported: true,
	durationMs: true,
	requestedAt: true,
	startedAt: true,
	finishedAt: true,
	createdAt: true,
	updatedAt: true
}

type ProductReadExecutor =
	| Pick<PrismaService, 'product' | 'productMedia'>
	| Pick<Prisma.TransactionClient, 'product' | 'productMedia'>

export type IntegrationRecord = Prisma.IntegrationGetPayload<{
	select: typeof integrationSelect
}>

export type IntegrationProductLinkRecord =
	Prisma.IntegrationProductLinkGetPayload<{
		select: typeof productLinkSelect
	}>

export type ProductSyncRecord = Prisma.ProductGetPayload<{
	select: typeof productSyncSelect
}>

export type IntegrationSyncRunRecord = Prisma.IntegrationSyncRunGetPayload<{
	select: typeof syncRunSelect
}>

@Injectable()
export class IntegrationRepository {
	constructor(private readonly prisma: PrismaService) {}

	findMoySklad(catalogId: string): Promise<IntegrationRecord | null> {
		return this.prisma.integration.findFirst({
			where: {
				catalogId,
				provider: IntegrationProvider.MOYSKLAD,
				deleteAt: null
			},
			select: integrationSelect
		})
	}

	findAllMoySklad(): Promise<IntegrationRecord[]> {
		return this.prisma.integration.findMany({
			where: {
				provider: IntegrationProvider.MOYSKLAD,
				deleteAt: null
			},
			orderBy: { createdAt: 'asc' },
			select: integrationSelect
		})
	}

	upsertMoySklad(
		catalogId: string,
		params: {
			metadata: Prisma.InputJsonValue
			isActive: boolean
		}
	): Promise<IntegrationRecord> {
		return this.prisma.integration.upsert({
			where: {
				catalogId_provider: {
					catalogId,
					provider: IntegrationProvider.MOYSKLAD
				}
			},
			create: {
				catalogId,
				provider: IntegrationProvider.MOYSKLAD,
				metadata: params.metadata,
				isActive: params.isActive
			},
			update: {
				metadata: params.metadata,
				isActive: params.isActive,
				deleteAt: null
			},
			select: integrationSelect
		})
	}

	async updateMoySklad(
		catalogId: string,
		params: {
			metadata?: Prisma.InputJsonValue
			isActive?: boolean
		}
	): Promise<IntegrationRecord | null> {
		const existing = await this.findMoySklad(catalogId)
		if (!existing) return null

		await this.prisma.integration.update({
			where: { id: existing.id },
			data: {
				...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
				...(params.isActive !== undefined ? { isActive: params.isActive } : {})
			}
		})

		return this.findMoySklad(catalogId)
	}

	async softDeleteMoySklad(
		catalogId: string
	): Promise<IntegrationRecord | null> {
		const existing = await this.findMoySklad(catalogId)
		if (!existing) return null

		await this.prisma.integration.update({
			where: { id: existing.id },
			data: {
				deleteAt: new Date(),
				isActive: false,
				lastSyncStatus: IntegrationSyncStatus.IDLE,
				syncStartedAt: null
			}
		})

		return existing
	}

	async beginMoySkladSync(
		catalogId: string,
		staleBefore: Date
	): Promise<IntegrationRecord | null> {
		const updated = await this.prisma.integration.updateMany({
			where: {
				catalogId,
				provider: IntegrationProvider.MOYSKLAD,
				deleteAt: null,
				isActive: true,
				OR: [
					{ lastSyncStatus: { not: IntegrationSyncStatus.SYNCING } },
					{ syncStartedAt: null },
					{ syncStartedAt: { lt: staleBefore } }
				]
			},
			data: {
				lastSyncStatus: IntegrationSyncStatus.SYNCING,
				syncStartedAt: new Date(),
				lastSyncError: null
			}
		})

		if (!updated.count) return null
		return this.findMoySklad(catalogId)
	}

	async finishMoySkladSync(
		catalogId: string,
		stats: {
			totalProducts: number
			createdProducts: number
			updatedProducts: number
			deletedProducts: number
			syncedAt: Date
		},
		tx?: Prisma.TransactionClient
	): Promise<IntegrationRecord | null> {
		const db = tx || this.prisma
		const existing = await this.findMoySklad(catalogId)
		if (!existing) return null

		await db.integration.update({
			where: { id: existing.id },
			data: {
				syncStartedAt: null,
				lastSyncAt: stats.syncedAt,
				lastSyncStatus: IntegrationSyncStatus.SUCCESS,
				lastSyncError: null,
				totalProducts: stats.totalProducts,
				createdProducts: stats.createdProducts,
				updatedProducts: stats.updatedProducts,
				deletedProducts: stats.deletedProducts
			}
		})

		return this.findMoySklad(catalogId)
	}

	async failMoySkladSync(
		catalogId: string,
		error: string,
		tx?: Prisma.TransactionClient
	): Promise<IntegrationRecord | null> {
		const db = tx || this.prisma
		const existing = await this.findMoySklad(catalogId)
		if (!existing) return null

		await db.integration.update({
			where: { id: existing.id },
			data: {
				syncStartedAt: null,
				lastSyncAt: new Date(),
				lastSyncStatus: IntegrationSyncStatus.ERROR,
				lastSyncError: error
			}
		})

		return this.findMoySklad(catalogId)
	}

	findSyncRunById(runId: string): Promise<IntegrationSyncRunRecord | null> {
		return this.prisma.integrationSyncRun.findUnique({
			where: { id: runId },
			select: syncRunSelect
		})
	}

	findLatestActiveSyncRun(
		catalogId: string
	): Promise<IntegrationSyncRunRecord | null> {
		return this.prisma.integrationSyncRun.findFirst({
			where: {
				catalogId,
				provider: IntegrationProvider.MOYSKLAD,
				status: {
					in: [IntegrationSyncRunStatus.PENDING, IntegrationSyncRunStatus.RUNNING]
				}
			},
			orderBy: [{ requestedAt: 'desc' }, { createdAt: 'desc' }],
			select: syncRunSelect
		})
	}

	findLatestFinishedSyncRun(
		catalogId: string
	): Promise<IntegrationSyncRunRecord | null> {
		return this.prisma.integrationSyncRun.findFirst({
			where: {
				catalogId,
				provider: IntegrationProvider.MOYSKLAD,
				status: {
					in: [
						IntegrationSyncRunStatus.SUCCESS,
						IntegrationSyncRunStatus.ERROR,
						IntegrationSyncRunStatus.SKIPPED
					]
				}
			},
			orderBy: [{ requestedAt: 'desc' }, { createdAt: 'desc' }],
			select: syncRunSelect
		})
	}

	findRecentSyncRuns(
		catalogId: string,
		take: number
	): Promise<IntegrationSyncRunRecord[]> {
		return this.prisma.integrationSyncRun.findMany({
			where: {
				catalogId,
				provider: IntegrationProvider.MOYSKLAD
			},
			orderBy: [{ requestedAt: 'desc' }, { createdAt: 'desc' }],
			take,
			select: syncRunSelect
		})
	}

	createSyncRun(params: {
		integrationId: string
		catalogId: string
		mode: IntegrationSyncRunMode
		trigger: IntegrationSyncRunTrigger
		status?: IntegrationSyncRunStatus
		jobId?: string | null
		productId?: string | null
		externalId?: string | null
		metadata?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
	}): Promise<IntegrationSyncRunRecord> {
		return this.prisma.integrationSyncRun.create({
			data: {
				integrationId: params.integrationId,
				catalogId: params.catalogId,
				provider: IntegrationProvider.MOYSKLAD,
				mode: params.mode,
				trigger: params.trigger,
				status: params.status ?? IntegrationSyncRunStatus.PENDING,
				jobId: params.jobId ?? null,
				productId: params.productId ?? null,
				externalId: params.externalId ?? null,
				...(params.metadata !== undefined ? { metadata: params.metadata } : {})
			},
			select: syncRunSelect
		})
	}

	async attachSyncRunJobId(
		runId: string,
		jobId: string
	): Promise<IntegrationSyncRunRecord | null> {
		const updated = await this.prisma.integrationSyncRun.updateMany({
			where: { id: runId },
			data: { jobId }
		})

		if (!updated.count) return null
		return this.findSyncRunById(runId)
	}

	async markSyncRunRunning(
		runId: string,
		jobId?: string | null
	): Promise<IntegrationSyncRunRecord | null> {
		const updated = await this.prisma.integrationSyncRun.updateMany({
			where: { id: runId },
			data: {
				status: IntegrationSyncRunStatus.RUNNING,
				startedAt: new Date(),
				...(jobId ? { jobId } : {})
			}
		})

		if (!updated.count) return null
		return this.findSyncRunById(runId)
	}

	async completeSyncRun(
		runId: string,
		params: {
			externalId?: string | null
			totalProducts: number
			createdProducts: number
			updatedProducts: number
			deletedProducts: number
			imagesImported: number
			durationMs: number
			finishedAt?: Date
		}
	): Promise<IntegrationSyncRunRecord | null> {
		const finishedAt = params.finishedAt ?? new Date()
		const updated = await this.prisma.integrationSyncRun.updateMany({
			where: { id: runId },
			data: {
				status: IntegrationSyncRunStatus.SUCCESS,
				externalId: params.externalId ?? null,
				error: null,
				totalProducts: params.totalProducts,
				createdProducts: params.createdProducts,
				updatedProducts: params.updatedProducts,
				deletedProducts: params.deletedProducts,
				imagesImported: params.imagesImported,
				durationMs: params.durationMs,
				finishedAt
			}
		})

		if (!updated.count) return null
		return this.findSyncRunById(runId)
	}

	async failSyncRun(
		runId: string,
		error: string,
		finishedAt: Date = new Date()
	): Promise<IntegrationSyncRunRecord | null> {
		const updated = await this.prisma.integrationSyncRun.updateMany({
			where: { id: runId },
			data: {
				status: IntegrationSyncRunStatus.ERROR,
				error,
				finishedAt
			}
		})

		if (!updated.count) return null
		return this.findSyncRunById(runId)
	}

	async skipSyncRun(
		runId: string,
		error: string,
		finishedAt: Date = new Date()
	): Promise<IntegrationSyncRunRecord | null> {
		const updated = await this.prisma.integrationSyncRun.updateMany({
			where: { id: runId },
			data: {
				status: IntegrationSyncRunStatus.SKIPPED,
				error,
				finishedAt
			}
		})

		if (!updated.count) return null
		return this.findSyncRunById(runId)
	}

	findProductLinkByExternalId(
		integrationId: string,
		externalId: string,
		tx?: Prisma.TransactionClient
	): Promise<IntegrationProductLinkRecord | null> {
		const db = tx || this.prisma
		return db.integrationProductLink.findUnique({
			where: {
				integrationId_externalId: {
					integrationId,
					externalId
				}
			},
			select: productLinkSelect
		})
	}

	findProductLinkByProductId(
		integrationId: string,
		productId: string
	): Promise<IntegrationProductLinkRecord | null> {
		return this.prisma.integrationProductLink.findUnique({
			where: {
				integrationId_productId: {
					integrationId,
					productId
				}
			},
			select: productLinkSelect
		})
	}

	findProductLinksByIntegration(
		integrationId: string
	): Promise<IntegrationProductLinkRecord[]> {
		return this.prisma.integrationProductLink.findMany({
			where: { integrationId },
			select: productLinkSelect
		})
	}

	upsertProductLink(
		params: {
			integrationId: string
			productId: string
			externalId: string
			externalCode?: string | null
			externalUpdatedAt?: Date | null
			rawMeta?: Prisma.InputJsonValue
		},
		tx?: Prisma.TransactionClient
	): Promise<IntegrationProductLinkRecord> {
		const db = tx || this.prisma
		const now = new Date()

		return db.integrationProductLink.upsert({
			where: {
				integrationId_externalId: {
					integrationId: params.integrationId,
					externalId: params.externalId
				}
			},
			create: {
				integrationId: params.integrationId,
				productId: params.productId,
				externalId: params.externalId,
				externalCode: params.externalCode ?? null,
				externalUpdatedAt: params.externalUpdatedAt ?? null,
				lastSyncedAt: now,
				rawMeta: params.rawMeta
			},
			update: {
				productId: params.productId,
				externalCode: params.externalCode ?? null,
				externalUpdatedAt: params.externalUpdatedAt ?? null,
				lastSyncedAt: now,
				rawMeta: params.rawMeta
			},
			select: productLinkSelect
		})
	}

	findProductById(
		catalogId: string,
		productId: string,
		tx?: Prisma.TransactionClient
	): Promise<ProductSyncRecord | null> {
		const db = tx || this.prisma
		return db.product.findFirst({
			where: {
				id: productId,
				catalogId,
				deleteAt: null
			},
			select: productSyncSelect
		})
	}

	findProductByCatalogAndSku(
		catalogId: string,
		sku: string,
		tx?: Prisma.TransactionClient
	): Promise<ProductSyncRecord | null> {
		const db = tx || this.prisma
		return db.product.findFirst({
			where: {
				catalogId,
				sku,
				deleteAt: null
			},
			select: productSyncSelect
		})
	}

	async existsProductSlug(
		catalogId: string,
		slug: string,
		excludeId?: string,
		tx?: Prisma.TransactionClient
	): Promise<boolean> {
		const db = tx || this.prisma
		const product = await db.product.findFirst({
			where: {
				catalogId,
				slug,
				...(excludeId ? { id: { not: excludeId } } : {})
			},
			select: { id: true }
		})

		return Boolean(product)
	}

	async existsProductSku(
		sku: string,
		excludeId?: string,
		tx?: Prisma.TransactionClient
	): Promise<boolean> {
		const db = tx || this.prisma
		const product = await db.product.findUnique({
			where: { sku },
			select: { id: true }
		})

		if (!product) return false
		if (!excludeId) return true
		return product.id !== excludeId
	}

	findCategoryByName(
		catalogId: string,
		name: string,
		tx?: Prisma.TransactionClient
	): Promise<{ id: string; name: string } | null> {
		const db = tx || this.prisma
		return db.category.findFirst({
			where: {
				catalogId,
				name,
				deleteAt: null
			},
			select: { id: true, name: true }
		})
	}

	createCategory(
		catalogId: string,
		name: string,
		parentId?: string,
		tx?: Prisma.TransactionClient
	): Promise<{ id: string; name: string }> {
		const db = tx || this.prisma
		return db.category.create({
			data: {
				catalog: { connect: { id: catalogId } },
				name,
				...(parentId ? { parent: { connect: { id: parentId } } } : {})
			},
			select: { id: true, name: true }
		})
	}

	async syncProductCategories(
		productId: string,
		catalogId: string,
		categoryIds: string[],
		tx?: Prisma.TransactionClient
	): Promise<void> {
		const db = tx || this.prisma
		// Simplified: replace all categories for the product
		await db.categoryProduct.deleteMany({
			where: { productId, category: { catalogId } }
		})
		if (categoryIds.length > 0) {
			await db.categoryProduct.createMany({
				data: categoryIds.map(categoryId => ({
					categoryId,
					productId,
					position: 0
				}))
			})
		}
		return
	}

	createProduct(
		params: {
			catalogId: string
			name: string
			sku: string
			slug: string
			price: number
			status: ProductStatus
		},
		tx?: Prisma.TransactionClient
	): Promise<ProductSyncRecord> {
		const db = tx || this.prisma
		return db.product.create({
			data: {
				catalog: { connect: { id: params.catalogId } },
				name: params.name,
				sku: params.sku,
				slug: params.slug,
				price: params.price,
				status: params.status
			},
			select: productSyncSelect
		})
	}

	async updateProduct(
		params: {
			productId: string
			catalogId: string
			data: Prisma.ProductUpdateManyMutationInput
		},
		tx?: Prisma.TransactionClient
	): Promise<ProductSyncRecord | null> {
		const db = tx || this.prisma
		const result = await db.product.updateMany({
			where: {
				id: params.productId,
				catalogId: params.catalogId,
				deleteAt: null
			},
			data: params.data
		})

		if (!result.count) return null
		return this.findProductById(params.catalogId, params.productId, tx)
	}

	async findProductMediaIds(
		productId: string,
		catalogId: string,
		tx?: Prisma.TransactionClient
	): Promise<string[]> {
		const db = tx || this.prisma
		return db.productMedia
			.findMany({
				where: {
					productId,
					product: {
						catalogId,
						deleteAt: null
					}
				},
				select: { mediaId: true }
			})
			.then(items => items.map(item => item.mediaId))
	}

	async replaceProductMedia(
		productId: string,
		catalogId: string,
		mediaIds: string[],
		tx?: Prisma.TransactionClient
	): Promise<boolean> {
		const db = tx || this.prisma
		const product = await this.findProductWithExecutor(db, catalogId, productId)
		if (!product) return false

		await db.productMedia.deleteMany({
			where: { productId }
		})

		if (mediaIds.length) {
			await db.productMedia.createMany({
				data: mediaIds.map((mediaId, index) => ({
					productId,
					mediaId,
					position: index
				}))
			})
		}

		return true
	}

	private findProductWithExecutor(
		executor: ProductReadExecutor,
		catalogId: string,
		productId: string
	): Promise<{ id: string } | null> {
		return executor.product.findFirst({
			where: {
				id: productId,
				catalogId,
				deleteAt: null
			},
			select: { id: true }
		})
	}
}

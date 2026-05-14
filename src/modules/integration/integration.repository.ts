import type { Prisma } from '@generated/client'
import {
	AttributeEnumValueSource,
	DataType,
	IntegrationProvider,
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger,
	IntegrationSyncStatus,
	ProductStatus,
	ProductVariantStatus
} from '@generated/enums'
import type { IntegrationOrderExportStatus } from '@generated/enums'
import { Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { renderSafeProviderErrorMessage } from './provider-error-redaction'

const ORDER_EXPORT_STATUS_PENDING: IntegrationOrderExportStatus = 'PENDING'
const ORDER_EXPORT_STATUS_RUNNING: IntegrationOrderExportStatus = 'RUNNING'
const ORDER_EXPORT_STATUS_SUCCESS: IntegrationOrderExportStatus = 'SUCCESS'
const ORDER_EXPORT_STATUS_ERROR: IntegrationOrderExportStatus = 'ERROR'
const ORDER_EXPORT_STATUS_SKIPPED: IntegrationOrderExportStatus = 'SKIPPED'
const DEFAULT_VARIANT_KEY = 'default'
const DEFAULT_VARIANT_SKU_SUFFIX = 'DEFAULT'
const VARIANT_SKU_MAX_LENGTH = 100
const MOVED_VARIANT_SKU_SUFFIX = 'MOVED'
const MOYSKLAD_PRODUCT_TYPE_CODE_PREFIX = 'moysklad-'
const PRODUCT_TYPE_SCOPE_CATALOG = 'CATALOG'
const PRODUCT_TYPE_CODE_MAX_LENGTH = 100
const PRODUCT_TYPE_NAME_MAX_LENGTH = 255

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

const variantLinkSelect = {
	id: true,
	integrationId: true,
	variantId: true,
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
	productTypeId: true,
	name: true,
	sku: true,
	slug: true,
	price: true,
	status: true,
	deleteAt: true
}

const productVariantSyncSelect = {
	id: true,
	productId: true,
	sku: true,
	variantKey: true,
	stock: true,
	price: true,
	status: true,
	isAvailable: true,
	deleteAt: true
}

const variantAttributeDefinitionSelect = {
	id: true,
	key: true,
	displayName: true,
	displayOrder: true
}

function buildMappingPreviewAttributeSelect(catalogId: string) {
	return {
		id: true,
		key: true,
		displayName: true,
		dataType: true,
		isVariantAttribute: true,
		displayOrder: true,
		enumValues: {
			where: { deleteAt: null, catalogId },
			orderBy: [{ displayOrder: 'asc' as const }, { value: 'asc' as const }],
			select: {
				id: true,
				value: true,
				displayName: true,
				displayOrder: true,
				aliases: {
					where: { deleteAt: null, catalogId },
					select: {
						value: true,
						displayName: true
					}
				}
			}
		}
	}
}

const mappingPreviewAttributeSelect =
	buildMappingPreviewAttributeSelect('__catalog__')

const mappingApplyEnumValueSelect = {
	id: true,
	attributeId: true,
	catalogId: true,
	value: true,
	displayName: true,
	displayOrder: true,
	source: true,
	deleteAt: true
}

const categorySyncSelect = {
	id: true,
	name: true,
	parentId: true
}

const categoryLinkSelect = {
	id: true,
	integrationId: true,
	categoryId: true,
	externalId: true,
	externalParentId: true,
	rawMeta: true,
	category: {
		select: categorySyncSelect
	},
	createdAt: true,
	updatedAt: true
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

const orderExportSelect = {
	id: true,
	integrationId: true,
	orderId: true,
	provider: true,
	idempotencyKey: true,
	externalId: true,
	status: true,
	attempts: true,
	lastError: true,
	payload: true,
	response: true,
	requestedAt: true,
	startedAt: true,
	exportedAt: true,
	createdAt: true,
	updatedAt: true
}

const orderExportWithIntegrationSelect = {
	...orderExportSelect,
	integration: {
		select: {
			catalogId: true,
			isActive: true,
			deleteAt: true,
			metadata: true
		}
	}
}

const orderForExportSelect = {
	id: true,
	catalogId: true,
	status: true,
	comment: true,
	address: true,
	isDelivery: true,
	checkoutMethod: true,
	checkoutData: true,
	checkoutContacts: true,
	products: true,
	totalAmount: true,
	createdAt: true,
	updatedAt: true
}

function mergeJsonObject(
	value: Prisma.JsonValue | null,
	patch: Record<string, Prisma.InputJsonValue>
): Prisma.InputJsonValue {
	const base =
		value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, Prisma.JsonValue>)
			: {}

	return {
		...base,
		...patch
	} as Prisma.InputJsonValue
}

function cloneJsonRecord(
	value: unknown
): Record<string, Prisma.InputJsonValue> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {}
	}

	return { ...(value as Record<string, Prisma.InputJsonValue>) }
}

function readStringRecord(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {}
	}

	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
			if (typeof item !== 'string') return []
			const normalizedKey = key.trim()
			const normalizedValue = item.trim()
			if (!normalizedKey || !normalizedValue) return []
			return [[normalizedKey, normalizedValue]]
		})
	)
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

export type IntegrationVariantLinkRecord =
	Prisma.IntegrationVariantLinkGetPayload<{
		select: typeof variantLinkSelect
	}>

export type ProductSyncRecord = Prisma.ProductGetPayload<{
	select: typeof productSyncSelect
}>

export type ProductVariantSyncRecord = Prisma.ProductVariantGetPayload<{
	select: typeof productVariantSyncSelect
}>

export type VariantAttributeDefinitionRecord = Prisma.AttributeGetPayload<{
	select: typeof variantAttributeDefinitionSelect
}>

export type MappingPreviewAttributeRecord = Prisma.AttributeGetPayload<{
	select: typeof mappingPreviewAttributeSelect
}>

export type MappingApplyEnumValueRecord = Prisma.AttributeEnumValueGetPayload<{
	select: typeof mappingApplyEnumValueSelect
}>

export type IntegrationVariantAttributeValueInput = {
	attributeId: string
	value: string
	displayName?: string | null
}

export type IntegrationVariantAttributeDefinitionInput =
	IntegrationVariantAttributeValueInput & {
		key: string
		attributeDisplayName?: string | null
		displayOrder: number
	}

export type CategorySyncRecord = Prisma.CategoryGetPayload<{
	select: typeof categorySyncSelect
}>

export type IntegrationCategoryLinkRecord =
	Prisma.IntegrationCategoryLinkGetPayload<{
		select: typeof categoryLinkSelect
	}>

export type IntegrationSyncRunRecord = Prisma.IntegrationSyncRunGetPayload<{
	select: typeof syncRunSelect
}>

export type IntegrationOrderExportRecord =
	Prisma.IntegrationOrderExportGetPayload<{
		select: typeof orderExportSelect
	}>

export type IntegrationOrderExportWithIntegrationRecord =
	Prisma.IntegrationOrderExportGetPayload<{
		select: typeof orderExportWithIntegrationSelect
	}>

export type OrderForExportRecord = Prisma.OrderGetPayload<{
	select: typeof orderForExportSelect
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

	async findCatalogInventoryMode(catalogId: string) {
		const settings = await this.prisma.catalogSettings.findUnique({
			where: { catalogId },
			select: { inventoryMode: true }
		})

		return settings?.inventoryMode ?? null
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
			lastStockSyncedAt?: Date
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
				deletedProducts: stats.deletedProducts,
				...(stats.lastStockSyncedAt
					? {
							metadata: mergeJsonObject(existing.metadata, {
								lastStockSyncedAt: stats.lastStockSyncedAt.toISOString()
							})
						}
					: {})
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
		const safeError = renderSafeProviderErrorMessage(error)

		await db.integration.update({
			where: { id: existing.id },
			data: {
				syncStartedAt: null,
				lastSyncAt: new Date(),
				lastSyncStatus: IntegrationSyncStatus.ERROR,
				lastSyncError: safeError
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

	async updateSyncRunProgress(
		runId: string,
		progress: Prisma.InputJsonValue
	): Promise<IntegrationSyncRunRecord | null> {
		const existing = await this.prisma.integrationSyncRun.findUnique({
			where: { id: runId },
			select: { id: true, metadata: true }
		})
		if (!existing) return null

		await this.prisma.integrationSyncRun.update({
			where: { id: runId },
			data: {
				metadata: mergeJsonObject(existing.metadata, {
					progress
				})
			}
		})

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
			metadata?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
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
				...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
				finishedAt
			}
		})

		if (!updated.count) return null
		return this.findSyncRunById(runId)
	}

	async failSyncRun(
		runId: string,
		error: string,
		finishedAt: Date = new Date(),
		metadata?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
	): Promise<IntegrationSyncRunRecord | null> {
		const safeError = renderSafeProviderErrorMessage(error)
		const updated = await this.prisma.integrationSyncRun.updateMany({
			where: { id: runId },
			data: {
				status: IntegrationSyncRunStatus.ERROR,
				error: safeError,
				...(metadata !== undefined ? { metadata } : {}),
				finishedAt
			}
		})

		if (!updated.count) return null
		return this.findSyncRunById(runId)
	}

	async skipSyncRun(
		runId: string,
		error: string,
		finishedAt: Date = new Date(),
		metadata?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
	): Promise<IntegrationSyncRunRecord | null> {
		const safeError = renderSafeProviderErrorMessage(error)
		const updated = await this.prisma.integrationSyncRun.updateMany({
			where: { id: runId },
			data: {
				status: IntegrationSyncRunStatus.SKIPPED,
				error: safeError,
				...(metadata !== undefined ? { metadata } : {}),
				finishedAt
			}
		})

		if (!updated.count) return null
		return this.findSyncRunById(runId)
	}

	findOrderExportById(
		exportId: string
	): Promise<IntegrationOrderExportRecord | null> {
		return this.prisma.integrationOrderExport.findUnique({
			where: { id: exportId },
			select: orderExportSelect
		})
	}

	findOrderExportByOrderId(
		integrationId: string,
		orderId: string
	): Promise<IntegrationOrderExportRecord | null> {
		return this.prisma.integrationOrderExport.findUnique({
			where: {
				integrationId_orderId: {
					integrationId,
					orderId
				}
			},
			select: orderExportSelect
		})
	}

	findOrderExportForCatalog(
		catalogId: string,
		exportId: string
	): Promise<IntegrationOrderExportRecord | null> {
		return this.prisma.integrationOrderExport.findFirst({
			where: {
				id: exportId,
				provider: IntegrationProvider.MOYSKLAD,
				integration: {
					catalogId,
					provider: IntegrationProvider.MOYSKLAD,
					deleteAt: null
				}
			},
			select: orderExportSelect
		})
	}

	findOrderExportsByCatalog(
		catalogId: string,
		limit: number
	): Promise<IntegrationOrderExportRecord[]> {
		return this.prisma.integrationOrderExport.findMany({
			where: {
				provider: IntegrationProvider.MOYSKLAD,
				integration: {
					catalogId,
					provider: IntegrationProvider.MOYSKLAD,
					deleteAt: null
				}
			},
			orderBy: { requestedAt: 'desc' },
			take: limit,
			select: orderExportSelect
		})
	}

	findRunnableOrderExports(params: {
		limit: number
		staleRunningBefore: Date
	}): Promise<IntegrationOrderExportWithIntegrationRecord[]> {
		return this.prisma.integrationOrderExport.findMany({
			where: {
				provider: IntegrationProvider.MOYSKLAD,
				integration: {
					provider: IntegrationProvider.MOYSKLAD,
					isActive: true,
					deleteAt: null
				},
				OR: [
					{
						status: ORDER_EXPORT_STATUS_PENDING
					},
					{
						status: ORDER_EXPORT_STATUS_RUNNING,
						startedAt: { lt: params.staleRunningBefore }
					}
				]
			},
			orderBy: { requestedAt: 'asc' },
			take: params.limit,
			select: orderExportWithIntegrationSelect
		})
	}

	findOrderForExport(
		orderId: string,
		catalogId?: string
	): Promise<OrderForExportRecord | null> {
		return this.prisma.order.findFirst({
			where: {
				id: orderId,
				...(catalogId ? { catalogId } : {}),
				deleteAt: null
			},
			select: orderForExportSelect
		})
	}

	createPendingOrderExport(
		params: {
			integrationId: string
			orderId: string
			idempotencyKey?: string
			payload?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
		},
		tx?: Prisma.TransactionClient
	): Promise<IntegrationOrderExportRecord> {
		const db = tx || this.prisma
		const idempotencyKey =
			params.idempotencyKey ??
			this.buildOrderExportIdempotencyKey(params.integrationId, params.orderId)

		return db.integrationOrderExport.upsert({
			where: {
				integrationId_orderId: {
					integrationId: params.integrationId,
					orderId: params.orderId
				}
			},
			create: {
				integrationId: params.integrationId,
				orderId: params.orderId,
				provider: IntegrationProvider.MOYSKLAD,
				idempotencyKey,
				status: ORDER_EXPORT_STATUS_PENDING,
				...(params.payload !== undefined ? { payload: params.payload } : {})
			},
			update: {},
			select: orderExportSelect
		})
	}

	async markOrderExportRunning(
		exportId: string,
		startedAt: Date = new Date(),
		params: { staleRunningBefore?: Date } = {}
	): Promise<IntegrationOrderExportRecord | null> {
		const updated = await this.prisma.integrationOrderExport.updateMany({
			where: {
				id: exportId,
				OR: [
					{
						status: {
							in: [ORDER_EXPORT_STATUS_PENDING, ORDER_EXPORT_STATUS_ERROR]
						}
					},
					...(params.staleRunningBefore
						? [
								{
									status: ORDER_EXPORT_STATUS_RUNNING,
									startedAt: { lt: params.staleRunningBefore }
								}
							]
						: [])
				]
			},
			data: {
				status: ORDER_EXPORT_STATUS_RUNNING,
				attempts: { increment: 1 },
				lastError: null,
				startedAt,
				exportedAt: null
			}
		})

		if (!updated.count) return null
		return this.findOrderExportById(exportId)
	}

	async resetOrderExportForRetry(
		exportId: string
	): Promise<IntegrationOrderExportRecord | null> {
		const updated = await this.prisma.integrationOrderExport.updateMany({
			where: {
				id: exportId,
				status: {
					in: [
						ORDER_EXPORT_STATUS_PENDING,
						ORDER_EXPORT_STATUS_ERROR,
						ORDER_EXPORT_STATUS_SKIPPED
					]
				}
			},
			data: {
				status: ORDER_EXPORT_STATUS_PENDING,
				lastError: null,
				startedAt: null,
				exportedAt: null
			}
		})

		if (!updated.count) return null
		return this.findOrderExportById(exportId)
	}

	async markOrderExportSkipped(
		exportId: string,
		reason: string
	): Promise<IntegrationOrderExportRecord | null> {
		const safeReason = renderSafeProviderErrorMessage(reason)
		const updated = await this.prisma.integrationOrderExport.updateMany({
			where: {
				id: exportId,
				status: { not: ORDER_EXPORT_STATUS_SUCCESS }
			},
			data: {
				status: ORDER_EXPORT_STATUS_SKIPPED,
				lastError: safeReason,
				exportedAt: null
			}
		})

		if (!updated.count) return null
		return this.findOrderExportById(exportId)
	}

	async setOrderExportPayload(
		exportId: string,
		payload: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
	): Promise<IntegrationOrderExportRecord | null> {
		const updated = await this.prisma.integrationOrderExport.updateMany({
			where: { id: exportId },
			data: { payload }
		})

		if (!updated.count) return null
		return this.findOrderExportById(exportId)
	}

	async markOrderExportSuccess(
		exportId: string,
		params: {
			externalId?: string | null
			response?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
			exportedAt?: Date
		} = {}
	): Promise<IntegrationOrderExportRecord | null> {
		const exportedAt = params.exportedAt ?? new Date()
		const updated = await this.prisma.integrationOrderExport.updateMany({
			where: { id: exportId },
			data: {
				status: ORDER_EXPORT_STATUS_SUCCESS,
				externalId: params.externalId ?? null,
				lastError: null,
				...(params.response !== undefined ? { response: params.response } : {}),
				exportedAt
			}
		})

		if (!updated.count) return null
		return this.findOrderExportById(exportId)
	}

	async markOrderExportError(
		exportId: string,
		error: string
	): Promise<IntegrationOrderExportRecord | null> {
		const safeError = renderSafeProviderErrorMessage(error)
		const updated = await this.prisma.integrationOrderExport.updateMany({
			where: { id: exportId },
			data: {
				status: ORDER_EXPORT_STATUS_ERROR,
				lastError: safeError
			}
		})

		if (!updated.count) return null
		return this.findOrderExportById(exportId)
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

	async upsertProductLink(
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
		const data = {
			productId: params.productId,
			externalCode: params.externalCode ?? null,
			externalUpdatedAt: params.externalUpdatedAt ?? null,
			lastSyncedAt: now,
			rawMeta: params.rawMeta
		}

		const existingByExternalId = await db.integrationProductLink.findUnique({
			where: {
				integrationId_externalId: {
					integrationId: params.integrationId,
					externalId: params.externalId
				}
			},
			select: productLinkSelect
		})
		if (existingByExternalId) {
			return db.integrationProductLink.update({
				where: { id: existingByExternalId.id },
				data,
				select: productLinkSelect
			})
		}

		const existingByProductId = await db.integrationProductLink.findUnique({
			where: {
				integrationId_productId: {
					integrationId: params.integrationId,
					productId: params.productId
				}
			},
			select: productLinkSelect
		})
		if (existingByProductId) {
			return db.integrationProductLink.update({
				where: { id: existingByProductId.id },
				data: {
					...data,
					externalId: params.externalId
				},
				select: productLinkSelect
			})
		}

		return db.integrationProductLink.create({
			data: {
				integrationId: params.integrationId,
				productId: params.productId,
				externalId: params.externalId,
				externalCode: params.externalCode ?? null,
				externalUpdatedAt: params.externalUpdatedAt ?? null,
				lastSyncedAt: now,
				rawMeta: params.rawMeta
			},
			select: productLinkSelect
		})
	}

	findVariantLinkByExternalId(
		integrationId: string,
		externalId: string,
		tx?: Prisma.TransactionClient
	): Promise<IntegrationVariantLinkRecord | null> {
		const db = tx || this.prisma
		return db.integrationVariantLink.findUnique({
			where: {
				integrationId_externalId: {
					integrationId,
					externalId
				}
			},
			select: variantLinkSelect
		})
	}

	findVariantLinkByVariantId(
		integrationId: string,
		variantId: string
	): Promise<IntegrationVariantLinkRecord | null> {
		return this.prisma.integrationVariantLink.findUnique({
			where: {
				integrationId_variantId: {
					integrationId,
					variantId
				}
			},
			select: variantLinkSelect
		})
	}

	findVariantLinksByIntegration(
		integrationId: string
	): Promise<IntegrationVariantLinkRecord[]> {
		return this.prisma.integrationVariantLink.findMany({
			where: { integrationId },
			select: variantLinkSelect
		})
	}

	async findProductIdsWithVariantLinks(
		integrationId: string,
		tx?: Prisma.TransactionClient
	): Promise<string[]> {
		const db = tx || this.prisma
		const rows = await db.productVariant.findMany({
			where: {
				deleteAt: null,
				integrationLinks: { some: { integrationId } }
			},
			select: { productId: true },
			distinct: ['productId']
		})

		return rows.map(row => row.productId)
	}

	async archiveMissingIntegratedProductVariants(
		params: {
			integrationId: string
			productId: string
			externalIds: string[]
		},
		tx?: Prisma.TransactionClient
	): Promise<number> {
		const db = tx || this.prisma
		const currentExternalIds = Array.from(
			new Set(params.externalIds.map(item => item.trim()).filter(Boolean))
		)
		const result = await db.productVariant.updateMany({
			where: {
				productId: params.productId,
				deleteAt: null,
				integrationLinks: {
					some: {
						integrationId: params.integrationId,
						...(currentExternalIds.length > 0
							? { externalId: { notIn: currentExternalIds } }
							: {})
					}
				}
			},
			data: {
				stock: 0,
				status: ProductVariantStatus.OUT_OF_STOCK,
				isAvailable: false,
				deleteAt: new Date()
			}
		})

		return result.count
	}

	async upsertVariantLink(
		params: {
			integrationId: string
			variantId: string
			externalId: string
			externalCode?: string | null
			externalUpdatedAt?: Date | null
			rawMeta?: Prisma.InputJsonValue
		},
		tx?: Prisma.TransactionClient
	): Promise<IntegrationVariantLinkRecord> {
		const db = tx || this.prisma
		const now = new Date()
		const data = {
			variantId: params.variantId,
			externalCode: params.externalCode ?? null,
			externalUpdatedAt: params.externalUpdatedAt ?? null,
			lastSyncedAt: now,
			rawMeta: params.rawMeta
		}

		const existingByExternalId = await db.integrationVariantLink.findUnique({
			where: {
				integrationId_externalId: {
					integrationId: params.integrationId,
					externalId: params.externalId
				}
			},
			select: variantLinkSelect
		})
		if (existingByExternalId) {
			return db.integrationVariantLink.update({
				where: { id: existingByExternalId.id },
				data,
				select: variantLinkSelect
			})
		}

		const existingByVariantId = await db.integrationVariantLink.findUnique({
			where: {
				integrationId_variantId: {
					integrationId: params.integrationId,
					variantId: params.variantId
				}
			},
			select: variantLinkSelect
		})
		if (existingByVariantId) {
			return db.integrationVariantLink.update({
				where: { id: existingByVariantId.id },
				data: {
					...data,
					externalId: params.externalId
				},
				select: variantLinkSelect
			})
		}

		return db.integrationVariantLink.create({
			data: {
				integrationId: params.integrationId,
				variantId: params.variantId,
				externalId: params.externalId,
				externalCode: params.externalCode ?? null,
				externalUpdatedAt: params.externalUpdatedAt ?? null,
				lastSyncedAt: now,
				rawMeta: params.rawMeta
			},
			select: variantLinkSelect
		})
	}

	findProductVariantById(
		productId: string,
		variantId: string,
		tx?: Prisma.TransactionClient
	): Promise<ProductVariantSyncRecord | null> {
		const db = tx || this.prisma
		return db.productVariant.findFirst({
			where: {
				id: variantId,
				productId
			},
			select: productVariantSyncSelect
		})
	}

	findProductVariantBySku(
		sku: string,
		tx?: Prisma.TransactionClient
	): Promise<ProductVariantSyncRecord | null> {
		const db = tx || this.prisma
		return db.productVariant.findUnique({
			where: { sku },
			select: productVariantSyncSelect
		})
	}

	async findMoySkladMappingPreviewAttributes(
		catalogId: string
	): Promise<MappingPreviewAttributeRecord[]> {
		const catalog = await this.prisma.catalog.findFirst({
			where: { id: catalogId, deleteAt: null },
			select: { typeId: true }
		})
		if (!catalog) return []

		return this.prisma.attribute.findMany({
			where: {
				deleteAt: null,
				types: { some: { id: catalog.typeId } }
			},
			orderBy: [{ displayOrder: 'asc' }, { displayName: 'asc' }],
			select: buildMappingPreviewAttributeSelect(catalogId)
		})
	}

	async findMoySkladVariantAttributeById(
		catalogId: string,
		attributeId: string,
		tx?: Prisma.TransactionClient
	): Promise<VariantAttributeDefinitionRecord | null> {
		const db = tx || this.prisma
		const catalog = await db.catalog.findFirst({
			where: { id: catalogId, deleteAt: null },
			select: { typeId: true }
		})
		if (!catalog) return null

		const attribute = await db.attribute.findFirst({
			where: {
				id: attributeId,
				deleteAt: null,
				dataType: DataType.ENUM,
				isVariantAttribute: true,
				types: { some: { id: catalog.typeId } }
			},
			select: variantAttributeDefinitionSelect
		})

		return attribute
	}

	async upsertMoySkladVariantAttributeForMapping(
		catalogId: string,
		params: {
			key: string
			displayName: string
		},
		tx?: Prisma.TransactionClient
	): Promise<{
		attribute: VariantAttributeDefinitionRecord
		created: boolean
	}> {
		const db = tx || this.prisma
		const catalog = await db.catalog.findFirst({
			where: { id: catalogId, deleteAt: null },
			select: { typeId: true }
		})
		if (!catalog) {
			throw new Error(`Catalog ${catalogId} not found`)
		}

		const key = params.key.slice(0, 100)
		const existing = await db.attribute.findFirst({
			where: {
				key,
				deleteAt: null,
				types: { some: { id: catalog.typeId } }
			},
			orderBy: { createdAt: 'asc' },
			select: {
				...variantAttributeDefinitionSelect,
				dataType: true,
				isVariantAttribute: true
			}
		})
		if (existing) {
			if (existing.dataType !== DataType.ENUM || !existing.isVariantAttribute) {
				throw new Error(
					`Attribute ${key} already exists for catalog type but is not a variant enum attribute`
				)
			}

			return {
				attribute: {
					id: existing.id,
					key: existing.key,
					displayName: existing.displayName,
					displayOrder: existing.displayOrder
				},
				created: false
			}
		}

		const order = await db.attribute.aggregate({
			where: {
				deleteAt: null,
				types: { some: { id: catalog.typeId } }
			},
			_max: { displayOrder: true }
		})

		const attribute = await db.attribute.create({
			data: {
				key,
				displayName: params.displayName,
				dataType: DataType.ENUM,
				isRequired: false,
				isVariantAttribute: true,
				isFilterable: true,
				isHidden: false,
				displayOrder: (order._max.displayOrder ?? 0) + 1,
				types: { connect: { id: catalog.typeId } }
			},
			select: variantAttributeDefinitionSelect
		})

		return { attribute, created: true }
	}

	async upsertMoySkladVariantAttribute(
		catalogId: string,
		params: {
			key: string
			displayName: string
		},
		tx?: Prisma.TransactionClient
	): Promise<VariantAttributeDefinitionRecord> {
		const result = await this.upsertMoySkladVariantAttributeForMapping(
			catalogId,
			params,
			tx
		)

		return result.attribute
	}

	async findMoySkladEnumValueById(
		catalogId: string,
		attributeId: string,
		enumValueId: string,
		tx?: Prisma.TransactionClient
	): Promise<MappingApplyEnumValueRecord | null> {
		const db = tx || this.prisma
		const attribute = await this.findMoySkladVariantAttributeById(
			catalogId,
			attributeId,
			tx
		)
		if (!attribute) return null

		return db.attributeEnumValue.findFirst({
			where: {
				id: enumValueId,
				attributeId,
				catalogId,
				deleteAt: null
			},
			select: mappingApplyEnumValueSelect
		})
	}

	async upsertMoySkladImportedEnumValue(
		catalogId: string,
		attributeId: string,
		params: {
			value: string
			displayName: string
		},
		tx?: Prisma.TransactionClient
	): Promise<{
		enumValue: MappingApplyEnumValueRecord | null
		created: boolean
	}> {
		const db = tx || this.prisma
		const attribute = await this.findMoySkladVariantAttributeById(
			catalogId,
			attributeId,
			tx
		)
		if (!attribute) return { enumValue: null, created: false }

		const current = await db.attributeEnumValue.findFirst({
			where: {
				attributeId,
				catalogId,
				value: params.value
			},
			select: mappingApplyEnumValueSelect
		})
		if (current) {
			if (current.deleteAt || current.displayName !== params.displayName) {
				const enumValue = await db.attributeEnumValue.update({
					where: { id: current.id },
					data: {
						displayName: params.displayName,
						deleteAt: null
					},
					select: mappingApplyEnumValueSelect
				})
				return { enumValue, created: false }
			}

			return { enumValue: current, created: false }
		}

		const alias = await db.attributeEnumValueAlias.findFirst({
			where: {
				attributeId,
				catalogId,
				value: params.value
			},
			select: {
				enumValue: {
					select: mappingApplyEnumValueSelect
				}
			}
		})
		if (alias?.enumValue && !alias.enumValue.deleteAt) {
			return { enumValue: alias.enumValue, created: false }
		}

		const order = await db.attributeEnumValue.aggregate({
			where: { attributeId, catalogId },
			_max: { displayOrder: true }
		})
		const enumValue = await db.attributeEnumValue.create({
			data: {
				attributeId,
				catalogId,
				value: params.value,
				displayName: params.displayName,
				displayOrder: (order._max.displayOrder ?? 0) + 1,
				source: AttributeEnumValueSource.IMPORTED
			},
			select: mappingApplyEnumValueSelect
		})

		return { enumValue, created: true }
	}

	async upsertMoySkladEnumValueAlias(
		catalogId: string,
		attributeId: string,
		enumValueId: string,
		params: {
			value: string
			displayName: string
		},
		tx?: Prisma.TransactionClient
	): Promise<{
		enumValue: MappingApplyEnumValueRecord | null
		created: boolean
		conflict: boolean
	}> {
		const db = tx || this.prisma
		const enumValue = await this.findMoySkladEnumValueById(
			catalogId,
			attributeId,
			enumValueId,
			tx
		)
		if (!enumValue) {
			return { enumValue: null, created: false, conflict: false }
		}

		const exactValue = await db.attributeEnumValue.findFirst({
			where: {
				attributeId,
				catalogId,
				value: params.value
			},
			select: { id: true }
		})
		if (exactValue) {
			return {
				enumValue: exactValue.id === enumValueId ? enumValue : null,
				created: false,
				conflict: exactValue.id !== enumValueId
			}
		}

		const existingAlias = await db.attributeEnumValueAlias.findFirst({
			where: {
				attributeId,
				catalogId,
				value: params.value
			},
			select: {
				id: true,
				enumValueId: true,
				displayName: true,
				deleteAt: true
			}
		})
		if (existingAlias) {
			if (existingAlias.enumValueId !== enumValueId) {
				return { enumValue: null, created: false, conflict: true }
			}

			if (
				existingAlias.deleteAt ||
				existingAlias.displayName !== params.displayName
			) {
				await db.attributeEnumValueAlias.update({
					where: { id: existingAlias.id },
					data: {
						displayName: params.displayName,
						deleteAt: null
					}
				})
			}

			return { enumValue, created: false, conflict: false }
		}

		await db.attributeEnumValueAlias.create({
			data: {
				attributeId,
				catalogId,
				enumValueId,
				value: params.value,
				displayName: params.displayName
			}
		})

		return { enumValue, created: true, conflict: false }
	}

	async upsertMoySkladAttributeMappings(
		catalogId: string,
		integrationId: string,
		mappings: Array<{ normalizedName: string; attributeId: string }>
	): Promise<boolean> {
		if (!mappings.length) return true

		const existing = await this.prisma.integration.findFirst({
			where: {
				id: integrationId,
				catalogId,
				provider: IntegrationProvider.MOYSKLAD,
				deleteAt: null
			},
			select: { id: true, metadata: true }
		})
		if (!existing) return false

		const metadata = cloneJsonRecord(existing.metadata)
		const mapping = cloneJsonRecord(metadata.moySkladMapping)
		const attributes = readStringRecord(mapping.attributes)

		for (const item of mappings) {
			attributes[item.normalizedName] = item.attributeId
		}

		mapping.attributes = attributes
		mapping.updatedAt = new Date().toISOString()
		metadata.moySkladMapping = mapping

		await this.prisma.integration.update({
			where: { id: existing.id },
			data: { metadata: metadata as Prisma.InputJsonValue }
		})

		return true
	}

	async ensureMoySkladProductTypeForVariantAttributes(
		params: {
			catalogId: string
			productId: string
			attributes: IntegrationVariantAttributeDefinitionInput[]
		},
		tx?: Prisma.TransactionClient
	): Promise<{
		productTypeId: string | null
		created: boolean
		assigned: boolean
		changed: boolean
	}> {
		const attributes = this.normalizeMoySkladProductTypeAttributes(
			params.attributes
		)
		if (!attributes.length) {
			return {
				productTypeId: null,
				created: false,
				assigned: false,
				changed: false
			}
		}

		const run = async (db: Prisma.TransactionClient | PrismaService) => {
			const product = await db.product.findFirst({
				where: {
					id: params.productId,
					catalogId: params.catalogId,
					deleteAt: null
				},
				select: {
					id: true,
					productTypeId: true,
					productType: {
						select: {
							id: true,
							code: true,
							attributes: {
								select: {
									attributeId: true,
									isVariant: true
								}
							}
						}
					}
				}
			})
			if (!product) {
				return {
					productTypeId: null,
					created: false,
					assigned: false,
					changed: false
				}
			}

			const ensured = await this.upsertMoySkladAutoProductType(
				db,
				params.catalogId,
				attributes
			)
			const currentSupportsAttributes = this.productTypeSupportsVariantAttributes(
				product.productType?.attributes ?? [],
				attributes
			)
			const shouldAssign =
				product.productTypeId !== ensured.productTypeId &&
				(!product.productTypeId ||
					this.isMoySkladAutoProductTypeCode(product.productType?.code) ||
					!currentSupportsAttributes)

			if (shouldAssign) {
				await db.product.update({
					where: { id: params.productId },
					data: { productTypeId: ensured.productTypeId }
				})
			}

			return {
				productTypeId: ensured.productTypeId,
				created: ensured.created,
				assigned: shouldAssign,
				changed: ensured.created || ensured.attributesChanged || shouldAssign
			}
		}

		if (tx) return run(tx)
		return this.prisma.$transaction(run)
	}

	async upsertIntegratedProductVariant(
		params: {
			catalogId: string
			integrationId: string
			productId: string
			externalId: string
			externalCode?: string | null
			externalUpdatedAt?: Date | null
			rawMeta?: Prisma.InputJsonValue
			sku: string
			variantKey: string
			price: number
			stock: number
			status: ProductVariantStatus
			attributes: IntegrationVariantAttributeValueInput[]
		},
		tx?: Prisma.TransactionClient
	): Promise<{
		variant: ProductVariantSyncRecord
		link: IntegrationVariantLinkRecord
		created: boolean
		updated: boolean
	}> {
		const run = async (
			db: Prisma.TransactionClient | PrismaService
		): Promise<{
			variant: ProductVariantSyncRecord
			link: IntegrationVariantLinkRecord
			created: boolean
			updated: boolean
		}> => {
			const link = await db.integrationVariantLink.findUnique({
				where: {
					integrationId_externalId: {
						integrationId: params.integrationId,
						externalId: params.externalId
					}
				},
				select: variantLinkSelect
			})

			const linkedVariant = link
				? await db.productVariant.findUnique({
						where: { id: link.variantId },
						select: productVariantSyncSelect
					})
				: null
			const staleLinkedVariant =
				linkedVariant && linkedVariant.productId !== params.productId
					? linkedVariant
					: null
			let variant =
				linkedVariant && linkedVariant.productId === params.productId
					? linkedVariant
					: null
			let nextSku = params.sku
			let created = false
			let updated = Boolean(staleLinkedVariant)

			if (staleLinkedVariant) {
				await this.retireMovedIntegratedVariant(db, staleLinkedVariant)
			}

			if (!variant) {
				const skuOwner = await db.productVariant.findUnique({
					where: { sku: params.sku },
					select: productVariantSyncSelect
				})
				if (skuOwner && skuOwner.productId !== params.productId) {
					nextSku = await this.resolveAvailableVariantSku(db, params.sku)
				} else if (skuOwner) {
					variant = skuOwner
				}
			}

			if (!variant) {
				variant = await db.productVariant.create({
					data: {
						productId: params.productId,
						sku: nextSku,
						variantKey: params.variantKey,
						price: params.price,
						stock: params.stock,
						status: params.status,
						isAvailable: params.status === ProductVariantStatus.ACTIVE
					},
					select: productVariantSyncSelect
				})
				created = true
			} else {
				const nextStatus =
					variant.status === ProductVariantStatus.DISABLED
						? ProductVariantStatus.DISABLED
						: params.status
				const data: Prisma.ProductVariantUpdateInput = {}
				if (variant.sku !== params.sku) {
					const skuOwner = await db.productVariant.findUnique({
						where: { sku: params.sku },
						select: { id: true }
					})
					const resolvedSku =
						skuOwner && skuOwner.id !== variant.id
							? await this.resolveAvailableVariantSku(db, params.sku)
							: params.sku
					if (variant.sku !== resolvedSku) {
						data.sku = resolvedSku
					}
				}
				if (variant.variantKey !== params.variantKey) {
					data.variantKey = params.variantKey
				}
				if (Number(variant.price) !== params.price) {
					data.price = params.price
				}
				if (variant.stock !== params.stock) {
					data.stock = params.stock
				}
				if (variant.status !== nextStatus) {
					data.status = nextStatus
					data.isAvailable = nextStatus === ProductVariantStatus.ACTIVE
				}
				if (variant.deleteAt) {
					data.deleteAt = null
				}

				if (Object.keys(data).length > 0) {
					variant = await db.productVariant.update({
						where: { id: variant.id },
						data,
						select: productVariantSyncSelect
					})
					updated = true
				}
			}

			const attributesChanged = await this.syncIntegratedVariantAttributes(
				db,
				params.catalogId,
				variant.id,
				params.attributes
			)
			if (attributesChanged) {
				updated = true
			}

			const variantLink = await this.upsertVariantLink(
				{
					integrationId: params.integrationId,
					variantId: variant.id,
					externalId: params.externalId,
					externalCode: params.externalCode ?? null,
					externalUpdatedAt: params.externalUpdatedAt ?? null,
					rawMeta: params.rawMeta
				},
				db
			)

			const defaultVariantDisabled =
				await this.disableUnlinkedDefaultVariantForProduct(
					db,
					params.productId,
					variant.id
				)
			if (defaultVariantDisabled) {
				updated = true
			}

			if (!link) {
				updated = true
			}

			return {
				variant,
				link: variantLink,
				created,
				updated: created ? false : updated
			}
		}

		if (tx) return run(tx)
		return this.prisma.$transaction(run)
	}

	async updateLinkedProductStock(
		catalogId: string,
		productId: string,
		stock: number,
		tx?: Prisma.TransactionClient
	): Promise<boolean> {
		const db = tx || this.prisma
		const product = await db.product.findFirst({
			where: {
				id: productId,
				catalogId,
				deleteAt: null
			},
			select: {
				id: true,
				status: true
			}
		})
		if (!product) return false

		let changed = false
		const nextProductStatus = this.resolveStockProductStatus(
			product.status,
			stock
		)
		if (product.status !== nextProductStatus) {
			await db.product.update({
				where: { id: product.id },
				data: { status: nextProductStatus }
			})
			changed = true
		}

		const defaultVariantChanged = await this.updateDefaultVariantStock(
			db,
			product.id,
			stock
		)

		return changed || defaultVariantChanged
	}

	async updateLinkedVariantStock(
		variantId: string,
		stock: number,
		tx?: Prisma.TransactionClient
	): Promise<{ changed: boolean; productId: string | null }> {
		const db = tx || this.prisma
		const variant = await db.productVariant.findFirst({
			where: {
				id: variantId,
				deleteAt: null
			},
			select: productVariantSyncSelect
		})
		if (!variant) return { changed: false, productId: null }

		return {
			changed: await this.updateVariantStockRecord(db, variant, stock),
			productId: variant.productId
		}
	}

	async recomputeProductStatusFromVariants(
		catalogId: string,
		productId: string,
		tx?: Prisma.TransactionClient
	): Promise<boolean> {
		const db = tx || this.prisma
		const product = await db.product.findFirst({
			where: {
				id: productId,
				catalogId,
				deleteAt: null
			},
			select: {
				id: true,
				status: true
			}
		})
		if (!product) return false
		if (
			product.status === ProductStatus.DRAFT ||
			product.status === ProductStatus.DELETE
		) {
			return false
		}

		const activeVariants = await db.productVariant.count({
			where: {
				productId,
				deleteAt: null,
				status: ProductVariantStatus.ACTIVE,
				isAvailable: true
			}
		})
		const nextStatus =
			activeVariants > 0 ? ProductStatus.ACTIVE : ProductStatus.HIDDEN
		if (product.status === nextStatus) {
			return false
		}

		await db.product.update({
			where: { id: product.id },
			data: { status: nextStatus }
		})
		return true
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
	): Promise<CategorySyncRecord | null> {
		const db = tx || this.prisma
		return db.category.findFirst({
			where: {
				catalogId,
				name,
				deleteAt: null
			},
			orderBy: [{ createdAt: 'asc' }],
			select: categorySyncSelect
		})
	}

	findCategoriesByName(
		catalogId: string,
		name: string,
		tx?: Prisma.TransactionClient
	): Promise<CategorySyncRecord[]> {
		const db = tx || this.prisma
		return db.category.findMany({
			where: {
				catalogId,
				name,
				deleteAt: null
			},
			orderBy: [{ createdAt: 'asc' }],
			select: categorySyncSelect
		})
	}

	createCategory(
		catalogId: string,
		name: string,
		parentId?: string,
		tx?: Prisma.TransactionClient
	): Promise<CategorySyncRecord> {
		const db = tx || this.prisma
		return db.category.create({
			data: {
				catalog: { connect: { id: catalogId } },
				name,
				...(parentId ? { parent: { connect: { id: parentId } } } : {})
			},
			select: categorySyncSelect
		})
	}

	async updateCategory(
		params: {
			categoryId: string
			catalogId: string
			data: {
				name?: string
				parentId?: string | null
			}
		},
		tx?: Prisma.TransactionClient
	): Promise<CategorySyncRecord | null> {
		const db = tx || this.prisma
		const existing = await db.category.findFirst({
			where: {
				id: params.categoryId,
				catalogId: params.catalogId,
				deleteAt: null
			},
			select: { id: true }
		})
		if (!existing) return null

		await db.category.update({
			where: { id: params.categoryId },
			data: {
				...(params.data.name !== undefined ? { name: params.data.name } : {}),
				...(params.data.parentId !== undefined
					? params.data.parentId
						? { parent: { connect: { id: params.data.parentId } } }
						: { parent: { disconnect: true } }
					: {})
			}
		})

		return db.category.findFirst({
			where: {
				id: params.categoryId,
				catalogId: params.catalogId,
				deleteAt: null
			},
			select: categorySyncSelect
		})
	}

	findCategoryLinkByExternalId(
		integrationId: string,
		externalId: string,
		tx?: Prisma.TransactionClient
	): Promise<IntegrationCategoryLinkRecord | null> {
		const db = tx || this.prisma
		return db.integrationCategoryLink.findFirst({
			where: {
				integrationId,
				externalId,
				category: { deleteAt: null }
			},
			select: categoryLinkSelect
		})
	}

	findCategoryLinkByCategoryId(
		integrationId: string,
		categoryId: string,
		tx?: Prisma.TransactionClient
	): Promise<IntegrationCategoryLinkRecord | null> {
		const db = tx || this.prisma
		return db.integrationCategoryLink.findFirst({
			where: {
				integrationId,
				categoryId,
				category: { deleteAt: null }
			},
			select: categoryLinkSelect
		})
	}

	async upsertCategoryLink(
		params: {
			integrationId: string
			categoryId: string
			externalId: string
			externalParentId?: string | null
			rawMeta?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
		},
		tx?: Prisma.TransactionClient
	): Promise<IntegrationCategoryLinkRecord> {
		const db = tx || this.prisma

		const existingByExternalId = await db.integrationCategoryLink.findUnique({
			where: {
				integrationId_externalId: {
					integrationId: params.integrationId,
					externalId: params.externalId
				}
			},
			select: { id: true }
		})

		if (existingByExternalId) {
			return db.integrationCategoryLink.update({
				where: { id: existingByExternalId.id },
				data: {
					categoryId: params.categoryId,
					externalParentId: params.externalParentId ?? null,
					...(params.rawMeta !== undefined ? { rawMeta: params.rawMeta } : {})
				},
				select: categoryLinkSelect
			})
		}

		const existingByCategoryId = await db.integrationCategoryLink.findUnique({
			where: {
				integrationId_categoryId: {
					integrationId: params.integrationId,
					categoryId: params.categoryId
				}
			},
			select: { id: true }
		})

		if (existingByCategoryId) {
			return db.integrationCategoryLink.update({
				where: { id: existingByCategoryId.id },
				data: {
					externalId: params.externalId,
					externalParentId: params.externalParentId ?? null,
					...(params.rawMeta !== undefined ? { rawMeta: params.rawMeta } : {})
				},
				select: categoryLinkSelect
			})
		}

		return db.integrationCategoryLink.create({
			data: {
				integrationId: params.integrationId,
				categoryId: params.categoryId,
				externalId: params.externalId,
				externalParentId: params.externalParentId ?? null,
				...(params.rawMeta !== undefined ? { rawMeta: params.rawMeta } : {})
			},
			select: categoryLinkSelect
		})
	}

	async syncManagedProductCategories(
		productId: string,
		catalogId: string,
		integrationId: string,
		categoryIds: string[],
		tx?: Prisma.TransactionClient
	): Promise<{ added: number; removed: number }> {
		const uniqueCategoryIds = [...new Set(categoryIds)]
		const run = async (
			db: Prisma.TransactionClient | PrismaService
		): Promise<{ added: number; removed: number }> => {
			const existing = await db.categoryProduct.findMany({
				where: {
					productId,
					category: { catalogId, deleteAt: null }
				},
				select: {
					categoryId: true,
					position: true,
					category: {
						select: {
							integrationLinks: {
								where: { integrationId },
								select: { id: true }
							}
						}
					}
				}
			})

			const nextManagedCategoryIds = new Set(uniqueCategoryIds)
			const existingByCategoryId = new Map(
				existing.map(item => [item.categoryId, item] as const)
			)
			let removed = 0
			let added = 0

			for (const current of existing) {
				const isManagedByIntegration = current.category.integrationLinks.length > 0
				if (
					!isManagedByIntegration ||
					nextManagedCategoryIds.has(current.categoryId)
				) {
					continue
				}

				await db.categoryProduct.updateMany({
					where: {
						categoryId: current.categoryId,
						position: { gt: current.position }
					},
					data: { position: { decrement: 1 } }
				})
				await db.categoryProduct.delete({
					where: {
						categoryId_productId: {
							categoryId: current.categoryId,
							productId
						}
					}
				})
				removed += 1
			}

			for (const categoryId of uniqueCategoryIds) {
				if (existingByCategoryId.has(categoryId)) {
					continue
				}

				const maxPosition = await db.categoryProduct.aggregate({
					where: {
						categoryId,
						category: { catalogId, deleteAt: null }
					},
					_max: { position: true }
				})

				await db.categoryProduct.create({
					data: {
						categoryId,
						productId,
						position: (maxPosition._max.position ?? -1) + 1
					}
				})
				added += 1
			}

			return { added, removed }
		}

		if (tx) {
			return run(tx)
		}

		return this.prisma.$transaction(run)
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

	async ensureDefaultVariantForProduct(
		params: {
			integrationId: string
			productId: string
			sku: string
			price: number
			stock: number
			status: ProductVariantStatus
		},
		tx?: Prisma.TransactionClient
	): Promise<{
		variant: ProductVariantSyncRecord | null
		created: boolean
		updated: boolean
		skipped: boolean
	}> {
		const run = async (
			db: Prisma.TransactionClient | PrismaService
		): Promise<{
			variant: ProductVariantSyncRecord | null
			created: boolean
			updated: boolean
			skipped: boolean
		}> => {
			const importedVariantCount = await db.productVariant.count({
				where: {
					productId: params.productId,
					deleteAt: null,
					integrationLinks: { some: { integrationId: params.integrationId } }
				}
			})

			if (importedVariantCount > 0) {
				return { variant: null, created: false, updated: false, skipped: true }
			}

			let variant = await db.productVariant.findFirst({
				where: {
					productId: params.productId,
					variantKey: DEFAULT_VARIANT_KEY
				},
				orderBy: { createdAt: 'asc' },
				select: productVariantSyncSelect
			})

			if (!variant) {
				variant = await db.productVariant.create({
					data: {
						productId: params.productId,
						sku: await this.resolveDefaultVariantSku(db, params.sku),
						variantKey: DEFAULT_VARIANT_KEY,
						price: params.price,
						stock: params.stock,
						status: params.status,
						isAvailable: params.status === ProductVariantStatus.ACTIVE
					},
					select: productVariantSyncSelect
				})

				return { variant, created: true, updated: false, skipped: false }
			}

			const nextStatus =
				variant.status === ProductVariantStatus.DISABLED
					? ProductVariantStatus.DISABLED
					: params.status
			const nextIsAvailable = nextStatus === ProductVariantStatus.ACTIVE
			const data: Prisma.ProductVariantUpdateInput = {}

			if (Number(variant.price) !== params.price) {
				data.price = params.price
			}
			if (variant.stock !== params.stock) {
				data.stock = params.stock
			}
			if (variant.status !== nextStatus) {
				data.status = nextStatus
			}
			if (variant.isAvailable !== nextIsAvailable) {
				data.isAvailable = nextIsAvailable
			}
			if (variant.deleteAt) {
				data.deleteAt = null
			}

			if (Object.keys(data).length === 0) {
				return { variant, created: false, updated: false, skipped: false }
			}

			variant = await db.productVariant.update({
				where: { id: variant.id },
				data,
				select: productVariantSyncSelect
			})

			return { variant, created: false, updated: true, skipped: false }
		}

		if (tx) return run(tx)
		return this.prisma.$transaction(run)
	}

	private async syncIntegratedVariantAttributes(
		db: Prisma.TransactionClient | PrismaService,
		catalogId: string,
		variantId: string,
		attributes: IntegrationVariantAttributeValueInput[]
	): Promise<boolean> {
		const normalized = attributes
			.map(attribute => ({
				...attribute,
				value: this.normalizeIntegratedEnumValue(attribute.value),
				displayName: attribute.displayName?.trim() || attribute.value.trim()
			}))
			.filter(attribute => attribute.value)
		const uniqueByAttribute = new Map(
			normalized.map(attribute => [attribute.attributeId, attribute])
		)
		const nextAttributes = [...uniqueByAttribute.values()]
		const nextAttributeIds = nextAttributes.map(
			attribute => attribute.attributeId
		)
		const now = new Date()
		let changed = false

		const removed = await db.variantAttribute.updateMany({
			where: {
				variantId,
				attributeId: { notIn: nextAttributeIds },
				deleteAt: null
			},
			data: { deleteAt: now }
		})
		if (removed.count > 0) {
			changed = true
		}

		for (const attribute of nextAttributes) {
			const enumValueId = await this.resolveIntegratedEnumValueId(
				db,
				catalogId,
				attribute.attributeId,
				attribute.value,
				attribute.displayName
			)
			const current = await db.variantAttribute.findUnique({
				where: {
					variantId_attributeId: {
						variantId,
						attributeId: attribute.attributeId
					}
				},
				select: {
					id: true,
					enumValueId: true,
					deleteAt: true
				}
			})

			if (!current) {
				await db.variantAttribute.create({
					data: {
						variantId,
						attributeId: attribute.attributeId,
						enumValueId
					}
				})
				changed = true
				continue
			}

			if (current.enumValueId !== enumValueId || current.deleteAt) {
				await db.variantAttribute.update({
					where: { id: current.id },
					data: {
						enumValueId,
						deleteAt: null
					}
				})
				changed = true
			}
		}

		return changed
	}

	private normalizeMoySkladProductTypeAttributes(
		attributes: IntegrationVariantAttributeDefinitionInput[]
	): IntegrationVariantAttributeDefinitionInput[] {
		const byAttributeId = new Map<
			string,
			IntegrationVariantAttributeDefinitionInput
		>()

		for (const attribute of attributes) {
			const attributeId = attribute.attributeId.trim()
			if (!attributeId) continue

			byAttributeId.set(attributeId, {
				...attribute,
				attributeId,
				key: attribute.key.trim(),
				attributeDisplayName:
					attribute.attributeDisplayName?.trim() || attribute.key.trim(),
				displayOrder: attribute.displayOrder
			})
		}

		return [...byAttributeId.values()].sort(
			(left, right) =>
				left.displayOrder - right.displayOrder || left.key.localeCompare(right.key)
		)
	}

	private async upsertMoySkladAutoProductType(
		db: Prisma.TransactionClient | PrismaService,
		catalogId: string,
		attributes: IntegrationVariantAttributeDefinitionInput[]
	): Promise<{
		productTypeId: string
		created: boolean
		attributesChanged: boolean
	}> {
		const code = this.buildMoySkladProductTypeCode(attributes)
		const name = this.buildMoySkladProductTypeName(attributes)
		const existing = await db.productType.findFirst({
			where: {
				catalogId,
				scope: PRODUCT_TYPE_SCOPE_CATALOG,
				code,
				isArchived: false
			},
			select: {
				id: true,
				name: true,
				attributes: {
					select: {
						attributeId: true,
						isVariant: true,
						isRequired: true,
						displayOrder: true
					}
				}
			}
		})

		if (!existing) {
			const productType = await db.productType.create({
				data: {
					catalogId,
					scope: PRODUCT_TYPE_SCOPE_CATALOG,
					code,
					name,
					description: 'Автоматически создано интеграцией МойСклад',
					attributes: {
						create: attributes.map((attribute, index) => ({
							attribute: { connect: { id: attribute.attributeId } },
							isVariant: true,
							isRequired: true,
							displayOrder: index
						}))
					}
				},
				select: { id: true }
			})

			return {
				productTypeId: productType.id,
				created: true,
				attributesChanged: true
			}
		}

		let attributesChanged = false
		const currentByAttributeId = new Map(
			existing.attributes.map(attribute => [attribute.attributeId, attribute])
		)

		for (const [index, attribute] of attributes.entries()) {
			const current = currentByAttributeId.get(attribute.attributeId)
			if (
				current &&
				current.isVariant &&
				current.isRequired &&
				current.displayOrder === index
			) {
				continue
			}

			await db.productTypeAttribute.upsert({
				where: {
					productTypeId_attributeId: {
						productTypeId: existing.id,
						attributeId: attribute.attributeId
					}
				},
				create: {
					productTypeId: existing.id,
					attributeId: attribute.attributeId,
					isVariant: true,
					isRequired: true,
					displayOrder: index
				},
				update: {
					isVariant: true,
					isRequired: true,
					displayOrder: index
				}
			})
			attributesChanged = true
		}

		if (existing.name !== name) {
			await db.productType.update({
				where: { id: existing.id },
				data: { name }
			})
			attributesChanged = true
		}

		return {
			productTypeId: existing.id,
			created: false,
			attributesChanged
		}
	}

	private productTypeSupportsVariantAttributes(
		productTypeAttributes: Array<{ attributeId: string; isVariant: boolean }>,
		requiredAttributes: IntegrationVariantAttributeDefinitionInput[]
	): boolean {
		const variantAttributeIds = new Set(
			productTypeAttributes
				.filter(attribute => attribute.isVariant)
				.map(attribute => attribute.attributeId)
		)

		return requiredAttributes.every(attribute =>
			variantAttributeIds.has(attribute.attributeId)
		)
	}

	private isMoySkladAutoProductTypeCode(code?: string | null): boolean {
		return Boolean(code?.startsWith(MOYSKLAD_PRODUCT_TYPE_CODE_PREFIX))
	}

	private buildMoySkladProductTypeCode(
		attributes: IntegrationVariantAttributeDefinitionInput[]
	): string {
		const signature = attributes
			.map(attribute => attribute.attributeId)
			.sort((left, right) => left.localeCompare(right))
			.join('|')
		const hash = createHash('sha1').update(signature).digest('hex').slice(0, 10)
		const rawBase =
			attributes
				.map(attribute => attribute.key.replace(/^moysklad[_-]?/, ''))
				.join('-')
				.toLowerCase()
				.replace(/[^a-z0-9_-]+/g, '-')
				.replace(/-+/g, '-')
				.replace(/^[-_]+|[-_]+$/g, '') || 'variant'
		const suffix = `-${hash}`
		const maxBaseLength =
			PRODUCT_TYPE_CODE_MAX_LENGTH -
			MOYSKLAD_PRODUCT_TYPE_CODE_PREFIX.length -
			suffix.length
		const base = rawBase.slice(0, Math.max(1, maxBaseLength)).replace(/-+$/g, '')

		return `${MOYSKLAD_PRODUCT_TYPE_CODE_PREFIX}${base}${suffix}`
	}

	private buildMoySkladProductTypeName(
		attributes: IntegrationVariantAttributeDefinitionInput[]
	): string {
		const label = attributes
			.map(attribute => attribute.attributeDisplayName?.trim() || attribute.key)
			.join(' + ')
		return `МойСклад: ${label || 'Модификации'}`.slice(
			0,
			PRODUCT_TYPE_NAME_MAX_LENGTH
		)
	}

	private async updateDefaultVariantStock(
		db: Prisma.TransactionClient | PrismaService,
		productId: string,
		stock: number
	): Promise<boolean> {
		const variant = await db.productVariant.findFirst({
			where: {
				productId,
				variantKey: 'default',
				deleteAt: null
			},
			orderBy: { createdAt: 'asc' },
			select: productVariantSyncSelect
		})
		if (!variant) return false

		return this.updateVariantStockRecord(db, variant, stock)
	}

	private async resolveDefaultVariantSku(
		db: Prisma.TransactionClient | PrismaService,
		baseSku: string
	): Promise<string> {
		const normalizedBase = baseSku.trim()
		const base = normalizedBase || DEFAULT_VARIANT_SKU_SUFFIX
		const firstCandidate = this.truncateVariantSku(base)
		if (await this.isVariantSkuFree(db, firstCandidate)) {
			return firstCandidate
		}

		const defaultBase = `${base}-${DEFAULT_VARIANT_SKU_SUFFIX}`
		let suffix = 0
		while (suffix < 1000) {
			const candidate = this.applyVariantSkuSuffix(defaultBase, suffix)
			if (await this.isVariantSkuFree(db, candidate)) {
				return candidate
			}
			suffix += 1
		}

		throw new Error(`Could not allocate default variant SKU for ${baseSku}`)
	}

	private async resolveAvailableVariantSku(
		db: Prisma.TransactionClient | PrismaService,
		baseSku: string
	): Promise<string> {
		const normalizedBase = baseSku.trim() || DEFAULT_VARIANT_SKU_SUFFIX
		let suffix = 0

		while (suffix < 1000) {
			const candidate = this.applyVariantSkuSuffix(normalizedBase, suffix)
			if (await this.isVariantSkuFree(db, candidate)) {
				return candidate
			}
			suffix += 1
		}

		throw new Error(`Could not allocate variant SKU for ${baseSku}`)
	}

	private async retireMovedIntegratedVariant(
		db: Prisma.TransactionClient | PrismaService,
		variant: ProductVariantSyncRecord
	): Promise<void> {
		const retiredSku = await this.resolveMovedVariantSku(db, variant)
		const nextStatus =
			variant.status === ProductVariantStatus.DISABLED
				? ProductVariantStatus.DISABLED
				: ProductVariantStatus.OUT_OF_STOCK

		await db.productVariant.update({
			where: { id: variant.id },
			data: {
				sku: retiredSku,
				stock: 0,
				status: nextStatus,
				isAvailable: false
			}
		})
	}

	private async resolveMovedVariantSku(
		db: Prisma.TransactionClient | PrismaService,
		variant: ProductVariantSyncRecord
	): Promise<string> {
		const base = `${variant.sku}-${MOVED_VARIANT_SKU_SUFFIX}-${variant.id.slice(0, 8)}`
		let suffix = 0

		while (suffix < 1000) {
			const candidate = this.applyVariantSkuSuffix(base, suffix)
			if (await this.isVariantSkuFree(db, candidate)) {
				return candidate
			}
			suffix += 1
		}

		throw new Error(`Could not retire moved variant SKU for ${variant.sku}`)
	}

	private truncateVariantSku(value: string): string {
		return value.slice(0, VARIANT_SKU_MAX_LENGTH).replace(/-+$/g, '')
	}

	private applyVariantSkuSuffix(base: string, suffix: number): string {
		const suffixPart = suffix > 0 ? `-${suffix}` : ''
		const headLength = Math.max(0, VARIANT_SKU_MAX_LENGTH - suffixPart.length)
		const head = base.slice(0, headLength).replace(/-+$/g, '')
		return `${head}${suffixPart}`
	}

	private async isVariantSkuFree(
		db: Prisma.TransactionClient | PrismaService,
		sku: string
	): Promise<boolean> {
		const existing = await db.productVariant.findUnique({
			where: { sku },
			select: { id: true }
		})

		return !existing
	}

	private async updateVariantStockRecord(
		db: Prisma.TransactionClient | PrismaService,
		variant: ProductVariantSyncRecord,
		stock: number
	): Promise<boolean> {
		const nextStatus = this.resolveStockVariantStatus(variant.status, stock)
		const nextIsAvailable = nextStatus === ProductVariantStatus.ACTIVE
		const data: Prisma.ProductVariantUpdateInput = {}

		if (variant.stock !== stock) {
			data.stock = stock
		}
		if (variant.status !== nextStatus) {
			data.status = nextStatus
		}
		if (variant.isAvailable !== nextIsAvailable) {
			data.isAvailable = nextIsAvailable
		}

		if (Object.keys(data).length === 0) {
			return false
		}

		await db.productVariant.update({
			where: { id: variant.id },
			data
		})
		return true
	}

	private async disableUnlinkedDefaultVariantForProduct(
		db: Prisma.TransactionClient | PrismaService,
		productId: string,
		excludeVariantId: string
	): Promise<boolean> {
		const result = await db.productVariant.updateMany({
			where: {
				productId,
				variantKey: 'default',
				id: { not: excludeVariantId },
				deleteAt: null,
				status: { not: ProductVariantStatus.DISABLED },
				integrationLinks: { none: {} }
			},
			data: {
				stock: 0,
				status: ProductVariantStatus.OUT_OF_STOCK,
				isAvailable: false
			}
		})

		return result.count > 0
	}

	private resolveStockProductStatus(
		currentStatus: ProductStatus,
		stock: number
	): ProductStatus {
		if (
			currentStatus === ProductStatus.DRAFT ||
			currentStatus === ProductStatus.DELETE
		) {
			return currentStatus
		}

		return stock > 0 ? ProductStatus.ACTIVE : ProductStatus.HIDDEN
	}

	private resolveStockVariantStatus(
		currentStatus: ProductVariantStatus,
		stock: number
	): ProductVariantStatus {
		if (currentStatus === ProductVariantStatus.DISABLED) {
			return currentStatus
		}

		return stock > 0
			? ProductVariantStatus.ACTIVE
			: ProductVariantStatus.OUT_OF_STOCK
	}

	private async resolveIntegratedEnumValueId(
		db: Prisma.TransactionClient | PrismaService,
		catalogId: string,
		attributeId: string,
		value: string,
		displayName: string
	): Promise<string> {
		const current = await db.attributeEnumValue.findFirst({
			where: {
				attributeId,
				catalogId,
				value
			},
			select: {
				id: true,
				displayName: true,
				deleteAt: true
			}
		})
		if (current) {
			if (current.deleteAt || current.displayName !== displayName) {
				await db.attributeEnumValue.update({
					where: { id: current.id },
					data: {
						displayName,
						deleteAt: null
					}
				})
			}
			return current.id
		}

		const alias = await db.attributeEnumValueAlias.findFirst({
			where: {
				attributeId,
				catalogId,
				value
			},
			select: {
				enumValue: {
					select: {
						id: true,
						deleteAt: true
					}
				}
			}
		})
		if (alias?.enumValue && !alias.enumValue.deleteAt) {
			return alias.enumValue.id
		}

		const order = await db.attributeEnumValue.aggregate({
			where: { attributeId, catalogId },
			_max: { displayOrder: true }
		})
		const created = await db.attributeEnumValue.create({
			data: {
				attributeId,
				catalogId,
				value,
				displayName,
				displayOrder: (order._max.displayOrder ?? 0) + 1,
				source: AttributeEnumValueSource.IMPORTED
			},
			select: { id: true }
		})

		return created.id
	}

	private normalizeIntegratedEnumValue(value: string): string {
		return value.trim().toLowerCase()
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

	private buildOrderExportIdempotencyKey(
		integrationId: string,
		orderId: string
	): string {
		return `${IntegrationProvider.MOYSKLAD}:${integrationId}:${orderId}`
	}
}

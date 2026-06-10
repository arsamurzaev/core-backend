import type { Prisma } from '@generated/client'
import {
	type IntegrationExternalObjectKind,
	type IntegrationMappingDataType,
	IntegrationMappingDirection,
	IntegrationMappingLocalEntity,
	IntegrationProvider,
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	type IntegrationSyncRunTrigger,
	IntegrationSyncSnapshotCompleteness,
	IntegrationSyncStatus,
	ProductVariantKind
} from '@generated/enums'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

const DEFAULT_VARIANT_KEY = 'default'

const oneCIntegrationSelect = {
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
} as const satisfies Prisma.IntegrationSelect

const oneCExternalObjectSelect = {
	id: true,
	integrationId: true,
	code: true,
	name: true,
	kind: true,
	endpoint: true,
	method: true,
	schema: true,
	sample: true,
	isActive: true,
	lastDiscoveredAt: true,
	createdAt: true,
	updatedAt: true
} as const satisfies Prisma.IntegrationExternalObjectSelect

const oneCFieldMappingSelect = {
	id: true,
	entityMappingId: true,
	localPath: true,
	externalPath: true,
	direction: true,
	dataType: true,
	transform: true,
	defaultValue: true,
	isRequired: true,
	isActive: true,
	displayOrder: true,
	createdAt: true,
	updatedAt: true
} as const satisfies Prisma.IntegrationFieldMappingSelect

const oneCEntityMappingSelect = {
	id: true,
	integrationId: true,
	externalObjectId: true,
	localEntity: true,
	externalObjectCode: true,
	identityField: true,
	direction: true,
	conflictPolicy: true,
	filters: true,
	options: true,
	isActive: true,
	externalObject: {
		select: oneCExternalObjectSelect
	},
	fieldMappings: {
		select: oneCFieldMappingSelect,
		orderBy: [{ displayOrder: 'asc' as const }, { createdAt: 'asc' as const }]
	},
	createdAt: true,
	updatedAt: true
} as const satisfies Prisma.IntegrationEntityMappingSelect

const oneCSyncRunSelect = {
	id: true,
	catalogId: true,
	provider: true,
	mode: true,
	trigger: true,
	status: true,
	snapshotCompleteness: true,
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
} as const satisfies Prisma.IntegrationSyncRunSelect

const oneCProductPreviewSelect = {
	id: true,
	name: true,
	sku: true,
	slug: true,
	price: true,
	status: true,
	brandId: true,
	productTypeId: true,
	isPopular: true,
	position: true,
	deleteAt: true,
	updatedAt: true
} as const satisfies Prisma.ProductSelect

const oneCProductStockPreviewSelect = {
	...oneCProductPreviewSelect,
	variants: {
		where: { deleteAt: null },
		select: {
			id: true,
			sku: true,
			variantKey: true,
			kind: true,
			stock: true,
			price: true,
			status: true,
			isAvailable: true,
			deleteAt: true
		},
		orderBy: [{ kind: 'asc' as const }, { createdAt: 'asc' as const }],
		take: 1
	}
} as const satisfies Prisma.ProductSelect

const oneCProductLinkPreviewSelect = {
	id: true,
	integrationId: true,
	productId: true,
	externalId: true,
	externalCode: true,
	product: {
		select: oneCProductPreviewSelect
	}
} as const satisfies Prisma.IntegrationProductLinkSelect

const oneCProductStockLinkPreviewSelect = {
	id: true,
	integrationId: true,
	productId: true,
	externalId: true,
	externalCode: true,
	product: {
		select: oneCProductStockPreviewSelect
	}
} as const satisfies Prisma.IntegrationProductLinkSelect

const oneCVariantPreviewSelect = {
	id: true,
	productId: true,
	sku: true,
	variantKey: true,
	kind: true,
	stock: true,
	price: true,
	status: true,
	isAvailable: true,
	deleteAt: true,
	updatedAt: true,
	product: {
		select: oneCProductPreviewSelect
	}
} as const satisfies Prisma.ProductVariantSelect

const oneCVariantLinkPreviewSelect = {
	id: true,
	integrationId: true,
	variantId: true,
	externalId: true,
	externalCode: true,
	variant: {
		select: oneCVariantPreviewSelect
	}
} as const satisfies Prisma.IntegrationVariantLinkSelect

export type OneCIntegrationRecord = Prisma.IntegrationGetPayload<{
	select: typeof oneCIntegrationSelect
}>

export type OneCExternalObjectRecord =
	Prisma.IntegrationExternalObjectGetPayload<{
		select: typeof oneCExternalObjectSelect
	}>

export type OneCEntityMappingRecord =
	Prisma.IntegrationEntityMappingGetPayload<{
		select: typeof oneCEntityMappingSelect
	}>

export type OneCFieldMappingRecord = Prisma.IntegrationFieldMappingGetPayload<{
	select: typeof oneCFieldMappingSelect
}>

export type OneCSyncRunRecord = Prisma.IntegrationSyncRunGetPayload<{
	select: typeof oneCSyncRunSelect
}>

export type OneCProductPreviewRecord = Prisma.ProductGetPayload<{
	select: typeof oneCProductPreviewSelect
}>

export type OneCProductStockPreviewRecord = Prisma.ProductGetPayload<{
	select: typeof oneCProductStockPreviewSelect
}>

export type OneCProductLinkPreviewRecord =
	Prisma.IntegrationProductLinkGetPayload<{
		select: typeof oneCProductLinkPreviewSelect
	}>

export type OneCProductStockLinkPreviewRecord =
	Prisma.IntegrationProductLinkGetPayload<{
		select: typeof oneCProductStockLinkPreviewSelect
	}>

export type OneCVariantPreviewRecord = Prisma.ProductVariantGetPayload<{
	select: typeof oneCVariantPreviewSelect
}>

export type OneCValueUpdateResult = {
	changed: boolean
	productId: string | null
	variantId: string | null
	previousValue: number | null
	nextValue: number | null
}

export type OneCVariantLinkPreviewRecord =
	Prisma.IntegrationVariantLinkGetPayload<{
		select: typeof oneCVariantLinkPreviewSelect
	}>

@Injectable()
export class OneCIntegrationRepository {
	constructor(private readonly prisma: PrismaService) {}

	transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
		return this.prisma.$transaction(fn)
	}

	findIntegration(catalogId: string): Promise<OneCIntegrationRecord | null> {
		return this.prisma.integration.findFirst({
			where: {
				catalogId,
				provider: IntegrationProvider.ONE_C,
				deleteAt: null
			},
			select: oneCIntegrationSelect
		})
	}

	findAllIntegrations(): Promise<OneCIntegrationRecord[]> {
		return this.prisma.integration.findMany({
			where: {
				provider: IntegrationProvider.ONE_C,
				deleteAt: null
			},
			select: oneCIntegrationSelect
		})
	}

	upsertIntegration(
		catalogId: string,
		params: { metadata: Prisma.InputJsonValue; isActive: boolean }
	): Promise<OneCIntegrationRecord> {
		return this.prisma.integration.upsert({
			where: {
				catalogId_provider: {
					catalogId,
					provider: IntegrationProvider.ONE_C
				}
			},
			create: {
				catalogId,
				provider: IntegrationProvider.ONE_C,
				metadata: params.metadata,
				isActive: params.isActive
			},
			update: {
				metadata: params.metadata,
				isActive: params.isActive,
				deleteAt: null
			},
			select: oneCIntegrationSelect
		})
	}

	updateIntegration(
		catalogId: string,
		params: { metadata: Prisma.InputJsonValue; isActive?: boolean }
	): Promise<OneCIntegrationRecord | null> {
		return this.prisma.integration
			.updateManyAndReturn({
				where: {
					catalogId,
					provider: IntegrationProvider.ONE_C,
					deleteAt: null
				},
				data: {
					metadata: params.metadata,
					...(params.isActive === undefined ? {} : { isActive: params.isActive })
				},
				select: oneCIntegrationSelect
			})
			.then(items => items[0] ?? null)
	}

	softDeleteIntegration(
		catalogId: string
	): Promise<OneCIntegrationRecord | null> {
		return this.prisma.integration
			.updateManyAndReturn({
				where: {
					catalogId,
					provider: IntegrationProvider.ONE_C,
					deleteAt: null
				},
				data: {
					deleteAt: new Date(),
					isActive: false
				},
				select: oneCIntegrationSelect
			})
			.then(items => items[0] ?? null)
	}

	async beginSync(
		catalogId: string,
		staleBefore: Date
	): Promise<OneCIntegrationRecord | null> {
		const updated = await this.prisma.integration.updateMany({
			where: {
				catalogId,
				provider: IntegrationProvider.ONE_C,
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
		return this.findIntegration(catalogId)
	}

	async finishSync(params: {
		catalogId: string
		status: IntegrationSyncStatus
		error?: string | null
		totalProducts: number
		createdProducts: number
		updatedProducts: number
		deletedProducts: number
		syncedAt: Date
	}): Promise<OneCIntegrationRecord | null> {
		const updated = await this.prisma.integration.updateMany({
			where: {
				catalogId: params.catalogId,
				provider: IntegrationProvider.ONE_C,
				deleteAt: null
			},
			data: {
				syncStartedAt: null,
				lastSyncAt: params.syncedAt,
				lastSyncStatus: params.status,
				lastSyncError: params.error ?? null,
				totalProducts: params.totalProducts,
				createdProducts: params.createdProducts,
				updatedProducts: params.updatedProducts,
				deletedProducts: params.deletedProducts
			}
		})

		if (!updated.count) return null
		return this.findIntegration(params.catalogId)
	}

	async failSync(
		catalogId: string,
		error: string
	): Promise<OneCIntegrationRecord | null> {
		const updated = await this.prisma.integration.updateMany({
			where: {
				catalogId,
				provider: IntegrationProvider.ONE_C,
				deleteAt: null
			},
			data: {
				syncStartedAt: null,
				lastSyncAt: new Date(),
				lastSyncStatus: IntegrationSyncStatus.ERROR,
				lastSyncError: error
			}
		})

		if (!updated.count) return null
		return this.findIntegration(catalogId)
	}

	findLatestActiveSyncRun(catalogId: string): Promise<OneCSyncRunRecord | null> {
		return this.prisma.integrationSyncRun.findFirst({
			where: {
				catalogId,
				provider: IntegrationProvider.ONE_C,
				status: {
					in: [IntegrationSyncRunStatus.PENDING, IntegrationSyncRunStatus.RUNNING]
				}
			},
			orderBy: { requestedAt: 'desc' },
			select: oneCSyncRunSelect
		})
	}

	findSyncRunForCatalog(
		catalogId: string,
		runId: string
	): Promise<OneCSyncRunRecord | null> {
		return this.prisma.integrationSyncRun.findFirst({
			where: {
				id: runId,
				catalogId,
				provider: IntegrationProvider.ONE_C
			},
			select: oneCSyncRunSelect
		})
	}

	findRecentSyncRuns(
		catalogId: string,
		take: number
	): Promise<OneCSyncRunRecord[]> {
		return this.prisma.integrationSyncRun.findMany({
			where: {
				catalogId,
				provider: IntegrationProvider.ONE_C
			},
			orderBy: [{ requestedAt: 'desc' }, { createdAt: 'desc' }],
			take,
			select: oneCSyncRunSelect
		})
	}

	createSyncRun(params: {
		integrationId: string
		catalogId: string
		mode: IntegrationSyncRunMode
		trigger: IntegrationSyncRunTrigger
		status?: IntegrationSyncRunStatus
		snapshotCompleteness?: IntegrationSyncSnapshotCompleteness
		jobId?: string | null
		metadata?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
		startedAt?: Date | null
	}): Promise<OneCSyncRunRecord> {
		return this.prisma.integrationSyncRun.create({
			data: {
				integrationId: params.integrationId,
				catalogId: params.catalogId,
				provider: IntegrationProvider.ONE_C,
				mode: params.mode,
				trigger: params.trigger,
				status: params.status ?? IntegrationSyncRunStatus.PENDING,
				snapshotCompleteness:
					params.snapshotCompleteness ?? IntegrationSyncSnapshotCompleteness.PARTIAL,
				jobId: params.jobId ?? null,
				...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
				startedAt: params.startedAt ?? null
			},
			select: oneCSyncRunSelect
		})
	}

	async attachSyncRunJobId(
		runId: string,
		jobId: string
	): Promise<OneCSyncRunRecord | null> {
		const updated = await this.prisma.integrationSyncRun.updateMany({
			where: { id: runId, provider: IntegrationProvider.ONE_C },
			data: { jobId }
		})

		if (!updated.count) return null
		return this.prisma.integrationSyncRun.findUnique({
			where: { id: runId },
			select: oneCSyncRunSelect
		})
	}

	async markSyncRunRunning(params: {
		runId: string
		jobId?: string | null
		startedAt?: Date
		metadata?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
	}): Promise<OneCSyncRunRecord | null> {
		const updated = await this.prisma.integrationSyncRun.updateMany({
			where: { id: params.runId, provider: IntegrationProvider.ONE_C },
			data: {
				status: IntegrationSyncRunStatus.RUNNING,
				startedAt: params.startedAt ?? new Date(),
				...(params.jobId ? { jobId: params.jobId } : {}),
				...(params.metadata !== undefined ? { metadata: params.metadata } : {})
			}
		})

		if (!updated.count) return null
		return this.prisma.integrationSyncRun.findUnique({
			where: { id: params.runId },
			select: oneCSyncRunSelect
		})
	}

	async finishSyncRun(params: {
		runId: string
		status: IntegrationSyncRunStatus
		snapshotCompleteness: IntegrationSyncSnapshotCompleteness
		error?: string | null
		totalProducts: number
		createdProducts: number
		updatedProducts: number
		deletedProducts: number
		imagesImported?: number
		durationMs: number
		metadata?: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput
		finishedAt?: Date
	}): Promise<OneCSyncRunRecord | null> {
		const updated = await this.prisma.integrationSyncRun.updateMany({
			where: { id: params.runId },
			data: {
				status: params.status,
				snapshotCompleteness: params.snapshotCompleteness,
				error: params.error ?? null,
				totalProducts: params.totalProducts,
				createdProducts: params.createdProducts,
				updatedProducts: params.updatedProducts,
				deletedProducts: params.deletedProducts,
				imagesImported: params.imagesImported ?? 0,
				durationMs: params.durationMs,
				...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
				finishedAt: params.finishedAt ?? new Date()
			}
		})

		if (!updated.count) return null
		return this.prisma.integrationSyncRun.findUnique({
			where: { id: params.runId },
			select: oneCSyncRunSelect
		})
	}

	findLatestFinishedSyncRun(
		catalogId: string
	): Promise<OneCSyncRunRecord | null> {
		return this.prisma.integrationSyncRun.findFirst({
			where: {
				catalogId,
				provider: IntegrationProvider.ONE_C,
				status: {
					in: [
						IntegrationSyncRunStatus.SUCCESS,
						IntegrationSyncRunStatus.ERROR,
						IntegrationSyncRunStatus.SKIPPED
					]
				}
			},
			orderBy: { requestedAt: 'desc' },
			select: oneCSyncRunSelect
		})
	}

	listExternalObjects(
		integrationId: string
	): Promise<OneCExternalObjectRecord[]> {
		return this.prisma.integrationExternalObject.findMany({
			where: { integrationId },
			orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
			select: oneCExternalObjectSelect
		})
	}

	findExternalObjectForCatalog(
		catalogId: string,
		id: string
	): Promise<OneCExternalObjectRecord | null> {
		return this.prisma.integrationExternalObject.findFirst({
			where: {
				id,
				integration: {
					catalogId,
					provider: IntegrationProvider.ONE_C,
					deleteAt: null
				}
			},
			select: oneCExternalObjectSelect
		})
	}

	upsertExternalObject(params: {
		integrationId: string
		code: string
		name: string
		kind: IntegrationExternalObjectKind
		endpoint?: string | null
		method?: string | null
		schema?: Prisma.InputJsonValue
		sample?: Prisma.InputJsonValue
		isActive?: boolean
		lastDiscoveredAt?: Date | null
	}): Promise<OneCExternalObjectRecord> {
		return this.prisma.integrationExternalObject.upsert({
			where: {
				integrationId_code: {
					integrationId: params.integrationId,
					code: params.code
				}
			},
			create: {
				integrationId: params.integrationId,
				code: params.code,
				name: params.name,
				kind: params.kind,
				endpoint: params.endpoint ?? null,
				method: params.method ?? null,
				...(params.schema === undefined ? {} : { schema: params.schema }),
				...(params.sample === undefined ? {} : { sample: params.sample }),
				isActive: params.isActive ?? true,
				lastDiscoveredAt: params.lastDiscoveredAt ?? null
			},
			update: {
				name: params.name,
				kind: params.kind,
				endpoint: params.endpoint ?? null,
				method: params.method ?? null,
				...(params.schema === undefined ? {} : { schema: params.schema }),
				...(params.sample === undefined ? {} : { sample: params.sample }),
				isActive: params.isActive ?? true,
				lastDiscoveredAt: params.lastDiscoveredAt ?? null
			},
			select: oneCExternalObjectSelect
		})
	}

	updateExternalObject(
		id: string,
		params: {
			code?: string
			name?: string
			kind?: IntegrationExternalObjectKind
			endpoint?: string | null
			method?: string | null
			schema?: Prisma.InputJsonValue
			sample?: Prisma.InputJsonValue
			isActive?: boolean
		}
	): Promise<OneCExternalObjectRecord> {
		return this.prisma.integrationExternalObject.update({
			where: { id },
			data: {
				...(params.code === undefined ? {} : { code: params.code }),
				...(params.name === undefined ? {} : { name: params.name }),
				...(params.kind === undefined ? {} : { kind: params.kind }),
				...(params.endpoint === undefined ? {} : { endpoint: params.endpoint }),
				...(params.method === undefined ? {} : { method: params.method }),
				...(params.schema === undefined ? {} : { schema: params.schema }),
				...(params.sample === undefined ? {} : { sample: params.sample }),
				...(params.isActive === undefined ? {} : { isActive: params.isActive })
			},
			select: oneCExternalObjectSelect
		})
	}

	deleteExternalObject(id: string): Promise<OneCExternalObjectRecord> {
		return this.prisma.integrationExternalObject.delete({
			where: { id },
			select: oneCExternalObjectSelect
		})
	}

	listEntityMappings(integrationId: string): Promise<OneCEntityMappingRecord[]> {
		return this.prisma.integrationEntityMapping.findMany({
			where: { integrationId },
			orderBy: [{ localEntity: 'asc' }, { createdAt: 'asc' }],
			select: oneCEntityMappingSelect
		})
	}

	findRecommendedProductEntityMapping(
		catalogId: string
	): Promise<OneCEntityMappingRecord | null> {
		return this.prisma.integrationEntityMapping.findFirst({
			where: {
				localEntity: IntegrationMappingLocalEntity.PRODUCT,
				isActive: true,
				direction: { not: IntegrationMappingDirection.EXPORT },
				integration: {
					catalogId,
					provider: IntegrationProvider.ONE_C,
					deleteAt: null
				}
			},
			orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
			select: oneCEntityMappingSelect
		})
	}

	findRecommendedVariantEntityMapping(
		catalogId: string
	): Promise<OneCEntityMappingRecord | null> {
		return this.prisma.integrationEntityMapping.findFirst({
			where: {
				localEntity: IntegrationMappingLocalEntity.PRODUCT_VARIANT,
				isActive: true,
				direction: { not: IntegrationMappingDirection.EXPORT },
				integration: {
					catalogId,
					provider: IntegrationProvider.ONE_C,
					deleteAt: null
				}
			},
			orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
			select: oneCEntityMappingSelect
		})
	}

	findRecommendedStockEntityMapping(
		catalogId: string
	): Promise<OneCEntityMappingRecord | null> {
		return this.prisma.integrationEntityMapping.findFirst({
			where: {
				localEntity: IntegrationMappingLocalEntity.STOCK,
				isActive: true,
				direction: { not: IntegrationMappingDirection.EXPORT },
				integration: {
					catalogId,
					provider: IntegrationProvider.ONE_C,
					deleteAt: null
				}
			},
			orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
			select: oneCEntityMappingSelect
		})
	}

	findRecommendedPriceEntityMapping(
		catalogId: string
	): Promise<OneCEntityMappingRecord | null> {
		return this.prisma.integrationEntityMapping.findFirst({
			where: {
				localEntity: IntegrationMappingLocalEntity.PRICE,
				isActive: true,
				direction: { not: IntegrationMappingDirection.EXPORT },
				integration: {
					catalogId,
					provider: IntegrationProvider.ONE_C,
					deleteAt: null
				}
			},
			orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
			select: oneCEntityMappingSelect
		})
	}

	findEntityMappingForCatalog(
		catalogId: string,
		id: string
	): Promise<OneCEntityMappingRecord | null> {
		return this.prisma.integrationEntityMapping.findFirst({
			where: {
				id,
				integration: {
					catalogId,
					provider: IntegrationProvider.ONE_C,
					deleteAt: null
				}
			},
			select: oneCEntityMappingSelect
		})
	}

	createEntityMapping(params: {
		integrationId: string
		externalObjectId?: string | null
		localEntity: IntegrationMappingLocalEntity
		externalObjectCode: string
		identityField: string
		direction: IntegrationMappingDirection
		conflictPolicy?: string | null
		filters?: Prisma.InputJsonValue
		options?: Prisma.InputJsonValue
		isActive?: boolean
	}): Promise<OneCEntityMappingRecord> {
		return this.prisma.integrationEntityMapping.create({
			data: {
				integrationId: params.integrationId,
				externalObjectId: params.externalObjectId ?? null,
				localEntity: params.localEntity,
				externalObjectCode: params.externalObjectCode,
				identityField: params.identityField,
				direction: params.direction,
				conflictPolicy: params.conflictPolicy ?? null,
				...(params.filters === undefined ? {} : { filters: params.filters }),
				...(params.options === undefined ? {} : { options: params.options }),
				isActive: params.isActive ?? true
			},
			select: oneCEntityMappingSelect
		})
	}

	updateEntityMapping(
		id: string,
		params: {
			externalObjectId?: string | null
			localEntity?: IntegrationMappingLocalEntity
			externalObjectCode?: string
			identityField?: string
			direction?: IntegrationMappingDirection
			conflictPolicy?: string | null
			filters?: Prisma.InputJsonValue
			options?: Prisma.InputJsonValue
			isActive?: boolean
		}
	): Promise<OneCEntityMappingRecord> {
		return this.prisma.integrationEntityMapping.update({
			where: { id },
			data: {
				...(params.externalObjectId === undefined
					? {}
					: { externalObjectId: params.externalObjectId }),
				...(params.localEntity === undefined
					? {}
					: { localEntity: params.localEntity }),
				...(params.externalObjectCode === undefined
					? {}
					: { externalObjectCode: params.externalObjectCode }),
				...(params.identityField === undefined
					? {}
					: { identityField: params.identityField }),
				...(params.direction === undefined ? {} : { direction: params.direction }),
				...(params.conflictPolicy === undefined
					? {}
					: { conflictPolicy: params.conflictPolicy }),
				...(params.filters === undefined ? {} : { filters: params.filters }),
				...(params.options === undefined ? {} : { options: params.options }),
				...(params.isActive === undefined ? {} : { isActive: params.isActive })
			},
			select: oneCEntityMappingSelect
		})
	}

	deleteEntityMapping(id: string): Promise<OneCEntityMappingRecord> {
		return this.prisma.integrationEntityMapping.delete({
			where: { id },
			select: oneCEntityMappingSelect
		})
	}

	createFieldMapping(params: {
		entityMappingId: string
		localPath: string
		externalPath: string
		direction: IntegrationMappingDirection
		dataType: IntegrationMappingDataType
		transform?: Prisma.InputJsonValue
		defaultValue?: Prisma.InputJsonValue
		isRequired?: boolean
		isActive?: boolean
		displayOrder?: number
	}): Promise<OneCFieldMappingRecord> {
		return this.prisma.integrationFieldMapping.create({
			data: {
				entityMappingId: params.entityMappingId,
				localPath: params.localPath,
				externalPath: params.externalPath,
				direction: params.direction,
				dataType: params.dataType,
				...(params.transform === undefined ? {} : { transform: params.transform }),
				...(params.defaultValue === undefined
					? {}
					: { defaultValue: params.defaultValue }),
				isRequired: params.isRequired ?? false,
				isActive: params.isActive ?? true,
				displayOrder: params.displayOrder ?? 0
			},
			select: oneCFieldMappingSelect
		})
	}

	findFieldMappingForCatalog(
		catalogId: string,
		id: string
	): Promise<OneCFieldMappingRecord | null> {
		return this.prisma.integrationFieldMapping.findFirst({
			where: {
				id,
				entityMapping: {
					integration: {
						catalogId,
						provider: IntegrationProvider.ONE_C,
						deleteAt: null
					}
				}
			},
			select: oneCFieldMappingSelect
		})
	}

	updateFieldMapping(
		id: string,
		params: {
			localPath?: string
			externalPath?: string
			direction?: IntegrationMappingDirection
			dataType?: IntegrationMappingDataType
			transform?: Prisma.InputJsonValue
			defaultValue?: Prisma.InputJsonValue
			isRequired?: boolean
			isActive?: boolean
			displayOrder?: number
		}
	): Promise<OneCFieldMappingRecord> {
		return this.prisma.integrationFieldMapping.update({
			where: { id },
			data: {
				...(params.localPath === undefined ? {} : { localPath: params.localPath }),
				...(params.externalPath === undefined
					? {}
					: { externalPath: params.externalPath }),
				...(params.direction === undefined ? {} : { direction: params.direction }),
				...(params.dataType === undefined ? {} : { dataType: params.dataType }),
				...(params.transform === undefined ? {} : { transform: params.transform }),
				...(params.defaultValue === undefined
					? {}
					: { defaultValue: params.defaultValue }),
				...(params.isRequired === undefined
					? {}
					: { isRequired: params.isRequired }),
				...(params.isActive === undefined ? {} : { isActive: params.isActive }),
				...(params.displayOrder === undefined
					? {}
					: { displayOrder: params.displayOrder })
			},
			select: oneCFieldMappingSelect
		})
	}

	deleteFieldMapping(id: string): Promise<OneCFieldMappingRecord> {
		return this.prisma.integrationFieldMapping.delete({
			where: { id },
			select: oneCFieldMappingSelect
		})
	}

	async upsertProductLink(
		params: {
			integrationId: string
			productId: string
			externalId: string
			externalCode?: string | null
			rawMeta?: Prisma.InputJsonValue
		},
		tx?: Prisma.TransactionClient
	): Promise<OneCProductLinkPreviewRecord> {
		const db = tx ?? this.prisma
		const now = new Date()
		const data = {
			productId: params.productId,
			externalCode: params.externalCode ?? null,
			lastSyncedAt: now,
			lastSeenAt: now,
			missingSince: null,
			missingSyncCount: 0,
			skippedReason: null,
			lastExternalError: null,
			rawMeta: params.rawMeta
		}
		const existingByExternalId = await db.integrationProductLink.findUnique({
			where: {
				integrationId_externalId: {
					integrationId: params.integrationId,
					externalId: params.externalId
				}
			},
			select: oneCProductLinkPreviewSelect
		})
		if (existingByExternalId) {
			return db.integrationProductLink.update({
				where: { id: existingByExternalId.id },
				data,
				select: oneCProductLinkPreviewSelect
			})
		}

		const existingByProductId = await db.integrationProductLink.findUnique({
			where: {
				integrationId_productId: {
					integrationId: params.integrationId,
					productId: params.productId
				}
			},
			select: oneCProductLinkPreviewSelect
		})
		if (existingByProductId) {
			return db.integrationProductLink.update({
				where: { id: existingByProductId.id },
				data: {
					...data,
					externalId: params.externalId
				},
				select: oneCProductLinkPreviewSelect
			})
		}

		return db.integrationProductLink.create({
			data: {
				integrationId: params.integrationId,
				productId: params.productId,
				externalId: params.externalId,
				externalCode: params.externalCode ?? null,
				lastSyncedAt: now,
				lastSeenAt: now,
				missingSince: null,
				missingSyncCount: 0,
				skippedReason: null,
				lastExternalError: null,
				rawMeta: params.rawMeta
			},
			select: oneCProductLinkPreviewSelect
		})
	}

	findProductLinksByExternalIds(params: {
		integrationId: string
		externalIds: string[]
	}): Promise<OneCProductLinkPreviewRecord[]> {
		const externalIds = [
			...new Set(params.externalIds.map(normalizeString).filter(Boolean))
		]
		if (!externalIds.length)
			return Promise.resolve<OneCProductLinkPreviewRecord[]>([])

		return this.prisma.integrationProductLink.findMany({
			where: {
				integrationId: params.integrationId,
				externalId: { in: externalIds }
			},
			select: oneCProductLinkPreviewSelect
		})
	}

	findProductStockLinksByExternalIds(params: {
		integrationId: string
		externalIds: string[]
	}): Promise<OneCProductStockLinkPreviewRecord[]> {
		const externalIds = [
			...new Set(params.externalIds.map(normalizeString).filter(Boolean))
		]
		if (!externalIds.length)
			return Promise.resolve<OneCProductStockLinkPreviewRecord[]>([])

		return this.prisma.integrationProductLink.findMany({
			where: {
				integrationId: params.integrationId,
				externalId: { in: externalIds }
			},
			select: oneCProductStockLinkPreviewSelect
		})
	}

	findVariantLinksByExternalIds(params: {
		integrationId: string
		externalIds: string[]
	}): Promise<OneCVariantLinkPreviewRecord[]> {
		const externalIds = [
			...new Set(params.externalIds.map(normalizeString).filter(Boolean))
		]
		if (!externalIds.length)
			return Promise.resolve<OneCVariantLinkPreviewRecord[]>([])

		return this.prisma.integrationVariantLink.findMany({
			where: {
				integrationId: params.integrationId,
				externalId: { in: externalIds }
			},
			select: oneCVariantLinkPreviewSelect
		})
	}

	findProductsByIds(params: {
		catalogId: string
		productIds: string[]
	}): Promise<OneCProductPreviewRecord[]> {
		const productIds = [
			...new Set(params.productIds.map(normalizeString).filter(Boolean))
		]
		if (!productIds.length) return Promise.resolve<OneCProductPreviewRecord[]>([])

		return this.prisma.product.findMany({
			where: {
				catalogId: params.catalogId,
				id: { in: productIds },
				deleteAt: null
			},
			select: oneCProductPreviewSelect
		})
	}

	findStockProductsByIds(params: {
		catalogId: string
		productIds: string[]
	}): Promise<OneCProductStockPreviewRecord[]> {
		const productIds = [
			...new Set(params.productIds.map(normalizeString).filter(Boolean))
		]
		if (!productIds.length)
			return Promise.resolve<OneCProductStockPreviewRecord[]>([])

		return this.prisma.product.findMany({
			where: {
				catalogId: params.catalogId,
				id: { in: productIds },
				deleteAt: null
			},
			select: oneCProductStockPreviewSelect
		})
	}

	findProductsBySkus(params: {
		catalogId: string
		skus: string[]
	}): Promise<OneCProductPreviewRecord[]> {
		const skus = [...new Set(params.skus.map(normalizeString).filter(Boolean))]
		if (!skus.length) return Promise.resolve<OneCProductPreviewRecord[]>([])

		return this.prisma.product.findMany({
			where: {
				catalogId: params.catalogId,
				sku: { in: skus },
				deleteAt: null
			},
			select: oneCProductPreviewSelect
		})
	}

	findStockProductsBySkus(params: {
		catalogId: string
		skus: string[]
	}): Promise<OneCProductStockPreviewRecord[]> {
		const skus = [...new Set(params.skus.map(normalizeString).filter(Boolean))]
		if (!skus.length) return Promise.resolve<OneCProductStockPreviewRecord[]>([])

		return this.prisma.product.findMany({
			where: {
				catalogId: params.catalogId,
				sku: { in: skus },
				deleteAt: null
			},
			select: oneCProductStockPreviewSelect
		})
	}

	findVariantsByIds(params: {
		catalogId: string
		variantIds: string[]
	}): Promise<OneCVariantPreviewRecord[]> {
		const variantIds = [
			...new Set(params.variantIds.map(normalizeString).filter(Boolean))
		]
		if (!variantIds.length) return Promise.resolve<OneCVariantPreviewRecord[]>([])

		return this.prisma.productVariant.findMany({
			where: {
				id: { in: variantIds },
				deleteAt: null,
				product: {
					catalogId: params.catalogId,
					deleteAt: null
				}
			},
			select: oneCVariantPreviewSelect
		})
	}

	findVariantsBySkus(params: {
		catalogId: string
		skus: string[]
	}): Promise<OneCVariantPreviewRecord[]> {
		const skus = [...new Set(params.skus.map(normalizeString).filter(Boolean))]
		if (!skus.length) return Promise.resolve<OneCVariantPreviewRecord[]>([])

		return this.prisma.productVariant.findMany({
			where: {
				sku: { in: skus },
				deleteAt: null,
				product: {
					catalogId: params.catalogId,
					deleteAt: null
				}
			},
			select: oneCVariantPreviewSelect
		})
	}

	findVariantsByProductVariantKeys(params: {
		catalogId: string
		pairs: Array<{ productId: string; variantKey: string }>
	}): Promise<OneCVariantPreviewRecord[]> {
		const pairs = [
			...new Map(
				params.pairs
					.map(pair => ({
						productId: normalizeString(pair.productId),
						variantKey: normalizeString(pair.variantKey)
					}))
					.filter(pair => pair.productId && pair.variantKey)
					.map(pair => [`${pair.productId}:${pair.variantKey}`, pair])
			).values()
		]
		if (!pairs.length) return Promise.resolve<OneCVariantPreviewRecord[]>([])

		return this.prisma.productVariant.findMany({
			where: {
				deleteAt: null,
				product: {
					catalogId: params.catalogId,
					deleteAt: null
				},
				OR: pairs.map(pair => ({
					productId: pair.productId,
					variantKey: pair.variantKey
				}))
			},
			select: oneCVariantPreviewSelect
		})
	}

	async touchProductLinkPriceSynced(
		integrationId: string,
		productId: string,
		at: Date = new Date()
	): Promise<number> {
		const result = await this.prisma.integrationProductLink.updateMany({
			where: { integrationId, productId },
			data: {
				lastSeenAt: at,
				lastPriceSyncAt: at,
				missingSince: null,
				missingSyncCount: 0,
				skippedReason: null,
				lastExternalError: null
			}
		})

		return result.count
	}

	async touchVariantLinkPriceSynced(
		integrationId: string,
		variantId: string,
		at: Date = new Date()
	): Promise<number> {
		const result = await this.prisma.integrationVariantLink.updateMany({
			where: { integrationId, variantId },
			data: {
				lastSeenAt: at,
				lastPriceSyncAt: at,
				missingSince: null,
				missingSyncCount: 0,
				skippedReason: null,
				lastExternalError: null
			}
		})

		return result.count
	}

	async updateProductPrice(params: {
		catalogId: string
		productId: string
		price: number | null
	}): Promise<OneCValueUpdateResult> {
		return this.prisma.$transaction(async tx => {
			const product = await tx.product.findFirst({
				where: {
					id: params.productId,
					catalogId: params.catalogId,
					deleteAt: null
				},
				select: {
					id: true,
					price: true,
					variants: {
						where: { deleteAt: null },
						select: {
							id: true,
							price: true,
							variantKey: true,
							kind: true,
							integrationLinks: { select: { id: true }, take: 1 }
						}
					}
				}
			})
			if (!product) {
				return emptyValueUpdateResult(params.price)
			}

			const previousValue = normalizeNullableNumber(product.price)
			const changed = nullableNumberChanged(previousValue, params.price)
			if (changed) {
				await tx.product.update({
					where: { id: product.id },
					data: { price: params.price }
				})
			}

			const [variant] = product.variants
			const shouldSyncDefaultVariant =
				product.variants.length === 1 &&
				variant &&
				isDefaultVariantRow(variant) &&
				!variant.integrationLinks.length &&
				nullableNumberChanged(normalizeNullableNumber(variant.price), params.price)
			if (shouldSyncDefaultVariant) {
				await tx.productVariant.update({
					where: { id: variant.id },
					data: { price: params.price }
				})
			}

			return {
				changed: changed || Boolean(shouldSyncDefaultVariant),
				productId: product.id,
				variantId: shouldSyncDefaultVariant ? variant.id : null,
				previousValue,
				nextValue: params.price
			}
		})
	}

	async updateVariantPrice(params: {
		catalogId: string
		variantId: string
		price: number | null
	}): Promise<OneCValueUpdateResult> {
		const variant = await this.prisma.productVariant.findFirst({
			where: {
				id: params.variantId,
				deleteAt: null,
				product: {
					catalogId: params.catalogId,
					deleteAt: null
				}
			},
			select: {
				id: true,
				productId: true,
				price: true
			}
		})
		if (!variant) {
			return emptyValueUpdateResult(params.price)
		}

		const previousValue = normalizeNullableNumber(variant.price)
		const changed = nullableNumberChanged(previousValue, params.price)
		if (changed) {
			await this.prisma.productVariant.update({
				where: { id: variant.id },
				data: { price: params.price }
			})
		}

		return {
			changed,
			productId: variant.productId,
			variantId: variant.id,
			previousValue,
			nextValue: params.price
		}
	}
}

function normalizeString(value: string): string {
	return value.trim()
}

function isDefaultVariantRow(variant: {
	variantKey: string
	kind?: ProductVariantKind | null
}): boolean {
	return (
		variant.kind === ProductVariantKind.DEFAULT ||
		variant.variantKey === DEFAULT_VARIANT_KEY
	)
}

function normalizeNullableNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null
	const numberValue = Number(value)
	return Number.isFinite(numberValue) ? numberValue : null
}

function nullableNumberChanged(
	current: number | null,
	next: number | null
): boolean {
	return current !== next
}

function emptyValueUpdateResult(
	nextValue: number | null
): OneCValueUpdateResult {
	return {
		changed: false,
		productId: null,
		variantId: null,
		previousValue: null,
		nextValue
	}
}

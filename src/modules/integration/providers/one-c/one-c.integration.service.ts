import type { Prisma } from '@generated/client'
import {
	IntegrationExternalObjectKind,
	IntegrationMappingDataType,
	IntegrationMappingDirection,
	IntegrationMappingLocalEntity,
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger,
	IntegrationSyncSnapshotCompleteness,
	IntegrationSyncStatus,
	ProductVariantStatus
} from '@generated/enums'
import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import slugify from 'slugify'

import {
	CAPABILITY_ASSERT_PORT,
	type CapabilityAssertPort
} from '@/modules/capability/contracts'
import {
	PRODUCT_EXTERNAL_SYNC_PORT,
	type ProductExternalProductUpdateInput,
	type ProductExternalSyncPort,
	type ProductExternalSyncProductRecord
} from '@/modules/product/public'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { mustCatalogId } from '@/shared/tenancy/ctx'
import { normalizeRequiredString } from '@/shared/utils'

import {
	ApplyOneCPriceSyncDtoReq,
	ApplyOneCStockSyncDtoReq,
	CreateOneCEntityMappingDtoReq,
	CreateOneCExternalObjectDtoReq,
	CreateOneCFieldMappingDtoReq,
	DiscoverOneCObjectsDtoReq,
	ImportOneCProductsDtoReq,
	ImportOneCVariantsDtoReq,
	PreviewOneCMappingDtoReq,
	PreviewOneCPriceSyncDtoReq,
	PreviewOneCProductImportDtoReq,
	PreviewOneCRemoteMappingDtoReq,
	PreviewOneCStockSyncDtoReq,
	PreviewOneCVariantImportDtoReq,
	RunOneCPriceSyncDtoReq,
	RunOneCProductSyncDtoReq,
	RunOneCStockSyncDtoReq,
	RunOneCVariantSyncDtoReq,
	TestOneCConnectionDtoReq,
	UpdateOneCEntityMappingDtoReq,
	UpdateOneCExternalObjectDtoReq,
	UpdateOneCFieldMappingDtoReq,
	UpdateOneCIntegrationDtoReq,
	UpsertOneCIntegrationDtoReq
} from '../../dto/requests/one-c-integration.dto.req'
import {
	OneCDiscoverObjectsDto,
	OneCEntityMappingDto,
	OneCExternalObjectDto,
	OneCFieldMappingDto,
	OneCIntegrationDto,
	OneCIntegrationStatusDto,
	OneCMappingPreviewDto,
	OneCPriceSyncPreviewDto,
	OneCPriceSyncResultDto,
	OneCProductImportPreviewDto,
	OneCProductImportResultDto,
	OneCRecommendedPriceMappingDto,
	OneCRecommendedProductMappingDto,
	OneCRecommendedStockMappingDto,
	OneCRecommendedVariantMappingDto,
	OneCRemoteMappingPreviewDto,
	OneCStockSyncPreviewDto,
	OneCStockSyncResultDto,
	OneCSyncProgressDto,
	OneCSyncRunDto,
	OneCTestConnectionDto,
	OneCVariantImportPreviewDto,
	OneCVariantImportResultDto
} from '../../dto/responses/one-c.dto.res'
import { IntegrationRepository } from '../../integration.repository'
import { getIntegrationProviderCapabilities } from '../../provider-capabilities'
import { renderSafeProviderErrorMessage } from '../../provider-error-redaction'

import { OneCClient } from './one-c.client'
import { maskOneCSecret, OneCMetadataCryptoService } from './one-c.metadata'
import {
	type OneCEntityMappingRecord,
	type OneCExternalObjectRecord,
	type OneCFieldMappingRecord,
	type OneCIntegrationRecord,
	OneCIntegrationRepository,
	type OneCProductPreviewRecord,
	type OneCProductStockLinkPreviewRecord,
	type OneCProductStockPreviewRecord,
	type OneCSyncRunRecord,
	type OneCVariantLinkPreviewRecord,
	type OneCVariantPreviewRecord
} from './one-c.repository'
import type { OneCMetadata } from './one-c.types'

type LocalPathRules = {
	exact: readonly string[]
	prefixes?: readonly string[]
}

type MappingPreviewResult = {
	items: OneCMappingPreviewDto['items']
	errors: string[]
	result: Record<string, unknown>
}

type ProductImportPreviewAction = 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR'
type ProductImportMatchBy = 'externalId' | 'sku' | 'none'
type VariantImportPreviewAction = ProductImportPreviewAction
type VariantImportMatchBy = 'externalId' | 'sku' | 'variantKey' | 'none'
type ValueSyncPreviewAction = 'UPDATE' | 'SKIP' | 'ERROR'
type ValueSyncTargetKind = 'product' | 'variant'
type ValueSyncMatchBy = 'externalId' | 'id' | 'sku' | 'none'
type ValueSyncKind = 'stock' | 'price'
type OneCSyncProgress = {
	phase: string
	message: string
	processed: number
	total: number | null
	percent: number | null
	updatedAt: string
}

type OneCSyncMetadata = {
	products: {
		total: number
		created: number
		updated: number
		deleted: number
		skipped: number
		failed: number
	}
	warnings: Array<{ code: string; message: string; externalId: string | null }>
	errors: Array<{ code: string; message: string; externalId: string | null }>
	progress: OneCSyncProgress | null
}

const LOCAL_PATH_RULES: Record<string, LocalPathRules> = {
	PRODUCT: {
		exact: [
			'id',
			'name',
			'sku',
			'slug',
			'price',
			'status',
			'brandId',
			'productTypeId',
			'isPopular',
			'position'
		],
		prefixes: ['attributes.', 'metadata.']
	},
	PRODUCT_VARIANT: {
		exact: [
			'id',
			'productId',
			'productExternalId',
			'productSku',
			'sku',
			'variantKey',
			'stock',
			'price',
			'status',
			'isAvailable'
		],
		prefixes: ['attributes.', 'saleUnits.', 'metadata.']
	},
	CATEGORY: {
		exact: ['id', 'name', 'slug', 'parentId', 'position'],
		prefixes: ['metadata.']
	},
	ORDER: {
		exact: [
			'id',
			'status',
			'comment',
			'address',
			'totalAmount',
			'isDelivery',
			'checkoutMethod'
		],
		prefixes: ['checkoutData.', 'checkoutContacts.', 'metadata.']
	},
	STOCK: {
		exact: [
			'productId',
			'productExternalId',
			'productSku',
			'variantId',
			'variantExternalId',
			'variantSku',
			'warehouseId',
			'stock',
			'quantity'
		],
		prefixes: ['metadata.']
	},
	PRICE: {
		exact: [
			'productId',
			'productExternalId',
			'productSku',
			'variantId',
			'variantExternalId',
			'variantSku',
			'price',
			'currency'
		],
		prefixes: ['metadata.']
	},
	WAREHOUSE: {
		exact: ['id', 'name', 'code', 'status'],
		prefixes: ['metadata.']
	},
	CUSTOMER: {
		exact: ['id', 'name', 'phone', 'email'],
		prefixes: ['metadata.']
	}
}

const PRODUCT_IMPORT_COMPARABLE_FIELDS = [
	'name',
	'sku',
	'slug',
	'price',
	'status',
	'brandId',
	'productTypeId',
	'isPopular',
	'position'
] as const
const VARIANT_IMPORT_COMPARABLE_FIELDS = [
	'sku',
	'variantKey',
	'stock',
	'price',
	'status',
	'isAvailable'
] as const
const PRODUCT_SKU_MAX_LENGTH = 100
const VARIANT_SKU_MAX_LENGTH = 100
const PRODUCT_SLUG_MAX_LENGTH = 255
const ONE_C_SYNC_STALE_AFTER_MS = 30 * 60 * 1000

@Injectable()
export class OneCIntegrationService {
	constructor(
		private readonly repo: OneCIntegrationRepository,
		private readonly integrationRepo: IntegrationRepository,
		private readonly metadataCrypto: OneCMetadataCryptoService,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly featureAssertions: CapabilityAssertPort,
		@Inject(PRODUCT_EXTERNAL_SYNC_PORT)
		private readonly products: ProductExternalSyncPort
	) {}

	async get(): Promise<OneCIntegrationDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const integration = await this.repo.findIntegration(catalogId)
		if (!integration) {
			throw new NotFoundException('ONE_C integration is not configured')
		}
		return this.mapIntegration(integration)
	}

	async getStatus(): Promise<OneCIntegrationStatusDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const [integration, activeRun, lastRun] = await Promise.all([
			this.repo.findIntegration(catalogId),
			this.repo.findLatestActiveSyncRun(catalogId),
			this.repo.findLatestFinishedSyncRun(catalogId)
		])

		return {
			configured: Boolean(integration),
			integration: integration ? this.mapIntegration(integration) : null,
			activeRun: activeRun ? this.mapSyncRun(activeRun) : null,
			lastRun: lastRun ? this.mapSyncRun(lastRun) : null
		}
	}

	async listRuns(limit?: number | string): Promise<OneCSyncRunDto[]> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const runs = await this.repo.findRecentSyncRuns(
			catalogId,
			normalizeRunsLimit(limit)
		)
		return runs.map(run => this.mapSyncRun(run))
	}

	async getRunProgress(runId: string): Promise<OneCSyncProgressDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const run = await this.repo.findSyncRunForCatalog(catalogId, runId)
		if (!run) {
			throw new NotFoundException('ONE_C sync run not found')
		}

		return this.mapSyncRunProgress(run, this.readSyncMetadata(run).progress)
	}

	async syncProducts(dto: RunOneCProductSyncDtoReq): Promise<OneCSyncRunDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const integration = await this.getStoredIntegration(catalogId)
		if (!integration.isActive) {
			throw new ConflictException('ONE_C integration is disabled')
		}
		const activeRun = await this.repo.findLatestActiveSyncRun(catalogId)
		if (activeRun) {
			throw new ConflictException('ONE_C sync is already queued or running')
		}

		const run = await this.repo.createSyncRun({
			integrationId: integration.id,
			catalogId,
			mode: IntegrationSyncRunMode.PRODUCT,
			trigger: IntegrationSyncRunTrigger.MANUAL,
			snapshotCompleteness: IntegrationSyncSnapshotCompleteness.PARTIAL
		})

		return this.executeProductSyncRun({
			catalogId,
			runId: run.id,
			dto,
			jobId: `manual:${Date.now()}`
		})
	}

	async executeProductSyncRun(params: {
		catalogId: string
		runId: string
		dto: RunOneCProductSyncDtoReq
		jobId?: string | null
	}): Promise<OneCSyncRunDto> {
		await this.featureAssertions.assertCanUseOneCIntegration(params.catalogId)
		const integration = await this.getStoredIntegration(params.catalogId)
		if (!integration.isActive) {
			throw new ConflictException('ONE_C integration is disabled')
		}
		const startedAt = new Date()
		const startedMs = Date.now()
		let run: OneCSyncRunRecord | null = null
		let beganIntegrationSync = false

		try {
			const locked = await this.repo.beginSync(
				params.catalogId,
				new Date(startedAt.getTime() - ONE_C_SYNC_STALE_AFTER_MS)
			)
			if (!locked) {
				throw new ConflictException('ONE_C sync is already running')
			}
			beganIntegrationSync = true

			run = await this.repo.markSyncRunRunning({
				runId: params.runId,
				jobId: params.jobId,
				startedAt,
				metadata: this.toPrismaJson(
					this.buildInitialSyncMetadata('ONE_C product sync started', startedAt)
				)
			})
			if (!run) {
				throw new NotFoundException('ONE_C sync run not found')
			}

			const result = await this.importProductsForCatalog(
				params.catalogId,
				params.dto
			)
			const failed = result.counters.failed
			const status =
				failed > 0
					? IntegrationSyncRunStatus.ERROR
					: IntegrationSyncRunStatus.SUCCESS
			const integrationStatus =
				failed > 0 ? IntegrationSyncStatus.ERROR : IntegrationSyncStatus.SUCCESS
			const error =
				failed > 0
					? `ONE_C product sync finished with ${failed} failed row(s)`
					: null
			const finishedAt = new Date()
			const durationMs = Math.max(0, Date.now() - startedMs)
			const finishedRun = await this.repo.finishSyncRun({
				runId: run.id,
				status,
				snapshotCompleteness: IntegrationSyncSnapshotCompleteness.PARTIAL,
				error,
				totalProducts: result.counters.total,
				createdProducts: result.counters.created,
				updatedProducts: result.counters.updated,
				deletedProducts: 0,
				imagesImported: 0,
				durationMs,
				finishedAt,
				metadata: this.toPrismaJson(
					this.buildProductSyncMetadata(result, status, finishedAt)
				)
			})
			await this.repo.finishSync({
				catalogId: params.catalogId,
				status: integrationStatus,
				error,
				totalProducts: result.counters.total,
				createdProducts: result.counters.created,
				updatedProducts: result.counters.updated,
				deletedProducts: 0,
				syncedAt: finishedAt
			})

			return this.mapSyncRun(finishedRun ?? run)
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			const finishedAt = new Date()
			const durationMs = Math.max(0, Date.now() - startedMs)
			const failedRun = await this.repo.finishSyncRun({
				runId: run.id,
				status: IntegrationSyncRunStatus.ERROR,
				snapshotCompleteness:
					IntegrationSyncSnapshotCompleteness.FAILED_BEFORE_SNAPSHOT,
				error: message,
				totalProducts: 0,
				createdProducts: 0,
				updatedProducts: 0,
				deletedProducts: 0,
				imagesImported: 0,
				durationMs,
				finishedAt,
				metadata: this.toPrismaJson(
					this.buildFailedSyncMetadata(message, finishedAt)
				)
			})
			if (beganIntegrationSync) {
				await this.repo.failSync(params.catalogId, message)
			}
			if (!failedRun && !run) {
				throw new NotFoundException('ONE_C sync run not found')
			}

			return this.mapSyncRun(failedRun ?? run)
		}
	}

	async syncVariants(dto: RunOneCVariantSyncDtoReq): Promise<OneCSyncRunDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const integration = await this.getStoredIntegration(catalogId)
		if (!integration.isActive) {
			throw new ConflictException('ONE_C integration is disabled')
		}
		const activeRun = await this.repo.findLatestActiveSyncRun(catalogId)
		if (activeRun) {
			throw new ConflictException('ONE_C sync is already queued or running')
		}

		const run = await this.repo.createSyncRun({
			integrationId: integration.id,
			catalogId,
			mode: IntegrationSyncRunMode.VARIANT,
			trigger: IntegrationSyncRunTrigger.MANUAL,
			snapshotCompleteness: IntegrationSyncSnapshotCompleteness.PARTIAL
		})

		return this.executeVariantSyncRun({
			catalogId,
			runId: run.id,
			dto,
			jobId: `manual:${Date.now()}`
		})
	}

	async executeVariantSyncRun(params: {
		catalogId: string
		runId: string
		dto: RunOneCVariantSyncDtoReq
		jobId?: string | null
	}): Promise<OneCSyncRunDto> {
		await this.featureAssertions.assertCanUseOneCIntegration(params.catalogId)
		const integration = await this.getStoredIntegration(params.catalogId)
		if (!integration.isActive) {
			throw new ConflictException('ONE_C integration is disabled')
		}
		const startedAt = new Date()
		const startedMs = Date.now()
		let run: OneCSyncRunRecord | null = null
		let beganIntegrationSync = false

		try {
			const locked = await this.repo.beginSync(
				params.catalogId,
				new Date(startedAt.getTime() - ONE_C_SYNC_STALE_AFTER_MS)
			)
			if (!locked) {
				throw new ConflictException('ONE_C sync is already running')
			}
			beganIntegrationSync = true

			run = await this.repo.markSyncRunRunning({
				runId: params.runId,
				jobId: params.jobId,
				startedAt,
				metadata: this.toPrismaJson(
					this.buildInitialSyncMetadata('ONE_C variant sync started', startedAt)
				)
			})
			if (!run) {
				throw new NotFoundException('ONE_C sync run not found')
			}

			const result = await this.importVariantsForCatalog(
				params.catalogId,
				params.dto
			)
			const failed = result.counters.failed
			const status =
				failed > 0
					? IntegrationSyncRunStatus.ERROR
					: IntegrationSyncRunStatus.SUCCESS
			const integrationStatus =
				failed > 0 ? IntegrationSyncStatus.ERROR : IntegrationSyncStatus.SUCCESS
			const error =
				failed > 0
					? `ONE_C variant sync finished with ${failed} failed row(s)`
					: null
			const finishedAt = new Date()
			const durationMs = Math.max(0, Date.now() - startedMs)
			const finishedRun = await this.repo.finishSyncRun({
				runId: run.id,
				status,
				snapshotCompleteness: IntegrationSyncSnapshotCompleteness.PARTIAL,
				error,
				totalProducts: result.counters.total,
				createdProducts: result.counters.created,
				updatedProducts: result.counters.updated,
				deletedProducts: 0,
				imagesImported: 0,
				durationMs,
				finishedAt,
				metadata: this.toPrismaJson(
					this.buildVariantSyncMetadata(result, status, finishedAt)
				)
			})
			await this.repo.finishSync({
				catalogId: params.catalogId,
				status: integrationStatus,
				error,
				totalProducts: integration.totalProducts,
				createdProducts: integration.createdProducts,
				updatedProducts: integration.updatedProducts,
				deletedProducts: integration.deletedProducts,
				syncedAt: finishedAt
			})

			return this.mapSyncRun(finishedRun ?? run)
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			const finishedAt = new Date()
			const durationMs = Math.max(0, Date.now() - startedMs)
			const failedRun = await this.repo.finishSyncRun({
				runId: run?.id ?? params.runId,
				status: IntegrationSyncRunStatus.ERROR,
				snapshotCompleteness:
					IntegrationSyncSnapshotCompleteness.FAILED_BEFORE_SNAPSHOT,
				error: message,
				totalProducts: 0,
				createdProducts: 0,
				updatedProducts: 0,
				deletedProducts: 0,
				imagesImported: 0,
				durationMs,
				finishedAt,
				metadata: this.toPrismaJson(
					this.buildFailedSyncMetadata(message, finishedAt)
				)
			})
			if (beganIntegrationSync) {
				await this.repo.failSync(params.catalogId, message)
			}
			if (!failedRun && !run) {
				throw new NotFoundException('ONE_C sync run not found')
			}

			return this.mapSyncRun(failedRun ?? run)
		}
	}

	async executeStockSyncRun(params: {
		catalogId: string
		runId: string
		dto: RunOneCStockSyncDtoReq
		jobId?: string | null
	}): Promise<OneCSyncRunDto> {
		await this.featureAssertions.assertCanUseOneCIntegration(params.catalogId)
		const integration = await this.getStoredIntegration(params.catalogId)
		if (!integration.isActive) {
			throw new ConflictException('ONE_C integration is disabled')
		}
		const startedAt = new Date()
		const startedMs = Date.now()
		let run: OneCSyncRunRecord | null = null
		let beganIntegrationSync = false

		try {
			const locked = await this.repo.beginSync(
				params.catalogId,
				new Date(startedAt.getTime() - ONE_C_SYNC_STALE_AFTER_MS)
			)
			if (!locked) {
				throw new ConflictException('ONE_C sync is already running')
			}
			beganIntegrationSync = true

			run = await this.repo.markSyncRunRunning({
				runId: params.runId,
				jobId: params.jobId,
				startedAt,
				metadata: this.toPrismaJson(
					this.buildInitialSyncMetadata('ONE_C stock sync started', startedAt)
				)
			})
			if (!run) {
				throw new NotFoundException('ONE_C sync run not found')
			}

			const result = await this.applyValueSyncForCatalog(
				params.catalogId,
				this.resolveStockSyncRunDto(params.dto, integration),
				'stock'
			)
			const failed = result.counters.failed
			const status =
				failed > 0
					? IntegrationSyncRunStatus.ERROR
					: IntegrationSyncRunStatus.SUCCESS
			const integrationStatus =
				failed > 0 ? IntegrationSyncStatus.ERROR : IntegrationSyncStatus.SUCCESS
			const error =
				failed > 0 ? `ONE_C stock sync finished with ${failed} failed row(s)` : null
			const finishedAt = new Date()
			const durationMs = Math.max(0, Date.now() - startedMs)
			const finishedRun = await this.repo.finishSyncRun({
				runId: run.id,
				status,
				snapshotCompleteness: IntegrationSyncSnapshotCompleteness.PARTIAL,
				error,
				totalProducts: result.counters.total,
				createdProducts: 0,
				updatedProducts: result.counters.updated,
				deletedProducts: 0,
				imagesImported: 0,
				durationMs,
				finishedAt,
				metadata: this.toPrismaJson(
					this.buildStockSyncMetadata(result, status, finishedAt)
				)
			})
			await this.repo.finishSync({
				catalogId: params.catalogId,
				status: integrationStatus,
				error,
				totalProducts: integration.totalProducts,
				createdProducts: integration.createdProducts,
				updatedProducts: integration.updatedProducts,
				deletedProducts: integration.deletedProducts,
				syncedAt: finishedAt
			})

			return this.mapSyncRun(finishedRun ?? run)
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			const finishedAt = new Date()
			const durationMs = Math.max(0, Date.now() - startedMs)
			const failedRun = await this.repo.finishSyncRun({
				runId: run?.id ?? params.runId,
				status: IntegrationSyncRunStatus.ERROR,
				snapshotCompleteness:
					IntegrationSyncSnapshotCompleteness.FAILED_BEFORE_SNAPSHOT,
				error: message,
				totalProducts: 0,
				createdProducts: 0,
				updatedProducts: 0,
				deletedProducts: 0,
				imagesImported: 0,
				durationMs,
				finishedAt,
				metadata: this.toPrismaJson(
					this.buildFailedSyncMetadata(
						message,
						finishedAt,
						'ONE_C_STOCK_SYNC_FAILED'
					)
				)
			})
			if (beganIntegrationSync) {
				await this.repo.failSync(params.catalogId, message)
			}
			if (!failedRun && !run) {
				throw new NotFoundException('ONE_C sync run not found')
			}

			return this.mapSyncRun(failedRun ?? run)
		}
	}

	async executePriceSyncRun(params: {
		catalogId: string
		runId: string
		dto: RunOneCPriceSyncDtoReq
		jobId?: string | null
	}): Promise<OneCSyncRunDto> {
		await this.featureAssertions.assertCanUseOneCIntegration(params.catalogId)
		const integration = await this.getStoredIntegration(params.catalogId)
		if (!integration.isActive) {
			throw new ConflictException('ONE_C integration is disabled')
		}
		const startedAt = new Date()
		const startedMs = Date.now()
		let run: OneCSyncRunRecord | null = null
		let beganIntegrationSync = false

		try {
			const locked = await this.repo.beginSync(
				params.catalogId,
				new Date(startedAt.getTime() - ONE_C_SYNC_STALE_AFTER_MS)
			)
			if (!locked) {
				throw new ConflictException('ONE_C sync is already running')
			}
			beganIntegrationSync = true

			run = await this.repo.markSyncRunRunning({
				runId: params.runId,
				jobId: params.jobId,
				startedAt,
				metadata: this.toPrismaJson(
					this.buildInitialSyncMetadata('ONE_C price sync started', startedAt)
				)
			})
			if (!run) {
				throw new NotFoundException('ONE_C sync run not found')
			}

			const result = await this.applyValueSyncForCatalog(
				params.catalogId,
				this.resolvePriceSyncRunDto(params.dto, integration),
				'price'
			)
			const failed = result.counters.failed
			const status =
				failed > 0
					? IntegrationSyncRunStatus.ERROR
					: IntegrationSyncRunStatus.SUCCESS
			const integrationStatus =
				failed > 0 ? IntegrationSyncStatus.ERROR : IntegrationSyncStatus.SUCCESS
			const error =
				failed > 0 ? `ONE_C price sync finished with ${failed} failed row(s)` : null
			const finishedAt = new Date()
			const durationMs = Math.max(0, Date.now() - startedMs)
			const finishedRun = await this.repo.finishSyncRun({
				runId: run.id,
				status,
				snapshotCompleteness: IntegrationSyncSnapshotCompleteness.PARTIAL,
				error,
				totalProducts: result.counters.total,
				createdProducts: 0,
				updatedProducts: result.counters.updated,
				deletedProducts: 0,
				imagesImported: 0,
				durationMs,
				finishedAt,
				metadata: this.toPrismaJson(
					this.buildPriceSyncMetadata(result, status, finishedAt)
				)
			})
			await this.repo.finishSync({
				catalogId: params.catalogId,
				status: integrationStatus,
				error,
				totalProducts: integration.totalProducts,
				createdProducts: integration.createdProducts,
				updatedProducts: integration.updatedProducts,
				deletedProducts: integration.deletedProducts,
				syncedAt: finishedAt
			})

			return this.mapSyncRun(finishedRun ?? run)
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			const finishedAt = new Date()
			const durationMs = Math.max(0, Date.now() - startedMs)
			const failedRun = await this.repo.finishSyncRun({
				runId: run?.id ?? params.runId,
				status: IntegrationSyncRunStatus.ERROR,
				snapshotCompleteness:
					IntegrationSyncSnapshotCompleteness.FAILED_BEFORE_SNAPSHOT,
				error: message,
				totalProducts: 0,
				createdProducts: 0,
				updatedProducts: 0,
				deletedProducts: 0,
				imagesImported: 0,
				durationMs,
				finishedAt,
				metadata: this.toPrismaJson(
					this.buildFailedSyncMetadata(
						message,
						finishedAt,
						'ONE_C_PRICE_SYNC_FAILED'
					)
				)
			})
			if (beganIntegrationSync) {
				await this.repo.failSync(params.catalogId, message)
			}
			if (!failedRun && !run) {
				throw new NotFoundException('ONE_C sync run not found')
			}

			return this.mapSyncRun(failedRun ?? run)
		}
	}

	async upsert(dto: UpsertOneCIntegrationDtoReq): Promise<OneCIntegrationDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const existing = await this.repo.findIntegration(catalogId)
		const current = existing
			? this.metadataCrypto.parseStoredMetadata(existing.metadata)
			: null
		const stockScheduleEnabled = dto.stockScheduleEnabled ?? false
		const priceScheduleEnabled = dto.priceScheduleEnabled ?? false
		const productSyncEntityMappingId =
			await this.resolveProductSyncEntityMappingId({
				catalogId,
				requested: dto.productSyncEntityMappingId,
				current: current?.productSyncEntityMappingId,
				scheduleEnabled: dto.scheduleEnabled ?? false
			})
		const variantSyncEntityMappingId =
			await this.resolveVariantSyncEntityMappingId({
				catalogId,
				requested: dto.variantSyncEntityMappingId,
				current: current?.variantSyncEntityMappingId,
				autoResolve: true
			})
		const stockSyncEntityMappingId = await this.resolveStockSyncEntityMappingId({
			catalogId,
			requested: dto.stockSyncEntityMappingId,
			current: current?.stockSyncEntityMappingId,
			autoResolve: (dto.syncStock ?? false) || stockScheduleEnabled,
			requireActive: stockScheduleEnabled
		})
		const priceSyncEntityMappingId = await this.resolvePriceSyncEntityMappingId({
			catalogId,
			requested: dto.priceSyncEntityMappingId,
			current: current?.priceSyncEntityMappingId,
			autoResolve:
				priceScheduleEnabled ||
				dto.priceSyncLimit !== undefined ||
				dto.priceSyncFilter !== undefined,
			requireActive: priceScheduleEnabled
		})
		const metadata = this.metadataCrypto.buildStoredMetadata({
			apiKind: dto.apiKind,
			authKind: dto.authKind,
			baseUrl: dto.baseUrl,
			username: dto.username,
			password: dto.password,
			token: dto.token,
			timeoutMs: dto.timeoutMs,
			importProducts: dto.importProducts,
			syncStock: dto.syncStock,
			exportOrders: dto.exportOrders,
			productSyncEntityMappingId,
			productSyncLimit: dto.productSyncLimit,
			productSyncFilter: dto.productSyncFilter,
			variantSyncEntityMappingId,
			variantSyncLimit: dto.variantSyncLimit,
			variantSyncFilter: dto.variantSyncFilter,
			stockSyncEntityMappingId,
			stockSyncLimit: dto.stockSyncLimit,
			stockSyncFilter: dto.stockSyncFilter,
			priceSyncEntityMappingId,
			priceSyncLimit: dto.priceSyncLimit,
			priceSyncFilter: dto.priceSyncFilter,
			scheduleEnabled: dto.scheduleEnabled,
			schedulePattern: dto.schedulePattern,
			scheduleTimezone: dto.scheduleTimezone,
			stockScheduleEnabled,
			stockSchedulePattern: dto.stockSchedulePattern,
			stockScheduleTimezone: dto.stockScheduleTimezone,
			priceScheduleEnabled,
			priceSchedulePattern: dto.priceSchedulePattern,
			priceScheduleTimezone: dto.priceScheduleTimezone,
			lastDiscoveredAt: current?.lastDiscoveredAt ?? null
		})
		const integration = await this.repo.upsertIntegration(catalogId, {
			metadata,
			isActive: dto.isActive ?? true
		})

		return this.mapIntegration(integration)
	}

	async update(dto: UpdateOneCIntegrationDtoReq): Promise<OneCIntegrationDto> {
		this.assertHasIntegrationUpdateFields(dto)

		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const existing = await this.repo.findIntegration(catalogId)
		if (!existing) {
			throw new NotFoundException('ONE_C integration is not configured')
		}
		const current = this.metadataCrypto.parseStoredMetadata(existing.metadata)
		const scheduleEnabled = dto.scheduleEnabled ?? current.scheduleEnabled
		const stockScheduleEnabled =
			dto.stockScheduleEnabled ?? current.stockScheduleEnabled
		const priceScheduleEnabled =
			dto.priceScheduleEnabled ?? current.priceScheduleEnabled
		const productSyncEntityMappingId =
			await this.resolveProductSyncEntityMappingId({
				catalogId,
				requested: dto.productSyncEntityMappingId,
				current: current.productSyncEntityMappingId,
				scheduleEnabled
			})
		const variantSyncEntityMappingId =
			await this.resolveVariantSyncEntityMappingId({
				catalogId,
				requested: dto.variantSyncEntityMappingId,
				current: current.variantSyncEntityMappingId,
				autoResolve:
					dto.variantSyncLimit !== undefined || dto.variantSyncFilter !== undefined
			})
		const stockSyncEntityMappingId = await this.resolveStockSyncEntityMappingId({
			catalogId,
			requested: dto.stockSyncEntityMappingId,
			current: current.stockSyncEntityMappingId,
			autoResolve:
				(stockScheduleEnabled && !current.stockSyncEntityMappingId) ||
				(dto.syncStock === true && !current.stockSyncEntityMappingId) ||
				dto.stockSyncLimit !== undefined ||
				dto.stockSyncFilter !== undefined,
			requireActive: stockScheduleEnabled
		})
		const priceSyncEntityMappingId = await this.resolvePriceSyncEntityMappingId({
			catalogId,
			requested: dto.priceSyncEntityMappingId,
			current: current.priceSyncEntityMappingId,
			autoResolve:
				(priceScheduleEnabled && !current.priceSyncEntityMappingId) ||
				dto.priceSyncLimit !== undefined ||
				dto.priceSyncFilter !== undefined,
			requireActive: priceScheduleEnabled
		})
		const metadata = this.metadataCrypto.buildStoredMetadata({
			apiKind: dto.apiKind ?? current.apiKind,
			authKind: dto.authKind ?? current.authKind,
			baseUrl: dto.baseUrl ?? current.baseUrl,
			username: dto.username !== undefined ? dto.username : current.username,
			password: dto.password !== undefined ? dto.password : current.password,
			token: dto.token !== undefined ? dto.token : current.token,
			timeoutMs: dto.timeoutMs ?? current.timeoutMs,
			importProducts: dto.importProducts ?? current.importProducts,
			syncStock: dto.syncStock ?? current.syncStock,
			exportOrders: dto.exportOrders ?? current.exportOrders,
			productSyncEntityMappingId,
			productSyncLimit: dto.productSyncLimit ?? current.productSyncLimit,
			productSyncFilter:
				dto.productSyncFilter !== undefined
					? dto.productSyncFilter
					: current.productSyncFilter,
			variantSyncEntityMappingId,
			variantSyncLimit: dto.variantSyncLimit ?? current.variantSyncLimit,
			variantSyncFilter:
				dto.variantSyncFilter !== undefined
					? dto.variantSyncFilter
					: current.variantSyncFilter,
			stockSyncEntityMappingId,
			stockSyncLimit: dto.stockSyncLimit ?? current.stockSyncLimit,
			stockSyncFilter:
				dto.stockSyncFilter !== undefined
					? dto.stockSyncFilter
					: current.stockSyncFilter,
			priceSyncEntityMappingId,
			priceSyncLimit: dto.priceSyncLimit ?? current.priceSyncLimit,
			priceSyncFilter:
				dto.priceSyncFilter !== undefined
					? dto.priceSyncFilter
					: current.priceSyncFilter,
			scheduleEnabled,
			schedulePattern:
				dto.schedulePattern !== undefined
					? dto.schedulePattern
					: current.schedulePattern,
			scheduleTimezone: dto.scheduleTimezone ?? current.scheduleTimezone,
			stockScheduleEnabled,
			stockSchedulePattern:
				dto.stockSchedulePattern !== undefined
					? dto.stockSchedulePattern
					: current.stockSchedulePattern,
			stockScheduleTimezone:
				dto.stockScheduleTimezone ?? current.stockScheduleTimezone,
			priceScheduleEnabled,
			priceSchedulePattern:
				dto.priceSchedulePattern !== undefined
					? dto.priceSchedulePattern
					: current.priceSchedulePattern,
			priceScheduleTimezone:
				dto.priceScheduleTimezone ?? current.priceScheduleTimezone,
			lastDiscoveredAt: current.lastDiscoveredAt
		})
		const integration = await this.repo.updateIntegration(catalogId, {
			metadata,
			isActive: dto.isActive
		})
		if (!integration) {
			throw new NotFoundException('ONE_C integration is not configured')
		}

		return this.mapIntegration(integration)
	}

	async remove(): Promise<OkResponseDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const integration = await this.repo.softDeleteIntegration(catalogId)
		if (!integration) {
			throw new NotFoundException('ONE_C integration is not configured')
		}
		return { ok: true }
	}

	async testConnection(
		dto: TestOneCConnectionDtoReq = {}
	): Promise<OneCTestConnectionDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const metadata = await this.resolveMetadataForRequest(catalogId, dto)
		const client = new OneCClient(metadata)
		return client.testConnection()
	}

	async discoverObjects(
		dto: DiscoverOneCObjectsDtoReq = {}
	): Promise<OneCDiscoverObjectsDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const integration = await this.getStoredIntegration(catalogId)
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		const objects = await new OneCClient(metadata).discoverObjects()
		const discoveredAt = new Date()

		if (dto.persist !== false) {
			await Promise.all(
				objects.map(object =>
					this.repo.upsertExternalObject({
						integrationId: integration.id,
						code: object.code,
						name: object.name,
						kind: IntegrationExternalObjectKind.ODATA_ENTITY,
						endpoint: object.endpoint,
						method: 'GET',
						schema: this.toPrismaJson({ fields: object.fields }),
						isActive: true,
						lastDiscoveredAt: discoveredAt
					})
				)
			)
			await this.repo.updateIntegration(catalogId, {
				metadata: this.metadataCrypto.buildStoredMetadata({
					...metadata,
					lastDiscoveredAt: discoveredAt.toISOString()
				})
			})
		}

		return {
			ok: true,
			total: objects.length,
			persisted: dto.persist !== false,
			objects
		}
	}

	async listExternalObjects(): Promise<OneCExternalObjectDto[]> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const integration = await this.getStoredIntegration(catalogId)
		const objects = await this.repo.listExternalObjects(integration.id)
		return objects.map(object => this.mapExternalObject(object))
	}

	async createExternalObject(
		dto: CreateOneCExternalObjectDtoReq
	): Promise<OneCExternalObjectDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const integration = await this.getStoredIntegration(catalogId)
		const code = normalizeRequiredString(dto.code, 'code')
		const object = await this.repo.upsertExternalObject({
			integrationId: integration.id,
			code,
			name: normalizeOptionalString(dto.name) ?? code,
			kind: (dto.kind ??
				IntegrationExternalObjectKind.CUSTOM) as IntegrationExternalObjectKind,
			endpoint: normalizeOptionalString(dto.endpoint),
			method: normalizeOptionalString(dto.method)?.toUpperCase() ?? null,
			schema: this.optionalJson(dto.schema),
			sample: this.optionalJson(dto.sample),
			isActive: dto.isActive ?? true
		})

		return this.mapExternalObject(object)
	}

	async updateExternalObject(
		id: string,
		dto: UpdateOneCExternalObjectDtoReq
	): Promise<OneCExternalObjectDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const existing = await this.repo.findExternalObjectForCatalog(catalogId, id)
		if (!existing) {
			throw new NotFoundException('ONE_C external object not found')
		}

		const object = await this.repo.updateExternalObject(existing.id, {
			code:
				dto.code === undefined
					? undefined
					: normalizeRequiredString(dto.code, 'code'),
			name:
				dto.name === undefined
					? undefined
					: normalizeRequiredString(dto.name, 'name'),
			kind: dto.kind as IntegrationExternalObjectKind | undefined,
			endpoint:
				dto.endpoint === undefined
					? undefined
					: normalizeOptionalString(dto.endpoint),
			method:
				dto.method === undefined
					? undefined
					: (normalizeOptionalString(dto.method)?.toUpperCase() ?? null),
			schema: this.optionalJson(dto.schema),
			sample: this.optionalJson(dto.sample),
			isActive: dto.isActive
		})

		return this.mapExternalObject(object)
	}

	async deleteExternalObject(id: string): Promise<OkResponseDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const existing = await this.repo.findExternalObjectForCatalog(catalogId, id)
		if (!existing) {
			throw new NotFoundException('ONE_C external object not found')
		}
		await this.repo.deleteExternalObject(existing.id)
		return { ok: true }
	}

	async listEntityMappings(): Promise<OneCEntityMappingDto[]> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const integration = await this.getStoredIntegration(catalogId)
		const mappings = await this.repo.listEntityMappings(integration.id)
		return mappings.map(mapping => this.mapEntityMapping(mapping))
	}

	async getRecommendedProductMapping(): Promise<OneCRecommendedProductMappingDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		await this.getStoredIntegration(catalogId)
		const mapping = await this.repo.findRecommendedProductEntityMapping(catalogId)

		return {
			ok: true,
			ready: Boolean(mapping),
			mappingId: mapping?.id ?? null,
			mapping: mapping ? this.mapEntityMapping(mapping) : null,
			reason: mapping ? null : 'No active ONE_C PRODUCT mapping configured'
		}
	}

	async getRecommendedVariantMapping(): Promise<OneCRecommendedVariantMappingDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		await this.getStoredIntegration(catalogId)
		const mapping = await this.repo.findRecommendedVariantEntityMapping(catalogId)

		return {
			ok: true,
			ready: Boolean(mapping),
			mappingId: mapping?.id ?? null,
			mapping: mapping ? this.mapEntityMapping(mapping) : null,
			reason: mapping ? null : 'No active ONE_C PRODUCT_VARIANT mapping configured'
		}
	}

	async getRecommendedStockMapping(): Promise<OneCRecommendedStockMappingDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		await this.getStoredIntegration(catalogId)
		const mapping = await this.repo.findRecommendedStockEntityMapping(catalogId)

		return {
			ok: true,
			ready: Boolean(mapping),
			mappingId: mapping?.id ?? null,
			mapping: mapping ? this.mapEntityMapping(mapping) : null,
			reason: mapping ? null : 'No active ONE_C STOCK mapping configured'
		}
	}

	async getRecommendedPriceMapping(): Promise<OneCRecommendedPriceMappingDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		await this.getStoredIntegration(catalogId)
		const mapping = await this.repo.findRecommendedPriceEntityMapping(catalogId)

		return {
			ok: true,
			ready: Boolean(mapping),
			mappingId: mapping?.id ?? null,
			mapping: mapping ? this.mapEntityMapping(mapping) : null,
			reason: mapping ? null : 'No active ONE_C PRICE mapping configured'
		}
	}

	async createEntityMapping(
		dto: CreateOneCEntityMappingDtoReq
	): Promise<OneCEntityMappingDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const integration = await this.getStoredIntegration(catalogId)
		const externalObject = dto.externalObjectId
			? await this.requireExternalObject(catalogId, dto.externalObjectId)
			: null
		const externalObjectCode = normalizeRequiredString(
			externalObject?.code ?? dto.externalObjectCode,
			'externalObjectCode'
		)

		const mapping = await this.repo.createEntityMapping({
			integrationId: integration.id,
			externalObjectId:
				externalObject?.id ?? normalizeOptionalString(dto.externalObjectId),
			localEntity: dto.localEntity as IntegrationMappingLocalEntity,
			externalObjectCode,
			identityField: normalizeRequiredString(dto.identityField, 'identityField'),
			direction:
				(dto.direction as IntegrationMappingDirection | undefined) ??
				IntegrationMappingDirection.IMPORT,
			conflictPolicy: normalizeOptionalString(dto.conflictPolicy),
			filters: this.optionalJson(dto.filters),
			options: this.optionalJson(dto.options),
			isActive: dto.isActive ?? true
		})

		return this.mapEntityMapping(mapping)
	}

	async updateEntityMapping(
		id: string,
		dto: UpdateOneCEntityMappingDtoReq
	): Promise<OneCEntityMappingDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const existing = await this.repo.findEntityMappingForCatalog(catalogId, id)
		if (!existing) {
			throw new NotFoundException('ONE_C entity mapping not found')
		}
		const externalObject =
			dto.externalObjectId === undefined
				? undefined
				: dto.externalObjectId
					? await this.requireExternalObject(catalogId, dto.externalObjectId)
					: null

		const mapping = await this.repo.updateEntityMapping(existing.id, {
			externalObjectId:
				externalObject === undefined ? undefined : (externalObject?.id ?? null),
			localEntity: dto.localEntity as IntegrationMappingLocalEntity | undefined,
			externalObjectCode:
				dto.externalObjectCode === undefined
					? externalObject?.code
					: normalizeRequiredString(dto.externalObjectCode, 'externalObjectCode'),
			identityField:
				dto.identityField === undefined
					? undefined
					: normalizeRequiredString(dto.identityField, 'identityField'),
			direction: dto.direction as IntegrationMappingDirection | undefined,
			conflictPolicy:
				dto.conflictPolicy === undefined
					? undefined
					: normalizeOptionalString(dto.conflictPolicy),
			filters: this.optionalJson(dto.filters),
			options: this.optionalJson(dto.options),
			isActive: dto.isActive
		})

		return this.mapEntityMapping(mapping)
	}

	async deleteEntityMapping(id: string): Promise<OkResponseDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const existing = await this.repo.findEntityMappingForCatalog(catalogId, id)
		if (!existing) {
			throw new NotFoundException('ONE_C entity mapping not found')
		}
		await this.repo.deleteEntityMapping(existing.id)
		return { ok: true }
	}

	async createFieldMapping(
		entityMappingId: string,
		dto: CreateOneCFieldMappingDtoReq
	): Promise<OneCFieldMappingDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const entityMapping = await this.repo.findEntityMappingForCatalog(
			catalogId,
			entityMappingId
		)
		if (!entityMapping) {
			throw new NotFoundException('ONE_C entity mapping not found')
		}
		this.assertLocalPathAllowed(entityMapping.localEntity, dto.localPath)

		const mapping = await this.repo.createFieldMapping({
			entityMappingId: entityMapping.id,
			localPath: normalizeRequiredString(dto.localPath, 'localPath'),
			externalPath: normalizeRequiredString(dto.externalPath, 'externalPath'),
			direction:
				(dto.direction as IntegrationMappingDirection | undefined) ??
				IntegrationMappingDirection.IMPORT,
			dataType:
				(dto.dataType as IntegrationMappingDataType | undefined) ??
				IntegrationMappingDataType.STRING,
			transform: this.optionalJson(dto.transform),
			defaultValue: this.optionalJson(dto.defaultValue),
			isRequired: dto.isRequired ?? false,
			isActive: dto.isActive ?? true,
			displayOrder: dto.displayOrder ?? 0
		})

		return this.mapFieldMapping(mapping)
	}

	async updateFieldMapping(
		id: string,
		dto: UpdateOneCFieldMappingDtoReq
	): Promise<OneCFieldMappingDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const existing = await this.repo.findFieldMappingForCatalog(catalogId, id)
		if (!existing) {
			throw new NotFoundException('ONE_C field mapping not found')
		}
		const entityMapping = await this.repo.findEntityMappingForCatalog(
			catalogId,
			existing.entityMappingId
		)
		if (!entityMapping) {
			throw new NotFoundException('ONE_C entity mapping not found')
		}
		if (dto.localPath !== undefined) {
			this.assertLocalPathAllowed(entityMapping.localEntity, dto.localPath)
		}

		const mapping = await this.repo.updateFieldMapping(existing.id, {
			localPath:
				dto.localPath === undefined
					? undefined
					: normalizeRequiredString(dto.localPath, 'localPath'),
			externalPath:
				dto.externalPath === undefined
					? undefined
					: normalizeRequiredString(dto.externalPath, 'externalPath'),
			direction: dto.direction as IntegrationMappingDirection | undefined,
			dataType: dto.dataType as IntegrationMappingDataType | undefined,
			transform: this.optionalJson(dto.transform),
			defaultValue: this.optionalJson(dto.defaultValue),
			isRequired: dto.isRequired,
			isActive: dto.isActive,
			displayOrder: dto.displayOrder
		})

		return this.mapFieldMapping(mapping)
	}

	async deleteFieldMapping(id: string): Promise<OkResponseDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const existing = await this.repo.findFieldMappingForCatalog(catalogId, id)
		if (!existing) {
			throw new NotFoundException('ONE_C field mapping not found')
		}
		await this.repo.deleteFieldMapping(existing.id)
		return { ok: true }
	}

	async previewMapping(
		dto: PreviewOneCMappingDtoReq
	): Promise<OneCMappingPreviewDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const mapping = await this.repo.findEntityMappingForCatalog(
			catalogId,
			dto.entityMappingId
		)
		if (!mapping) {
			throw new NotFoundException('ONE_C entity mapping not found')
		}
		const payload = normalizePreviewPayload(dto.externalPayload)
		const preview = this.previewPayload(mapping, payload)

		return {
			ok: true,
			entityMappingId: mapping.id,
			localEntity: mapping.localEntity,
			externalObjectCode: mapping.externalObjectCode,
			items: preview.items,
			errors: preview.errors,
			result: preview.result
		}
	}

	async previewRemoteMapping(
		dto: PreviewOneCRemoteMappingDtoReq
	): Promise<OneCRemoteMappingPreviewDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const integration = await this.getStoredIntegration(catalogId)
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		const mapping = await this.repo.findEntityMappingForCatalog(
			catalogId,
			dto.entityMappingId
		)
		if (!mapping) {
			throw new NotFoundException('ONE_C entity mapping not found')
		}
		if (!mapping.isActive) {
			throw new BadRequestException('ONE_C entity mapping is disabled')
		}

		const rows = await new OneCClient(metadata).fetchRows({
			objectCode: mapping.externalObjectCode,
			endpoint: mapping.externalObject?.endpoint,
			limit: dto.limit ?? 10,
			filter: dto.filter,
			select: this.buildRemotePreviewSelect(mapping)
		})
		const previews = rows.map((row, index) => {
			const preview = this.previewPayload(mapping, row)
			return {
				index,
				externalIdentity: normalizeIdentityValue(
					readPath(row, mapping.identityField)
				),
				items: preview.items,
				errors: preview.errors,
				result: preview.result,
				...(dto.includeRaw ? { raw: row } : {})
			}
		})

		return {
			ok: true,
			entityMappingId: mapping.id,
			localEntity: mapping.localEntity,
			externalObjectCode: mapping.externalObjectCode,
			totalFetched: previews.length,
			totalWithErrors: previews.filter(row => row.errors.length > 0).length,
			rows: previews
		}
	}

	async previewProductImport(
		dto: PreviewOneCProductImportDtoReq
	): Promise<OneCProductImportPreviewDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		return this.previewProductImportForCatalog(catalogId, dto)
	}

	private async previewProductImportForCatalog(
		catalogId: string,
		dto: PreviewOneCProductImportDtoReq
	): Promise<OneCProductImportPreviewDto> {
		const integration = await this.getStoredIntegration(catalogId)
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		const mapping = await this.repo.findEntityMappingForCatalog(
			catalogId,
			dto.entityMappingId
		)
		if (!mapping) {
			throw new NotFoundException('ONE_C entity mapping not found')
		}
		if (mapping.localEntity !== IntegrationMappingLocalEntity.PRODUCT) {
			throw new BadRequestException(
				'ONE_C product import preview requires PRODUCT entity mapping'
			)
		}
		if (!mapping.isActive) {
			throw new BadRequestException('ONE_C entity mapping is disabled')
		}

		const rows = await new OneCClient(metadata).fetchRows({
			objectCode: mapping.externalObjectCode,
			endpoint: mapping.externalObject?.endpoint,
			limit: dto.limit ?? 20,
			filter: dto.filter,
			select: this.buildRemotePreviewSelect(mapping)
		})
		const mappedRows = rows.map((row, index) => {
			const preview = this.previewPayload(mapping, row)
			const externalIdentity = normalizeIdentityValue(
				readPath(row, mapping.identityField)
			)
			return {
				index,
				row,
				preview,
				externalIdentity,
				sku: normalizeIdentityValue(preview.result.sku)
			}
		})
		const externalIds = mappedRows.flatMap(row =>
			row.externalIdentity ? [row.externalIdentity] : []
		)
		const skus = mappedRows.flatMap(row => (row.sku ? [row.sku] : []))
		const [links, products] = await Promise.all([
			this.repo.findProductLinksByExternalIds({
				integrationId: integration.id,
				externalIds
			}),
			this.repo.findProductsBySkus({ catalogId, skus })
		])
		const linksByExternalId = new Map(links.map(link => [link.externalId, link]))
		const productsBySku = new Map(products.map(product => [product.sku, product]))
		const previewRows = mappedRows.map(mappedRow => {
			const link = mappedRow.externalIdentity
				? linksByExternalId.get(mappedRow.externalIdentity)
				: null
			const product =
				link?.product ?? (mappedRow.sku ? productsBySku.get(mappedRow.sku) : null)
			const matchBy: ProductImportMatchBy = link
				? 'externalId'
				: product
					? 'sku'
					: 'none'
			const errors = [...mappedRow.preview.errors]
			if (!mappedRow.externalIdentity) {
				errors.push('External identity is missing')
			}
			if (!product) {
				errors.push(...validateProductCreatePayload(mappedRow.preview.result))
			}
			const changes = product
				? buildProductChanges(product, mappedRow.preview.result)
				: buildProductCreateChanges(mappedRow.preview.result)
			const action = resolveProductImportAction({
				errors,
				product,
				changes
			})

			return {
				index: mappedRow.index,
				externalIdentity: mappedRow.externalIdentity,
				action,
				matchBy,
				productId: product?.id ?? null,
				productName: product?.name ?? null,
				productSku: product?.sku ?? null,
				mapped: mappedRow.preview.result,
				changes,
				errors,
				...(dto.includeRaw ? { raw: mappedRow.row } : {})
			}
		})
		const counters = {
			total: previewRows.length,
			create: previewRows.filter(row => row.action === 'CREATE').length,
			update: previewRows.filter(row => row.action === 'UPDATE').length,
			skip: previewRows.filter(row => row.action === 'SKIP').length,
			error: previewRows.filter(row => row.action === 'ERROR').length
		}

		return {
			ok: true,
			entityMappingId: mapping.id,
			externalObjectCode: mapping.externalObjectCode,
			totalFetched: previewRows.length,
			counters,
			rows: previewRows
		}
	}

	async importProducts(
		dto: ImportOneCProductsDtoReq
	): Promise<OneCProductImportResultDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		return this.importProductsForCatalog(catalogId, dto)
	}

	private async importProductsForCatalog(
		catalogId: string,
		dto: ImportOneCProductsDtoReq
	): Promise<OneCProductImportResultDto> {
		const preview = await this.previewProductImportForCatalog(catalogId, dto)
		if (dto.failOnRowError && preview.counters.error > 0) {
			throw new BadRequestException('ONE_C product import preview has row errors')
		}
		const integration = await this.getStoredIntegration(catalogId)
		const resultRows: OneCProductImportResultDto['rows'] = []

		for (const row of preview.rows) {
			if (row.action === 'ERROR') {
				resultRows.push({
					index: row.index,
					externalIdentity: row.externalIdentity,
					status: 'FAILED' as const,
					productId: row.productId,
					errors: row.errors
				})
				continue
			}
			if (row.action === 'SKIP') {
				resultRows.push({
					index: row.index,
					externalIdentity: row.externalIdentity,
					status: 'SKIPPED' as const,
					productId: row.productId,
					errors: []
				})
				continue
			}

			try {
				const product = await this.applyProductImportRow({
					catalogId,
					integrationId: integration.id,
					row
				})
				resultRows.push({
					index: row.index,
					externalIdentity: row.externalIdentity,
					status:
						row.action === 'CREATE' ? ('CREATED' as const) : ('UPDATED' as const),
					productId: product.id,
					errors: []
				})
			} catch (error) {
				resultRows.push({
					index: row.index,
					externalIdentity: row.externalIdentity,
					status: 'FAILED' as const,
					productId: row.productId,
					errors: [renderSafeProviderErrorMessage(error)]
				})
			}
		}

		const counters = {
			total: resultRows.length,
			created: resultRows.filter(row => row.status === 'CREATED').length,
			updated: resultRows.filter(row => row.status === 'UPDATED').length,
			skipped: resultRows.filter(row => row.status === 'SKIPPED').length,
			failed: resultRows.filter(row => row.status === 'FAILED').length
		}

		return {
			ok: true,
			entityMappingId: preview.entityMappingId,
			externalObjectCode: preview.externalObjectCode,
			counters,
			rows: resultRows
		}
	}

	async previewVariantImport(
		dto: PreviewOneCVariantImportDtoReq
	): Promise<OneCVariantImportPreviewDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		return this.previewVariantImportForCatalog(catalogId, dto)
	}

	private async previewVariantImportForCatalog(
		catalogId: string,
		dto: PreviewOneCVariantImportDtoReq
	): Promise<OneCVariantImportPreviewDto> {
		const integration = await this.getStoredIntegration(catalogId)
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		const mapping = await this.repo.findEntityMappingForCatalog(
			catalogId,
			dto.entityMappingId
		)
		if (!mapping) {
			throw new NotFoundException('ONE_C entity mapping not found')
		}
		if (mapping.localEntity !== IntegrationMappingLocalEntity.PRODUCT_VARIANT) {
			throw new BadRequestException(
				'ONE_C variant import preview requires PRODUCT_VARIANT entity mapping'
			)
		}
		if (!mapping.isActive) {
			throw new BadRequestException('ONE_C entity mapping is disabled')
		}

		const rows = await new OneCClient(metadata).fetchRows({
			objectCode: mapping.externalObjectCode,
			endpoint: mapping.externalObject?.endpoint,
			limit: dto.limit ?? 20,
			filter: dto.filter,
			select: this.buildRemotePreviewSelect(mapping)
		})
		const mappedRows = rows.map((row, index) => {
			const preview = this.previewPayload(mapping, row)
			const externalIdentity = normalizeIdentityValue(
				readPath(row, mapping.identityField)
			)
			return {
				index,
				row,
				preview,
				externalIdentity,
				productId: normalizeIdentityValue(preview.result.productId),
				productExternalId: normalizeIdentityValue(preview.result.productExternalId),
				productSku: normalizeIdentityValue(preview.result.productSku),
				sku: normalizeIdentityValue(preview.result.sku),
				variantKey: normalizeIdentityValue(preview.result.variantKey)
			}
		})
		const externalIds = mappedRows.flatMap(row =>
			row.externalIdentity ? [row.externalIdentity] : []
		)
		const productIds = mappedRows.flatMap(row =>
			row.productId ? [row.productId] : []
		)
		const productExternalIds = mappedRows.flatMap(row =>
			row.productExternalId ? [row.productExternalId] : []
		)
		const productSkus = mappedRows.flatMap(row =>
			row.productSku ? [row.productSku] : []
		)
		const variantSkus = mappedRows.flatMap(row => (row.sku ? [row.sku] : []))
		const [
			variantLinks,
			productLinks,
			productsById,
			productsBySku,
			variantsBySku
		] = await Promise.all([
			this.repo.findVariantLinksByExternalIds({
				integrationId: integration.id,
				externalIds
			}),
			this.repo.findProductLinksByExternalIds({
				integrationId: integration.id,
				externalIds: productExternalIds
			}),
			this.repo.findProductsByIds({ catalogId, productIds }),
			this.repo.findProductsBySkus({ catalogId, skus: productSkus }),
			this.repo.findVariantsBySkus({ catalogId, skus: variantSkus })
		])
		const variantLinksByExternalId = new Map(
			variantLinks.map(link => [link.externalId, link])
		)
		const productLinksByExternalId = new Map(
			productLinks.map(link => [link.externalId, link])
		)
		const productsByIdMap = new Map(
			productsById.map(product => [product.id, product])
		)
		const productsBySkuMap = new Map(
			productsBySku.map(product => [product.sku, product])
		)
		const variantsBySkuMap = new Map(
			variantsBySku.map(variant => [variant.sku, variant])
		)
		const preliminaryRows = mappedRows.map(mappedRow => {
			const link = mappedRow.externalIdentity
				? variantLinksByExternalId.get(mappedRow.externalIdentity)
				: null
			const product =
				(mappedRow.productId ? productsByIdMap.get(mappedRow.productId) : null) ??
				(mappedRow.productExternalId
					? productLinksByExternalId.get(mappedRow.productExternalId)?.product
					: null) ??
				(mappedRow.productSku
					? productsBySkuMap.get(mappedRow.productSku)
					: null) ??
				link?.variant.product ??
				null
			const skuVariant = mappedRow.sku ? variantsBySkuMap.get(mappedRow.sku) : null

			return {
				mappedRow,
				link,
				product,
				skuVariant
			}
		})
		const productVariantKeyPairs = preliminaryRows.flatMap(row =>
			row.product && row.mappedRow.variantKey
				? [
						{
							productId: row.product.id,
							variantKey: row.mappedRow.variantKey
						}
					]
				: []
		)
		const variantsByProductVariantKey =
			await this.repo.findVariantsByProductVariantKeys({
				catalogId,
				pairs: productVariantKeyPairs
			})
		const variantsByProductVariantKeyMap = new Map(
			variantsByProductVariantKey.map(variant => [
				buildProductVariantKey(variant.productId, variant.variantKey),
				variant
			])
		)

		const previewRows = preliminaryRows.map(row => {
			const mapped = row.mappedRow.preview.result
			const skuVariant =
				row.skuVariant &&
				(!row.product || row.skuVariant.productId === row.product.id)
					? row.skuVariant
					: null
			const skuConflict =
				Boolean(row.skuVariant && row.product) &&
				row.skuVariant?.productId !== row.product?.id
			const variant =
				row.link?.variant ??
				skuVariant ??
				(row.product && row.mappedRow.variantKey
					? variantsByProductVariantKeyMap.get(
							buildProductVariantKey(row.product.id, row.mappedRow.variantKey)
						)
					: null) ??
				null
			const matchBy: VariantImportMatchBy = row.link
				? 'externalId'
				: skuVariant
					? 'sku'
					: variant
						? 'variantKey'
						: 'none'
			const attributes = readVariantAttributes(mapped)
			const errors = [
				...row.mappedRow.preview.errors,
				...validateVariantImportResolution(row.mappedRow, row.product),
				...validateVariantPayload(mapped),
				...(skuConflict
					? ['Mapped variant sku already belongs to another product']
					: [])
			]
			if (!variant) {
				errors.push(
					...validateVariantCreatePayload(mapped, row.product, attributes)
				)
			}
			const syncContent = attributes.length > 0
			const changes = variant
				? buildVariantChanges(variant, mapped, syncContent)
				: buildVariantCreateChanges(mapped, attributes)
			const action = resolveVariantImportAction({
				errors,
				variant,
				changes
			})

			return {
				index: row.mappedRow.index,
				externalIdentity: row.mappedRow.externalIdentity,
				action,
				matchBy,
				productId: row.product?.id ?? null,
				productName: row.product?.name ?? null,
				productSku: row.product?.sku ?? null,
				variantId: variant?.id ?? null,
				variantSku: variant?.sku ?? null,
				variantKey: variant?.variantKey ?? null,
				mapped,
				changes,
				errors,
				...(dto.includeRaw ? { raw: row.mappedRow.row } : {})
			}
		})
		const counters = {
			total: previewRows.length,
			create: previewRows.filter(row => row.action === 'CREATE').length,
			update: previewRows.filter(row => row.action === 'UPDATE').length,
			skip: previewRows.filter(row => row.action === 'SKIP').length,
			error: previewRows.filter(row => row.action === 'ERROR').length
		}

		return {
			ok: true,
			entityMappingId: mapping.id,
			externalObjectCode: mapping.externalObjectCode,
			totalFetched: previewRows.length,
			counters,
			rows: previewRows
		}
	}

	async importVariants(
		dto: ImportOneCVariantsDtoReq
	): Promise<OneCVariantImportResultDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		return this.importVariantsForCatalog(catalogId, dto)
	}

	private async importVariantsForCatalog(
		catalogId: string,
		dto: ImportOneCVariantsDtoReq
	): Promise<OneCVariantImportResultDto> {
		const preview = await this.previewVariantImportForCatalog(catalogId, dto)
		if (dto.failOnRowError && preview.counters.error > 0) {
			throw new BadRequestException('ONE_C variant import preview has row errors')
		}
		const integration = await this.getStoredIntegration(catalogId)
		const resultRows: OneCVariantImportResultDto['rows'] = []

		for (const row of preview.rows) {
			if (row.action === 'ERROR') {
				resultRows.push({
					index: row.index,
					externalIdentity: row.externalIdentity,
					status: 'FAILED' as const,
					productId: row.productId,
					variantId: row.variantId,
					errors: row.errors
				})
				continue
			}
			if (row.action === 'SKIP') {
				resultRows.push({
					index: row.index,
					externalIdentity: row.externalIdentity,
					status: 'SKIPPED' as const,
					productId: row.productId,
					variantId: row.variantId,
					errors: []
				})
				continue
			}

			try {
				const result = await this.applyVariantImportRow({
					catalogId,
					integrationId: integration.id,
					row
				})
				resultRows.push({
					index: row.index,
					externalIdentity: row.externalIdentity,
					status: result.created ? ('CREATED' as const) : ('UPDATED' as const),
					productId: result.variant.productId,
					variantId: result.variant.id,
					errors: []
				})
			} catch (error) {
				resultRows.push({
					index: row.index,
					externalIdentity: row.externalIdentity,
					status: 'FAILED' as const,
					productId: row.productId,
					variantId: row.variantId,
					errors: [renderSafeProviderErrorMessage(error)]
				})
			}
		}

		const counters = {
			total: resultRows.length,
			created: resultRows.filter(row => row.status === 'CREATED').length,
			updated: resultRows.filter(row => row.status === 'UPDATED').length,
			skipped: resultRows.filter(row => row.status === 'SKIPPED').length,
			failed: resultRows.filter(row => row.status === 'FAILED').length
		}

		return {
			ok: true,
			entityMappingId: preview.entityMappingId,
			externalObjectCode: preview.externalObjectCode,
			counters,
			rows: resultRows
		}
	}

	private async applyVariantImportRow(params: {
		catalogId: string
		integrationId: string
		row: OneCVariantImportPreviewDto['rows'][number]
	}) {
		const externalId = normalizeRequiredString(
			params.row.externalIdentity ?? '',
			'externalIdentity'
		)
		const productId = normalizeRequiredString(
			params.row.productId ?? '',
			'productId'
		)
		const mapped = params.row.mapped
		const attributes = readVariantAttributes(mapped)
		const stock = readVariantStock(mapped)
		const result = await this.integrationRepo.upsertIntegratedProductVariant({
			catalogId: params.catalogId,
			integrationId: params.integrationId,
			productId,
			externalId,
			externalCode: normalizeIdentityValue(mapped.sku) ?? externalId,
			rawMeta: this.toPrismaJson({
				source: 'ONE_C',
				mapped
			}),
			sku: resolveVariantSku(mapped, externalId),
			variantKey: resolveVariantKey(mapped, attributes, externalId),
			price: readNullableNumber(mapped.price),
			syncPrice: Object.hasOwn(mapped, 'price'),
			syncContent: attributes.length > 0,
			stock,
			status: resolveMappedVariantStatus(mapped, stock),
			attributes
		})

		await this.products.recomputeProductCommercialState({
			catalogId: params.catalogId,
			productId: result.variant.productId
		})

		return result
	}

	async previewStockSync(
		dto: PreviewOneCStockSyncDtoReq
	): Promise<OneCStockSyncPreviewDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		return this.previewValueSyncForCatalog(catalogId, dto, 'stock')
	}

	async applyStockSync(
		dto: ApplyOneCStockSyncDtoReq
	): Promise<OneCStockSyncResultDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		return this.applyValueSyncForCatalog(catalogId, dto, 'stock')
	}

	async previewPriceSync(
		dto: PreviewOneCPriceSyncDtoReq
	): Promise<OneCPriceSyncPreviewDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		return this.previewValueSyncForCatalog(catalogId, dto, 'price')
	}

	async applyPriceSync(
		dto: ApplyOneCPriceSyncDtoReq
	): Promise<OneCPriceSyncResultDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		return this.applyValueSyncForCatalog(catalogId, dto, 'price')
	}

	private async previewValueSyncForCatalog(
		catalogId: string,
		dto: PreviewOneCRemoteMappingDtoReq,
		kind: ValueSyncKind
	): Promise<OneCStockSyncPreviewDto> {
		const integration = await this.getStoredIntegration(catalogId)
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		const mapping = await this.repo.findEntityMappingForCatalog(
			catalogId,
			dto.entityMappingId
		)
		if (!mapping) {
			throw new NotFoundException('ONE_C entity mapping not found')
		}
		const expectedEntity =
			kind === 'stock'
				? IntegrationMappingLocalEntity.STOCK
				: IntegrationMappingLocalEntity.PRICE
		if (mapping.localEntity !== expectedEntity) {
			throw new BadRequestException(
				`ONE_C ${kind} sync preview requires ${expectedEntity} entity mapping`
			)
		}
		if (!mapping.isActive) {
			throw new BadRequestException('ONE_C entity mapping is disabled')
		}

		const rows = await new OneCClient(metadata).fetchRows({
			objectCode: mapping.externalObjectCode,
			endpoint: mapping.externalObject?.endpoint,
			limit: dto.limit ?? 20,
			filter: dto.filter,
			select: this.buildRemotePreviewSelect(mapping)
		})
		const mappedRows = rows.map((row, index) => {
			const preview = this.previewPayload(mapping, row)
			return {
				index,
				row,
				preview,
				externalIdentity: normalizeIdentityValue(
					readPath(row, mapping.identityField)
				),
				productId: normalizeIdentityValue(preview.result.productId),
				productExternalId: normalizeIdentityValue(preview.result.productExternalId),
				productSku: normalizeIdentityValue(preview.result.productSku),
				variantId: normalizeIdentityValue(preview.result.variantId),
				variantExternalId: normalizeIdentityValue(preview.result.variantExternalId),
				variantSku: normalizeIdentityValue(preview.result.variantSku)
			}
		})
		const externalIds = mappedRows.flatMap(row =>
			row.externalIdentity ? [row.externalIdentity] : []
		)
		const productExternalIds = mappedRows.flatMap(row =>
			row.productExternalId ? [row.productExternalId] : []
		)
		const variantExternalIds = mappedRows.flatMap(row =>
			row.variantExternalId ? [row.variantExternalId] : []
		)
		const productIds = mappedRows.flatMap(row =>
			row.productId ? [row.productId] : []
		)
		const productSkus = mappedRows.flatMap(row =>
			row.productSku ? [row.productSku] : []
		)
		const variantIds = mappedRows.flatMap(row =>
			row.variantId ? [row.variantId] : []
		)
		const variantSkus = mappedRows.flatMap(row =>
			row.variantSku ? [row.variantSku] : []
		)

		const [
			productLinks,
			variantLinks,
			productsById,
			productsBySku,
			variantsById,
			variantsBySku
		] = await Promise.all([
			this.repo.findProductStockLinksByExternalIds({
				integrationId: integration.id,
				externalIds: [...externalIds, ...productExternalIds]
			}),
			this.repo.findVariantLinksByExternalIds({
				integrationId: integration.id,
				externalIds: [...externalIds, ...variantExternalIds]
			}),
			this.repo.findStockProductsByIds({ catalogId, productIds }),
			this.repo.findStockProductsBySkus({ catalogId, skus: productSkus }),
			this.repo.findVariantsByIds({ catalogId, variantIds }),
			this.repo.findVariantsBySkus({ catalogId, skus: variantSkus })
		])

		const productLinksByExternalId = new Map(
			productLinks.map(link => [link.externalId, link])
		)
		const variantLinksByExternalId = new Map(
			variantLinks.map(link => [link.externalId, link])
		)
		const productsByIdMap = new Map(
			productsById.map(product => [product.id, product])
		)
		const productsBySkuMap = new Map(
			productsBySku.map(product => [product.sku, product])
		)
		const variantsByIdMap = new Map(
			variantsById.map(variant => [variant.id, variant])
		)
		const variantsBySkuMap = new Map(
			variantsBySku.map(variant => [variant.sku, variant])
		)

		const previewRows = mappedRows.map(mappedRow => {
			const target = resolveValueSyncTarget({
				mappedRow,
				productLinksByExternalId,
				variantLinksByExternalId,
				productsById: productsByIdMap,
				productsBySku: productsBySkuMap,
				variantsById: variantsByIdMap,
				variantsBySku: variantsBySkuMap
			})
			const value = readValueSyncNextValue(mappedRow.preview.result, kind)
			const errors = [
				...mappedRow.preview.errors,
				...validateValueSyncRow(mappedRow, target, value, kind)
			]
			const currentValue = target ? readValueSyncCurrentValue(target, kind) : null
			const action: ValueSyncPreviewAction = errors.length
				? 'ERROR'
				: currentValue === value.value
					? 'SKIP'
					: 'UPDATE'

			return {
				index: mappedRow.index,
				externalIdentity: mappedRow.externalIdentity,
				action,
				targetKind: target?.targetKind ?? null,
				matchBy: target?.matchBy ?? 'none',
				productId: target?.productId ?? null,
				productName: target?.productName ?? null,
				productSku: target?.productSku ?? null,
				variantId: target?.variantId ?? null,
				variantSku: target?.variantSku ?? null,
				variantKey: target?.variantKey ?? null,
				mapped: mappedRow.preview.result,
				currentValue,
				nextValue: value.value,
				errors,
				...(dto.includeRaw ? { raw: mappedRow.row } : {})
			}
		})
		const counters = {
			total: previewRows.length,
			update: previewRows.filter(row => row.action === 'UPDATE').length,
			skip: previewRows.filter(row => row.action === 'SKIP').length,
			error: previewRows.filter(row => row.action === 'ERROR').length
		}

		return {
			ok: true,
			entityMappingId: mapping.id,
			externalObjectCode: mapping.externalObjectCode,
			totalFetched: previewRows.length,
			counters,
			rows: previewRows
		}
	}

	private async applyValueSyncForCatalog(
		catalogId: string,
		dto: ApplyOneCStockSyncDtoReq | ApplyOneCPriceSyncDtoReq,
		kind: ValueSyncKind
	): Promise<OneCStockSyncResultDto> {
		const preview = await this.previewValueSyncForCatalog(catalogId, dto, kind)
		if (dto.failOnRowError && preview.counters.error > 0) {
			throw new BadRequestException(`ONE_C ${kind} sync preview has row errors`)
		}
		const integration = await this.getStoredIntegration(catalogId)
		const resultRows: OneCStockSyncResultDto['rows'] = []

		for (const row of preview.rows) {
			if (row.action === 'ERROR') {
				resultRows.push({
					index: row.index,
					externalIdentity: row.externalIdentity,
					status: 'FAILED' as const,
					targetKind: row.targetKind,
					productId: row.productId,
					variantId: row.variantId,
					previousValue: row.currentValue,
					nextValue: row.nextValue,
					errors: row.errors
				})
				continue
			}
			if (row.action === 'SKIP') {
				resultRows.push({
					index: row.index,
					externalIdentity: row.externalIdentity,
					status: 'SKIPPED' as const,
					targetKind: row.targetKind,
					productId: row.productId,
					variantId: row.variantId,
					previousValue: row.currentValue,
					nextValue: row.nextValue,
					errors: []
				})
				continue
			}

			try {
				const result = await this.applyValueSyncRow({
					catalogId,
					integrationId: integration.id,
					row,
					kind
				})
				resultRows.push({
					index: row.index,
					externalIdentity: row.externalIdentity,
					status: result.changed ? ('UPDATED' as const) : ('SKIPPED' as const),
					targetKind: row.targetKind,
					productId: result.productId ?? row.productId,
					variantId: result.variantId ?? row.variantId,
					previousValue: result.previousValue,
					nextValue: result.nextValue,
					errors: []
				})
			} catch (error) {
				resultRows.push({
					index: row.index,
					externalIdentity: row.externalIdentity,
					status: 'FAILED' as const,
					targetKind: row.targetKind,
					productId: row.productId,
					variantId: row.variantId,
					previousValue: row.currentValue,
					nextValue: row.nextValue,
					errors: [renderSafeProviderErrorMessage(error)]
				})
			}
		}

		const counters = {
			total: resultRows.length,
			updated: resultRows.filter(row => row.status === 'UPDATED').length,
			skipped: resultRows.filter(row => row.status === 'SKIPPED').length,
			failed: resultRows.filter(row => row.status === 'FAILED').length
		}

		return {
			ok: true,
			entityMappingId: preview.entityMappingId,
			externalObjectCode: preview.externalObjectCode,
			counters,
			rows: resultRows
		}
	}

	private async applyValueSyncRow(params: {
		catalogId: string
		integrationId: string
		row: OneCStockSyncPreviewDto['rows'][number]
		kind: ValueSyncKind
	}) {
		const value = readNullableNumber(params.row.nextValue)
		if (params.kind === 'stock') {
			const stock = Math.max(0, Math.trunc(value ?? 0))
			const result =
				params.row.targetKind === 'variant'
					? await this.integrationRepo.updateLinkedVariantStock(
							normalizeRequiredString(params.row.variantId ?? '', 'variantId'),
							stock
						)
					: await this.integrationRepo.updateLinkedProductStock(
							params.catalogId,
							normalizeRequiredString(params.row.productId ?? '', 'productId'),
							stock
						)

			if (params.row.targetKind === 'variant' && params.row.variantId) {
				await this.integrationRepo.touchVariantLinkStockSynced(
					params.integrationId,
					params.row.variantId
				)
			}
			if (params.row.targetKind === 'product' && params.row.productId) {
				await this.integrationRepo.touchProductLinkStockSynced(
					params.integrationId,
					params.row.productId
				)
			}
			const productId = result.productId ?? params.row.productId
			if (productId) {
				await this.products.recomputeProductCommercialState({
					catalogId: params.catalogId,
					productId
				})
			}

			return {
				changed: result.changed,
				productId,
				variantId: result.variantId ?? params.row.variantId,
				previousValue: result.previousStock,
				nextValue: result.nextStock ?? stock
			}
		}

		const result =
			params.row.targetKind === 'variant'
				? await this.repo.updateVariantPrice({
						catalogId: params.catalogId,
						variantId: normalizeRequiredString(
							params.row.variantId ?? '',
							'variantId'
						),
						price: value
					})
				: await this.repo.updateProductPrice({
						catalogId: params.catalogId,
						productId: normalizeRequiredString(
							params.row.productId ?? '',
							'productId'
						),
						price: value
					})
		if (params.row.targetKind === 'variant' && params.row.variantId) {
			await this.repo.touchVariantLinkPriceSynced(
				params.integrationId,
				params.row.variantId
			)
		}
		if (params.row.targetKind === 'product' && params.row.productId) {
			await this.repo.touchProductLinkPriceSynced(
				params.integrationId,
				params.row.productId
			)
		}
		const productId = result.productId ?? params.row.productId
		if (productId) {
			await this.products.recomputeProductCommercialState({
				catalogId: params.catalogId,
				productId
			})
		}

		return result
	}

	private async applyProductImportRow(params: {
		catalogId: string
		integrationId: string
		row: OneCProductImportPreviewDto['rows'][number]
	}): Promise<ProductExternalSyncProductRecord> {
		const externalId = normalizeRequiredString(
			params.row.externalIdentity ?? '',
			'externalIdentity'
		)
		const mapped = params.row.mapped

		const product = await this.repo.transaction(async tx => {
			const product =
				params.row.action === 'CREATE'
					? await this.createImportedProduct(params.catalogId, mapped, tx)
					: await this.updateImportedProduct(params.catalogId, params.row, tx)

			await this.repo.upsertProductLink(
				{
					integrationId: params.integrationId,
					productId: product.id,
					externalId,
					externalCode: normalizeIdentityValue(mapped.sku) ?? externalId,
					rawMeta: this.toPrismaJson({
						source: 'ONE_C',
						mapped
					})
				},
				tx
			)

			return product
		})

		await this.products.ensureDefaultVariant({
			catalogId: params.catalogId,
			productId: product.id,
			sku: product.sku,
			price: readNullableNumber(mapped.price),
			productStatus: normalizeIdentityValue(mapped.status)
		})
		await this.products.recomputeProductCommercialState({
			catalogId: params.catalogId,
			productId: product.id
		})

		return product
	}

	private async createImportedProduct(
		catalogId: string,
		mapped: Record<string, unknown>,
		tx: unknown
	): Promise<ProductExternalSyncProductRecord> {
		const name = normalizeRequiredString(
			normalizeIdentityValue(mapped.name) ?? '',
			'name'
		)
		const sku = await this.resolveUniqueSku(
			normalizeRequiredString(normalizeIdentityValue(mapped.sku) ?? '', 'sku'),
			undefined,
			tx
		)
		const slug = await this.resolveUniqueSlug(
			catalogId,
			normalizeIdentityValue(mapped.slug) ?? name,
			undefined,
			tx
		)

		return this.products.createExternalProduct({
			catalogId,
			name,
			sku,
			slug,
			price: readNullableNumber(mapped.price),
			status: normalizeIdentityValue(mapped.status) ?? 'ACTIVE',
			isPopular: readOptionalBoolean(mapped.isPopular),
			position: readOptionalInteger(mapped.position),
			tx
		})
	}

	private async updateImportedProduct(
		catalogId: string,
		row: OneCProductImportPreviewDto['rows'][number],
		tx: unknown
	): Promise<ProductExternalSyncProductRecord> {
		if (!row.productId) {
			throw new BadRequestException('Product id is required for update')
		}

		const data: ProductExternalProductUpdateInput['data'] = {}
		for (const change of row.changes) {
			if (change.field === 'name') {
				data.name = normalizeRequiredString(
					normalizeIdentityValue(change.nextValue) ?? '',
					'name'
				)
			}
			if (change.field === 'sku') {
				const nextSku = normalizeRequiredString(
					normalizeIdentityValue(change.nextValue) ?? '',
					'sku'
				)
				if (
					await this.products.existsExternalProductSku({
						sku: nextSku,
						excludeId: row.productId,
						tx
					})
				) {
					throw new BadRequestException(`Product sku already exists: ${nextSku}`)
				}
				data.sku = nextSku
			}
			if (change.field === 'slug') {
				data.slug = await this.resolveUniqueSlug(
					catalogId,
					normalizeIdentityValue(change.nextValue) ??
						normalizeIdentityValue(row.mapped.name) ??
						row.productName ??
						row.productId,
					row.productId,
					tx
				)
			}
			if (change.field === 'price') {
				data.price = readNullableNumber(change.nextValue)
			}
			if (change.field === 'status') {
				const status = normalizeIdentityValue(change.nextValue)
				if (status) {
					data.status = status
				}
			}
			if (change.field === 'isPopular') {
				const isPopular = readOptionalBoolean(change.nextValue)
				if (isPopular !== undefined) {
					data.isPopular = isPopular
				}
			}
			if (change.field === 'position') {
				const position = readOptionalInteger(change.nextValue)
				if (position !== undefined) {
					data.position = position
				}
			}
		}

		if (!Object.keys(data).length) {
			const product = await this.products.findExternalProductById({
				catalogId,
				productId: row.productId,
				tx
			})
			if (!product) {
				throw new NotFoundException('Product not found')
			}
			return product
		}

		const updated = await this.products.updateExternalProduct({
			catalogId,
			productId: row.productId,
			data,
			tx
		})
		if (!updated) {
			throw new NotFoundException('Product not found')
		}

		return updated
	}

	private async resolveUniqueSlug(
		catalogId: string,
		source: string,
		excludeId: string | undefined,
		tx: unknown
	): Promise<string> {
		const base = buildSlugBase(source)
		let suffix = 0

		while (suffix < 1000) {
			const candidate = appendUniqueSuffix(base, suffix, PRODUCT_SLUG_MAX_LENGTH)
			if (
				!(await this.products.existsExternalProductSlug({
					catalogId,
					slug: candidate,
					excludeId,
					tx
				}))
			) {
				return candidate
			}
			suffix += 1
		}

		throw new BadRequestException(`Could not build unique product slug: ${base}`)
	}

	private async resolveUniqueSku(
		source: string,
		excludeId: string | undefined,
		tx: unknown
	): Promise<string> {
		const base = source.trim().slice(0, PRODUCT_SKU_MAX_LENGTH)
		let suffix = 0

		while (suffix < 1000) {
			const candidate = appendUniqueSuffix(base, suffix, PRODUCT_SKU_MAX_LENGTH)
			if (
				!(await this.products.existsExternalProductSku({
					sku: candidate,
					excludeId,
					tx
				}))
			) {
				return candidate
			}
			suffix += 1
		}

		throw new BadRequestException(`Could not build unique product sku: ${base}`)
	}

	private async getStoredIntegration(
		catalogId: string
	): Promise<OneCIntegrationRecord> {
		const integration = await this.repo.findIntegration(catalogId)
		if (!integration) {
			throw new NotFoundException('ONE_C integration is not configured')
		}
		return integration
	}

	private async resolveMetadataForRequest(
		catalogId: string,
		dto: TestOneCConnectionDtoReq
	): Promise<OneCMetadata> {
		const existing = await this.repo.findIntegration(catalogId)
		const current = existing
			? this.metadataCrypto.parseStoredMetadata(existing.metadata)
			: null

		return this.metadataCrypto.parseStoredMetadata(
			this.metadataCrypto.buildStoredMetadata({
				apiKind: dto.apiKind ?? current?.apiKind ?? 'ODATA',
				authKind: dto.authKind ?? current?.authKind ?? 'BASIC',
				baseUrl: dto.baseUrl ?? current?.baseUrl,
				username: dto.username !== undefined ? dto.username : current?.username,
				password: dto.password !== undefined ? dto.password : current?.password,
				token: dto.token !== undefined ? dto.token : current?.token,
				timeoutMs: dto.timeoutMs ?? current?.timeoutMs,
				importProducts: dto.importProducts ?? current?.importProducts,
				syncStock: dto.syncStock ?? current?.syncStock,
				exportOrders: dto.exportOrders ?? current?.exportOrders,
				productSyncEntityMappingId:
					dto.productSyncEntityMappingId !== undefined
						? dto.productSyncEntityMappingId
						: current?.productSyncEntityMappingId,
				productSyncLimit: dto.productSyncLimit ?? current?.productSyncLimit,
				productSyncFilter:
					dto.productSyncFilter !== undefined
						? dto.productSyncFilter
						: current?.productSyncFilter,
				variantSyncEntityMappingId:
					dto.variantSyncEntityMappingId !== undefined
						? dto.variantSyncEntityMappingId
						: current?.variantSyncEntityMappingId,
				variantSyncLimit: dto.variantSyncLimit ?? current?.variantSyncLimit,
				variantSyncFilter:
					dto.variantSyncFilter !== undefined
						? dto.variantSyncFilter
						: current?.variantSyncFilter,
				stockSyncEntityMappingId:
					dto.stockSyncEntityMappingId !== undefined
						? dto.stockSyncEntityMappingId
						: current?.stockSyncEntityMappingId,
				stockSyncLimit: dto.stockSyncLimit ?? current?.stockSyncLimit,
				stockSyncFilter:
					dto.stockSyncFilter !== undefined
						? dto.stockSyncFilter
						: current?.stockSyncFilter,
				priceSyncEntityMappingId:
					dto.priceSyncEntityMappingId !== undefined
						? dto.priceSyncEntityMappingId
						: current?.priceSyncEntityMappingId,
				priceSyncLimit: dto.priceSyncLimit ?? current?.priceSyncLimit,
				priceSyncFilter:
					dto.priceSyncFilter !== undefined
						? dto.priceSyncFilter
						: current?.priceSyncFilter,
				scheduleEnabled: dto.scheduleEnabled ?? current?.scheduleEnabled,
				schedulePattern:
					dto.schedulePattern !== undefined
						? dto.schedulePattern
						: current?.schedulePattern,
				scheduleTimezone: dto.scheduleTimezone ?? current?.scheduleTimezone,
				stockScheduleEnabled:
					dto.stockScheduleEnabled ?? current?.stockScheduleEnabled,
				stockSchedulePattern:
					dto.stockSchedulePattern !== undefined
						? dto.stockSchedulePattern
						: current?.stockSchedulePattern,
				stockScheduleTimezone:
					dto.stockScheduleTimezone ?? current?.stockScheduleTimezone,
				priceScheduleEnabled:
					dto.priceScheduleEnabled ?? current?.priceScheduleEnabled,
				priceSchedulePattern:
					dto.priceSchedulePattern !== undefined
						? dto.priceSchedulePattern
						: current?.priceSchedulePattern,
				priceScheduleTimezone:
					dto.priceScheduleTimezone ?? current?.priceScheduleTimezone,
				lastDiscoveredAt: current?.lastDiscoveredAt ?? null
			})
		)
	}

	private async requireExternalObject(
		catalogId: string,
		id: string
	): Promise<OneCExternalObjectRecord> {
		const object = await this.repo.findExternalObjectForCatalog(catalogId, id)
		if (!object) {
			throw new NotFoundException('ONE_C external object not found')
		}
		return object
	}

	private async resolveProductSyncEntityMappingId(params: {
		catalogId: string
		requested?: string | null
		current?: string | null
		scheduleEnabled: boolean
	}): Promise<string | null> {
		const requested =
			params.requested === undefined
				? normalizeOptionalString(params.current)
				: normalizeOptionalString(params.requested)

		if (requested) {
			const mapping = await this.repo.findEntityMappingForCatalog(
				params.catalogId,
				requested
			)
			if (!mapping) {
				throw new NotFoundException('ONE_C product sync mapping not found')
			}
			if (mapping.localEntity !== IntegrationMappingLocalEntity.PRODUCT) {
				throw new BadRequestException(
					'ONE_C product sync mapping must target PRODUCT entity'
				)
			}
			if (params.scheduleEnabled && !mapping.isActive) {
				throw new BadRequestException(
					'ONE_C scheduled product sync mapping must be active'
				)
			}
			return mapping.id
		}

		if (!params.scheduleEnabled) return null

		const fallback = await this.repo.findRecommendedProductEntityMapping(
			params.catalogId
		)
		if (fallback) return fallback.id

		throw new BadRequestException(
			'For scheduled ONE_C product sync, create an active PRODUCT mapping or pass productSyncEntityMappingId'
		)
	}

	private async resolveVariantSyncEntityMappingId(params: {
		catalogId: string
		requested?: string | null
		current?: string | null
		autoResolve?: boolean
	}): Promise<string | null> {
		const explicitRequest = params.requested !== undefined
		const requested = !explicitRequest
			? normalizeOptionalString(params.current)
			: normalizeOptionalString(params.requested)

		if (!requested) {
			if (explicitRequest || !params.autoResolve) return null
			const fallback = await this.repo.findRecommendedVariantEntityMapping(
				params.catalogId
			)
			return fallback?.id ?? null
		}

		const mapping = await this.repo.findEntityMappingForCatalog(
			params.catalogId,
			requested
		)
		if (!mapping) {
			throw new NotFoundException('ONE_C variant sync mapping not found')
		}
		if (mapping.localEntity !== IntegrationMappingLocalEntity.PRODUCT_VARIANT) {
			throw new BadRequestException(
				'ONE_C variant sync mapping must target PRODUCT_VARIANT entity'
			)
		}

		return mapping.id
	}

	private async resolveStockSyncEntityMappingId(params: {
		catalogId: string
		requested?: string | null
		current?: string | null
		autoResolve?: boolean
		requireActive?: boolean
	}): Promise<string | null> {
		return this.resolveValueSyncEntityMappingId({
			...params,
			localEntity: IntegrationMappingLocalEntity.STOCK,
			label: 'stock',
			findFallback: catalogId =>
				this.repo.findRecommendedStockEntityMapping(catalogId)
		})
	}

	private async resolvePriceSyncEntityMappingId(params: {
		catalogId: string
		requested?: string | null
		current?: string | null
		autoResolve?: boolean
		requireActive?: boolean
	}): Promise<string | null> {
		return this.resolveValueSyncEntityMappingId({
			...params,
			localEntity: IntegrationMappingLocalEntity.PRICE,
			label: 'price',
			findFallback: catalogId =>
				this.repo.findRecommendedPriceEntityMapping(catalogId)
		})
	}

	private async resolveValueSyncEntityMappingId(params: {
		catalogId: string
		requested?: string | null
		current?: string | null
		autoResolve?: boolean
		requireActive?: boolean
		localEntity: IntegrationMappingLocalEntity
		label: string
		findFallback: (catalogId: string) => Promise<OneCEntityMappingRecord | null>
	}): Promise<string | null> {
		const explicitRequest = params.requested !== undefined
		const requested = !explicitRequest
			? normalizeOptionalString(params.current)
			: normalizeOptionalString(params.requested)

		if (!requested) {
			if (explicitRequest || !params.autoResolve) return null
			const fallback = await params.findFallback(params.catalogId)
			return fallback?.id ?? null
		}

		const mapping = await this.repo.findEntityMappingForCatalog(
			params.catalogId,
			requested
		)
		if (!mapping) {
			throw new NotFoundException(`ONE_C ${params.label} sync mapping not found`)
		}
		if (mapping.localEntity !== params.localEntity) {
			throw new BadRequestException(
				`ONE_C ${params.label} sync mapping must target ${params.localEntity} entity`
			)
		}
		if (params.requireActive && !mapping.isActive) {
			throw new BadRequestException(
				`ONE_C scheduled ${params.label} sync mapping must be active`
			)
		}

		return mapping.id
	}

	private resolveStockSyncRunDto(
		dto: RunOneCStockSyncDtoReq,
		integration: OneCIntegrationRecord
	): ApplyOneCStockSyncDtoReq {
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		const entityMappingId =
			normalizeOptionalString(dto.entityMappingId) ??
			metadata.stockSyncEntityMappingId
		if (!entityMappingId) {
			throw new BadRequestException(
				'ONE_C stock sync requires entityMappingId or configured stockSyncEntityMappingId'
			)
		}

		return {
			entityMappingId,
			limit: dto.limit ?? metadata.stockSyncLimit,
			filter: dto.filter !== undefined ? dto.filter : metadata.stockSyncFilter,
			includeRaw: dto.includeRaw,
			failOnRowError: dto.failOnRowError
		}
	}

	private resolvePriceSyncRunDto(
		dto: RunOneCPriceSyncDtoReq,
		integration: OneCIntegrationRecord
	): ApplyOneCPriceSyncDtoReq {
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		const entityMappingId =
			normalizeOptionalString(dto.entityMappingId) ??
			metadata.priceSyncEntityMappingId
		if (!entityMappingId) {
			throw new BadRequestException(
				'ONE_C price sync requires entityMappingId or configured priceSyncEntityMappingId'
			)
		}

		return {
			entityMappingId,
			limit: dto.limit ?? metadata.priceSyncLimit,
			filter: dto.filter !== undefined ? dto.filter : metadata.priceSyncFilter,
			includeRaw: dto.includeRaw,
			failOnRowError: dto.failOnRowError
		}
	}

	private assertLocalPathAllowed(
		localEntity: IntegrationMappingLocalEntity,
		localPath: string
	): void {
		const normalized = normalizeRequiredString(localPath, 'localPath')
		const rules = LOCAL_PATH_RULES[localEntity]
		if (!rules) {
			throw new BadRequestException(`Unsupported local entity: ${localEntity}`)
		}
		if (rules.exact.includes(normalized)) return
		if (rules.prefixes?.some(prefix => normalized.startsWith(prefix))) return

		throw new BadRequestException(
			`localPath "${normalized}" is not allowed for ${localEntity}`
		)
	}

	private applyFieldTransform(
		field: OneCFieldMappingRecord,
		value: unknown
	): { value: unknown; error: string | null } {
		try {
			const transformed = applyTransform(value, field.transform)
			return {
				value: coerceValue(transformed, field.dataType),
				error: null
			}
		} catch (error) {
			return {
				value: null,
				error: renderSafeProviderErrorMessage(error)
			}
		}
	}

	private previewPayload(
		mapping: OneCEntityMappingRecord,
		payload: Record<string, unknown>
	): MappingPreviewResult {
		const result: Record<string, unknown> = {}
		const items = mapping.fieldMappings
			.filter(
				field =>
					field.isActive && field.direction !== IntegrationMappingDirection.EXPORT
			)
			.map(field => {
				const externalValue = readPath(payload, field.externalPath)
				const missing =
					externalValue === undefined ||
					externalValue === null ||
					externalValue === ''
				const valueWithDefault =
					missing && field.defaultValue !== undefined
						? field.defaultValue
						: externalValue
				const transformed = this.applyFieldTransform(field, valueWithDefault)
				const error =
					field.isRequired &&
					(transformed.value === undefined ||
						transformed.value === null ||
						transformed.value === '')
						? 'Required value is missing'
						: transformed.error

				if (!error && transformed.value !== undefined) {
					setPath(result, field.localPath, transformed.value)
				}

				return {
					fieldMappingId: field.id,
					localPath: field.localPath,
					externalPath: field.externalPath,
					dataType: field.dataType,
					externalValue: externalValue ?? null,
					mappedValue: transformed.value ?? null,
					missing,
					error
				}
			})

		return {
			items,
			errors: items.flatMap(item => (item.error ? [item.error] : [])),
			result
		}
	}

	private buildRemotePreviewSelect(mapping: OneCEntityMappingRecord): string[] {
		return [
			mapping.identityField,
			...mapping.fieldMappings
				.filter(
					field =>
						field.isActive && field.direction !== IntegrationMappingDirection.EXPORT
				)
				.map(field => field.externalPath)
		]
	}

	private mapIntegration(
		integration: OneCIntegrationRecord
	): OneCIntegrationDto {
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)

		return {
			provider: integration.provider,
			capabilities: getIntegrationProviderCapabilities(integration.provider),
			isActive: integration.isActive,
			apiKind: metadata.apiKind,
			authKind: metadata.authKind,
			baseUrl: metadata.baseUrl,
			username: metadata.username,
			hasPassword: Boolean(metadata.password),
			hasToken: Boolean(metadata.token),
			tokenPreview: maskOneCSecret(metadata.token),
			timeoutMs: metadata.timeoutMs,
			importProducts: metadata.importProducts,
			syncStock: metadata.syncStock,
			exportOrders: metadata.exportOrders,
			productSyncEntityMappingId: metadata.productSyncEntityMappingId,
			productSyncLimit: metadata.productSyncLimit,
			productSyncFilter: metadata.productSyncFilter,
			variantSyncEntityMappingId: metadata.variantSyncEntityMappingId,
			variantSyncLimit: metadata.variantSyncLimit,
			variantSyncFilter: metadata.variantSyncFilter,
			stockSyncEntityMappingId: metadata.stockSyncEntityMappingId,
			stockSyncLimit: metadata.stockSyncLimit,
			stockSyncFilter: metadata.stockSyncFilter,
			priceSyncEntityMappingId: metadata.priceSyncEntityMappingId,
			priceSyncLimit: metadata.priceSyncLimit,
			priceSyncFilter: metadata.priceSyncFilter,
			scheduleEnabled: metadata.scheduleEnabled,
			schedulePattern: metadata.schedulePattern,
			scheduleTimezone: metadata.scheduleTimezone,
			stockScheduleEnabled: metadata.stockScheduleEnabled,
			stockSchedulePattern: metadata.stockSchedulePattern,
			stockScheduleTimezone: metadata.stockScheduleTimezone,
			priceScheduleEnabled: metadata.priceScheduleEnabled,
			priceSchedulePattern: metadata.priceSchedulePattern,
			priceScheduleTimezone: metadata.priceScheduleTimezone,
			lastSyncStatus: integration.lastSyncStatus,
			syncStartedAt: integration.syncStartedAt,
			lastSyncAt: integration.lastSyncAt,
			lastDiscoveredAt: metadata.lastDiscoveredAt,
			lastSyncError: integration.lastSyncError
				? renderSafeProviderErrorMessage(integration.lastSyncError)
				: null,
			totalProducts: integration.totalProducts,
			createdProducts: integration.createdProducts,
			updatedProducts: integration.updatedProducts,
			deletedProducts: integration.deletedProducts,
			createdAt: integration.createdAt,
			updatedAt: integration.updatedAt
		}
	}

	private mapSyncRun(run: OneCSyncRunRecord): OneCSyncRunDto {
		const metadata = this.readSyncMetadata(run)

		return {
			id: run.id,
			provider: run.provider,
			mode: run.mode,
			trigger: run.trigger,
			status: run.status,
			snapshotCompleteness: run.snapshotCompleteness,
			jobId: run.jobId,
			productId: run.productId,
			externalId: run.externalId,
			error: run.error ? renderSafeProviderErrorMessage(run.error) : null,
			totalProducts: run.totalProducts,
			createdProducts: run.createdProducts,
			updatedProducts: run.updatedProducts,
			deletedProducts: run.deletedProducts,
			imagesImported: run.imagesImported,
			skippedProducts: metadata.products.skipped,
			failedProducts: metadata.products.failed,
			progress: this.mapSyncRunProgress(run, metadata.progress),
			durationMs: run.durationMs,
			requestedAt: run.requestedAt,
			startedAt: run.startedAt,
			finishedAt: run.finishedAt,
			createdAt: run.createdAt,
			updatedAt: run.updatedAt
		}
	}

	private mapSyncRunProgress(
		run: OneCSyncRunRecord,
		progress: OneCSyncProgress | null
	): OneCSyncProgressDto {
		const resolved = progress ?? this.buildFallbackSyncProgress(run)

		return {
			runId: run.id,
			status: run.status,
			phase: resolved.phase,
			message: resolved.message,
			processed: resolved.processed,
			total: resolved.total,
			percent: resolved.percent,
			updatedAt: resolved.updatedAt,
			startedAt: run.startedAt,
			finishedAt: run.finishedAt
		}
	}

	private readSyncMetadata(run: OneCSyncRunRecord): OneCSyncMetadata {
		const metadata = isRecord(run.metadata) ? run.metadata : {}
		const products = isRecord(metadata.products) ? metadata.products : {}

		return {
			products: {
				total: readNonNegativeInteger(products.total) ?? run.totalProducts,
				created: readNonNegativeInteger(products.created) ?? run.createdProducts,
				updated: readNonNegativeInteger(products.updated) ?? run.updatedProducts,
				deleted: readNonNegativeInteger(products.deleted) ?? run.deletedProducts,
				skipped: readNonNegativeInteger(products.skipped) ?? 0,
				failed: readNonNegativeInteger(products.failed) ?? 0
			},
			warnings: this.readSyncIssues(metadata.warnings),
			errors: this.readSyncIssues(metadata.errors),
			progress: this.readSyncProgress(metadata.progress)
		}
	}

	private readSyncIssues(
		value: unknown
	): Array<{ code: string; message: string; externalId: string | null }> {
		if (!Array.isArray(value)) return []

		return value.flatMap(item => {
			if (!isRecord(item)) return []
			const message = normalizeIdentityValue(item.message)
			if (!message) return []

			return [
				{
					code: normalizeIdentityValue(item.code) ?? 'ONE_C_SYNC_ISSUE',
					message: renderSafeProviderErrorMessage(message),
					externalId: normalizeIdentityValue(item.externalId)
				}
			]
		})
	}

	private readSyncProgress(value: unknown): OneCSyncProgress | null {
		if (!isRecord(value)) return null
		const phase = normalizeIdentityValue(value.phase)
		const message = normalizeIdentityValue(value.message)
		if (!phase || !message) return null

		return {
			phase,
			message: renderSafeProviderErrorMessage(message),
			processed: readNonNegativeInteger(value.processed) ?? 0,
			total:
				value.total === null ? null : (readNonNegativeInteger(value.total) ?? null),
			percent:
				value.percent === null
					? null
					: clampPercent(readNonNegativeInteger(value.percent)),
			updatedAt:
				normalizeIdentityValue(value.updatedAt) ?? new Date().toISOString()
		}
	}

	private buildInitialSyncMetadata(
		message: string,
		now: Date
	): OneCSyncMetadata {
		return {
			products: {
				total: 0,
				created: 0,
				updated: 0,
				deleted: 0,
				skipped: 0,
				failed: 0
			},
			warnings: [],
			errors: [],
			progress: {
				phase: 'RUNNING',
				message,
				processed: 0,
				total: null,
				percent: null,
				updatedAt: now.toISOString()
			}
		}
	}

	private buildProductSyncMetadata(
		result: OneCProductImportResultDto,
		status: IntegrationSyncRunStatus,
		now: Date
	): OneCSyncMetadata {
		const failedRows = result.rows.filter(row => row.status === 'FAILED')
		const message =
			status === IntegrationSyncRunStatus.SUCCESS
				? 'ONE_C product sync completed'
				: `ONE_C product sync completed with ${failedRows.length} failed row(s)`

		return {
			products: {
				total: result.counters.total,
				created: result.counters.created,
				updated: result.counters.updated,
				deleted: 0,
				skipped: result.counters.skipped,
				failed: result.counters.failed
			},
			warnings: [],
			errors: failedRows.flatMap(row =>
				row.errors.map(message => ({
					code: 'ONE_C_PRODUCT_ROW_FAILED',
					message: renderSafeProviderErrorMessage(message),
					externalId: row.externalIdentity
				}))
			),
			progress: {
				phase: status === IntegrationSyncRunStatus.SUCCESS ? 'COMPLETED' : 'FAILED',
				message,
				processed: result.counters.total,
				total: result.counters.total,
				percent: 100,
				updatedAt: now.toISOString()
			}
		}
	}

	private buildVariantSyncMetadata(
		result: OneCVariantImportResultDto,
		status: IntegrationSyncRunStatus,
		now: Date
	): OneCSyncMetadata {
		const failedRows = result.rows.filter(row => row.status === 'FAILED')
		const message =
			status === IntegrationSyncRunStatus.SUCCESS
				? 'ONE_C variant sync completed'
				: `ONE_C variant sync completed with ${failedRows.length} failed row(s)`

		return {
			products: {
				total: result.counters.total,
				created: result.counters.created,
				updated: result.counters.updated,
				deleted: 0,
				skipped: result.counters.skipped,
				failed: result.counters.failed
			},
			warnings: [],
			errors: failedRows.flatMap(row =>
				row.errors.map(message => ({
					code: 'ONE_C_VARIANT_ROW_FAILED',
					message: renderSafeProviderErrorMessage(message),
					externalId: row.externalIdentity
				}))
			),
			progress: {
				phase: status === IntegrationSyncRunStatus.SUCCESS ? 'COMPLETED' : 'FAILED',
				message,
				processed: result.counters.total,
				total: result.counters.total,
				percent: 100,
				updatedAt: now.toISOString()
			}
		}
	}

	private buildStockSyncMetadata(
		result: OneCStockSyncResultDto,
		status: IntegrationSyncRunStatus,
		now: Date
	): OneCSyncMetadata {
		const failedRows = result.rows.filter(row => row.status === 'FAILED')
		const message =
			status === IntegrationSyncRunStatus.SUCCESS
				? 'ONE_C stock sync completed'
				: `ONE_C stock sync completed with ${failedRows.length} failed row(s)`

		return {
			products: {
				total: result.counters.total,
				created: 0,
				updated: result.counters.updated,
				deleted: 0,
				skipped: result.counters.skipped,
				failed: result.counters.failed
			},
			warnings: [],
			errors: failedRows.flatMap(row =>
				row.errors.map(message => ({
					code: 'ONE_C_STOCK_ROW_FAILED',
					message: renderSafeProviderErrorMessage(message),
					externalId: row.externalIdentity
				}))
			),
			progress: {
				phase: status === IntegrationSyncRunStatus.SUCCESS ? 'COMPLETED' : 'FAILED',
				message,
				processed: result.counters.total,
				total: result.counters.total,
				percent: 100,
				updatedAt: now.toISOString()
			}
		}
	}

	private buildPriceSyncMetadata(
		result: OneCPriceSyncResultDto,
		status: IntegrationSyncRunStatus,
		now: Date
	): OneCSyncMetadata {
		const failedRows = result.rows.filter(row => row.status === 'FAILED')
		const message =
			status === IntegrationSyncRunStatus.SUCCESS
				? 'ONE_C price sync completed'
				: `ONE_C price sync completed with ${failedRows.length} failed row(s)`

		return {
			products: {
				total: result.counters.total,
				created: 0,
				updated: result.counters.updated,
				deleted: 0,
				skipped: result.counters.skipped,
				failed: result.counters.failed
			},
			warnings: [],
			errors: failedRows.flatMap(row =>
				row.errors.map(message => ({
					code: 'ONE_C_PRICE_ROW_FAILED',
					message: renderSafeProviderErrorMessage(message),
					externalId: row.externalIdentity
				}))
			),
			progress: {
				phase: status === IntegrationSyncRunStatus.SUCCESS ? 'COMPLETED' : 'FAILED',
				message,
				processed: result.counters.total,
				total: result.counters.total,
				percent: 100,
				updatedAt: now.toISOString()
			}
		}
	}

	private buildFailedSyncMetadata(
		message: string,
		now: Date,
		code = 'ONE_C_PRODUCT_SYNC_FAILED'
	): OneCSyncMetadata {
		return {
			products: {
				total: 0,
				created: 0,
				updated: 0,
				deleted: 0,
				skipped: 0,
				failed: 0
			},
			warnings: [],
			errors: [
				{
					code,
					message,
					externalId: null
				}
			],
			progress: {
				phase: 'FAILED',
				message,
				processed: 0,
				total: null,
				percent: null,
				updatedAt: now.toISOString()
			}
		}
	}

	private buildFallbackSyncProgress(run: OneCSyncRunRecord): OneCSyncProgress {
		const updatedAt = run.updatedAt.toISOString()
		const subject =
			run.mode === IntegrationSyncRunMode.PRICE
				? 'price'
				: run.mode === IntegrationSyncRunMode.STOCK
					? 'stock'
					: run.mode === IntegrationSyncRunMode.VARIANT
						? 'variant'
						: 'product'

		if (run.status === IntegrationSyncRunStatus.SUCCESS) {
			return {
				phase: 'COMPLETED',
				message: `ONE_C ${subject} sync completed`,
				processed: run.totalProducts,
				total: run.totalProducts,
				percent: 100,
				updatedAt
			}
		}

		if (run.status === IntegrationSyncRunStatus.ERROR) {
			return {
				phase: 'FAILED',
				message: run.error
					? renderSafeProviderErrorMessage(run.error)
					: `ONE_C ${subject} sync failed`,
				processed: 0,
				total: null,
				percent: null,
				updatedAt
			}
		}

		if (run.status === IntegrationSyncRunStatus.SKIPPED) {
			return {
				phase: 'FAILED',
				message: `ONE_C ${subject} sync skipped`,
				processed: 0,
				total: null,
				percent: null,
				updatedAt
			}
		}

		return {
			phase:
				run.status === IntegrationSyncRunStatus.PENDING ? 'QUEUED' : 'RUNNING',
			message:
				run.status === IntegrationSyncRunStatus.PENDING
					? `ONE_C ${subject} sync is queued`
					: `ONE_C ${subject} sync is running`,
			processed: 0,
			total: null,
			percent: null,
			updatedAt
		}
	}

	private mapExternalObject(
		object: OneCExternalObjectRecord
	): OneCExternalObjectDto {
		return {
			id: object.id,
			code: object.code,
			name: object.name,
			kind: object.kind,
			endpoint: object.endpoint,
			method: object.method,
			schema: object.schema,
			sample: object.sample,
			isActive: object.isActive,
			lastDiscoveredAt: object.lastDiscoveredAt,
			createdAt: object.createdAt,
			updatedAt: object.updatedAt
		}
	}

	private mapEntityMapping(
		mapping: OneCEntityMappingRecord
	): OneCEntityMappingDto {
		return {
			id: mapping.id,
			localEntity: mapping.localEntity,
			externalObjectId: mapping.externalObjectId,
			externalObjectCode: mapping.externalObjectCode,
			identityField: mapping.identityField,
			direction: mapping.direction,
			conflictPolicy: mapping.conflictPolicy,
			filters: mapping.filters,
			options: mapping.options,
			isActive: mapping.isActive,
			externalObject: mapping.externalObject
				? this.mapExternalObject(mapping.externalObject)
				: null,
			fieldMappings: mapping.fieldMappings.map(field =>
				this.mapFieldMapping(field)
			),
			createdAt: mapping.createdAt,
			updatedAt: mapping.updatedAt
		}
	}

	private mapFieldMapping(field: OneCFieldMappingRecord): OneCFieldMappingDto {
		return {
			id: field.id,
			entityMappingId: field.entityMappingId,
			localPath: field.localPath,
			externalPath: field.externalPath,
			direction: field.direction,
			dataType: field.dataType,
			transform: field.transform,
			defaultValue: field.defaultValue,
			isRequired: field.isRequired,
			isActive: field.isActive,
			displayOrder: field.displayOrder,
			createdAt: field.createdAt,
			updatedAt: field.updatedAt
		}
	}

	private optionalJson(value: unknown): Prisma.InputJsonValue | undefined {
		if (value === undefined) return undefined
		return this.toPrismaJson(value)
	}

	private toPrismaJson(value: unknown): Prisma.InputJsonValue {
		return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue
	}

	private assertHasIntegrationUpdateFields(
		dto: UpdateOneCIntegrationDtoReq
	): void {
		if (
			dto.apiKind === undefined &&
			dto.authKind === undefined &&
			dto.baseUrl === undefined &&
			dto.username === undefined &&
			dto.password === undefined &&
			dto.token === undefined &&
			dto.timeoutMs === undefined &&
			dto.isActive === undefined &&
			dto.importProducts === undefined &&
			dto.syncStock === undefined &&
			dto.exportOrders === undefined &&
			dto.productSyncEntityMappingId === undefined &&
			dto.productSyncLimit === undefined &&
			dto.productSyncFilter === undefined &&
			dto.variantSyncEntityMappingId === undefined &&
			dto.variantSyncLimit === undefined &&
			dto.variantSyncFilter === undefined &&
			dto.stockSyncEntityMappingId === undefined &&
			dto.stockSyncLimit === undefined &&
			dto.stockSyncFilter === undefined &&
			dto.priceSyncEntityMappingId === undefined &&
			dto.priceSyncLimit === undefined &&
			dto.priceSyncFilter === undefined &&
			dto.scheduleEnabled === undefined &&
			dto.schedulePattern === undefined &&
			dto.scheduleTimezone === undefined &&
			dto.stockScheduleEnabled === undefined &&
			dto.stockSchedulePattern === undefined &&
			dto.stockScheduleTimezone === undefined &&
			dto.priceScheduleEnabled === undefined &&
			dto.priceSchedulePattern === undefined &&
			dto.priceScheduleTimezone === undefined
		) {
			throw new BadRequestException('No ONE_C fields provided for update')
		}
	}
}

function normalizeOptionalString(value?: string | null): string | null {
	const normalized = typeof value === 'string' ? value.trim() : ''
	return normalized || null
}

function normalizeRunsLimit(value?: number | string): number {
	const parsed =
		typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number(value)
				: 20
	if (!Number.isFinite(parsed)) return 20
	return Math.min(100, Math.max(1, Math.trunc(parsed)))
}

function readNonNegativeInteger(value: unknown): number | undefined {
	const number = Number(value)
	if (!Number.isFinite(number)) return undefined
	return Math.max(0, Math.trunc(number))
}

function clampPercent(value: number | undefined): number | null {
	if (value === undefined) return null
	return Math.min(100, Math.max(0, value))
}

function readNullableNumber(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null
	const number =
		typeof value === 'string' ? Number(value.replace(',', '.')) : Number(value)
	return Number.isFinite(number) ? number : null
}

function readOptionalBoolean(value: unknown): boolean | undefined {
	if (value === null || value === undefined || value === '') return undefined
	return toBoolean(value)
}

function readOptionalInteger(value: unknown): number | undefined {
	const number = readNullableNumber(value)
	return number === null ? undefined : Math.trunc(number)
}

function buildSlugBase(value: string): string {
	const slug = slugify(value, { lower: true, strict: true })
		.trim()
		.slice(0, PRODUCT_SLUG_MAX_LENGTH)
	return slug || 'product'
}

function appendUniqueSuffix(
	base: string,
	suffix: number,
	maxLength: number
): string {
	if (suffix <= 0) return base.slice(0, maxLength)

	const postfix = `-${suffix}`
	return `${base.slice(0, maxLength - postfix.length)}${postfix}`
}

function resolveProductImportAction(params: {
	errors: string[]
	product?: OneCProductPreviewRecord | null
	changes: Array<{ field: string; currentValue: unknown; nextValue: unknown }>
}): ProductImportPreviewAction {
	if (params.errors.length) return 'ERROR'
	if (!params.product) return 'CREATE'
	return params.changes.length ? 'UPDATE' : 'SKIP'
}

function validateProductCreatePayload(
	payload: Record<string, unknown>
): string[] {
	const errors: string[] = []
	if (!normalizeIdentityValue(payload.name)) {
		errors.push('Mapped product name is required for create')
	}
	if (!normalizeIdentityValue(payload.sku)) {
		errors.push('Mapped product sku is required for create')
	}
	return errors
}

function buildProductCreateChanges(
	payload: Record<string, unknown>
): Array<{ field: string; currentValue: unknown; nextValue: unknown }> {
	return PRODUCT_IMPORT_COMPARABLE_FIELDS.flatMap(field => {
		if (!Object.prototype.hasOwnProperty.call(payload, field)) return []
		const nextValue = normalizeProductComparableValue(field, payload[field])
		if (nextValue === undefined) return []
		return [{ field, currentValue: null, nextValue }]
	})
}

function buildProductChanges(
	product: OneCProductPreviewRecord,
	payload: Record<string, unknown>
): Array<{ field: string; currentValue: unknown; nextValue: unknown }> {
	return PRODUCT_IMPORT_COMPARABLE_FIELDS.flatMap(field => {
		if (!Object.prototype.hasOwnProperty.call(payload, field)) return []

		const currentValue = normalizeProductComparableValue(field, product[field])
		const nextValue = normalizeProductComparableValue(field, payload[field])
		if (currentValue === nextValue) return []

		return [{ field, currentValue, nextValue }]
	})
}

function normalizeProductComparableValue(
	field: (typeof PRODUCT_IMPORT_COMPARABLE_FIELDS)[number],
	value: unknown
): unknown {
	if (value === undefined) return undefined
	if (value === null || value === '') return null

	if (field === 'price') {
		return readNullableNumber(value)
	}
	if (field === 'isPopular') return Boolean(value)
	if (field === 'position') {
		const number = Number(value)
		return Number.isFinite(number) ? Math.trunc(number) : null
	}

	return normalizeIdentityValue(value)
}

type OneCVariantAttributeValueInput = {
	attributeId: string
	value: string
	displayName?: string | null
}

type OneCVariantMappedRowIdentity = {
	externalIdentity: string | null
	productId: string | null
	productExternalId: string | null
	productSku: string | null
}

function buildProductVariantKey(productId: string, variantKey: string): string {
	return `${productId}:${variantKey}`
}

function resolveVariantImportAction(params: {
	errors: string[]
	variant?: OneCVariantPreviewRecord | null
	changes: Array<{ field: string; currentValue: unknown; nextValue: unknown }>
}): VariantImportPreviewAction {
	if (params.errors.length) return 'ERROR'
	if (!params.variant) return 'CREATE'
	return params.changes.length ? 'UPDATE' : 'SKIP'
}

function validateVariantImportResolution(
	row: OneCVariantMappedRowIdentity,
	product?: OneCProductPreviewRecord | null
): string[] {
	const errors: string[] = []
	if (!row.externalIdentity) {
		errors.push('External identity is missing')
	}
	if (row.productId && product?.id !== row.productId) {
		errors.push('Mapped parent productId was not found')
	}
	if (!product) {
		errors.push(
			'Mapped parent product is required; map productId, productExternalId or productSku'
		)
	}
	return errors
}

function validateVariantCreatePayload(
	payload: Record<string, unknown>,
	product: OneCProductPreviewRecord | null,
	attributes: OneCVariantAttributeValueInput[]
): string[] {
	const errors: string[] = []
	if (!product) {
		return errors
	}
	if (!normalizeIdentityValue(payload.sku)) {
		errors.push('Mapped variant sku is required for create')
	}
	if (!attributes.length) {
		errors.push(
			'Mapped variant attributes are required for create; map attributes.<attributeId>'
		)
	}
	return errors
}

function validateVariantPayload(payload: Record<string, unknown>): string[] {
	const errors: string[] = []
	if (
		Object.prototype.hasOwnProperty.call(payload, 'stock') &&
		readNullableNumber(payload.stock) === null
	) {
		errors.push('Mapped variant stock must be a number')
	}
	if (
		Object.prototype.hasOwnProperty.call(payload, 'price') &&
		payload.price !== null &&
		payload.price !== '' &&
		readNullableNumber(payload.price) === null
	) {
		errors.push('Mapped variant price must be a number')
	}
	const status = normalizeIdentityValue(payload.status)
	if (status && !isProductVariantStatus(status)) {
		errors.push(`Mapped variant status is unsupported: ${status}`)
	}
	return errors
}

function buildVariantCreateChanges(
	payload: Record<string, unknown>,
	attributes: OneCVariantAttributeValueInput[]
): Array<{ field: string; currentValue: unknown; nextValue: unknown }> {
	const changes: Array<{
		field: string
		currentValue: unknown
		nextValue: unknown
	}> = []

	for (const field of VARIANT_IMPORT_COMPARABLE_FIELDS) {
		if (!Object.prototype.hasOwnProperty.call(payload, field)) continue
		const nextValue = normalizeVariantComparableValue(field, payload[field])
		if (nextValue === undefined) continue
		changes.push({ field, currentValue: null, nextValue })
	}
	if (
		!Object.prototype.hasOwnProperty.call(payload, 'variantKey') &&
		attributes.length
	) {
		changes.push({
			field: 'variantKey',
			currentValue: null,
			nextValue: buildVariantKeyFromAttributes(attributes)
		})
	}
	if (attributes.length) {
		changes.push({
			field: 'attributes',
			currentValue: null,
			nextValue: attributes
		})
	}
	return changes
}

function buildVariantChanges(
	variant: OneCVariantPreviewRecord,
	payload: Record<string, unknown>,
	syncContent: boolean
): Array<{ field: string; currentValue: unknown; nextValue: unknown }> {
	const changes: Array<{
		field: string
		currentValue: unknown
		nextValue: unknown
	}> = []

	for (const field of VARIANT_IMPORT_COMPARABLE_FIELDS) {
		if (!Object.prototype.hasOwnProperty.call(payload, field)) continue
		if (!syncContent && (field === 'sku' || field === 'variantKey')) continue

		const currentValue = normalizeVariantComparableValue(field, variant[field])
		const nextValue =
			field === 'status'
				? resolveMappedVariantStatus(payload, readVariantStock(payload))
				: normalizeVariantComparableValue(field, payload[field])
		if (currentValue === nextValue) continue

		changes.push({ field, currentValue, nextValue })
	}

	return changes
}

function normalizeVariantComparableValue(
	field: (typeof VARIANT_IMPORT_COMPARABLE_FIELDS)[number],
	value: unknown
): unknown {
	if (value === undefined) return undefined
	if (value === null || value === '') return null

	if (field === 'price') return readNullableNumber(value)
	if (field === 'stock') {
		const stock = readNullableNumber(value)
		return stock === null ? null : Math.max(0, Math.trunc(stock))
	}
	if (field === 'isAvailable') return toBoolean(value)
	if (field === 'status') {
		const status = normalizeIdentityValue(value)
		return status && isProductVariantStatus(status) ? status : null
	}

	return normalizeIdentityValue(value)
}

function readVariantAttributes(
	payload: Record<string, unknown>
): OneCVariantAttributeValueInput[] {
	if (!isRecord(payload.attributes)) return []

	return Object.entries(payload.attributes).flatMap(([attributeId, raw]) => {
		const normalizedAttributeId = attributeId.trim()
		if (!normalizedAttributeId) return []

		const value = isRecord(raw)
			? normalizeIdentityValue(raw.value)
			: normalizeIdentityValue(raw)
		if (!value) return []

		const displayName = isRecord(raw)
			? (normalizeIdentityValue(raw.displayName) ??
				normalizeIdentityValue(raw.name) ??
				value)
			: value

		return [
			{
				attributeId: normalizedAttributeId,
				value,
				displayName
			}
		]
	})
}

function readVariantStock(payload: Record<string, unknown>): number {
	const stock = readNullableNumber(payload.stock)
	if (stock === null) return 0
	return Math.max(0, Math.trunc(stock))
}

function resolveMappedVariantStatus(
	payload: Record<string, unknown>,
	stock: number
): ProductVariantStatus {
	const status = normalizeIdentityValue(payload.status)
	if (status && isProductVariantStatus(status)) {
		return status
	}

	const isAvailable = Object.prototype.hasOwnProperty.call(
		payload,
		'isAvailable'
	)
		? readOptionalBoolean(payload.isAvailable)
		: undefined
	if (isAvailable === false) return ProductVariantStatus.DISABLED
	return stock > 0
		? ProductVariantStatus.ACTIVE
		: ProductVariantStatus.OUT_OF_STOCK
}

function isProductVariantStatus(value: string): value is ProductVariantStatus {
	return Object.values(ProductVariantStatus).includes(
		value as ProductVariantStatus
	)
}

function resolveVariantSku(
	payload: Record<string, unknown>,
	externalId: string
): string {
	const raw = normalizeIdentityValue(payload.sku) ?? `ONE-C-${externalId}`
	const normalized = raw
		.trim()
		.replace(/\s+/g, '-')
		.slice(0, VARIANT_SKU_MAX_LENGTH)
	return normalized || `ONE-C-${externalId}`.slice(0, VARIANT_SKU_MAX_LENGTH)
}

function resolveVariantKey(
	payload: Record<string, unknown>,
	attributes: OneCVariantAttributeValueInput[],
	externalId: string
): string {
	const explicit = normalizeIdentityValue(payload.variantKey)
	if (explicit) return explicit

	const fromAttributes = buildVariantKeyFromAttributes(attributes)
	return fromAttributes || `one_c=${externalId}`
}

function buildVariantKeyFromAttributes(
	attributes: OneCVariantAttributeValueInput[]
): string {
	return attributes
		.map(attribute => `${attribute.attributeId}=${attribute.value}`)
		.sort((left, right) => left.localeCompare(right))
		.join(';')
}

type OneCValueSyncMappedRow = {
	externalIdentity: string | null
	productId: string | null
	productExternalId: string | null
	productSku: string | null
	variantId: string | null
	variantExternalId: string | null
	variantSku: string | null
	preview: { result: Record<string, unknown>; errors: string[] }
}

type OneCValueSyncTarget = {
	targetKind: ValueSyncTargetKind
	matchBy: ValueSyncMatchBy
	productId: string
	productName: string | null
	productSku: string | null
	variantId: string | null
	variantSku: string | null
	variantKey: string | null
	currentStock: number | null
	currentPrice: number | null
}

type OneCValueSyncNextValue = {
	present: boolean
	value: number | null
	error: string | null
}

function resolveValueSyncTarget(params: {
	mappedRow: OneCValueSyncMappedRow
	productLinksByExternalId: Map<string, OneCProductStockLinkPreviewRecord>
	variantLinksByExternalId: Map<string, OneCVariantLinkPreviewRecord>
	productsById: Map<string, OneCProductStockPreviewRecord>
	productsBySku: Map<string, OneCProductStockPreviewRecord>
	variantsById: Map<string, OneCVariantPreviewRecord>
	variantsBySku: Map<string, OneCVariantPreviewRecord>
}): OneCValueSyncTarget | null {
	const row = params.mappedRow
	const variantLink =
		(row.variantExternalId
			? params.variantLinksByExternalId.get(row.variantExternalId)
			: null) ??
		(row.externalIdentity
			? params.variantLinksByExternalId.get(row.externalIdentity)
			: null)
	if (variantLink) {
		return buildVariantValueSyncTarget(variantLink.variant, 'externalId')
	}

	const variant =
		(row.variantId ? params.variantsById.get(row.variantId) : null) ??
		(row.variantSku ? params.variantsBySku.get(row.variantSku) : null)
	if (variant) {
		return buildVariantValueSyncTarget(variant, row.variantId ? 'id' : 'sku')
	}

	const productLink =
		(row.productExternalId
			? params.productLinksByExternalId.get(row.productExternalId)
			: null) ??
		(row.externalIdentity
			? params.productLinksByExternalId.get(row.externalIdentity)
			: null)
	if (productLink) {
		return buildProductValueSyncTarget(productLink.product, 'externalId')
	}

	const product =
		(row.productId ? params.productsById.get(row.productId) : null) ??
		(row.productSku ? params.productsBySku.get(row.productSku) : null)
	if (product) {
		return buildProductValueSyncTarget(product, row.productId ? 'id' : 'sku')
	}

	return null
}

function buildVariantValueSyncTarget(
	variant: OneCVariantPreviewRecord,
	matchBy: ValueSyncMatchBy
): OneCValueSyncTarget {
	return {
		targetKind: 'variant',
		matchBy,
		productId: variant.productId,
		productName: variant.product.name,
		productSku: variant.product.sku,
		variantId: variant.id,
		variantSku: variant.sku,
		variantKey: variant.variantKey,
		currentStock: variant.stock,
		currentPrice: normalizeComparableNumber(variant.price)
	}
}

function buildProductValueSyncTarget(
	product: OneCProductStockPreviewRecord,
	matchBy: ValueSyncMatchBy
): OneCValueSyncTarget {
	const defaultVariant = product.variants[0] ?? null
	return {
		targetKind: 'product',
		matchBy,
		productId: product.id,
		productName: product.name,
		productSku: product.sku,
		variantId: defaultVariant?.id ?? null,
		variantSku: defaultVariant?.sku ?? null,
		variantKey: defaultVariant?.variantKey ?? null,
		currentStock: defaultVariant?.stock ?? null,
		currentPrice: normalizeComparableNumber(product.price)
	}
}

function readValueSyncNextValue(
	payload: Record<string, unknown>,
	kind: ValueSyncKind
): OneCValueSyncNextValue {
	if (kind === 'stock') {
		const hasStock = Object.hasOwn(payload, 'stock')
		const hasQuantity = Object.hasOwn(payload, 'quantity')
		const raw = hasStock
			? payload.stock
			: hasQuantity
				? payload.quantity
				: undefined
		if (!hasStock && !hasQuantity) {
			return {
				present: false,
				value: null,
				error: 'Mapped stock or quantity is required'
			}
		}
		const value = readNullableNumber(raw)
		if (value === null) {
			return {
				present: true,
				value: null,
				error: 'Mapped stock must be a number'
			}
		}

		return {
			present: true,
			value: Math.max(0, Math.trunc(value)),
			error: null
		}
	}

	if (!Object.prototype.hasOwnProperty.call(payload, 'price')) {
		return {
			present: false,
			value: null,
			error: 'Mapped price is required'
		}
	}
	const value = readNullableNumber(payload.price)
	if (payload.price !== null && payload.price !== '' && value === null) {
		return {
			present: true,
			value: null,
			error: 'Mapped price must be a number'
		}
	}

	return { present: true, value, error: null }
}

function validateValueSyncRow(
	row: OneCValueSyncMappedRow,
	target: OneCValueSyncTarget | null,
	value: OneCValueSyncNextValue,
	kind: ValueSyncKind
): string[] {
	const errors: string[] = []
	if (value.error) {
		errors.push(value.error)
	}
	if (!target) {
		const hasAnyTarget = Boolean(
			row.externalIdentity ||
			row.productId ||
			row.productExternalId ||
			row.productSku ||
			row.variantId ||
			row.variantExternalId ||
			row.variantSku
		)
		errors.push(
			hasAnyTarget
				? `Mapped ${kind} target was not found`
				: `Mapped ${kind} target is required; map product/variant id, external id or sku`
		)
	}

	return errors
}

function readValueSyncCurrentValue(
	target: OneCValueSyncTarget,
	kind: ValueSyncKind
): number | null {
	return kind === 'stock' ? target.currentStock : target.currentPrice
}

function normalizeComparableNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null
	const number = Number(value)
	return Number.isFinite(number) ? number : null
}

function normalizePreviewPayload(value: unknown): Record<string, unknown> {
	const source: unknown = Array.isArray(value) ? (value as unknown[])[0] : value
	if (!source || typeof source !== 'object' || Array.isArray(source)) {
		return {}
	}
	return source as Record<string, unknown>
}

function stringifyMappingValue(value: unknown): string | null {
	if (value === null || value === undefined) return null
	if (typeof value === 'string') return value
	if (
		typeof value === 'number' ||
		typeof value === 'boolean' ||
		typeof value === 'bigint'
	) {
		return String(value)
	}
	if (value instanceof Date) return value.toISOString()
	return JSON.stringify(value) ?? null
}

function normalizeIdentityValue(value: unknown): string | null {
	if (value === null || value === undefined || value === '') return null
	if (typeof value === 'string') return value.trim() || null
	if (typeof value === 'number' || typeof value === 'boolean')
		return String(value)
	return null
}

function readPath(source: Record<string, unknown>, path: string): unknown {
	const parts = path.split('.').filter(Boolean)
	let current: unknown = source

	for (const part of parts) {
		if (!current || typeof current !== 'object' || Array.isArray(current)) {
			return undefined
		}
		current = (current as Record<string, unknown>)[part]
	}

	return current
}

function setPath(
	target: Record<string, unknown>,
	path: string,
	value: unknown
): void {
	const parts = path.split('.').filter(Boolean)
	if (!parts.length) return
	let current = target

	for (const part of parts.slice(0, -1)) {
		const next = current[part]
		if (!next || typeof next !== 'object' || Array.isArray(next)) {
			current[part] = {}
		}
		current = current[part] as Record<string, unknown>
	}

	current[parts[parts.length - 1]] = value
}

function applyTransform(value: unknown, transform: unknown): unknown {
	if (!isRecord(transform)) return value
	const type = typeof transform.type === 'string' ? transform.type : null

	if (type === 'trim') return typeof value === 'string' ? value.trim() : value
	if (type === 'toString') return stringifyMappingValue(value)
	if (type === 'toNumber') return toFiniteNumber(value)
	if (type === 'booleanInvert') return !toBoolean(value)
	if (type === 'defaultIfEmpty') {
		return value === null || value === undefined || value === ''
			? transform.value
			: value
	}
	if (type === 'enumMap') {
		const map = isRecord(transform.map) ? transform.map : {}
		const key = stringifyMappingValue(value) ?? ''
		return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : value
	}

	return value
}

function coerceValue(
	value: unknown,
	dataType: IntegrationMappingDataType
): unknown {
	if (value === null || value === undefined || value === '') return null

	if (dataType === IntegrationMappingDataType.STRING)
		return stringifyMappingValue(value)
	if (dataType === IntegrationMappingDataType.INTEGER) {
		return Math.trunc(toFiniteNumber(value))
	}
	if (dataType === IntegrationMappingDataType.DECIMAL)
		return toFiniteNumber(value)
	if (dataType === IntegrationMappingDataType.BOOLEAN) return toBoolean(value)
	if (dataType === IntegrationMappingDataType.DATETIME) {
		const text = stringifyMappingValue(value)
		const date = text ? new Date(text) : new Date(Number.NaN)
		if (Number.isNaN(date.getTime())) {
			throw new BadRequestException(
				`Invalid date value: ${stringifyMappingValue(value) ?? 'unknown'}`
			)
		}
		return date.toISOString()
	}

	return value
}

function toFiniteNumber(value: unknown): number {
	const number =
		typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number(value.replace(',', '.'))
				: Number.NaN
	if (!Number.isFinite(number)) {
		throw new BadRequestException(
			`Invalid number value: ${stringifyMappingValue(value) ?? 'unknown'}`
		)
	}
	return number
}

function toBoolean(value: unknown): boolean {
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value !== 0
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase()
		if (['true', '1', 'yes', 'y'].includes(normalized)) return true
		if (['false', '0', 'no', 'n'].includes(normalized)) return false
	}
	return Boolean(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

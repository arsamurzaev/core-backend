import type { Prisma } from '@generated/client'
import {
	AuditOutcome,
	DataType,
	IntegrationProvider,
	IntegrationSyncRunStatus,
	type IntegrationWebhookEventStatus
} from '@generated/enums'
import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	HttpException,
	HttpStatus,
	Inject,
	Injectable,
	Logger,
	NotFoundException
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import slugify from 'slugify'

import { AllInterfaces } from '@/core/config'
import {
	AUDIT_RECORDER_PORT,
	type AuditRecorderPort
} from '@/modules/audit/contracts'
import {
	CAPABILITY_ASSERT_PORT,
	CAPABILITY_READER_PORT,
	type CapabilityAssertPort,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'
import {
	PRODUCT_EXTERNAL_SYNC_PORT,
	type ProductExternalSyncPort
} from '@/modules/product/public'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { mustCatalogId } from '@/shared/tenancy/ctx'

import type { AuthRequest, SessionUser } from '../auth/types/auth-request'

import { ApplyMoySkladMappingDtoReq } from './dto/requests/apply-moysklad-mapping.dto.req'
import { PreviewIikoImportDtoReq } from './dto/requests/preview-iiko-import.dto.req'
import { TestIikoConnectionDtoReq } from './dto/requests/test-iiko-connection.dto.req'
import { TestMoySkladConnectionDtoReq } from './dto/requests/test-moysklad-connection.dto.req'
import { UpdateIikoIntegrationDtoReq } from './dto/requests/update-iiko-integration.dto.req'
import { UpdateMoySkladIntegrationDtoReq } from './dto/requests/update-moysklad-integration.dto.req'
import { UpsertIikoIntegrationDtoReq } from './dto/requests/upsert-iiko-integration.dto.req'
import { UpsertMoySkladIntegrationDtoReq } from './dto/requests/upsert-moysklad-integration.dto.req'
import {
	IikoImportPreviewDto,
	IikoIntegrationDto,
	IikoIntegrationStatusDto,
	IikoOrderExportDto,
	IikoOrderExportTimelineDto,
	IikoQueuedOrderExportDto,
	IikoQueuedSyncDto,
	IikoRestaurantTablesDto,
	IikoSyncProgressDto,
	IikoSyncRunDto,
	IikoTestConnectionDto,
	IikoWebhookEventDto,
	IikoWebhookSetupDto
} from './dto/responses/iiko.dto.res'
import {
	MoySkladIntegrationDto,
	MoySkladIntegrationStatusDto,
	MoySkladMappingAppliedAttributeDto,
	MoySkladMappingAppliedEnumValueDto,
	MoySkladMappingApplyCounterDto,
	MoySkladMappingApplyReportDto,
	MoySkladMappingPreviewDto,
	MoySkladMappingSuggestedExistingValueDto,
	MoySkladMappingUnknownAttributeDto,
	MoySkladMappingUnknownEnumValueDto,
	MoySkladOrderExportDto,
	MoySkladOrderExportRefOptionDto,
	MoySkladOrderExportRefsDto,
	MoySkladQueuedOrderExportDto,
	MoySkladQueuedSyncDto,
	MoySkladSyncProgressDto,
	MoySkladSyncRunDto,
	MoySkladTestConnectionDto
} from './dto/responses/moysklad.dto.res'
import {
	type IntegrationOrderExportRecord,
	type IntegrationExternalItemRecord,
	type IntegrationProductPreviewRecord,
	type IntegrationRecord,
	IntegrationRepository,
	type IntegrationSyncRunRecord,
	type IntegrationWebhookEventRecord,
	type MappingPreviewAttributeRecord
} from './integration.repository'
import {
	INTEGRATION_EXTERNAL_ITEM_TYPE_RESTAURANT_SECTION,
	INTEGRATION_EXTERNAL_ITEM_TYPE_TABLE
} from './integration-external-items'
import { getIntegrationProviderCapabilities } from './provider-capabilities'
import { renderSafeProviderErrorMessage } from './provider-error-redaction'
import { IikoClient } from './providers/iiko/iiko.client'
import type { IikoExternalMenuPreview } from './providers/iiko/iiko.external-menu-normalizer'
import {
	IikoMetadataCryptoService,
	maskApiLogin
} from './providers/iiko/iiko.metadata'
import { IikoOrderExportQueueService } from './providers/iiko/iiko.order-export.queue.service'
import { IikoQueueService } from './providers/iiko/iiko.queue.service'
import { IikoSyncService } from './providers/iiko/iiko.sync.service'
import type {
	IikoMetadata,
	IikoWebhookMetadata
} from './providers/iiko/iiko.types'
import {
	buildIikoWebhookSettingsFilter,
	normalizeIikoWebhookPayload,
	resolveIikoWebhookAction,
	resolveIikoWebhookOrderRefs
} from './providers/iiko/iiko.webhooks'
import {
	MoySkladClient,
	normalizeMoySkladStockReportUrl
} from './providers/moysklad/moysklad.client'
import {
	isMoySkladExternalField,
	maskToken,
	MOYSKLAD_PRODUCT_CHANGE_WEBHOOK_ACTIONS,
	MOYSKLAD_PRODUCT_CHANGE_WEBHOOK_ENTITY_TYPES,
	MOYSKLAD_PRODUCT_DELETE_WEBHOOK_ENTITY_TYPES,
	MOYSKLAD_PRODUCT_FOLDER_WEBHOOK_ACTIONS,
	MOYSKLAD_PRODUCT_FOLDER_WEBHOOK_ENTITY_TYPE,
	MoySkladMetadataCryptoService
} from './providers/moysklad/moysklad.metadata'
import { MoySkladOrderExportQueueService } from './providers/moysklad/moysklad.order-export.queue.service'
import { MoySkladQueueService } from './providers/moysklad/moysklad.queue.service'
import { MoySkladSyncService } from './providers/moysklad/moysklad.sync.service'
import type {
	MoySkladMetadata,
	MoySkladNamedEntity,
	MoySkladProduct,
	MoySkladProductChangeWebhookAction,
	MoySkladProductChangeWebhookEntityType,
	MoySkladProductChangeWebhookMetadata,
	MoySkladProductChangeWebhookNotification,
	MoySkladProductDeleteWebhookEntityType,
	MoySkladProductDeleteWebhookMetadata,
	MoySkladProductDeleteWebhookNotification,
	MoySkladProductFolderWebhookAction,
	MoySkladProductFolderWebhookMetadata,
	MoySkladProductFolderWebhookNotification,
	MoySkladStockWebhookNotification,
	MoySkladVariantCharacteristic,
	MoySkladWebhook,
	MoySkladWebhookStock
} from './providers/moysklad/moysklad.types'

type SyncRunEntityStats = {
	total: number
	created: number
	updated: number
	deleted: number
	skipped: number
}

type SyncRunStockStats = {
	total: number
	applied: number
	skipped: number
	diagnostics: SyncRunStockDiagnostics | null
}

type SyncRunStockSkippedReasons = {
	missingStock: number
	productHasVariantLinks: number
	variantsCapabilityDisabled: number
	stockRowWithoutLocalLink: number
}

type SyncRunStockDiagnostics = {
	source: 'FULL_SYNC' | 'WEBHOOK'
	stockRows: number
	matchedStockRows: number
	unmatchedStockRows: number
	productLinks: number
	variantLinks: number
	ignoredVariantLinks: number
	appliedProductLinks: number
	appliedVariantLinks: number
	skippedReasons: SyncRunStockSkippedReasons
}

type SyncRunIssue = {
	code: string
	message: string
	externalId: string | null
	count: number | null
}

type ExternalItemUpsertInput = {
	catalogId: string
	integrationId: string
	provider: IntegrationProvider
	type: string
	externalId: string
	externalParentId?: string | null
	name?: string | null
	code?: string | null
	isActive?: boolean
	rawMeta?: Prisma.InputJsonValue
	lastSeenAt?: Date | null
	lastSyncedAt?: Date | null
}

type SyncRunProgress = {
	phase: string
	message: string
	processed: number
	total: number | null
	percent: number | null
	updatedAt: string
}

type SyncRunMetadata = {
	products: SyncRunEntityStats
	variants: SyncRunEntityStats
	stockRows: SyncRunStockStats
	warnings: SyncRunIssue[]
	errors: SyncRunIssue[]
	progress: SyncRunProgress | null
}

const EMPTY_SYNC_ENTITY_STATS: SyncRunEntityStats = {
	total: 0,
	created: 0,
	updated: 0,
	deleted: 0,
	skipped: 0
}

const EMPTY_SYNC_STOCK_STATS: SyncRunStockStats = {
	total: 0,
	applied: 0,
	skipped: 0,
	diagnostics: null
}

const EMPTY_STOCK_SKIPPED_REASONS: SyncRunStockSkippedReasons = {
	missingStock: 0,
	productHasVariantLinks: 0,
	variantsCapabilityDisabled: 0,
	stockRowWithoutLocalLink: 0
}

const MAPPING_SAMPLE_LIMIT = 10
const MAPPING_SUGGESTION_LIMIT = 3

type PreviewCharacteristicBucket = {
	externalName: string
	suggestedKey: string
	normalizedName: string
	occurrences: number
	sampledExternalIds: string[]
	values: Map<string, PreviewValueBucket>
}

type PreviewValueBucket = {
	externalAttributeName: string
	externalValue: string
	normalizedValue: string
	occurrences: number
	sampledExternalIds: string[]
}

type PreviewAttributeMatch = {
	attribute: MappingPreviewAttributeRecord
	score: number
}

type ApplyMappingStatus = 'created' | 'linked' | 'skipped'

type AppliedAttributeMapping = MoySkladMappingAppliedAttributeDto & {
	status: ApplyMappingStatus
}

type AppliedEnumValueMapping = MoySkladMappingAppliedEnumValueDto & {
	status: ApplyMappingStatus
}

type AttributeMappingResolution = {
	attributeId: string
	attributeKey: string
	created: boolean
}

@Injectable()
export class IntegrationService {
	private readonly logger = new Logger(IntegrationService.name)

	constructor(
		private readonly repo: IntegrationRepository,
		private readonly moySkladSync: MoySkladSyncService,
		private readonly moySkladQueue: MoySkladQueueService,
		private readonly moySkladOrderExportQueue: MoySkladOrderExportQueueService,
		private readonly metadataCrypto: MoySkladMetadataCryptoService,
		private readonly iikoSync: IikoSyncService,
		private readonly iikoQueue: IikoQueueService,
		private readonly iikoOrderExportQueue: IikoOrderExportQueueService,
		private readonly iikoMetadataCrypto: IikoMetadataCryptoService,
		@Inject(AUDIT_RECORDER_PORT)
		private readonly audit: AuditRecorderPort,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly featureAssertions: CapabilityAssertPort,
		@Inject(CAPABILITY_READER_PORT)
		private readonly featureReader: CapabilityReaderPort,
		@Inject(PRODUCT_EXTERNAL_SYNC_PORT)
		private readonly products: ProductExternalSyncPort,
		private readonly configService: ConfigService<AllInterfaces>
	) {}

	async getMoySklad(): Promise<MoySkladIntegrationDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const integration = await this.repo.findMoySklad(catalogId)
		if (!integration) {
			throw new NotFoundException('Интеграция MoySklad не настроена')
		}

		return this.mapMoySkladIntegration(integration)
	}

	async getMoySkladStatus(): Promise<MoySkladIntegrationStatusDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const [integration, activeRun, lastRun] = await Promise.all([
			this.repo.findMoySklad(catalogId),
			this.repo.findLatestActiveSyncRun(catalogId),
			this.repo.findLatestFinishedSyncRun(catalogId)
		])

		return {
			configured: Boolean(integration),
			integration: integration ? this.mapMoySkladIntegration(integration) : null,
			activeRun: activeRun ? this.mapSyncRun(activeRun) : null,
			lastRun: lastRun ? this.mapSyncRun(lastRun) : null
		}
	}

	async getIiko(): Promise<IikoIntegrationDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const integration = await this.repo.findIiko(catalogId)
		if (!integration) {
			throw new NotFoundException('iiko integration is not configured')
		}

		return this.mapIikoIntegration(integration)
	}

	async getIikoStatus(): Promise<IikoIntegrationStatusDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const [integration, activeRun, lastRun] = await Promise.all([
			this.repo.findIiko(catalogId),
			this.repo.findLatestActiveSyncRun(catalogId, IntegrationProvider.IIKO),
			this.repo.findLatestFinishedSyncRun(catalogId, IntegrationProvider.IIKO)
		])

		return {
			configured: Boolean(integration),
			integration: integration ? this.mapIikoIntegration(integration) : null,
			activeRun: activeRun ? (this.mapSyncRun(activeRun) as IikoSyncRunDto) : null,
			lastRun: lastRun ? (this.mapSyncRun(lastRun) as IikoSyncRunDto) : null
		}
	}

	async getIikoRuns(limit?: number | string): Promise<IikoSyncRunDto[]> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const normalizedLimit = this.normalizeRunsLimit(limit)
		const runs = await this.repo.findRecentSyncRuns(
			catalogId,
			normalizedLimit,
			IntegrationProvider.IIKO
		)
		return runs.map(run => this.mapSyncRun(run) as IikoSyncRunDto)
	}

	async getIikoRunProgress(runId: string): Promise<IikoSyncProgressDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const run = await this.repo.findSyncRunById(runId)
		if (
			!run ||
			run.catalogId !== catalogId ||
			run.provider !== IntegrationProvider.IIKO
		) {
			throw new NotFoundException('iiko sync run not found')
		}

		const metadata = this.normalizeSyncRunMetadata(run)
		return this.mapSyncRunProgress(run, metadata.progress) as IikoSyncProgressDto
	}

	async getIikoOrderExports(
		limit?: number | string
	): Promise<IikoOrderExportDto[]> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const normalizedLimit = this.normalizeRunsLimit(limit)
		const exports = await this.repo.findOrderExportsByCatalog(
			catalogId,
			normalizedLimit,
			IntegrationProvider.IIKO
		)
		return exports.map(item => this.mapOrderExport(item) as IikoOrderExportDto)
	}

	async getIikoWebhookEvents(
		limit?: number | string,
		status?: string
	): Promise<IikoWebhookEventDto[]> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const integration = await this.repo.findIiko(catalogId)
		if (!integration) {
			throw new NotFoundException('iiko integration is not configured')
		}

		const events = await this.repo.findWebhookEvents({
			integrationId: integration.id,
			provider: IntegrationProvider.IIKO,
			limit: this.normalizeRunsLimit(limit),
			status: this.normalizeWebhookEventStatus(status)
		})
		return events.map(event => this.mapIikoWebhookEvent(event))
	}

	async retryIikoWebhookEvent(eventId: string): Promise<IikoWebhookEventDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const storedEvent = await this.repo.findWebhookEventForCatalog(
			catalogId,
			eventId,
			IntegrationProvider.IIKO
		)
		if (!storedEvent) {
			throw new NotFoundException('iiko webhook event not found')
		}
		if (storedEvent.status !== 'FAILED' && storedEvent.status !== 'SKIPPED') {
			throw new ConflictException(
				'Only failed or skipped iiko webhook events can be retried'
			)
		}

		const integration = await this.repo.findIikoById(storedEvent.integrationId)
		if (!integration || integration.catalogId !== catalogId) {
			throw new NotFoundException('iiko integration is not configured')
		}
		if (!integration.isActive) {
			throw new ConflictException('iiko integration is disabled')
		}
		const metadata = this.iikoMetadataCrypto.parseStoredMetadata(
			integration.metadata
		)
		if (!metadata.webhook.enabled) {
			throw new ConflictException('iiko webhook handling is disabled')
		}

		const resetEvent = await this.repo.resetWebhookEventForRetry(storedEvent.id)
		if (!resetEvent) {
			throw new ConflictException('iiko webhook event is not retryable now')
		}
		const event = normalizeIikoWebhookPayload(
			resetEvent.payload ?? { eventType: resetEvent.reportUrl }
		)
		if (
			event.organizationId &&
			event.organizationId !== metadata.organizationId
		) {
			throw new ForbiddenException('Invalid iiko webhook organization')
		}

		await this.processIikoWebhookEvent({
			integration,
			metadata,
			storedEvent: resetEvent,
			event,
			jobId: 'manual-retry'
		})

		const updated = await this.repo.findWebhookEventById(resetEvent.id)
		return this.mapIikoWebhookEvent(updated ?? resetEvent)
	}

	async retryIikoOrderExport(
		exportId: string,
		reqOrActor: AuthRequest | SessionUser | null = null
	): Promise<IikoQueuedOrderExportDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const result = await this.iikoOrderExportQueue.retryOrderExport(
			catalogId,
			exportId
		)
		await this.audit.record({
			action: 'integration.iiko.order_export.retry',
			category: 'integration',
			outcome: result.queued ? AuditOutcome.SUCCESS : AuditOutcome.DENIED,
			actor: this.resolveAuditActor(reqOrActor),
			request: this.resolveAuditRequest(reqOrActor),
			targetType: 'INTEGRATION_ORDER_EXPORT',
			targetId: exportId,
			targetCatalogId: catalogId,
			reason: result.reason ?? null,
			message: result.queued
				? 'iiko order export retry queued'
				: 'iiko order export retry skipped',
			metadata: {
				provider: IntegrationProvider.IIKO,
				exportId,
				queued: result.queued,
				jobId: result.jobId ?? null,
				reason: result.reason ?? null
			}
		})
		return result
	}

	async getIikoOrderExportTimeline(
		orderId: string
	): Promise<IikoOrderExportTimelineDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const exports = await this.repo.findOrderExportsByOrderId(
			catalogId,
			orderId,
			IntegrationProvider.IIKO
		)
		return {
			orderId,
			items: exports.flatMap(exportRecord =>
				this.mapOrderExportTimelineItems(exportRecord)
			)
		}
	}

	async getMoySkladRuns(limit?: number | string): Promise<MoySkladSyncRunDto[]> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const normalizedLimit = this.normalizeRunsLimit(limit)
		const runs = await this.repo.findRecentSyncRuns(catalogId, normalizedLimit)
		return runs.map(run => this.mapSyncRun(run))
	}

	async getMoySkladRunProgress(runId: string): Promise<MoySkladSyncProgressDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const run = await this.repo.findSyncRunById(runId)
		if (
			!run ||
			run.catalogId !== catalogId ||
			run.provider !== IntegrationProvider.MOYSKLAD
		) {
			throw new NotFoundException('Запуск синхронизации MoySklad не найден')
		}

		const metadata = this.normalizeSyncRunMetadata(run)
		return this.mapSyncRunProgress(run, metadata.progress)
	}

	async getMoySkladOrderExports(
		limit?: number | string
	): Promise<MoySkladOrderExportDto[]> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const normalizedLimit = this.normalizeRunsLimit(limit)
		const exports = await this.repo.findOrderExportsByCatalog(
			catalogId,
			normalizedLimit
		)
		return exports.map(item => this.mapOrderExport(item))
	}

	async getMoySkladOrderExportRefs(): Promise<MoySkladOrderExportRefsDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const integration = await this.getActiveMoySkladIntegration(catalogId)
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		if (!metadata.token) {
			throw new NotFoundException('Токен MoySklad не настроен')
		}

		const client = new MoySkladClient({ token: metadata.token })
		const [organizations, counterparties, stores] = await Promise.all([
			client.getAllOrganizations(),
			client.getAllCounterparties(),
			client.getAllStores()
		])

		return {
			organizations: this.mapMoySkladRefOptions(organizations),
			counterparties: this.mapMoySkladRefOptions(counterparties),
			stores: this.mapMoySkladRefOptions(stores)
		}
	}

	async previewMoySkladMapping(): Promise<MoySkladMappingPreviewDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		await this.featureAssertions.assertCanUseProductTypes(catalogId)
		await this.featureAssertions.assertCanUseProductVariants(catalogId)
		const integration = await this.getActiveMoySkladIntegration(catalogId)
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		if (!metadata.token) {
			throw new NotFoundException('Токен MoySklad не настроен')
		}

		const client = new MoySkladClient({ token: metadata.token })
		const [assortment, variants, attributes] = await Promise.all([
			client.getAllAssortment(),
			client.getAllVariants(),
			this.repo.findMoySkladMappingPreviewAttributes(catalogId)
		])

		return this.buildMoySkladMappingPreview({
			assortment,
			variants,
			attributes
		})
	}

	async applyMoySkladMapping(
		dto: ApplyMoySkladMappingDtoReq
	): Promise<MoySkladMappingApplyReportDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		await this.featureAssertions.assertCanUseProductTypes(catalogId)
		await this.featureAssertions.assertCanUseProductVariants(catalogId)
		const integration = await this.getActiveMoySkladIntegration(catalogId)
		const attributeSelections = dto.attributes ?? []
		const enumValueSelections = dto.enumValues ?? []
		if (!attributeSelections.length && !enumValueSelections.length) {
			throw new BadRequestException('No MoySklad mapping selections provided')
		}

		const attributes: AppliedAttributeMapping[] = []
		const enumValues: AppliedEnumValueMapping[] = []
		const resolvedAttributes = new Map<string, AttributeMappingResolution>()
		const attributeMappingsToPersist = new Map<string, string>()

		for (const selection of attributeSelections) {
			const result = await this.applyMoySkladAttributeMapping({
				catalogId,
				trustedCatalog: dto.trustedCatalog === true,
				selection
			})
			attributes.push(result.item)

			if (result.resolution) {
				resolvedAttributes.set(result.item.normalizedName, result.resolution)
				attributeMappingsToPersist.set(
					result.item.normalizedName,
					result.resolution.attributeId
				)
			}
		}

		for (const selection of enumValueSelections) {
			const result = await this.applyMoySkladEnumValueMapping({
				catalogId,
				integration,
				selection,
				resolvedAttributes
			})
			enumValues.push(result.item)

			if (result.resolution) {
				resolvedAttributes.set(result.normalizedAttributeName, result.resolution)
				attributeMappingsToPersist.set(
					result.normalizedAttributeName,
					result.resolution.attributeId
				)
			}
		}

		if (attributeMappingsToPersist.size > 0) {
			await this.repo.upsertMoySkladAttributeMappings(
				catalogId,
				integration.id,
				[...attributeMappingsToPersist].map(([normalizedName, attributeId]) => ({
					normalizedName,
					attributeId
				}))
			)
		}

		return this.buildMoySkladMappingApplyReport(attributes, enumValues)
	}

	async retryMoySkladOrderExport(
		exportId: string,
		reqOrActor: AuthRequest | SessionUser | null = null
	): Promise<MoySkladQueuedOrderExportDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const result = await this.moySkladOrderExportQueue.retryOrderExport(
			catalogId,
			exportId
		)
		await this.audit.record({
			action: 'integration.moysklad.order_export.retry',
			category: 'integration',
			outcome: result.queued ? AuditOutcome.SUCCESS : AuditOutcome.DENIED,
			actor: this.resolveAuditActor(reqOrActor),
			request: this.resolveAuditRequest(reqOrActor),
			targetType: 'INTEGRATION_ORDER_EXPORT',
			targetId: exportId,
			targetCatalogId: catalogId,
			reason: result.reason ?? null,
			message: result.queued
				? 'MoySklad order export retry queued'
				: 'MoySklad order export retry skipped',
			metadata: {
				provider: IntegrationProvider.MOYSKLAD,
				exportId,
				queued: result.queued,
				jobId: result.jobId ?? null,
				reason: result.reason ?? null
			}
		})
		return result
	}

	async upsertMoySklad(
		dto: UpsertMoySkladIntegrationDtoReq
	): Promise<MoySkladIntegrationDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const existing = await this.repo.findMoySklad(catalogId)
		const currentMetadata = existing
			? this.metadataCrypto.parseStoredMetadata(existing.metadata)
			: null
		const metadata = this.metadataCrypto.buildStoredMetadata({
			token: dto.token,
			priceTypeName: dto.priceTypeName,
			importImages: dto.importImages,
			syncStock: dto.syncStock,
			stockWebhookEnabled:
				dto.stockWebhookEnabled ?? currentMetadata?.stockWebhookEnabled ?? false,
			stockWebhook: currentMetadata?.stockWebhook ?? null,
			productDeleteWebhook: currentMetadata?.productDeleteWebhook ?? null,
			productChangeWebhook: currentMetadata?.productChangeWebhook ?? null,
			productFolderWebhook: currentMetadata?.productFolderWebhook ?? null,
			fieldOwnership: {
				...(currentMetadata?.fieldOwnership ?? {}),
				...(dto.fieldOwnership ?? {})
			},
			exportOrders: dto.exportOrders,
			orderExportOrganizationId: dto.orderExportOrganizationId,
			orderExportCounterpartyId: dto.orderExportCounterpartyId,
			orderExportStoreId: dto.orderExportStoreId,
			scheduleEnabled: dto.scheduleEnabled,
			schedulePattern: dto.schedulePattern,
			scheduleTimezone: dto.scheduleTimezone,
			lastStockSyncedAt: currentMetadata?.lastStockSyncedAt ?? null
		})
		let integration = await this.repo.upsertMoySklad(catalogId, {
			metadata,
			isActive: dto.isActive ?? true
		})
		integration = await this.reconcileMoySkladStockWebhook(integration)
		integration = await this.reconcileMoySkladProductChangeWebhooks(integration)
		integration = await this.reconcileMoySkladProductFolderWebhooks(integration)
		integration = await this.reconcileMoySkladProductDeleteWebhooks(integration)
		await this.moySkladQueue.syncSchedulerForIntegration(integration)

		await this.tryQueueInitialSync({
			catalogId,
			previous: existing,
			next: integration,
			context: existing ? 'updated' : 'created'
		})

		return this.mapMoySkladIntegration(integration)
	}

	async updateMoySklad(
		dto: UpdateMoySkladIntegrationDtoReq
	): Promise<MoySkladIntegrationDto> {
		this.assertHasUpdateFields(dto)

		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const existing = await this.repo.findMoySklad(catalogId)
		if (!existing) {
			throw new NotFoundException('Интеграция MoySklad не настроена')
		}

		const currentMetadata = this.metadataCrypto.parseStoredMetadata(
			existing.metadata
		)
		const metadata = this.metadataCrypto.buildStoredMetadata({
			token: dto.token ?? currentMetadata.token,
			priceTypeName: dto.priceTypeName ?? currentMetadata.priceTypeName,
			importImages: dto.importImages ?? currentMetadata.importImages,
			syncStock: dto.syncStock ?? currentMetadata.syncStock,
			stockWebhookEnabled:
				dto.stockWebhookEnabled ?? currentMetadata.stockWebhookEnabled,
			stockWebhook: currentMetadata.stockWebhook,
			productDeleteWebhook: currentMetadata.productDeleteWebhook,
			productChangeWebhook: currentMetadata.productChangeWebhook,
			productFolderWebhook: currentMetadata.productFolderWebhook,
			fieldOwnership: {
				...currentMetadata.fieldOwnership,
				...(dto.fieldOwnership ?? {})
			},
			exportOrders: dto.exportOrders ?? currentMetadata.exportOrders,
			orderExportOrganizationId:
				dto.orderExportOrganizationId !== undefined
					? dto.orderExportOrganizationId
					: currentMetadata.orderExportOrganizationId,
			orderExportCounterpartyId:
				dto.orderExportCounterpartyId !== undefined
					? dto.orderExportCounterpartyId
					: currentMetadata.orderExportCounterpartyId,
			orderExportStoreId:
				dto.orderExportStoreId !== undefined
					? dto.orderExportStoreId
					: currentMetadata.orderExportStoreId,
			scheduleEnabled: dto.scheduleEnabled ?? currentMetadata.scheduleEnabled,
			schedulePattern:
				dto.schedulePattern !== undefined
					? dto.schedulePattern
					: currentMetadata.schedulePattern,
			scheduleTimezone: dto.scheduleTimezone ?? currentMetadata.scheduleTimezone,
			lastStockSyncedAt: currentMetadata.lastStockSyncedAt
		})
		let integration = await this.repo.updateMoySklad(catalogId, {
			metadata,
			isActive: dto.isActive
		})

		if (!integration) {
			throw new NotFoundException('Интеграция MoySklad не настроена')
		}
		integration = await this.reconcileMoySkladStockWebhook(integration)
		integration = await this.reconcileMoySkladProductChangeWebhooks(integration)
		integration = await this.reconcileMoySkladProductFolderWebhooks(integration)
		integration = await this.reconcileMoySkladProductDeleteWebhooks(integration)
		await this.moySkladQueue.syncSchedulerForIntegration(integration)
		await this.tryQueueInitialSync({
			catalogId,
			previous: existing,
			next: integration,
			context: 'updated'
		})

		return this.mapMoySkladIntegration(integration)
	}

	async removeMoySklad(): Promise<OkResponseDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const existing = await this.repo.findMoySklad(catalogId)
		if (!existing) {
			throw new NotFoundException('Интеграция MoySklad не настроена')
		}

		await this.deleteMoySkladStockWebhook(existing)
		await this.deleteMoySkladProductChangeWebhooks(existing)
		await this.deleteMoySkladProductFolderWebhooks(existing)
		await this.deleteMoySkladProductDeleteWebhooks(existing)
		const integration = await this.repo.softDeleteMoySklad(catalogId)
		if (!integration) {
			throw new NotFoundException('Интеграция MoySklad не настроена')
		}
		await this.moySkladQueue.removeScheduler(existing.catalogId)

		return { ok: true }
	}

	async testMoySkladConnection(
		dto: TestMoySkladConnectionDtoReq
	): Promise<MoySkladTestConnectionDto> {
		await this.featureAssertions.assertCanUseMoySkladIntegration(mustCatalogId())
		const token = await this.resolveToken(dto.token)
		return this.moySkladSync.testConnection(token)
	}

	async upsertIiko(
		dto: UpsertIikoIntegrationDtoReq
	): Promise<IikoIntegrationDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const existing = await this.repo.findIiko(catalogId)
		const currentMetadata = existing
			? this.iikoMetadataCrypto.parseStoredMetadata(existing.metadata)
			: null
		const metadata = this.iikoMetadataCrypto.buildStoredMetadata({
			apiLogin: dto.apiLogin,
			organizationId: dto.organizationId,
			organizationName: dto.organizationName,
			externalMenuId: dto.externalMenuId,
			externalMenuName: dto.externalMenuName,
			priceCategoryId: dto.priceCategoryId,
			priceCategoryName: dto.priceCategoryName,
			terminalGroupId: dto.terminalGroupId,
			terminalGroupName: dto.terminalGroupName,
			menuVersion: dto.menuVersion,
			syncSource: 'external_menu',
			importImages: dto.importImages,
			exportOrders: dto.exportOrders,
			orderExportServiceType: dto.orderExportServiceType,
			orderExportSourceKey: dto.orderExportSourceKey,
			lastRevision: currentMetadata?.lastRevision ?? null,
			lastMenuSyncedAt: currentMetadata?.lastMenuSyncedAt ?? null,
			lastStopListSyncedAt: currentMetadata?.lastStopListSyncedAt ?? null
		})
		const integration = await this.repo.upsertIiko(catalogId, {
			metadata,
			isActive: dto.isActive ?? true
		})

		return this.mapIikoIntegration(integration)
	}

	async updateIiko(
		dto: UpdateIikoIntegrationDtoReq
	): Promise<IikoIntegrationDto> {
		this.assertHasIikoUpdateFields(dto)

		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const existing = await this.repo.findIiko(catalogId)
		if (!existing) {
			throw new NotFoundException('iiko integration is not configured')
		}

		const currentMetadata = this.iikoMetadataCrypto.parseStoredMetadata(
			existing.metadata
		)
		const metadata = this.iikoMetadataCrypto.buildStoredMetadata({
			apiLogin: dto.apiLogin ?? currentMetadata.apiLogin,
			organizationId: dto.organizationId ?? currentMetadata.organizationId,
			organizationName:
				dto.organizationName !== undefined
					? dto.organizationName
					: dto.organizationId !== undefined
						? null
						: currentMetadata.organizationName,
			externalMenuId:
				dto.externalMenuId !== undefined
					? dto.externalMenuId
					: currentMetadata.externalMenuId,
			externalMenuName:
				dto.externalMenuName !== undefined
					? dto.externalMenuName
					: dto.externalMenuId !== undefined
						? null
						: currentMetadata.externalMenuName,
			priceCategoryId:
				dto.priceCategoryId !== undefined
					? dto.priceCategoryId
					: currentMetadata.priceCategoryId,
			priceCategoryName:
				dto.priceCategoryName !== undefined
					? dto.priceCategoryName
					: dto.priceCategoryId !== undefined
						? null
						: currentMetadata.priceCategoryName,
			terminalGroupId:
				dto.terminalGroupId !== undefined
					? dto.terminalGroupId
					: currentMetadata.terminalGroupId,
			terminalGroupName:
				dto.terminalGroupName !== undefined
					? dto.terminalGroupName
					: dto.terminalGroupId !== undefined
						? null
						: currentMetadata.terminalGroupName,
			menuVersion: dto.menuVersion ?? currentMetadata.menuVersion,
			syncSource: 'external_menu',
			importImages: dto.importImages ?? currentMetadata.importImages,
			exportOrders: dto.exportOrders ?? currentMetadata.exportOrders,
			orderExportServiceType:
				dto.orderExportServiceType !== undefined
					? dto.orderExportServiceType
					: currentMetadata.orderExportServiceType,
			orderExportSourceKey:
				dto.orderExportSourceKey !== undefined
					? dto.orderExportSourceKey
					: currentMetadata.orderExportSourceKey,
			lastRevision: currentMetadata.lastRevision,
			lastMenuSyncedAt: currentMetadata.lastMenuSyncedAt,
			lastStopListSyncedAt: currentMetadata.lastStopListSyncedAt
		})
		const integration = await this.repo.updateIiko(catalogId, {
			metadata,
			isActive: dto.isActive
		})
		if (!integration) {
			throw new NotFoundException('iiko integration is not configured')
		}

		return this.mapIikoIntegration(integration)
	}

	async removeIiko(): Promise<OkResponseDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const integration = await this.repo.softDeleteIiko(catalogId)
		if (!integration) {
			throw new NotFoundException('iiko integration is not configured')
		}

		return { ok: true }
	}

	async testIikoConnection(
		dto: TestIikoConnectionDtoReq = {}
	): Promise<IikoTestConnectionDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)

		const requestApiLogin = dto.apiLogin?.trim()
		if (requestApiLogin) {
			return this.iikoSync.testConnection(requestApiLogin)
		}

		const existing = await this.repo.findIiko(catalogId)
		const metadata = existing
			? this.iikoMetadataCrypto.parseStoredMetadata(existing.metadata)
			: null
		const storedApiLogin = metadata?.apiLogin?.trim()
		if (!storedApiLogin) {
			throw new BadRequestException('iiko apiLogin is required')
		}

		return this.iikoSync.testConnection(storedApiLogin)
	}

	async getIikoTables(): Promise<IikoRestaurantTablesDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const integration = await this.repo.findIiko(catalogId)
		if (!integration) {
			throw new NotFoundException('iiko integration is not configured')
		}
		if (!integration.isActive) {
			throw new ConflictException('iiko integration is disabled')
		}

		const metadata = this.iikoMetadataCrypto.parseStoredMetadata(
			integration.metadata
		)
		if (!metadata.terminalGroupId) {
			throw new BadRequestException('iiko terminal group is required')
		}

		const client = new IikoClient({
			apiLogin: metadata.apiLogin,
			baseUrl: this.resolveIikoApiBaseUrl()
		})
		const response = await client.getRestaurantSections({
			terminalGroupIds: [metadata.terminalGroupId],
			returnSchema: false
		})
		const now = new Date()
		const seenSectionIds: string[] = []
		const tableInputs = (response.restaurantSections ?? []).flatMap(section => {
			const sectionId = normalizeOptionalString(section.id)
			const sectionName = normalizeOptionalString(section.name)
			const terminalGroupId = normalizeOptionalString(section.terminalGroupId)

			if (sectionId) {
				seenSectionIds.push(sectionId)
			}

			return (section.tables ?? [])
				.filter(table => !table.isDeleted)
				.map(table => {
					const number = normalizeNullableNumber(table.number)
					const name = normalizeOptionalString(table.name)
					return {
						id: normalizeOptionalString(table.id) ?? '',
						publicCode: null as string | null,
						number,
						displayNumber: resolveIikoTableDisplayNumber(name, number),
						name,
						seatingCapacity: normalizeNullableNumber(table.seatingCapacity),
						sectionId,
						sectionName,
						terminalGroupId
					}
				})
				.filter(table => table.id)
		})
		const seenTableIds = tableInputs.map(table => table.id)

		await Promise.all(
			(response.restaurantSections ?? [])
				.map(section => {
					const sectionId = normalizeOptionalString(section.id)
					if (!sectionId) return null
					const sectionName = normalizeOptionalString(section.name)
					const terminalGroupId = normalizeOptionalString(section.terminalGroupId)
					return this.upsertExternalItemWithGeneratedCode({
						catalogId,
						integrationId: integration.id,
						provider: IntegrationProvider.IIKO,
						type: INTEGRATION_EXTERNAL_ITEM_TYPE_RESTAURANT_SECTION,
						externalId: sectionId,
						name: sectionName,
						rawMeta: {
							provider: 'iiko',
							source: 'restaurantSections',
							terminalGroupId,
							revision: normalizeNullableNumber(response.revision)
						},
						lastSeenAt: now,
						lastSyncedAt: now
					})
				})
				.filter(
					(promise): promise is Promise<IntegrationExternalItemRecord> =>
						Boolean(promise)
				)
		)

		const tables = await Promise.all(
			tableInputs.map(async table => {
				const externalItem = await this.upsertExternalItemWithGeneratedCode({
					catalogId,
					integrationId: integration.id,
					provider: IntegrationProvider.IIKO,
					type: INTEGRATION_EXTERNAL_ITEM_TYPE_TABLE,
					externalId: table.id,
					externalParentId: table.sectionId,
					name:
						table.name ??
						(table.displayNumber ? `Стол ${table.displayNumber}` : null),
					code: table.displayNumber,
					rawMeta: {
						provider: 'iiko',
						source: 'restaurantSections',
						terminalGroupId: table.terminalGroupId,
						restaurantSectionId: table.sectionId,
						restaurantSectionName: table.sectionName,
						iikoTableNumber: table.number,
						tableNumber: table.displayNumber,
						displayTableNumber: table.displayNumber,
						tableName: table.name,
						seatingCapacity: table.seatingCapacity,
						revision: normalizeNullableNumber(response.revision)
					},
					lastSeenAt: now,
					lastSyncedAt: now
				})

				return {
					...table,
					publicCode: externalItem.publicCode
				}
			})
		)

		await Promise.all([
			this.repo.deactivateMissingExternalItems({
				integrationId: integration.id,
				type: INTEGRATION_EXTERNAL_ITEM_TYPE_RESTAURANT_SECTION,
				externalIds: seenSectionIds
			}),
			this.repo.deactivateMissingExternalItems({
				integrationId: integration.id,
				type: INTEGRATION_EXTERNAL_ITEM_TYPE_TABLE,
				externalIds: seenTableIds
			})
		])

		return {
			ok: true,
			tables,
			revision: normalizeNullableNumber(response.revision)
		}
	}

	async previewIikoImport(
		dto: PreviewIikoImportDtoReq
	): Promise<IikoImportPreviewDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const existing = await this.repo.findIiko(catalogId)
		const metadata = existing
			? this.iikoMetadataCrypto.parseStoredMetadata(existing.metadata)
			: null

		const apiLogin = dto.apiLogin?.trim() || metadata?.apiLogin
		const organizationId = dto.organizationId?.trim() || metadata?.organizationId
		const externalMenuId = dto.externalMenuId?.trim() || metadata?.externalMenuId

		if (!apiLogin) {
			throw new BadRequestException('iiko apiLogin is required')
		}
		if (!organizationId) {
			throw new BadRequestException('iiko organization is required')
		}
		if (!externalMenuId) {
			throw new BadRequestException('iiko external menu is required')
		}

		const preview = await this.iikoSync.previewExternalMenu({
			apiLogin,
			organizationId,
			externalMenuId,
			externalMenuName:
				dto.externalMenuName !== undefined
					? dto.externalMenuName
					: metadata?.externalMenuName,
			priceCategoryId:
				dto.priceCategoryId !== undefined
					? dto.priceCategoryId
					: metadata?.priceCategoryId,
			menuVersion: dto.menuVersion ?? metadata?.menuVersion ?? 4
		})

		return this.enrichIikoImportPreviewDiff(existing, preview)
	}

	async syncMoySkladCatalog(): Promise<MoySkladQueuedSyncDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		return this.moySkladQueue.enqueueCatalogSync(catalogId)
	}

	async syncIikoCatalog(): Promise<IikoQueuedSyncDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		return this.iikoQueue.enqueueCatalogSync(catalogId)
	}

	async syncIikoStock(): Promise<IikoQueuedSyncDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		return this.iikoQueue.enqueueStockSync(catalogId)
	}

	async syncIikoProduct(productId: string): Promise<IikoQueuedSyncDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		return this.iikoQueue.enqueueProductSync(catalogId, productId)
	}

	async setupIikoWebhooks(): Promise<IikoWebhookSetupDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const integration = await this.repo.findIiko(catalogId)
		if (!integration) {
			throw new NotFoundException('iiko integration is not configured')
		}
		if (!integration.isActive) {
			throw new ConflictException('iiko integration is disabled')
		}

		const metadata = this.iikoMetadataCrypto.parseStoredMetadata(
			integration.metadata
		)
		const baseUrl = this.resolveIikoWebhookBaseUrl()
		const secret = this.generateWebhookSecret()
		const webHooksUri = this.buildIikoWebhookUrl(baseUrl, integration.id, secret)
		const urlPreview = this.buildIikoWebhookUrl(baseUrl, integration.id, '***')
		if (
			metadata.webhook.enabled &&
			metadata.webhook.secretHash &&
			metadata.webhook.urlPreview === urlPreview
		) {
			return {
				ok: true,
				enabled: true,
				correlationId: null,
				webhook: this.mapIikoWebhookStatus(metadata.webhook)
			}
		}

		const client = new IikoClient({
			apiLogin: metadata.apiLogin,
			baseUrl: this.resolveIikoApiBaseUrl()
		})
		let response: Awaited<ReturnType<IikoClient['updateWebhookSettings']>>
		try {
			response = await client.updateWebhookSettings({
				organizationId: metadata.organizationId,
				webHooksUri,
				authToken: secret,
				webHooksFilter: buildIikoWebhookSettingsFilter()
			})
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			if (this.isIikoRateLimitedError(message)) {
				throw new HttpException(
					'iiko API temporarily rate-limited webhook setup; wait a bit and try again',
					HttpStatus.TOO_MANY_REQUESTS
				)
			}
			throw error
		}
		const nextWebhook: IikoWebhookMetadata = {
			...metadata.webhook,
			enabled: true,
			urlPreview,
			secretHash: this.hashWebhookSecret(secret),
			lastConfiguredAt: new Date().toISOString(),
			lastError: null
		}
		await this.updateStoredIikoMetadata(integration, {
			...metadata,
			webhook: nextWebhook
		})
		const updated = await this.repo.findIikoById(integration.id)
		if (!updated) {
			throw new NotFoundException('iiko integration is not configured')
		}

		return {
			ok: true,
			enabled: true,
			correlationId: response.correlationId ?? null,
			webhook: this.mapIikoWebhookStatus(
				this.iikoMetadataCrypto.parseStoredMetadata(updated.metadata).webhook
			)
		}
	}

	async disableIikoWebhooks(): Promise<OkResponseDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseIikoIntegration(catalogId)
		const integration = await this.repo.findIiko(catalogId)
		if (!integration) {
			throw new NotFoundException('iiko integration is not configured')
		}
		const metadata = this.iikoMetadataCrypto.parseStoredMetadata(
			integration.metadata
		)
		let lastError: string | null = null
		if (metadata.organizationId && metadata.apiLogin) {
			try {
				const client = new IikoClient({
					apiLogin: metadata.apiLogin,
					baseUrl: this.resolveIikoApiBaseUrl()
				})
				await client.updateWebhookSettings({
					organizationId: metadata.organizationId,
					webHooksUri: '',
					authToken: null,
					webHooksFilter: null
				})
			} catch (error) {
				lastError = renderSafeProviderErrorMessage(error)
				this.logger.warn(`Failed to disable iiko webhooks remotely: ${lastError}`)
			}
		}
		await this.updateStoredIikoMetadata(integration, {
			...metadata,
			webhook: {
				...metadata.webhook,
				enabled: false,
				urlPreview: null,
				secretHash: null,
				lastConfiguredAt: new Date().toISOString(),
				lastError
			}
		})

		return { ok: true }
	}

	async receiveIikoWebhook(params: {
		integrationId: string
		secret: string
		payload: unknown
		headers?: Record<string, unknown>
	}): Promise<void> {
		const integration = await this.repo.findIikoById(params.integrationId)
		if (!integration) {
			throw new NotFoundException('iiko integration is not configured')
		}
		const metadata = this.iikoMetadataCrypto.parseStoredMetadata(
			integration.metadata
		)
		this.assertIikoWebhookSecret(metadata.webhook, params.secret)

		if (!metadata.webhook.enabled) {
			await this.touchIikoWebhook(integration, metadata, {
				lastError: 'iiko webhook is disabled locally'
			})
			return
		}

		const event = normalizeIikoWebhookPayload(params.payload)
		if (
			event.organizationId &&
			event.organizationId !== metadata.organizationId
		) {
			throw new ForbiddenException('Invalid iiko webhook organization')
		}

		const { event: storedEvent, created } =
			await this.repo.createWebhookEventIfNew({
				integrationId: integration.id,
				provider: IntegrationProvider.IIKO,
				requestId: event.requestId,
				reportUrl: event.eventType,
				payload: event.payload as Prisma.InputJsonValue
			})
		if (!created) return

		await this.processIikoWebhookEvent({
			integration,
			metadata,
			storedEvent,
			event,
			jobId: 'inline'
		})
	}

	async syncMoySkladProduct(productId: string): Promise<MoySkladQueuedSyncDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		return this.moySkladQueue.enqueueProductSync(catalogId, productId)
	}

	async syncMoySkladStock(): Promise<MoySkladQueuedSyncDto> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		return this.moySkladQueue.enqueueStockSync(catalogId)
	}

	async receiveMoySkladStockWebhook(params: {
		integrationId: string
		secret: string
		requestId?: string | string[]
		payload: unknown
	}): Promise<void> {
		const integration = await this.repo.findMoySkladById(params.integrationId)
		if (!integration) {
			throw new NotFoundException('MoySklad integration not found')
		}

		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		this.assertMoySkladWebhookSecret(
			metadata.stockWebhook,
			params.secret,
			'MoySklad stock webhook'
		)

		if (
			!integration.isActive ||
			!metadata.syncStock ||
			!isMoySkladExternalField(metadata, 'stock') ||
			!metadata.stockWebhookEnabled
		) {
			this.logger.warn(
				`Ignoring MoySklad stock webhook for disabled integration ${integration.id}`
			)
			return
		}

		if (
			!(await this.featureReader.canUseMoySkladIntegration(integration.catalogId))
		) {
			this.logger.warn(
				`Ignoring MoySklad stock webhook for catalog ${integration.catalogId}: capability disabled`
			)
			return
		}

		const events = this.extractMoySkladStockWebhookEvents(params.payload)
		const baseRequestId = this.normalizeWebhookRequestId(
			params.requestId,
			params.payload
		)
		let created = 0

		for (const [index, event] of events.entries()) {
			this.assertMoySkladWebhookAccount(
				metadata.stockWebhook,
				event.accountId,
				'MoySklad stock webhook'
			)
			const requestId =
				events.length === 1 ? baseRequestId : `${baseRequestId}:${index}`
			const result = await this.repo.createWebhookEventIfNew({
				integrationId: integration.id,
				requestId,
				reportUrl: event.reportUrl,
				payload: this.toPrismaJson(params.payload)
			})
			if (result.created) {
				created += 1
			}
		}

		await this.repo.patchMoySkladStockWebhookMetadata(integration.id, {
			lastReceivedAt: new Date().toISOString(),
			lastError: null
		})

		if (created > 0) {
			await this.moySkladQueue.enqueueStockWebhookDrain(
				integration.catalogId,
				integration.id
			)
		}
	}

	async receiveMoySkladProductChangeWebhook(params: {
		integrationId: string
		secret: string
		payload: unknown
	}): Promise<void> {
		const integration = await this.repo.findMoySkladById(params.integrationId)
		if (!integration) {
			throw new NotFoundException('MoySklad integration not found')
		}

		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		this.assertMoySkladWebhookSecret(
			metadata.productChangeWebhook,
			params.secret,
			'MoySklad product change webhook'
		)

		if (!integration.isActive || !metadata.productChangeWebhook.enabled) {
			this.logger.warn(
				`Ignoring MoySklad product change webhook for disabled integration ${integration.id}`
			)
			return
		}

		if (
			!(await this.featureReader.canUseMoySkladIntegration(integration.catalogId))
		) {
			this.logger.warn(
				`Ignoring MoySklad product change webhook for catalog ${integration.catalogId}: capability disabled`
			)
			return
		}

		const events = this.dedupeMoySkladProductChangeWebhookEvents(
			this.extractMoySkladProductChangeWebhookEvents(params.payload)
		)

		for (const event of events) {
			this.assertMoySkladWebhookAccount(
				metadata.productChangeWebhook,
				event.accountId,
				'MoySklad product change webhook'
			)
		}

		for (const event of events) {
			await this.moySkladQueue.enqueueProductWebhookSync(
				integration.catalogId,
				integration.id,
				{
					entityType: event.entityType,
					externalId: event.externalId,
					action: event.action
				}
			)
		}

		await this.repo.patchMoySkladProductChangeWebhookMetadata(integration.id, {
			lastReceivedAt: new Date().toISOString(),
			lastError: null
		})
	}

	async receiveMoySkladProductFolderWebhook(params: {
		integrationId: string
		secret: string
		payload: unknown
	}): Promise<void> {
		const integration = await this.repo.findMoySkladById(params.integrationId)
		if (!integration) {
			throw new NotFoundException('MoySklad integration not found')
		}

		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		this.assertMoySkladWebhookSecret(
			metadata.productFolderWebhook,
			params.secret,
			'MoySklad productfolder webhook'
		)

		if (!integration.isActive || !metadata.productFolderWebhook.enabled) {
			this.logger.warn(
				`Ignoring MoySklad productfolder webhook for disabled integration ${integration.id}`
			)
			return
		}

		if (
			!(await this.featureReader.canUseMoySkladIntegration(integration.catalogId))
		) {
			this.logger.warn(
				`Ignoring MoySklad productfolder webhook for catalog ${integration.catalogId}: capability disabled`
			)
			return
		}

		const events = this.dedupeMoySkladProductFolderWebhookEvents(
			this.extractMoySkladProductFolderWebhookEvents(params.payload)
		)

		for (const event of events) {
			this.assertMoySkladWebhookAccount(
				metadata.productFolderWebhook,
				event.accountId,
				'MoySklad productfolder webhook'
			)
		}

		for (const event of events) {
			await this.moySkladQueue.enqueueProductFolderWebhookSync(
				integration.catalogId,
				integration.id,
				{
					externalId: event.externalId,
					action: event.action
				}
			)
		}

		await this.repo.patchMoySkladProductFolderWebhookMetadata(integration.id, {
			lastReceivedAt: new Date().toISOString(),
			lastError: null
		})
	}

	async receiveMoySkladProductDeleteWebhook(params: {
		integrationId: string
		secret: string
		payload: unknown
	}): Promise<void> {
		const integration = await this.repo.findMoySkladById(params.integrationId)
		if (!integration) {
			throw new NotFoundException('MoySklad integration not found')
		}

		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		this.assertMoySkladWebhookSecret(
			metadata.productDeleteWebhook,
			params.secret,
			'MoySklad product delete webhook'
		)

		if (!integration.isActive || !metadata.productDeleteWebhook.enabled) {
			this.logger.warn(
				`Ignoring MoySklad product delete webhook for disabled integration ${integration.id}`
			)
			return
		}

		if (
			!(await this.featureReader.canUseMoySkladIntegration(integration.catalogId))
		) {
			this.logger.warn(
				`Ignoring MoySklad product delete webhook for catalog ${integration.catalogId}: capability disabled`
			)
			return
		}

		const events = this.extractMoySkladProductDeleteWebhookEvents(params.payload)
		let deleted = 0
		let linkByExternalIdentity: ReadonlyMap<
			string,
			{
				productId: string
			}
		> | null = null

		for (const event of events) {
			this.assertMoySkladWebhookAccount(
				metadata.productDeleteWebhook,
				event.accountId,
				'MoySklad product delete webhook'
			)
		}

		for (const event of events) {
			if (event.entityType === 'variant') {
				const result = await this.repo.softDeleteIntegratedVariantByExternalId({
					integrationId: integration.id,
					catalogId: integration.catalogId,
					externalId: event.externalId
				})
				if (!result.deleted) {
					this.logger.warn(
						`MoySklad delete webhook skipped: local variant link not found for ${event.entityType}:${event.externalId}`
					)
					continue
				}

				if (result.productId) {
					await this.repo.recomputeProductStatusFromVariants(
						integration.catalogId,
						result.productId
					)
					await this.products.recomputeProductCommercialState({
						catalogId: integration.catalogId,
						productId: result.productId
					})
				}
				deleted += 1
				continue
			}

			if (!linkByExternalIdentity) {
				const links = await this.repo.findProductLinksByIntegration(integration.id)
				linkByExternalIdentity = this.buildProductLinkByExternalIdentity(links)
			}
			const link = linkByExternalIdentity.get(event.externalId)
			if (!link) {
				this.logger.warn(
					`MoySklad delete webhook skipped: local product link not found for ${event.entityType}:${event.externalId}`
				)
				continue
			}

			const removed = await this.products.softDeleteExternalProduct({
				catalogId: integration.catalogId,
				productId: link.productId
			})
			if (removed) {
				deleted += 1
			}
		}

		await this.repo.patchMoySkladProductDeleteWebhookMetadata(integration.id, {
			lastReceivedAt: new Date().toISOString(),
			lastProcessedAt: new Date().toISOString(),
			lastError: null
		})

		if (deleted > 0) {
			this.logger.log(
				`Soft deleted ${deleted} items from MoySklad delete webhook for catalog ${integration.catalogId}`
			)
		}
	}

	async cancelMoySkladSync(): Promise<void> {
		const catalogId = mustCatalogId()
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		await this.repo.failMoySkladSync(catalogId, 'Отменено пользователем')
	}

	private async applyMoySkladAttributeMapping(params: {
		catalogId: string
		trustedCatalog: boolean
		selection: NonNullable<ApplyMoySkladMappingDtoReq['attributes']>[number]
	}): Promise<{
		item: AppliedAttributeMapping
		resolution: AttributeMappingResolution | null
	}> {
		const externalName = this.normalizePreviewText(params.selection.externalName)
		const normalizedName = this.normalizePreviewComparable(externalName)
		const skipped = (
			reason: string
		): {
			item: AppliedAttributeMapping
			resolution: null
		} => ({
			item: {
				externalName,
				normalizedName,
				status: 'skipped',
				attributeId: null,
				attributeKey: null,
				reason
			},
			resolution: null
		})

		if (!externalName || !normalizedName) {
			return skipped('empty_external_name')
		}

		if (params.selection.action === 'SKIP') {
			return skipped('selected_skip')
		}

		if (params.selection.action === 'LINK') {
			if (!params.selection.attributeId) {
				return skipped('attribute_id_required')
			}

			const attribute = await this.repo.findMoySkladVariantAttributeById(
				params.catalogId,
				params.selection.attributeId
			)
			if (!attribute) {
				return skipped('attribute_not_found')
			}

			return {
				item: {
					externalName,
					normalizedName,
					status: 'linked',
					attributeId: attribute.id,
					attributeKey: attribute.key,
					reason: null
				},
				resolution: {
					attributeId: attribute.id,
					attributeKey: attribute.key,
					created: false
				}
			}
		}

		if (!params.trustedCatalog) {
			return skipped('auto_create_attribute_requires_trusted_catalog')
		}

		const displayName =
			this.normalizePreviewText(params.selection.displayName) || externalName
		const key = this.normalizeMappingAttributeKey(
			params.selection.key,
			this.buildMoySkladPreviewAttributeKey(displayName)
		)
		const result = await this.repo.upsertMoySkladVariantAttributeForMapping(
			params.catalogId,
			{
				key,
				displayName
			}
		)

		return {
			item: {
				externalName,
				normalizedName,
				status: result.created ? 'created' : 'linked',
				attributeId: result.attribute.id,
				attributeKey: result.attribute.key,
				reason: null
			},
			resolution: {
				attributeId: result.attribute.id,
				attributeKey: result.attribute.key,
				created: result.created
			}
		}
	}

	private async applyMoySkladEnumValueMapping(params: {
		catalogId: string
		integration: IntegrationRecord
		selection: NonNullable<ApplyMoySkladMappingDtoReq['enumValues']>[number]
		resolvedAttributes: Map<string, AttributeMappingResolution>
	}): Promise<{
		item: AppliedEnumValueMapping
		normalizedAttributeName: string
		resolution: AttributeMappingResolution | null
	}> {
		const externalAttributeName = this.normalizePreviewText(
			params.selection.externalAttributeName
		)
		const normalizedAttributeName = this.normalizePreviewComparable(
			externalAttributeName
		)
		const externalValue = this.normalizePreviewText(
			params.selection.externalValue
		)
		const normalizedValue = this.normalizePreviewEnumValue(externalValue)
		const skipped = (
			reason: string
		): {
			item: AppliedEnumValueMapping
			normalizedAttributeName: string
			resolution: null
		} => ({
			item: {
				externalAttributeName,
				externalValue,
				normalizedValue,
				status: 'skipped',
				attributeId: null,
				enumValueId: null,
				value: null,
				reason
			},
			normalizedAttributeName,
			resolution: null
		})

		if (!externalAttributeName || !normalizedAttributeName) {
			return skipped('empty_external_attribute_name')
		}
		if (!externalValue || !normalizedValue) {
			return skipped('empty_external_value')
		}
		if (params.selection.action === 'SKIP') {
			return skipped('selected_skip')
		}

		const attribute = await this.resolveMoySkladMappingAttributeForEnumValue({
			catalogId: params.catalogId,
			integration: params.integration,
			selectionAttributeId: params.selection.attributeId,
			normalizedAttributeName,
			resolvedAttributes: params.resolvedAttributes
		})
		if (!attribute) {
			return skipped('attribute_not_found')
		}

		const resolution: AttributeMappingResolution = {
			attributeId: attribute.attributeId,
			attributeKey: attribute.attributeKey,
			created: false
		}

		if (params.selection.action === 'LINK') {
			if (!params.selection.enumValueId) {
				return skipped('enum_value_id_required')
			}

			const result = await this.repo.upsertMoySkladEnumValueAlias(
				params.catalogId,
				attribute.attributeId,
				params.selection.enumValueId,
				{
					value: normalizedValue,
					displayName: externalValue
				}
			)
			if (!result.enumValue) {
				return skipped(
					result.conflict ? 'enum_value_mapping_conflict' : 'enum_value_not_found'
				)
			}

			return {
				item: {
					externalAttributeName,
					externalValue,
					normalizedValue,
					status: 'linked',
					attributeId: attribute.attributeId,
					enumValueId: result.enumValue.id,
					value: result.enumValue.value,
					reason: null
				},
				normalizedAttributeName,
				resolution
			}
		}

		const value = this.normalizePreviewEnumValue(
			params.selection.value ?? externalValue
		)
		if (!value) {
			return skipped('empty_value')
		}
		const displayName =
			this.normalizePreviewText(params.selection.displayName) || externalValue
		const result = await this.repo.upsertMoySkladImportedEnumValue(
			params.catalogId,
			attribute.attributeId,
			{
				value,
				displayName
			}
		)
		if (!result.enumValue) {
			return skipped('enum_value_attribute_not_found')
		}

		return {
			item: {
				externalAttributeName,
				externalValue,
				normalizedValue,
				status: result.created ? 'created' : 'linked',
				attributeId: attribute.attributeId,
				enumValueId: result.enumValue.id,
				value: result.enumValue.value,
				reason: null
			},
			normalizedAttributeName,
			resolution
		}
	}

	private async resolveMoySkladMappingAttributeForEnumValue(params: {
		catalogId: string
		integration: IntegrationRecord
		selectionAttributeId?: string
		normalizedAttributeName: string
		resolvedAttributes: Map<string, AttributeMappingResolution>
	}): Promise<AttributeMappingResolution | null> {
		const attributeId =
			params.selectionAttributeId ??
			params.resolvedAttributes.get(params.normalizedAttributeName)?.attributeId ??
			this.readStoredMoySkladAttributeMappingId(
				params.integration.metadata,
				params.normalizedAttributeName
			)

		if (!attributeId) return null

		const attribute = await this.repo.findMoySkladVariantAttributeById(
			params.catalogId,
			attributeId
		)
		if (!attribute) return null

		return {
			attributeId: attribute.id,
			attributeKey: attribute.key,
			created: false
		}
	}

	private buildMoySkladMappingApplyReport(
		attributes: AppliedAttributeMapping[],
		enumValues: AppliedEnumValueMapping[]
	): MoySkladMappingApplyReportDto {
		return {
			ok: true,
			applied: this.countAppliedMappings(attributes, enumValues, [
				'created',
				'linked'
			]),
			skipped: this.countAppliedMappings(attributes, enumValues, ['skipped']),
			created: this.countAppliedMappings(attributes, enumValues, ['created']),
			linked: this.countAppliedMappings(attributes, enumValues, ['linked']),
			attributes,
			enumValues
		}
	}

	private countAppliedMappings(
		attributes: AppliedAttributeMapping[],
		enumValues: AppliedEnumValueMapping[],
		statuses: ApplyMappingStatus[]
	): MoySkladMappingApplyCounterDto {
		const matches = new Set(statuses)
		const attributeCount = attributes.filter(item =>
			matches.has(item.status)
		).length
		const enumValueCount = enumValues.filter(item =>
			matches.has(item.status)
		).length

		return {
			total: attributeCount + enumValueCount,
			attributes: attributeCount,
			enumValues: enumValueCount
		}
	}

	private buildMoySkladMappingPreview(params: {
		assortment: MoySkladProduct[]
		variants: MoySkladProduct[]
		attributes: MappingPreviewAttributeRecord[]
	}): MoySkladMappingPreviewDto {
		const buckets = new Map<string, PreviewCharacteristicBucket>()
		const sampledExternalIds: string[] = []
		const seenCharacteristicItems = new Set<string>()
		let itemsWithCharacteristics = 0
		let characteristicsCount = 0

		for (const item of [...params.assortment, ...params.variants]) {
			const characteristics = Array.isArray(item.characteristics)
				? item.characteristics
				: []
			if (!characteristics.length) continue

			const externalId = this.resolvePreviewExternalId(item)
			if (externalId) {
				if (seenCharacteristicItems.has(externalId)) continue
				seenCharacteristicItems.add(externalId)
			}

			itemsWithCharacteristics += 1
			if (externalId) {
				this.pushSample(sampledExternalIds, externalId)
			}

			for (const characteristic of characteristics) {
				if (this.addPreviewCharacteristic(buckets, characteristic, externalId)) {
					characteristicsCount += 1
				}
			}
		}

		const enumAttributes = params.attributes.filter(
			attribute =>
				attribute.dataType === DataType.ENUM && attribute.isVariantAttribute
		)
		const unknownAttributes: MoySkladMappingUnknownAttributeDto[] = []
		const unknownEnumValues: MoySkladMappingUnknownEnumValueDto[] = []
		const suggestedExistingValues: MoySkladMappingSuggestedExistingValueDto[] = []
		let knownAttributes = 0
		let knownEnumValues = 0

		for (const bucket of buckets.values()) {
			const matches = this.findPreviewAttributeMatches(bucket, enumAttributes)
			const exactAttribute = matches[0]?.score === 1 ? matches[0].attribute : null

			if (exactAttribute) {
				knownAttributes += 1
			} else {
				unknownAttributes.push({
					externalName: bucket.externalName,
					suggestedKey: bucket.suggestedKey,
					occurrences: bucket.occurrences,
					sampledExternalIds: bucket.sampledExternalIds,
					suggestedExistingAttributes: matches.map(match => ({
						id: match.attribute.id,
						key: match.attribute.key,
						displayName: match.attribute.displayName,
						score: match.score
					}))
				})
			}

			const valueAttribute = exactAttribute ?? matches[0]?.attribute ?? null
			for (const valueBucket of bucket.values.values()) {
				const existingValue = valueAttribute
					? this.findPreviewEnumValue(valueAttribute, valueBucket.normalizedValue)
					: null

				if (existingValue) {
					knownEnumValues += 1
					continue
				}

				unknownEnumValues.push({
					externalAttributeName: bucket.externalName,
					externalValue: valueBucket.externalValue,
					normalizedValue: valueBucket.normalizedValue,
					attributeId: valueAttribute?.id ?? null,
					attributeKey: valueAttribute?.key ?? null,
					occurrences: valueBucket.occurrences,
					sampledExternalIds: valueBucket.sampledExternalIds
				})

				if (valueAttribute) {
					const suggestions = this.findPreviewEnumValueSuggestions(
						valueAttribute,
						valueBucket.normalizedValue
					)
					suggestedExistingValues.push(
						...suggestions.map(suggestion => ({
							externalAttributeName: bucket.externalName,
							externalValue: valueBucket.externalValue,
							normalizedValue: valueBucket.normalizedValue,
							attributeId: valueAttribute.id,
							attributeKey: valueAttribute.key,
							attributeDisplayName: valueAttribute.displayName,
							enumValue: {
								id: suggestion.value.id,
								value: suggestion.value.value,
								displayName: suggestion.value.displayName
							},
							score: suggestion.score
						}))
					)
				}
			}
		}

		return {
			unknownAttributes: unknownAttributes.sort((left, right) =>
				left.externalName.localeCompare(right.externalName)
			),
			unknownEnumValues: unknownEnumValues.sort((left, right) =>
				`${left.externalAttributeName}:${left.externalValue}`.localeCompare(
					`${right.externalAttributeName}:${right.externalValue}`
				)
			),
			suggestedExistingValues: suggestedExistingValues.sort(
				(left, right) =>
					right.score - left.score ||
					left.externalAttributeName.localeCompare(right.externalAttributeName)
			),
			counters: {
				assortmentItems: params.assortment.length,
				variantItems: params.variants.length,
				itemsWithCharacteristics,
				characteristics: characteristicsCount,
				knownAttributes,
				unknownAttributes: unknownAttributes.length,
				knownEnumValues,
				unknownEnumValues: unknownEnumValues.length,
				suggestedExistingValues: suggestedExistingValues.length
			},
			sampledExternalIds
		}
	}

	private addPreviewCharacteristic(
		buckets: Map<string, PreviewCharacteristicBucket>,
		characteristic: MoySkladVariantCharacteristic,
		externalId: string | null
	): boolean {
		const externalName = this.normalizePreviewText(characteristic.name)
		const externalValue = this.normalizePreviewText(characteristic.value)
		if (!externalName || !externalValue) return false

		const suggestedKey = this.buildMoySkladPreviewAttributeKey(externalName)
		const normalizedName = this.normalizePreviewComparable(externalName)
		const normalizedValue = this.normalizePreviewEnumValue(externalValue)
		let bucket = buckets.get(normalizedName)
		if (!bucket) {
			bucket = {
				externalName,
				suggestedKey,
				normalizedName,
				occurrences: 0,
				sampledExternalIds: [],
				values: new Map()
			}
			buckets.set(normalizedName, bucket)
		}

		bucket.occurrences += 1
		if (externalId) {
			this.pushSample(bucket.sampledExternalIds, externalId)
		}

		let valueBucket = bucket.values.get(normalizedValue)
		if (!valueBucket) {
			valueBucket = {
				externalAttributeName: bucket.externalName,
				externalValue,
				normalizedValue,
				occurrences: 0,
				sampledExternalIds: []
			}
			bucket.values.set(normalizedValue, valueBucket)
		}

		valueBucket.occurrences += 1
		if (externalId) {
			this.pushSample(valueBucket.sampledExternalIds, externalId)
		}

		return true
	}

	private findPreviewAttributeMatches(
		bucket: PreviewCharacteristicBucket,
		attributes: MappingPreviewAttributeRecord[]
	): PreviewAttributeMatch[] {
		return attributes
			.flatMap(attribute => {
				const score = this.scorePreviewAttribute(bucket, attribute)
				return score > 0 ? [{ attribute, score }] : []
			})
			.sort(
				(left, right) =>
					right.score - left.score ||
					left.attribute.displayName.localeCompare(right.attribute.displayName)
			)
			.slice(0, MAPPING_SUGGESTION_LIMIT)
	}

	private scorePreviewAttribute(
		bucket: PreviewCharacteristicBucket,
		attribute: MappingPreviewAttributeRecord
	): number {
		if (attribute.key === bucket.suggestedKey) return 1

		const attributeName = this.normalizePreviewComparable(attribute.displayName)
		if (attributeName === bucket.normalizedName) return 1

		const attributeKey = this.normalizePreviewComparable(attribute.key)
		if (attributeKey === bucket.normalizedName) return 0.95
		if (
			attributeName.includes(bucket.normalizedName) ||
			bucket.normalizedName.includes(attributeName)
		) {
			return 0.75
		}

		return this.similarityScore(attributeName, bucket.normalizedName) >= 0.8
			? 0.65
			: 0
	}

	private findPreviewEnumValue(
		attribute: MappingPreviewAttributeRecord,
		normalizedValue: string
	): MappingPreviewAttributeRecord['enumValues'][number] | null {
		return (
			attribute.enumValues.find(value =>
				this.previewEnumValueMatches(value, normalizedValue)
			) ?? null
		)
	}

	private findPreviewEnumValueSuggestions(
		attribute: MappingPreviewAttributeRecord,
		normalizedValue: string
	): Array<{
		value: MappingPreviewAttributeRecord['enumValues'][number]
		score: number
	}> {
		return attribute.enumValues
			.flatMap(value => {
				const candidates = [
					value.value,
					value.displayName ?? '',
					...(value.aliases ?? []).flatMap(alias => [
						alias.value,
						alias.displayName ?? ''
					])
				]
				const score = Math.max(
					...candidates.map(candidate =>
						this.similarityScore(
							this.normalizePreviewComparable(candidate),
							normalizedValue
						)
					)
				)

				return score >= 0.72 ? [{ value, score }] : []
			})
			.sort((left, right) => right.score - left.score)
			.slice(0, MAPPING_SUGGESTION_LIMIT)
	}

	private previewEnumValueMatches(
		value: MappingPreviewAttributeRecord['enumValues'][number],
		normalizedValue: string
	): boolean {
		return (
			this.normalizePreviewEnumValue(value.value) === normalizedValue ||
			this.normalizePreviewEnumValue(value.displayName ?? '') ===
				normalizedValue ||
			(value.aliases ?? []).some(
				alias =>
					this.normalizePreviewEnumValue(alias.value) === normalizedValue ||
					this.normalizePreviewEnumValue(alias.displayName ?? '') === normalizedValue
			)
		)
	}

	private async getActiveMoySkladIntegration(
		catalogId: string
	): Promise<IntegrationRecord> {
		const integration = await this.repo.findMoySklad(catalogId)
		if (!integration) {
			throw new NotFoundException('Интеграция MoySklad не настроена')
		}
		if (!integration.isActive) {
			throw new ConflictException('Интеграция MoySklad отключена')
		}

		return integration
	}

	private resolvePreviewExternalId(item: MoySkladProduct): string | null {
		return (
			this.normalizePreviewText(item.id) ||
			this.normalizePreviewText(item.externalCode) ||
			this.normalizePreviewText(item.code)
		)
	}

	private normalizeMappingAttributeKey(
		value: string | undefined,
		fallback: string
	): string {
		const normalized = this.normalizePreviewText(value)
			.toLowerCase()
			.replace(/[^a-z0-9_]+/g, '_')
			.replace(/_+/g, '_')
			.replace(/^_+|_+$/g, '')

		return (normalized || fallback).slice(0, 100)
	}

	private readStoredMoySkladAttributeMappingId(
		metadata: unknown,
		normalizedName: string
	): string | null {
		if (!isRecord(metadata)) return null
		const mapping = metadata.moySkladMapping
		if (!isRecord(mapping)) return null
		const attributes = mapping.attributes
		if (!isRecord(attributes)) return null
		const attributeId = attributes[normalizedName]
		if (typeof attributeId !== 'string') return null
		const normalized = attributeId.trim()
		return normalized || null
	}

	private buildMoySkladPreviewAttributeKey(displayName: string): string {
		const slug = slugify(displayName, {
			lower: true,
			strict: true,
			trim: true
		})
			.replace(/-+/g, '-')
			.replace(/^[-_]+|[-_]+$/g, '')
			.replace(/-/g, '_')
		return `moysklad_${slug || 'option'}`.slice(0, 100)
	}

	private normalizePreviewEnumValue(value: string): string {
		return this.normalizePreviewComparable(value)
	}

	private normalizePreviewComparable(value: string): string {
		return this.normalizePreviewText(value).toLowerCase()
	}

	private normalizePreviewText(value: unknown): string {
		if (typeof value !== 'string') return ''
		return value.normalize('NFKC').replace(/\s+/g, ' ').trim()
	}

	private pushSample(samples: string[], value: string): void {
		if (samples.length >= MAPPING_SAMPLE_LIMIT || samples.includes(value)) return
		samples.push(value)
	}

	private similarityScore(left: string, right: string): number {
		if (!left || !right) return 0
		if (left === right) return 1

		const distance = this.levenshteinDistance(left, right)
		return 1 - distance / Math.max(left.length, right.length)
	}

	private levenshteinDistance(left: string, right: string): number {
		const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
		const current = Array.from({ length: right.length + 1 }, () => 0)

		for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
			current[0] = leftIndex
			for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
				const substitutionCost =
					left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
				current[rightIndex] = Math.min(
					previous[rightIndex] + 1,
					current[rightIndex - 1] + 1,
					previous[rightIndex - 1] + substitutionCost
				)
			}
			for (let index = 0; index < previous.length; index += 1) {
				previous[index] = current[index]
			}
		}

		return previous[right.length] ?? 0
	}

	private async reconcileMoySkladStockWebhook(
		integration: IntegrationRecord
	): Promise<IntegrationRecord> {
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		const shouldEnable =
			integration.isActive &&
			metadata.syncStock &&
			isMoySkladExternalField(metadata, 'stock') &&
			metadata.stockWebhookEnabled

		if (!shouldEnable) {
			return this.disableMoySkladStockWebhook(integration, metadata)
		}

		const baseUrl = this.getMoySkladWebhookBaseUrl()
		if (!baseUrl) {
			throw new BadRequestException(
				'INTEGRATION_WEBHOOK_BASE_URL or MOYSKLAD_WEBHOOK_BASE_URL is required to enable MoySklad stock webhook'
			)
		}

		const client = new MoySkladClient({ token: metadata.token })
		const currentWebhook = metadata.stockWebhook
		const needsNewSecret =
			!currentWebhook.externalId || !currentWebhook.secretHash
		const secret = needsNewSecret ? this.generateWebhookSecret() : null
		const secretHash = secret
			? this.hashWebhookSecret(secret)
			: currentWebhook.secretHash
		const url = secret
			? this.buildMoySkladStockWebhookUrl(integration.id, secret, baseUrl)
			: undefined

		let remoteWebhook: MoySkladWebhookStock | undefined
		if (currentWebhook.externalId) {
			try {
				remoteWebhook = await client.updateWebhookStock(currentWebhook.externalId, {
					...(url ? { url } : {}),
					enabled: true,
					reportType: 'all',
					stockType: 'stock'
				})
			} catch (error) {
				if (!this.isProviderNotFound(error)) throw error
			}
		}

		if (!remoteWebhook) {
			const newSecret = secret ?? this.generateWebhookSecret()
			remoteWebhook = await client.createWebhookStock({
				url: this.buildMoySkladStockWebhookUrl(integration.id, newSecret, baseUrl),
				enabled: true,
				reportType: 'all',
				stockType: 'stock'
			})
			return this.persistMoySkladMetadata(integration, {
				...metadata,
				stockWebhookEnabled: true,
				stockWebhook: {
					...metadata.stockWebhook,
					externalId: remoteWebhook.id,
					accountId: remoteWebhook.accountId ?? null,
					secretHash: this.hashWebhookSecret(newSecret),
					reportType: 'all',
					stockType: 'stock',
					lastError: null
				}
			})
		}

		return this.persistMoySkladMetadata(integration, {
			...metadata,
			stockWebhookEnabled: true,
			stockWebhook: {
				...metadata.stockWebhook,
				externalId: remoteWebhook.id,
				accountId: remoteWebhook.accountId ?? currentWebhook.accountId,
				secretHash,
				reportType: 'all',
				stockType: 'stock',
				lastError: null
			}
		})
	}

	private async reconcileMoySkladProductChangeWebhooks(
		integration: IntegrationRecord
	): Promise<IntegrationRecord> {
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)

		if (!integration.isActive) {
			return this.disableMoySkladProductChangeWebhooks(integration, metadata)
		}

		const currentWebhook = metadata.productChangeWebhook
		const needsRegistration =
			!currentWebhook.secretHash ||
			MOYSKLAD_PRODUCT_CHANGE_WEBHOOK_ENTITY_TYPES.some(entityType =>
				MOYSKLAD_PRODUCT_CHANGE_WEBHOOK_ACTIONS.some(
					action => !currentWebhook.externalIds[entityType][action]
				)
			)
		const needsEnable = !currentWebhook.enabled

		if (!needsRegistration && !needsEnable) {
			return integration
		}

		const baseUrl = this.getMoySkladWebhookBaseUrl()
		if (!baseUrl) {
			this.logger.warn(
				`INTEGRATION_WEBHOOK_BASE_URL or MOYSKLAD_WEBHOOK_BASE_URL is required to enable MoySklad product change webhook for integration ${integration.id}`
			)
			return integration
		}

		const client = new MoySkladClient({ token: metadata.token })
		const secret = needsRegistration ? this.generateWebhookSecret() : null
		const url = secret
			? this.buildMoySkladProductChangeWebhookUrl(integration.id, secret, baseUrl)
			: undefined
		const externalIds = this.cloneMoySkladProductChangeWebhookIds(currentWebhook)
		let accountId = currentWebhook.accountId

		for (const entityType of MOYSKLAD_PRODUCT_CHANGE_WEBHOOK_ENTITY_TYPES) {
			for (const action of MOYSKLAD_PRODUCT_CHANGE_WEBHOOK_ACTIONS) {
				let remoteWebhook: MoySkladWebhook | undefined
				const existingId = currentWebhook.externalIds[entityType][action]
				if (existingId) {
					try {
						remoteWebhook = await client.updateWebhook(existingId, {
							...(url ? { url } : {}),
							enabled: true,
							action,
							entityType
						})
					} catch (error) {
						if (!this.isProviderNotFound(error)) throw error
					}
				}

				if (!remoteWebhook) {
					if (!url || !secret) {
						throw new BadRequestException(
							'MoySklad product change webhook secret rotation is required'
						)
					}
					remoteWebhook = await client.createWebhook({
						url,
						enabled: true,
						action,
						entityType
					})
				}

				externalIds[entityType][action] = remoteWebhook.id
				accountId = accountId ?? remoteWebhook.accountId ?? null
			}
		}

		return this.persistMoySkladMetadata(integration, {
			...metadata,
			productChangeWebhook: {
				...metadata.productChangeWebhook,
				enabled: true,
				externalIds,
				accountId,
				secretHash: secret
					? this.hashWebhookSecret(secret)
					: metadata.productChangeWebhook.secretHash,
				lastError: null
			}
		})
	}

	private async reconcileMoySkladProductFolderWebhooks(
		integration: IntegrationRecord
	): Promise<IntegrationRecord> {
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)

		if (!integration.isActive) {
			return this.disableMoySkladProductFolderWebhooks(integration, metadata)
		}

		const currentWebhook = metadata.productFolderWebhook
		const needsRegistration =
			!currentWebhook.secretHash ||
			MOYSKLAD_PRODUCT_FOLDER_WEBHOOK_ACTIONS.some(
				action => !currentWebhook.externalIds[action]
			)
		const needsEnable = !currentWebhook.enabled

		if (!needsRegistration && !needsEnable) {
			return integration
		}

		const baseUrl = this.getMoySkladWebhookBaseUrl()
		if (!baseUrl) {
			this.logger.warn(
				`INTEGRATION_WEBHOOK_BASE_URL or MOYSKLAD_WEBHOOK_BASE_URL is required to enable MoySklad productfolder webhook for integration ${integration.id}`
			)
			return integration
		}

		const client = new MoySkladClient({ token: metadata.token })
		const secret = needsRegistration ? this.generateWebhookSecret() : null
		const url = secret
			? this.buildMoySkladProductFolderWebhookUrl(integration.id, secret, baseUrl)
			: undefined
		const externalIds = { ...currentWebhook.externalIds }
		let accountId = currentWebhook.accountId

		for (const action of MOYSKLAD_PRODUCT_FOLDER_WEBHOOK_ACTIONS) {
			let remoteWebhook: MoySkladWebhook | undefined
			const existingId = currentWebhook.externalIds[action]
			if (existingId) {
				try {
					remoteWebhook = await client.updateWebhook(existingId, {
						...(url ? { url } : {}),
						enabled: true,
						action,
						entityType: MOYSKLAD_PRODUCT_FOLDER_WEBHOOK_ENTITY_TYPE
					})
				} catch (error) {
					if (!this.isProviderNotFound(error)) throw error
				}
			}

			if (!remoteWebhook) {
				if (!url || !secret) {
					throw new BadRequestException(
						'MoySklad productfolder webhook secret rotation is required'
					)
				}
				remoteWebhook = await client.createWebhook({
					url,
					enabled: true,
					action,
					entityType: MOYSKLAD_PRODUCT_FOLDER_WEBHOOK_ENTITY_TYPE
				})
			}

			externalIds[action] = remoteWebhook.id
			accountId = accountId ?? remoteWebhook.accountId ?? null
		}

		return this.persistMoySkladMetadata(integration, {
			...metadata,
			productFolderWebhook: {
				...metadata.productFolderWebhook,
				enabled: true,
				externalIds,
				accountId,
				secretHash: secret
					? this.hashWebhookSecret(secret)
					: metadata.productFolderWebhook.secretHash,
				lastError: null
			}
		})
	}

	private async reconcileMoySkladProductDeleteWebhooks(
		integration: IntegrationRecord
	): Promise<IntegrationRecord> {
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)

		if (!integration.isActive) {
			return this.disableMoySkladProductDeleteWebhooks(integration, metadata)
		}

		const currentWebhook = metadata.productDeleteWebhook
		const needsRegistration =
			!currentWebhook.secretHash ||
			MOYSKLAD_PRODUCT_DELETE_WEBHOOK_ENTITY_TYPES.some(
				entityType => !currentWebhook.externalIds[entityType]
			)
		const needsEnable = !currentWebhook.enabled

		if (!needsRegistration && !needsEnable) {
			return integration
		}

		const baseUrl = this.getMoySkladWebhookBaseUrl()
		if (!baseUrl) {
			this.logger.warn(
				`INTEGRATION_WEBHOOK_BASE_URL or MOYSKLAD_WEBHOOK_BASE_URL is required to enable MoySklad product delete webhook for integration ${integration.id}`
			)
			return integration
		}

		const client = new MoySkladClient({ token: metadata.token })
		const secret = needsRegistration ? this.generateWebhookSecret() : null
		const url = secret
			? this.buildMoySkladProductDeleteWebhookUrl(integration.id, secret, baseUrl)
			: undefined
		const externalIds = { ...currentWebhook.externalIds }
		let accountId = currentWebhook.accountId

		for (const entityType of MOYSKLAD_PRODUCT_DELETE_WEBHOOK_ENTITY_TYPES) {
			let remoteWebhook: MoySkladWebhook | undefined
			const existingId = currentWebhook.externalIds[entityType]
			if (existingId) {
				try {
					remoteWebhook = await client.updateWebhook(existingId, {
						...(url ? { url } : {}),
						enabled: true,
						action: 'DELETE',
						entityType
					})
				} catch (error) {
					if (!this.isProviderNotFound(error)) throw error
				}
			}

			if (!remoteWebhook) {
				if (!url || !secret) {
					throw new BadRequestException(
						'MoySklad product delete webhook secret rotation is required'
					)
				}
				remoteWebhook = await client.createWebhook({
					url,
					enabled: true,
					action: 'DELETE',
					entityType
				})
			}

			externalIds[entityType] = remoteWebhook.id
			accountId = accountId ?? remoteWebhook.accountId ?? null
		}

		return this.persistMoySkladMetadata(integration, {
			...metadata,
			productDeleteWebhook: {
				...metadata.productDeleteWebhook,
				enabled: true,
				externalIds,
				accountId,
				secretHash: secret
					? this.hashWebhookSecret(secret)
					: metadata.productDeleteWebhook.secretHash,
				lastError: null
			}
		})
	}

	private async disableMoySkladStockWebhook(
		integration: IntegrationRecord,
		metadata: MoySkladMetadata
	): Promise<IntegrationRecord> {
		if (!metadata.stockWebhook.externalId) {
			return integration
		}

		try {
			await new MoySkladClient({ token: metadata.token }).disableWebhookStock(
				metadata.stockWebhook.externalId
			)
		} catch (error) {
			if (!this.isProviderNotFound(error)) throw error
		}

		return this.persistMoySkladMetadata(integration, {
			...metadata,
			stockWebhookEnabled: false
		})
	}

	private async disableMoySkladProductDeleteWebhooks(
		integration: IntegrationRecord,
		metadata: MoySkladMetadata
	): Promise<IntegrationRecord> {
		const webhookIds = this.getMoySkladProductDeleteWebhookIds(
			metadata.productDeleteWebhook
		)
		if (!metadata.productDeleteWebhook.enabled && !webhookIds.length) {
			return integration
		}

		const client = new MoySkladClient({ token: metadata.token })
		for (const webhookId of webhookIds) {
			try {
				await client.disableWebhook(webhookId)
			} catch (error) {
				if (!this.isProviderNotFound(error)) throw error
			}
		}

		return this.persistMoySkladMetadata(integration, {
			...metadata,
			productDeleteWebhook: {
				...metadata.productDeleteWebhook,
				enabled: false
			}
		})
	}

	private async disableMoySkladProductFolderWebhooks(
		integration: IntegrationRecord,
		metadata: MoySkladMetadata
	): Promise<IntegrationRecord> {
		const webhookIds = this.getMoySkladProductFolderWebhookIds(
			metadata.productFolderWebhook
		)
		if (!metadata.productFolderWebhook.enabled && !webhookIds.length) {
			return integration
		}

		const client = new MoySkladClient({ token: metadata.token })
		for (const webhookId of webhookIds) {
			try {
				await client.disableWebhook(webhookId)
			} catch (error) {
				if (!this.isProviderNotFound(error)) throw error
			}
		}

		return this.persistMoySkladMetadata(integration, {
			...metadata,
			productFolderWebhook: {
				...metadata.productFolderWebhook,
				enabled: false
			}
		})
	}

	private async disableMoySkladProductChangeWebhooks(
		integration: IntegrationRecord,
		metadata: MoySkladMetadata
	): Promise<IntegrationRecord> {
		const webhookIds = this.getMoySkladProductChangeWebhookIds(
			metadata.productChangeWebhook
		)
		if (!metadata.productChangeWebhook.enabled && !webhookIds.length) {
			return integration
		}

		const client = new MoySkladClient({ token: metadata.token })
		for (const webhookId of webhookIds) {
			try {
				await client.disableWebhook(webhookId)
			} catch (error) {
				if (!this.isProviderNotFound(error)) throw error
			}
		}

		return this.persistMoySkladMetadata(integration, {
			...metadata,
			productChangeWebhook: {
				...metadata.productChangeWebhook,
				enabled: false
			}
		})
	}

	private async deleteMoySkladStockWebhook(
		integration: IntegrationRecord
	): Promise<void> {
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		if (!metadata.stockWebhook.externalId) return

		try {
			await new MoySkladClient({ token: metadata.token }).deleteWebhookStock(
				metadata.stockWebhook.externalId
			)
		} catch (error) {
			if (!this.isProviderNotFound(error)) throw error
		}
	}

	private async deleteMoySkladProductChangeWebhooks(
		integration: IntegrationRecord
	): Promise<void> {
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		const webhookIds = this.getMoySkladProductChangeWebhookIds(
			metadata.productChangeWebhook
		)
		if (!webhookIds.length) return

		const client = new MoySkladClient({ token: metadata.token })
		for (const webhookId of webhookIds) {
			try {
				await client.deleteWebhook(webhookId)
			} catch (error) {
				if (!this.isProviderNotFound(error)) throw error
			}
		}
	}

	private async deleteMoySkladProductFolderWebhooks(
		integration: IntegrationRecord
	): Promise<void> {
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		const webhookIds = this.getMoySkladProductFolderWebhookIds(
			metadata.productFolderWebhook
		)
		if (!webhookIds.length) return

		const client = new MoySkladClient({ token: metadata.token })
		for (const webhookId of webhookIds) {
			try {
				await client.deleteWebhook(webhookId)
			} catch (error) {
				if (!this.isProviderNotFound(error)) throw error
			}
		}
	}

	private async deleteMoySkladProductDeleteWebhooks(
		integration: IntegrationRecord
	): Promise<void> {
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		const webhookIds = this.getMoySkladProductDeleteWebhookIds(
			metadata.productDeleteWebhook
		)
		if (!webhookIds.length) return

		const client = new MoySkladClient({ token: metadata.token })
		for (const webhookId of webhookIds) {
			try {
				await client.deleteWebhook(webhookId)
			} catch (error) {
				if (!this.isProviderNotFound(error)) throw error
			}
		}
	}

	private getMoySkladProductDeleteWebhookIds(
		webhook: MoySkladProductDeleteWebhookMetadata
	): string[] {
		return [
			...new Set(
				MOYSKLAD_PRODUCT_DELETE_WEBHOOK_ENTITY_TYPES.map(
					entityType => webhook.externalIds[entityType]
				).filter(isPresent)
			)
		]
	}

	private getMoySkladProductChangeWebhookIds(
		webhook: MoySkladProductChangeWebhookMetadata
	): string[] {
		const ids: string[] = []
		for (const entityType of MOYSKLAD_PRODUCT_CHANGE_WEBHOOK_ENTITY_TYPES) {
			for (const action of MOYSKLAD_PRODUCT_CHANGE_WEBHOOK_ACTIONS) {
				const webhookId = webhook.externalIds[entityType][action]
				if (webhookId) ids.push(webhookId)
			}
		}

		return [...new Set(ids)]
	}

	private getMoySkladProductFolderWebhookIds(
		webhook: MoySkladProductFolderWebhookMetadata
	): string[] {
		return [
			...new Set(
				MOYSKLAD_PRODUCT_FOLDER_WEBHOOK_ACTIONS.map(
					action => webhook.externalIds[action]
				).filter(isPresent)
			)
		]
	}

	private cloneMoySkladProductChangeWebhookIds(
		webhook: MoySkladProductChangeWebhookMetadata
	): MoySkladProductChangeWebhookMetadata['externalIds'] {
		return {
			product: { ...webhook.externalIds.product },
			service: { ...webhook.externalIds.service },
			bundle: { ...webhook.externalIds.bundle },
			variant: { ...webhook.externalIds.variant }
		}
	}

	private async persistMoySkladMetadata(
		integration: IntegrationRecord,
		metadata: MoySkladMetadata
	): Promise<IntegrationRecord> {
		const stored = this.metadataCrypto.buildStoredMetadata(metadata)
		const updated = await this.repo.updateMoySkladMetadataById(
			integration.id,
			stored
		)
		return updated ?? integration
	}

	private getMoySkladWebhookBaseUrl(): string | null {
		const raw = this.configService
			.get('integration', { infer: true })
			?.moySkladWebhookBaseUrl?.trim()
		if (!raw) return null

		try {
			const url = new URL(raw)
			if (url.protocol !== 'https:' && url.protocol !== 'http:') {
				return null
			}
			url.pathname = url.pathname.replace(/\/+$/, '')
			url.search = ''
			url.hash = ''
			return url.toString().replace(/\/+$/, '')
		} catch {
			return null
		}
	}

	private async processIikoWebhookEvent(params: {
		integration: IntegrationRecord
		metadata: IikoMetadata
		storedEvent: IntegrationWebhookEventRecord
		event: ReturnType<typeof normalizeIikoWebhookPayload>
		jobId: string
	}): Promise<void> {
		await this.repo.markWebhookEventsProcessing(
			[params.storedEvent.id],
			params.jobId
		)
		try {
			const action = resolveIikoWebhookAction(params.event.eventType)
			if (action === 'stock-sync') {
				const queued = await this.iikoQueue.enqueueStockWebhookSync(
					params.integration
				)
				await this.repo.markWebhookEventProcessed(params.storedEvent.id)
				if (!queued.queued) {
					this.logger.log('iiko stop-list webhook accepted without queue', {
						integrationId: params.integration.id,
						reason: 'reason' in queued ? queued.reason : 'not_queued'
					})
				}
			} else if (action === 'catalog-sync') {
				const queued = await this.iikoQueue.enqueueCatalogWebhookSync(
					params.integration
				)
				await this.repo.markWebhookEventProcessed(params.storedEvent.id)
				if (!queued.queued) {
					this.logger.log('iiko menu webhook accepted without queue', {
						integrationId: params.integration.id,
						reason: 'reason' in queued ? queued.reason : 'not_queued'
					})
				}
			} else if (action === 'order-update') {
				await this.applyIikoOrderWebhook(params.integration, params.event)
				await this.repo.markWebhookEventProcessed(params.storedEvent.id)
			} else {
				await this.repo.markWebhookEventsSkipped(
					[params.storedEvent.id],
					`iiko webhook event ${params.event.eventType} does not require local action`
				)
			}

			await this.touchIikoWebhook(params.integration, params.metadata, {
				lastReceivedAt: new Date().toISOString(),
				lastEventType: params.event.eventType,
				lastError: null
			})
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			await this.repo.markWebhookEventFailed(params.storedEvent.id, message)
			await this.touchIikoWebhook(params.integration, params.metadata, {
				lastReceivedAt: new Date().toISOString(),
				lastEventType: params.event.eventType,
				lastError: message
			})
			throw error
		}
	}

	private async applyIikoOrderWebhook(
		integration: IntegrationRecord,
		event: ReturnType<typeof normalizeIikoWebhookPayload>
	): Promise<void> {
		const refs = resolveIikoWebhookOrderRefs(event)
		const exportRecord = refs.localOrderId
			? await this.repo.findOrderExportByOrderId(integration.id, refs.localOrderId)
			: refs.iikoOrderId
				? await this.repo.findOrderExportByExternalId(
						integration.id,
						refs.iikoOrderId,
						IntegrationProvider.IIKO
					)
				: null

		if (!exportRecord) {
			this.logger.warn('iiko order webhook did not match a local export', {
				integrationId: integration.id,
				eventType: event.eventType,
				iikoOrderId: refs.iikoOrderId,
				localOrderId: refs.localOrderId,
				externalNumber: refs.externalNumber
			})
			return
		}

		const response = {
			eventType: event.eventType,
			eventTime: event.eventTime,
			correlationId: event.correlationId,
			eventInfo: event.eventInfo
		}

		if (
			event.eventType === 'DeliveryOrderError' ||
			refs.creationStatus === 'Error'
		) {
			await this.repo.markOrderExportError(
				exportRecord.id,
				`iiko webhook ${event.eventType}: ${renderSafeProviderErrorMessage(
					JSON.stringify(refs.errorInfo ?? response)
				)}`
			)
			return
		}

		if (refs.iikoOrderId) {
			await this.repo.markOrderExportSuccess(exportRecord.id, {
				externalId: refs.iikoOrderId,
				response: response as Prisma.InputJsonValue
			})
		}
	}

	private async updateStoredIikoMetadata(
		integration: IntegrationRecord,
		metadata: IikoMetadata
	): Promise<void> {
		const stored = this.iikoMetadataCrypto.buildStoredMetadata(metadata)
		await this.repo.updateIikoMetadataById(integration.id, stored)
	}

	private async touchIikoWebhook(
		integration: IntegrationRecord,
		metadata: IikoMetadata,
		patch: Partial<IikoWebhookMetadata>
	): Promise<void> {
		await this.updateStoredIikoMetadata(integration, {
			...metadata,
			webhook: {
				...metadata.webhook,
				...patch
			}
		})
	}

	private async upsertExternalItemWithGeneratedCode(
		params: ExternalItemUpsertInput
	): Promise<IntegrationExternalItemRecord> {
		let lastError: unknown = null
		for (let attempt = 0; attempt < 5; attempt += 1) {
			try {
				return await this.repo.upsertExternalItem({
					...params,
					publicCode: generateIntegrationExternalItemCode()
				})
			} catch (error) {
				lastError = error
				if (!isPrismaUniqueConstraintError(error)) {
					throw error
				}
			}
		}

		throw lastError
	}

	private resolveIikoApiBaseUrl(): string {
		const config = this.configService.get('integration', { infer: true })
		return config?.iikoApiBaseUrl ?? 'https://api-ru.iiko.services'
	}

	private resolveIikoWebhookBaseUrl(): string {
		const raw = this.configService
			.get('integration', { infer: true })
			?.iikoWebhookBaseUrl?.trim()
		if (!raw) {
			throw new BadRequestException(
				'INTEGRATION_WEBHOOK_BASE_URL or IIKO_WEBHOOK_BASE_URL is required to enable iiko webhooks'
			)
		}

		return raw.replace(/\/+$/g, '')
	}

	private buildIikoWebhookUrl(
		baseUrl: string,
		integrationId: string,
		secret: string
	): string {
		return `${baseUrl}/integration/webhooks/iiko/${encodeURIComponent(integrationId)}/${encodeURIComponent(secret)}`
	}

	private buildMoySkladStockWebhookUrl(
		integrationId: string,
		secret: string,
		baseUrl: string
	): string {
		return `${baseUrl}/integration/webhooks/moysklad/stock/${encodeURIComponent(integrationId)}/${encodeURIComponent(secret)}`
	}

	private buildMoySkladProductDeleteWebhookUrl(
		integrationId: string,
		secret: string,
		baseUrl: string
	): string {
		return `${baseUrl}/integration/webhooks/moysklad/product-delete/${encodeURIComponent(integrationId)}/${encodeURIComponent(secret)}`
	}

	private buildMoySkladProductChangeWebhookUrl(
		integrationId: string,
		secret: string,
		baseUrl: string
	): string {
		return `${baseUrl}/integration/webhooks/moysklad/product-change/${encodeURIComponent(integrationId)}/${encodeURIComponent(secret)}`
	}

	private buildMoySkladProductFolderWebhookUrl(
		integrationId: string,
		secret: string,
		baseUrl: string
	): string {
		return `${baseUrl}/integration/webhooks/moysklad/productfolder/${encodeURIComponent(integrationId)}/${encodeURIComponent(secret)}`
	}

	private generateWebhookSecret(): string {
		return randomBytes(32).toString('hex')
	}

	private hashWebhookSecret(secret: string): string {
		return createHash('sha256').update(secret).digest('hex')
	}

	private assertMoySkladWebhookSecret(
		webhook: { secretHash: string | null },
		secret: string,
		label: string
	): void {
		const expectedHash = webhook.secretHash
		if (!expectedHash) {
			throw new ForbiddenException(`${label} is not registered`)
		}

		const actual = Buffer.from(this.hashWebhookSecret(secret), 'hex')
		const expected = Buffer.from(expectedHash, 'hex')
		if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
			throw new ForbiddenException(`Invalid ${label} secret`)
		}
	}

	private assertIikoWebhookSecret(
		webhook: { secretHash: string | null },
		secret: string
	): void {
		const expectedHash = webhook.secretHash
		if (!expectedHash) {
			throw new ForbiddenException('iiko webhook is not registered')
		}

		const actual = Buffer.from(this.hashWebhookSecret(secret), 'hex')
		const expected = Buffer.from(expectedHash, 'hex')
		if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
			throw new ForbiddenException('Invalid iiko webhook secret')
		}
	}

	private assertMoySkladWebhookAccount(
		webhook: { accountId: string | null },
		accountId: string,
		label: string
	): void {
		const expectedAccountId = webhook.accountId
		if (expectedAccountId && expectedAccountId !== accountId) {
			throw new ForbiddenException(`Invalid ${label} account`)
		}
	}

	private extractMoySkladStockWebhookEvents(
		payload: unknown
	): MoySkladStockWebhookNotification[] {
		const eventsSource =
			isRecord(payload) && Array.isArray(payload.events)
				? payload.events
				: [payload]
		const events = eventsSource
			.map(item => {
				if (!isRecord(item)) return null
				const accountId = readNonEmptyString(item.accountId)
				const reportUrl = readNonEmptyString(item.reportUrl)
				if (!accountId || !reportUrl) return null

				return {
					accountId,
					reportUrl: normalizeMoySkladStockReportUrl(reportUrl),
					reportType: 'all',
					stockType: 'stock'
				} satisfies MoySkladStockWebhookNotification
			})
			.filter(isPresent)

		if (!events.length) {
			throw new BadRequestException('MoySklad stock webhook payload is empty')
		}

		return events
	}

	private extractMoySkladProductDeleteWebhookEvents(
		payload: unknown
	): MoySkladProductDeleteWebhookNotification[] {
		const rootAccountId = isRecord(payload)
			? readNonEmptyString(payload.accountId)
			: null
		const eventsSource =
			isRecord(payload) && Array.isArray(payload.events)
				? payload.events
				: [payload]
		const events = eventsSource
			.map(item => {
				if (!isRecord(item)) return null
				const accountId = readNonEmptyString(item.accountId) ?? rootAccountId
				const action = readNonEmptyString(item.action)?.toUpperCase()
				const meta = isRecord(item.meta)
					? item.meta
					: isRecord(payload) && isRecord(payload.meta)
						? payload.meta
						: null
				const href = readNonEmptyString(meta?.href)
				const entityType = this.normalizeMoySkladProductDeleteEntityType(
					readNonEmptyString(meta?.type) ?? this.extractMoySkladEntityType(href)
				)
				const externalId = this.extractMoySkladEntityId(href, entityType)

				if (
					!accountId ||
					action !== 'DELETE' ||
					!href ||
					!entityType ||
					!externalId
				) {
					return null
				}

				return {
					accountId,
					action: 'DELETE',
					entityType,
					externalId,
					href
				} satisfies MoySkladProductDeleteWebhookNotification
			})
			.filter(isPresent)

		if (!events.length) {
			throw new BadRequestException(
				'MoySklad product delete webhook payload is empty'
			)
		}

		return events
	}

	private extractMoySkladProductChangeWebhookEvents(
		payload: unknown
	): MoySkladProductChangeWebhookNotification[] {
		const rootAccountId = isRecord(payload)
			? readNonEmptyString(payload.accountId)
			: null
		const eventsSource =
			isRecord(payload) && Array.isArray(payload.events)
				? payload.events
				: [payload]
		const events = eventsSource
			.map(item => {
				if (!isRecord(item)) return null
				const accountId = readNonEmptyString(item.accountId) ?? rootAccountId
				const action = this.normalizeMoySkladProductChangeAction(
					readNonEmptyString(item.action)
				)
				const meta = isRecord(item.meta)
					? item.meta
					: isRecord(payload) && isRecord(payload.meta)
						? payload.meta
						: null
				const href = readNonEmptyString(meta?.href)
				const entityType = this.normalizeMoySkladProductChangeEntityType(
					readNonEmptyString(meta?.type) ?? this.extractMoySkladEntityType(href)
				)
				const externalId = this.extractMoySkladEntityId(href, entityType)

				if (!accountId || !action || !href || !entityType || !externalId) {
					return null
				}

				return {
					accountId,
					action,
					entityType,
					externalId,
					href
				} satisfies MoySkladProductChangeWebhookNotification
			})
			.filter(isPresent)

		if (!events.length) {
			throw new BadRequestException(
				'MoySklad product change webhook payload is empty'
			)
		}

		return events
	}

	private extractMoySkladProductFolderWebhookEvents(
		payload: unknown
	): MoySkladProductFolderWebhookNotification[] {
		const rootAccountId = isRecord(payload)
			? readNonEmptyString(payload.accountId)
			: null
		const eventsSource =
			isRecord(payload) && Array.isArray(payload.events)
				? payload.events
				: [payload]
		const events = eventsSource
			.map(item => {
				if (!isRecord(item)) return null
				const accountId = readNonEmptyString(item.accountId) ?? rootAccountId
				const action = this.normalizeMoySkladProductFolderAction(
					readNonEmptyString(item.action)
				)
				const meta = isRecord(item.meta)
					? item.meta
					: isRecord(payload) && isRecord(payload.meta)
						? payload.meta
						: null
				const href = readNonEmptyString(meta?.href)
				const entityType = this.normalizeMoySkladProductFolderEntityType(
					readNonEmptyString(meta?.type) ?? this.extractMoySkladEntityType(href)
				)
				const externalId = this.extractMoySkladEntityId(href, entityType)

				if (!accountId || !action || !href || !entityType || !externalId) {
					return null
				}

				return {
					accountId,
					action,
					entityType,
					externalId,
					href
				} satisfies MoySkladProductFolderWebhookNotification
			})
			.filter(isPresent)

		if (!events.length) {
			throw new BadRequestException(
				'MoySklad productfolder webhook payload is empty'
			)
		}

		return events
	}

	private dedupeMoySkladProductChangeWebhookEvents(
		events: MoySkladProductChangeWebhookNotification[]
	): MoySkladProductChangeWebhookNotification[] {
		const byEntity = new Map<string, MoySkladProductChangeWebhookNotification>()
		for (const event of events) {
			const key = `${event.entityType}:${event.externalId}`
			const existing = byEntity.get(key)
			if (!existing || event.action === 'UPDATE') {
				byEntity.set(key, event)
			}
		}

		return [...byEntity.values()]
	}

	private dedupeMoySkladProductFolderWebhookEvents(
		events: MoySkladProductFolderWebhookNotification[]
	): MoySkladProductFolderWebhookNotification[] {
		const priority: Record<MoySkladProductFolderWebhookAction, number> = {
			CREATE: 1,
			UPDATE: 2,
			DELETE: 3
		}
		const byFolder = new Map<string, MoySkladProductFolderWebhookNotification>()
		for (const event of events) {
			const key = event.externalId
			const existing = byFolder.get(key)
			if (!existing || priority[event.action] >= priority[existing.action]) {
				byFolder.set(key, event)
			}
		}

		return [...byFolder.values()]
	}

	private buildProductLinkByExternalIdentity(
		links: Array<{
			productId: string
			externalId: string
			externalCode: string | null
			rawMeta: unknown
		}>
	): Map<string, (typeof links)[number]> {
		const map = new Map<string, (typeof links)[number]>()
		for (const link of links) {
			this.addProductLinkIdentity(map, link.externalId, link)
			this.addProductLinkIdentity(map, link.externalCode, link)
			this.addProductLinkIdentity(
				map,
				this.readRawMetaString(link.rawMeta, 'id'),
				link
			)
		}
		return map
	}

	private addProductLinkIdentity<TLink>(
		map: Map<string, TLink>,
		value: string | null | undefined,
		link: TLink
	): void {
		const normalized = value?.trim()
		if (normalized && !map.has(normalized)) {
			map.set(normalized, link)
		}
	}

	private normalizeMoySkladProductDeleteEntityType(
		value: string | null
	): MoySkladProductDeleteWebhookEntityType | null {
		if (
			MOYSKLAD_PRODUCT_DELETE_WEBHOOK_ENTITY_TYPES.includes(
				value as MoySkladProductDeleteWebhookEntityType
			)
		) {
			return value as MoySkladProductDeleteWebhookEntityType
		}
		return null
	}

	private normalizeMoySkladProductChangeEntityType(
		value: string | null
	): MoySkladProductChangeWebhookEntityType | null {
		if (
			MOYSKLAD_PRODUCT_CHANGE_WEBHOOK_ENTITY_TYPES.includes(
				value as MoySkladProductChangeWebhookEntityType
			)
		) {
			return value as MoySkladProductChangeWebhookEntityType
		}
		return null
	}

	private normalizeMoySkladProductChangeAction(
		value: string | null
	): MoySkladProductChangeWebhookAction | null {
		const normalized = value?.toUpperCase()
		if (
			MOYSKLAD_PRODUCT_CHANGE_WEBHOOK_ACTIONS.includes(
				normalized as MoySkladProductChangeWebhookAction
			)
		) {
			return normalized as MoySkladProductChangeWebhookAction
		}
		return null
	}

	private normalizeMoySkladProductFolderEntityType(
		value: string | null
	): 'productfolder' | null {
		return value === MOYSKLAD_PRODUCT_FOLDER_WEBHOOK_ENTITY_TYPE
			? MOYSKLAD_PRODUCT_FOLDER_WEBHOOK_ENTITY_TYPE
			: null
	}

	private normalizeMoySkladProductFolderAction(
		value: string | null
	): MoySkladProductFolderWebhookAction | null {
		const normalized = value?.toUpperCase()
		if (
			MOYSKLAD_PRODUCT_FOLDER_WEBHOOK_ACTIONS.includes(
				normalized as MoySkladProductFolderWebhookAction
			)
		) {
			return normalized as MoySkladProductFolderWebhookAction
		}
		return null
	}

	private extractMoySkladEntityType(href: string | null): string | null {
		const match = this.matchMoySkladEntityHref(href)
		return match?.entityType ?? null
	}

	private extractMoySkladEntityId(
		href: string | null,
		entityType: string | null
	): string | null {
		const match = this.matchMoySkladEntityHref(href)
		if (!match || match.entityType !== entityType) return null
		return match.externalId
	}

	private matchMoySkladEntityHref(
		href: string | null
	): { entityType: string; externalId: string } | null {
		if (!href) return null

		let url: URL
		try {
			url = new URL(href)
		} catch {
			return null
		}
		if (url.hostname !== 'api.moysklad.ru') return null

		const match = url.pathname.match(/\/entity\/([^/]+)\/([^/?#]+)/i)
		const entityType = match?.[1] ? decodeURIComponent(match[1]) : ''
		const externalId = match?.[2] ? decodeURIComponent(match[2]) : ''
		if (!entityType || !externalId) return null
		return { entityType, externalId }
	}

	private readRawMetaString(rawMeta: unknown, key: string): string | null {
		if (!isRecord(rawMeta)) return null

		return readNonEmptyString(rawMeta[key])
	}

	private normalizeWebhookRequestId(
		value: string | string[] | undefined,
		payload: unknown
	): string {
		const raw = Array.isArray(value) ? value[0] : value
		const normalized = typeof raw === 'string' ? raw.trim() : ''
		if (normalized) return normalized.slice(0, 180)

		return createHash('sha256')
			.update(JSON.stringify(payload ?? null))
			.digest('hex')
	}

	private toPrismaJson(value: unknown): Prisma.InputJsonValue {
		return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue
	}

	private isProviderNotFound(error: unknown): boolean {
		return (
			error instanceof Error && /MoySklad API error 404:/i.test(error.message)
		)
	}

	private mapMoySkladIntegration(
		integration: IntegrationRecord
	): MoySkladIntegrationDto {
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)

		return {
			provider: integration.provider,
			capabilities: getIntegrationProviderCapabilities(integration.provider),
			isActive: integration.isActive,
			hasToken: Boolean(metadata.token),
			tokenPreview: maskToken(metadata.token),
			priceTypeName: metadata.priceTypeName,
			importImages: metadata.importImages,
			syncStock: metadata.syncStock,
			fieldOwnership: metadata.fieldOwnership,
			stockWebhook: {
				enabled: metadata.stockWebhookEnabled,
				registered: Boolean(metadata.stockWebhook.externalId),
				reportType: metadata.stockWebhook.reportType,
				stockType: metadata.stockWebhook.stockType,
				lastReceivedAt: metadata.stockWebhook.lastReceivedAt,
				lastProcessedAt: metadata.stockWebhook.lastProcessedAt,
				lastError: metadata.stockWebhook.lastError
					? renderSafeProviderErrorMessage(metadata.stockWebhook.lastError)
					: null
			},
			exportOrders: metadata.exportOrders,
			orderExportOrganizationId: metadata.orderExportOrganizationId,
			orderExportCounterpartyId: metadata.orderExportCounterpartyId,
			orderExportStoreId: metadata.orderExportStoreId,
			scheduleEnabled: metadata.scheduleEnabled,
			schedulePattern: metadata.schedulePattern,
			scheduleTimezone: metadata.scheduleTimezone,
			lastSyncStatus: integration.lastSyncStatus,
			syncStartedAt: integration.syncStartedAt,
			lastSyncAt: integration.lastSyncAt,
			lastStockSyncedAt: metadata.lastStockSyncedAt,
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

	private mapIikoIntegration(
		integration: IntegrationRecord
	): IikoIntegrationDto {
		const metadata = this.iikoMetadataCrypto.parseStoredMetadata(
			integration.metadata
		)

		return {
			provider: integration.provider,
			capabilities: getIntegrationProviderCapabilities(integration.provider),
			isActive: integration.isActive,
			hasApiLogin: Boolean(metadata.apiLogin),
			apiLoginPreview: maskApiLogin(metadata.apiLogin),
			organizationId: metadata.organizationId,
			organizationName: metadata.organizationName,
			externalMenuId: metadata.externalMenuId,
			externalMenuName: metadata.externalMenuName,
			priceCategoryId: metadata.priceCategoryId,
			priceCategoryName: metadata.priceCategoryName,
			terminalGroupId: metadata.terminalGroupId,
			terminalGroupName: metadata.terminalGroupName,
			menuVersion: metadata.menuVersion,
			syncSource: metadata.syncSource,
			importImages: metadata.importImages,
			exportOrders: metadata.exportOrders,
			webhook: this.mapIikoWebhookStatus(metadata.webhook),
			orderExportServiceType: metadata.orderExportServiceType,
			orderExportSourceKey: metadata.orderExportSourceKey,
			lastRevision: metadata.lastRevision,
			lastMenuSyncedAt: metadata.lastMenuSyncedAt,
			lastStopListSyncedAt: metadata.lastStopListSyncedAt,
			lastSyncStatus: integration.lastSyncStatus,
			syncStartedAt: integration.syncStartedAt,
			lastSyncAt: integration.lastSyncAt,
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

	private async enrichIikoImportPreviewDiff(
		integration: IntegrationRecord | null,
		preview: IikoExternalMenuPreview
	): Promise<IikoImportPreviewDto> {
		let links: IntegrationProductPreviewRecord[] = []
		if (
			integration &&
			typeof this.repo.findProductPreviewLinksByIntegration === 'function'
		) {
			links = await this.repo.findProductPreviewLinksByIntegration(integration.id)
		}
		const linksByExternalId = new Map(
			links.map(link => [link.externalId, link] as const)
		)
		const previewExternalIds = new Set<string>()
		let newItems = 0
		let matchedItems = 0
		let changedItems = 0
		let priceChanges = 0
		let nameChanges = 0
		let unchangedItems = 0

		const items = preview.items.map(item => {
			previewExternalIds.add(item.id)
			if (!item.willImport) {
				return {
					...item,
					diffStatus: 'skipped',
					localProductId: null,
					localName: null,
					localPrice: null
				}
			}

			const link = linksByExternalId.get(item.id)
			if (!link || link.product.deleteAt) {
				newItems += 1
				return {
					...item,
					diffStatus: 'new',
					localProductId: link?.productId ?? null,
					localName: null,
					localPrice: null
				}
			}

			matchedItems += 1
			const localPrice = this.numberOrNull(link.product.price)
			const priceChanged = !this.sameMoney(localPrice, item.price)
			const nameChanged = link.product.name.trim() !== item.name.trim()
			if (priceChanged) priceChanges += 1
			if (nameChanged) nameChanges += 1

			const diffStatus =
				priceChanged && nameChanged
					? 'changed'
					: priceChanged
						? 'price_changed'
						: nameChanged
							? 'name_changed'
							: 'unchanged'

			if (diffStatus === 'unchanged') {
				unchangedItems += 1
			} else {
				changedItems += 1
			}

			return {
				...item,
				diffStatus,
				localProductId: link.productId,
				localName: link.product.name,
				localPrice
			}
		})
		const missingLinkedItems = links.filter(
			link => !previewExternalIds.has(link.externalId)
		).length

		return {
			...preview,
			diff: {
				newItems,
				matchedItems,
				changedItems,
				priceChanges,
				nameChanges,
				unchangedItems,
				missingLinkedItems
			},
			items
		}
	}

	private numberOrNull(value: unknown): number | null {
		if (value === null || value === undefined) return null
		const numberValue = Number(value)
		return Number.isFinite(numberValue) ? numberValue : null
	}

	private sameMoney(left: number | null, right: number | null): boolean {
		if (left === null || right === null) return left === right
		return Math.round(left * 100) === Math.round(right * 100)
	}

	private mapIikoWebhookStatus(webhook?: IikoWebhookMetadata | null) {
		const safeWebhook = webhook ?? {
			enabled: false,
			urlPreview: null,
			secretHash: null,
			lastConfiguredAt: null,
			lastReceivedAt: null,
			lastEventType: null,
			lastError: null
		}
		return {
			enabled: safeWebhook.enabled,
			urlPreview: safeWebhook.urlPreview,
			hasSecret: Boolean(safeWebhook.secretHash),
			lastConfiguredAt: safeWebhook.lastConfiguredAt,
			lastReceivedAt: safeWebhook.lastReceivedAt,
			lastEventType: safeWebhook.lastEventType,
			lastError: safeWebhook.lastError
				? renderSafeProviderErrorMessage(safeWebhook.lastError)
				: null
		}
	}

	private isIikoRateLimitedError(message: string): boolean {
		return (
			message.includes('iiko API error 429') ||
			message.includes('TOO_MANY_REQUESTS')
		)
	}

	private mapIikoWebhookEvent(
		event: IntegrationWebhookEventRecord
	): IikoWebhookEventDto {
		const payload = this.asRecord(event.payload)
		const eventInfo = this.asRecord(payload?.eventInfo)
		const order = this.asRecord(eventInfo?.order)

		return {
			id: event.id,
			provider: event.provider,
			requestId: event.requestId,
			eventType:
				this.readString(payload?.eventType) ??
				this.readString(event.reportUrl) ??
				'iiko',
			status: event.status,
			jobId: event.jobId,
			error: event.error ? renderSafeProviderErrorMessage(event.error) : null,
			details: this.compactWebhookDetails({
				organizationId:
					this.readString(payload?.organizationId) ??
					this.readString(eventInfo?.organizationId),
				correlationId: this.readString(payload?.correlationId),
				eventTime: this.readString(payload?.eventTime),
				iikoOrderId: this.readString(eventInfo?.id) ?? this.readString(order?.id),
				externalNumber:
					this.readString(eventInfo?.externalNumber) ??
					this.readString(order?.externalNumber),
				creationStatus: this.readString(eventInfo?.creationStatus),
				orderStatus: this.readString(order?.status),
				errorCode: this.readString(this.asRecord(eventInfo?.errorInfo)?.code)
			}),
			receivedAt: event.receivedAt,
			processedAt: event.processedAt,
			createdAt: event.createdAt,
			updatedAt: event.updatedAt
		}
	}

	private compactWebhookDetails(
		details: Record<string, string | null | undefined>
	): Record<string, string | null> {
		return Object.fromEntries(
			Object.entries(details).filter(([, value]) => value !== undefined)
		) as Record<string, string | null>
	}

	private asRecord(value: unknown): Record<string, unknown> | null {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return null
		return value as Record<string, unknown>
	}

	private readString(value: unknown): string | null {
		if (typeof value === 'string') {
			const trimmed = value.trim()
			return trimmed || null
		}
		if (typeof value === 'number' || typeof value === 'boolean') {
			return String(value)
		}
		return null
	}

	private mapSyncRun(run: IntegrationSyncRunRecord): MoySkladSyncRunDto {
		const metadata = this.normalizeSyncRunMetadata(run)

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
			products: metadata.products,
			variants: metadata.variants,
			stockRows: metadata.stockRows,
			warnings: metadata.warnings,
			errors: metadata.errors,
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
		run: IntegrationSyncRunRecord,
		progress: SyncRunProgress | null
	): MoySkladSyncProgressDto {
		const resolved = progress ?? this.buildFallbackSyncRunProgress(run)

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

	private mapOrderExport(
		exportRecord: IntegrationOrderExportRecord
	): MoySkladOrderExportDto {
		return {
			id: exportRecord.id,
			provider: exportRecord.provider,
			orderId: exportRecord.orderId,
			idempotencyKey: exportRecord.idempotencyKey,
			externalId: exportRecord.externalId,
			status: exportRecord.status,
			attempts: exportRecord.attempts,
			lastError: exportRecord.lastError
				? renderSafeProviderErrorMessage(exportRecord.lastError)
				: null,
			requestedAt: exportRecord.requestedAt,
			startedAt: exportRecord.startedAt,
			exportedAt: exportRecord.exportedAt,
			createdAt: exportRecord.createdAt,
			updatedAt: exportRecord.updatedAt
		}
	}

	private mapOrderExportTimelineItems(
		exportRecord: IntegrationOrderExportRecord
	) {
		const items = [
			{
				id: `${exportRecord.id}:requested`,
				provider: exportRecord.provider,
				exportId: exportRecord.id,
				type: 'queued',
				status: 'PENDING',
				title: 'Экспорт поставлен в очередь',
				detail: `Попыток: ${exportRecord.attempts}`,
				externalId: exportRecord.externalId,
				error: null,
				attempts: exportRecord.attempts,
				occurredAt: exportRecord.requestedAt
			}
		]

		if (exportRecord.startedAt) {
			items.push({
				id: `${exportRecord.id}:started`,
				provider: exportRecord.provider,
				exportId: exportRecord.id,
				type: 'started',
				status: 'RUNNING',
				title: 'Отправка в iiko началась',
				detail: null,
				externalId: exportRecord.externalId,
				error: null,
				attempts: exportRecord.attempts,
				occurredAt: exportRecord.startedAt
			})
		}

		if (exportRecord.exportedAt) {
			items.push({
				id: `${exportRecord.id}:exported`,
				provider: exportRecord.provider,
				exportId: exportRecord.id,
				type: 'exported',
				status: 'SUCCESS',
				title: 'Заказ принят iiko',
				detail: exportRecord.externalId ? `iiko: ${exportRecord.externalId}` : null,
				externalId: exportRecord.externalId,
				error: null,
				attempts: exportRecord.attempts,
				occurredAt: exportRecord.exportedAt
			})
		}

		if (exportRecord.status === 'ERROR' || exportRecord.status === 'SKIPPED') {
			items.push({
				id: `${exportRecord.id}:final`,
				provider: exportRecord.provider,
				exportId: exportRecord.id,
				type: exportRecord.status.toLowerCase(),
				status: exportRecord.status,
				title:
					exportRecord.status === 'ERROR'
						? 'Экспорт завершился ошибкой'
						: 'Экспорт пропущен',
				detail: exportRecord.lastError
					? renderSafeProviderErrorMessage(exportRecord.lastError)
					: null,
				externalId: exportRecord.externalId,
				error: exportRecord.lastError
					? renderSafeProviderErrorMessage(exportRecord.lastError)
					: null,
				attempts: exportRecord.attempts,
				occurredAt: exportRecord.updatedAt
			})
		}

		return items.sort(
			(left, right) => right.occurredAt.getTime() - left.occurredAt.getTime()
		)
	}

	private mapMoySkladRefOptions(
		items: MoySkladNamedEntity[]
	): MoySkladOrderExportRefOptionDto[] {
		return items
			.map(item => ({
				id: item.id,
				name: readNonEmptyString(item.name) ?? item.id,
				code: readNonEmptyString(item.code),
				externalCode: readNonEmptyString(item.externalCode),
				archived: item.archived === true
			}))
			.sort((left, right) => {
				if (left.archived !== right.archived) return left.archived ? 1 : -1
				return left.name.localeCompare(right.name, 'ru')
			})
	}

	private normalizeSyncRunMetadata(
		run: IntegrationSyncRunRecord
	): SyncRunMetadata {
		const metadata = isRecord(run.metadata) ? run.metadata : {}

		return {
			products: this.normalizeEntityStats(metadata.products, {
				total: run.totalProducts,
				created: run.createdProducts,
				updated: run.updatedProducts,
				deleted: run.deletedProducts,
				skipped: 0
			}),
			variants: this.normalizeEntityStats(metadata.variants, {
				...EMPTY_SYNC_ENTITY_STATS
			}),
			stockRows: this.normalizeStockStats(metadata.stockRows, {
				...EMPTY_SYNC_STOCK_STATS
			}),
			warnings: this.normalizeIssues(metadata.warnings),
			errors: this.normalizeIssues(metadata.errors),
			progress: this.normalizeProgress(metadata.progress)
		}
	}

	private buildFallbackSyncRunProgress(
		run: IntegrationSyncRunRecord
	): SyncRunProgress {
		const updatedAt = run.updatedAt.toISOString()
		const total =
			run.status === IntegrationSyncRunStatus.SUCCESS ? run.totalProducts : null
		const processed =
			run.status === IntegrationSyncRunStatus.SUCCESS ? run.totalProducts : 0
		const percent =
			run.status === IntegrationSyncRunStatus.SUCCESS
				? 100
				: run.status === IntegrationSyncRunStatus.PENDING ||
					  run.status === IntegrationSyncRunStatus.RUNNING
					? null
					: null

		if (run.status === IntegrationSyncRunStatus.SUCCESS) {
			return {
				phase: 'COMPLETED',
				message: 'Синхронизация MoySklad завершена',
				processed,
				total,
				percent,
				updatedAt
			}
		}

		if (run.status === IntegrationSyncRunStatus.ERROR) {
			return {
				phase: 'FAILED',
				message: run.error
					? renderSafeProviderErrorMessage(run.error)
					: 'Синхронизация MoySklad завершилась с ошибкой',
				processed: 0,
				total: null,
				percent: null,
				updatedAt
			}
		}

		if (run.status === IntegrationSyncRunStatus.SKIPPED) {
			return {
				phase: 'FAILED',
				message: 'Синхронизация MoySklad пропущена',
				processed: 0,
				total: null,
				percent: null,
				updatedAt
			}
		}

		return {
			phase: run.status === IntegrationSyncRunStatus.PENDING ? 'QUEUED' : 'QUEUED',
			message:
				run.status === IntegrationSyncRunStatus.PENDING
					? 'Синхронизация MoySklad ожидает запуска'
					: 'Синхронизация MoySklad выполняется',
			processed: 0,
			total: null,
			percent: null,
			updatedAt
		}
	}

	private normalizeProgress(value: unknown): SyncRunProgress | null {
		if (!isRecord(value)) return null

		const phase = readNonEmptyString(value.phase)
		const message = readNonEmptyString(value.message)
		if (!phase || !message) return null

		const processed = readNonNegativeInteger(value.processed) ?? 0
		const total =
			value.total === null ? null : readNonNegativeInteger(value.total)
		const rawPercent =
			value.percent === null ? null : readNonNegativeInteger(value.percent)
		const percent =
			rawPercent === null || rawPercent === undefined
				? null
				: Math.min(100, rawPercent)
		const updatedAt =
			readNonEmptyString(value.updatedAt) ?? new Date().toISOString()

		return {
			phase,
			message: renderSafeProviderErrorMessage(message),
			processed,
			total,
			percent,
			updatedAt
		}
	}

	private normalizeEntityStats(
		value: unknown,
		fallback: SyncRunEntityStats
	): SyncRunEntityStats {
		const source = isRecord(value) ? value : {}

		return {
			total: readNonNegativeInteger(source.total) ?? fallback.total,
			created: readNonNegativeInteger(source.created) ?? fallback.created,
			updated: readNonNegativeInteger(source.updated) ?? fallback.updated,
			deleted: readNonNegativeInteger(source.deleted) ?? fallback.deleted,
			skipped: readNonNegativeInteger(source.skipped) ?? fallback.skipped
		}
	}

	private normalizeStockStats(
		value: unknown,
		fallback: SyncRunStockStats
	): SyncRunStockStats {
		const source = isRecord(value) ? value : {}

		return {
			total: readNonNegativeInteger(source.total) ?? fallback.total,
			applied: readNonNegativeInteger(source.applied) ?? fallback.applied,
			skipped: readNonNegativeInteger(source.skipped) ?? fallback.skipped,
			diagnostics:
				this.normalizeStockDiagnostics(source.diagnostics) ?? fallback.diagnostics
		}
	}

	private normalizeStockDiagnostics(
		value: unknown
	): SyncRunStockDiagnostics | null {
		if (!isRecord(value)) return null

		const source = readStockApplySource(value.source)
		if (!source) return null
		const skippedReasons = this.normalizeStockSkippedReasons(value.skippedReasons)

		return {
			source,
			stockRows: readNonNegativeInteger(value.stockRows) ?? 0,
			matchedStockRows: readNonNegativeInteger(value.matchedStockRows) ?? 0,
			unmatchedStockRows: readNonNegativeInteger(value.unmatchedStockRows) ?? 0,
			productLinks: readNonNegativeInteger(value.productLinks) ?? 0,
			variantLinks: readNonNegativeInteger(value.variantLinks) ?? 0,
			ignoredVariantLinks: readNonNegativeInteger(value.ignoredVariantLinks) ?? 0,
			appliedProductLinks: readNonNegativeInteger(value.appliedProductLinks) ?? 0,
			appliedVariantLinks: readNonNegativeInteger(value.appliedVariantLinks) ?? 0,
			skippedReasons
		}
	}

	private normalizeStockSkippedReasons(
		value: unknown
	): SyncRunStockSkippedReasons {
		const source = isRecord(value) ? value : {}

		return {
			missingStock:
				readNonNegativeInteger(source.missingStock) ??
				EMPTY_STOCK_SKIPPED_REASONS.missingStock,
			productHasVariantLinks:
				readNonNegativeInteger(source.productHasVariantLinks) ??
				EMPTY_STOCK_SKIPPED_REASONS.productHasVariantLinks,
			variantsCapabilityDisabled:
				readNonNegativeInteger(source.variantsCapabilityDisabled) ??
				EMPTY_STOCK_SKIPPED_REASONS.variantsCapabilityDisabled,
			stockRowWithoutLocalLink:
				readNonNegativeInteger(source.stockRowWithoutLocalLink) ??
				EMPTY_STOCK_SKIPPED_REASONS.stockRowWithoutLocalLink
		}
	}

	private normalizeIssues(value: unknown): SyncRunIssue[] {
		if (!Array.isArray(value)) return []

		return value.flatMap(item => {
			if (!isRecord(item)) return []

			const code = readNonEmptyString(item.code) ?? 'UNKNOWN'
			const message = readNonEmptyString(item.message)
			if (!message) return []

			return [
				{
					code,
					message: renderSafeProviderErrorMessage(message),
					externalId: readNonEmptyString(item.externalId),
					count: readNonNegativeInteger(item.count)
				}
			]
		})
	}

	private assertHasUpdateFields(dto: UpdateMoySkladIntegrationDtoReq): void {
		if (
			dto.token === undefined &&
			dto.isActive === undefined &&
			dto.priceTypeName === undefined &&
			dto.importImages === undefined &&
			dto.syncStock === undefined &&
			dto.fieldOwnership === undefined &&
			dto.stockWebhookEnabled === undefined &&
			dto.exportOrders === undefined &&
			dto.orderExportOrganizationId === undefined &&
			dto.orderExportCounterpartyId === undefined &&
			dto.orderExportStoreId === undefined &&
			dto.scheduleEnabled === undefined &&
			dto.schedulePattern === undefined &&
			dto.scheduleTimezone === undefined
		) {
			throw new BadRequestException('Нет полей для обновления')
		}
	}

	private assertHasIikoUpdateFields(dto: UpdateIikoIntegrationDtoReq): void {
		if (
			dto.apiLogin === undefined &&
			dto.organizationId === undefined &&
			dto.organizationName === undefined &&
			dto.externalMenuId === undefined &&
			dto.externalMenuName === undefined &&
			dto.priceCategoryId === undefined &&
			dto.priceCategoryName === undefined &&
			dto.terminalGroupId === undefined &&
			dto.terminalGroupName === undefined &&
			dto.menuVersion === undefined &&
			dto.importImages === undefined &&
			dto.exportOrders === undefined &&
			dto.orderExportServiceType === undefined &&
			dto.orderExportSourceKey === undefined &&
			dto.isActive === undefined
		) {
			throw new BadRequestException('No iiko fields provided for update')
		}
	}

	private normalizeRunsLimit(limit?: number | string): number {
		if (limit === undefined || limit === null) {
			return 20
		}
		const normalizedLimit =
			typeof limit === 'string' ? Number(limit.trim()) : limit
		if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1) {
			throw new BadRequestException('limit должен быть положительным целым числом')
		}
		return Math.min(normalizedLimit, 100)
	}

	private normalizeWebhookEventStatus(
		status?: string
	): IntegrationWebhookEventStatus | null {
		if (!status) return null
		const normalized = status.trim().toUpperCase()
		if (!normalized) return null
		const allowed: IntegrationWebhookEventStatus[] = [
			'PENDING',
			'PROCESSING',
			'PROCESSED',
			'FAILED',
			'SKIPPED'
		]
		if (!allowed.includes(normalized as IntegrationWebhookEventStatus)) {
			throw new BadRequestException('Invalid webhook event status')
		}
		return normalized as IntegrationWebhookEventStatus
	}

	private async resolveToken(explicitToken?: string): Promise<string> {
		if (explicitToken?.trim()) {
			return explicitToken.trim()
		}

		const catalogId = mustCatalogId()
		const integration = await this.repo.findMoySklad(catalogId)
		if (!integration) {
			throw new NotFoundException('Интеграция MoySklad не настроена')
		}

		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		if (!metadata.token) {
			throw new NotFoundException('Токен MoySklad не настроен')
		}

		return metadata.token
	}

	private async tryQueueInitialSync(params: {
		catalogId: string
		previous: IntegrationRecord | null
		next: IntegrationRecord
		context: 'created' | 'updated'
	}): Promise<void> {
		if (!params.next.isActive) return
		if (params.next.lastSyncAt) return
		if (params.previous?.lastSyncAt) return

		try {
			const queued = await this.moySkladQueue.enqueueCatalogSync(params.catalogId)
			this.logger.log(
				`Initial MoySklad import queued after integration ${params.context} for catalog ${params.catalogId}: runId=${queued.runId}, jobId=${queued.jobId}`
			)
		} catch (error) {
			this.logger.warn(
				`MoySklad integration was ${params.context} for catalog ${params.catalogId}, but initial import was not queued: ${this.renderErrorMessage(error)}`
			)
		}
	}

	private renderErrorMessage(error: unknown): string {
		return renderSafeProviderErrorMessage(error)
	}

	private resolveAuditActor(
		reqOrActor: AuthRequest | SessionUser | null
	): SessionUser | null {
		if (!reqOrActor) return null
		if ('headers' in reqOrActor) return reqOrActor.user ?? null
		return reqOrActor
	}

	private resolveAuditRequest(
		reqOrActor: AuthRequest | SessionUser | null
	): AuthRequest | null {
		if (!reqOrActor) return null
		return 'headers' in reqOrActor ? reqOrActor : null
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized || null
}

function normalizeOptionalString(value: unknown): string | null {
	return readNonEmptyString(value)
}

function normalizeNullableNumber(value: unknown): number | null {
	const number =
		typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number(value.trim())
				: Number.NaN
	return Number.isFinite(number) ? number : null
}

function resolveIikoTableDisplayNumber(
	tableName: string | null,
	iikoNumber: number | null
): string | null {
	if (iikoNumber !== null) return String(iikoNumber)

	const nameNumber = tableName?.match(/\d+/)?.[0]?.trim()
	if (nameNumber) return nameNumber
	return null
}

function generateIntegrationExternalItemCode(): string {
	return randomBytes(6).toString('base64url')
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code?: unknown }).code === 'P2002'
	)
}

function readStockApplySource(value: unknown): 'FULL_SYNC' | 'WEBHOOK' | null {
	if (value === 'FULL_SYNC' || value === 'WEBHOOK') return value
	return null
}

function isPresent<T>(value: T | null | undefined): value is T {
	return value !== null && value !== undefined
}

function readNonNegativeInteger(value: unknown): number | null {
	const parsed =
		typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number(value)
				: Number.NaN

	if (!Number.isInteger(parsed) || parsed < 0) return null
	return parsed
}

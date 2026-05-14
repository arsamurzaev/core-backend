import {
	AuditOutcome,
	DataType,
	IntegrationProvider,
	IntegrationSyncRunStatus
} from '@generated/enums'
import {
	BadRequestException,
	ConflictException,
	Injectable,
	Logger,
	NotFoundException
} from '@nestjs/common'
import slugify from 'slugify'

import { AuditService } from '@/modules/audit/audit.service'
import { CapabilityService } from '@/modules/capability/capability.service'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { mustCatalogId } from '@/shared/tenancy/ctx'

import type { AuthRequest, SessionUser } from '../auth/types/auth-request'

import { ApplyMoySkladMappingDtoReq } from './dto/requests/apply-moysklad-mapping.dto.req'
import { TestMoySkladConnectionDtoReq } from './dto/requests/test-moysklad-connection.dto.req'
import { UpdateMoySkladIntegrationDtoReq } from './dto/requests/update-moysklad-integration.dto.req'
import { UpsertMoySkladIntegrationDtoReq } from './dto/requests/upsert-moysklad-integration.dto.req'
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
	type IntegrationRecord,
	IntegrationRepository,
	type IntegrationSyncRunRecord,
	type MappingPreviewAttributeRecord
} from './integration.repository'
import { getIntegrationProviderCapabilities } from './provider-capabilities'
import { renderSafeProviderErrorMessage } from './provider-error-redaction'
import { MoySkladClient } from './providers/moysklad/moysklad.client'
import {
	maskToken,
	MoySkladMetadataCryptoService
} from './providers/moysklad/moysklad.metadata'
import { MoySkladOrderExportQueueService } from './providers/moysklad/moysklad.order-export.queue.service'
import { MoySkladQueueService } from './providers/moysklad/moysklad.queue.service'
import { MoySkladSyncService } from './providers/moysklad/moysklad.sync.service'
import type {
	MoySkladNamedEntity,
	MoySkladProduct,
	MoySkladVariantCharacteristic
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
}

type SyncRunIssue = {
	code: string
	message: string
	externalId: string | null
	count: number | null
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
	skipped: 0
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
		private readonly audit: AuditService,
		private readonly featureEntitlements: CapabilityService
	) {}

	async getMoySklad(): Promise<MoySkladIntegrationDto> {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
		const integration = await this.repo.findMoySklad(catalogId)
		if (!integration) {
			throw new NotFoundException('Интеграция MoySklad не настроена')
		}

		return this.mapMoySkladIntegration(integration)
	}

	async getMoySkladStatus(): Promise<MoySkladIntegrationStatusDto> {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
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

	async getMoySkladRuns(limit?: number | string): Promise<MoySkladSyncRunDto[]> {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
		const normalizedLimit = this.normalizeRunsLimit(limit)
		const runs = await this.repo.findRecentSyncRuns(catalogId, normalizedLimit)
		return runs.map(run => this.mapSyncRun(run))
	}

	async getMoySkladRunProgress(runId: string): Promise<MoySkladSyncProgressDto> {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
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
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
		const normalizedLimit = this.normalizeRunsLimit(limit)
		const exports = await this.repo.findOrderExportsByCatalog(
			catalogId,
			normalizedLimit
		)
		return exports.map(item => this.mapOrderExport(item))
	}

	async getMoySkladOrderExportRefs(): Promise<MoySkladOrderExportRefsDto> {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
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
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
		await this.featureEntitlements.assertCanUseProductTypes(catalogId)
		await this.featureEntitlements.assertCanUseProductVariants(catalogId)
		const integration = await this.getActiveMoySkladIntegration(catalogId)
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		if (!metadata.token) {
			throw new NotFoundException('РўРѕРєРµРЅ MoySklad РЅРµ РЅР°СЃС‚СЂРѕРµРЅ')
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
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
		await this.featureEntitlements.assertCanUseProductTypes(catalogId)
		await this.featureEntitlements.assertCanUseProductVariants(catalogId)
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
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
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
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
		const existing = await this.repo.findMoySklad(catalogId)
		const metadata = this.metadataCrypto.buildStoredMetadata({
			token: dto.token,
			priceTypeName: dto.priceTypeName,
			importImages: dto.importImages,
			syncStock: dto.syncStock,
			exportOrders: dto.exportOrders,
			orderExportOrganizationId: dto.orderExportOrganizationId,
			orderExportCounterpartyId: dto.orderExportCounterpartyId,
			orderExportStoreId: dto.orderExportStoreId,
			scheduleEnabled: dto.scheduleEnabled,
			schedulePattern: dto.schedulePattern,
			scheduleTimezone: dto.scheduleTimezone,
			lastStockSyncedAt: existing
				? this.metadataCrypto.parseStoredMetadata(existing.metadata)
						.lastStockSyncedAt
				: null
		})
		const integration = await this.repo.upsertMoySklad(catalogId, {
			metadata,
			isActive: dto.isActive ?? true
		})
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
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
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
		const integration = await this.repo.updateMoySklad(catalogId, {
			metadata,
			isActive: dto.isActive
		})

		if (!integration) {
			throw new NotFoundException('Интеграция MoySklad не настроена')
		}
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
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
		const existing = await this.repo.findMoySklad(catalogId)
		if (!existing) {
			throw new NotFoundException('Интеграция MoySklad не настроена')
		}

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
		await this.featureEntitlements.assertCanUseMoySkladIntegration(
			mustCatalogId()
		)
		const token = await this.resolveToken(dto.token)
		return this.moySkladSync.testConnection(token)
	}

	async syncMoySkladCatalog(): Promise<MoySkladQueuedSyncDto> {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
		return this.moySkladQueue.enqueueCatalogSync(catalogId)
	}

	async syncMoySkladProduct(productId: string): Promise<MoySkladQueuedSyncDto> {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
		return this.moySkladQueue.enqueueProductSync(catalogId, productId)
	}

	async syncMoySkladStock(): Promise<MoySkladQueuedSyncDto> {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
		return this.moySkladQueue.enqueueStockSync(catalogId)
	}

	async cancelMoySkladSync(): Promise<void> {
		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
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

	private mapSyncRun(run: IntegrationSyncRunRecord): MoySkladSyncRunDto {
		const metadata = this.normalizeSyncRunMetadata(run)

		return {
			id: run.id,
			provider: run.provider,
			mode: run.mode,
			trigger: run.trigger,
			status: run.status,
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
			skipped: readNonNegativeInteger(source.skipped) ?? fallback.skipped
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

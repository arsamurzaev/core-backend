import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException
} from '@nestjs/common'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { mustCatalogId } from '@/shared/tenancy/ctx'

import { TestMoySkladConnectionDtoReq } from './dto/requests/test-moysklad-connection.dto.req'
import { UpdateMoySkladIntegrationDtoReq } from './dto/requests/update-moysklad-integration.dto.req'
import { UpsertMoySkladIntegrationDtoReq } from './dto/requests/upsert-moysklad-integration.dto.req'
import {
	MoySkladIntegrationDto,
	MoySkladIntegrationStatusDto,
	MoySkladQueuedSyncDto,
	MoySkladSyncRunDto,
	MoySkladTestConnectionDto
} from './dto/responses/moysklad.dto.res'
import {
	type IntegrationRecord,
	IntegrationRepository,
	type IntegrationSyncRunRecord
} from './integration.repository'
import {
	maskToken,
	MoySkladMetadataCryptoService
} from './providers/moysklad/moysklad.metadata'
import { MoySkladQueueService } from './providers/moysklad/moysklad.queue.service'
import { MoySkladSyncService } from './providers/moysklad/moysklad.sync.service'

@Injectable()
export class IntegrationService {
	private readonly logger = new Logger(IntegrationService.name)

	constructor(
		private readonly repo: IntegrationRepository,
		private readonly moySkladSync: MoySkladSyncService,
		private readonly moySkladQueue: MoySkladQueueService,
		private readonly metadataCrypto: MoySkladMetadataCryptoService
	) {}

	async getMoySklad(): Promise<MoySkladIntegrationDto> {
		const catalogId = mustCatalogId()
		const integration = await this.repo.findMoySklad(catalogId)
		if (!integration) {
			throw new NotFoundException('Интеграция MoySklad не настроена')
		}

		return this.mapMoySkladIntegration(integration)
	}

	async getMoySkladStatus(): Promise<MoySkladIntegrationStatusDto> {
		const catalogId = mustCatalogId()
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

	async getMoySkladRuns(limit?: number): Promise<MoySkladSyncRunDto[]> {
		const catalogId = mustCatalogId()
		const normalizedLimit = this.normalizeRunsLimit(limit)
		const runs = await this.repo.findRecentSyncRuns(catalogId, normalizedLimit)
		return runs.map(run => this.mapSyncRun(run))
	}

	async upsertMoySklad(
		dto: UpsertMoySkladIntegrationDtoReq
	): Promise<MoySkladIntegrationDto> {
		const catalogId = mustCatalogId()
		const existing = await this.repo.findMoySklad(catalogId)
		const metadata = this.metadataCrypto.buildStoredMetadata({
			token: dto.token,
			priceTypeName: dto.priceTypeName,
			importImages: dto.importImages,
			syncStock: dto.syncStock,
			scheduleEnabled: dto.scheduleEnabled,
			schedulePattern: dto.schedulePattern,
			scheduleTimezone: dto.scheduleTimezone
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
			scheduleEnabled: dto.scheduleEnabled ?? currentMetadata.scheduleEnabled,
			schedulePattern:
				dto.schedulePattern !== undefined
					? dto.schedulePattern
					: currentMetadata.schedulePattern,
			scheduleTimezone: dto.scheduleTimezone ?? currentMetadata.scheduleTimezone
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
		const token = await this.resolveToken(dto.token)
		return this.moySkladSync.testConnection(token)
	}

	async syncMoySkladCatalog(): Promise<MoySkladQueuedSyncDto> {
		const catalogId = mustCatalogId()
		return this.moySkladQueue.enqueueCatalogSync(catalogId)
	}

	async syncMoySkladProduct(productId: string): Promise<MoySkladQueuedSyncDto> {
		const catalogId = mustCatalogId()
		return this.moySkladQueue.enqueueProductSync(catalogId, productId)
	}

	async cancelMoySkladSync(): Promise<void> {
		const catalogId = mustCatalogId()
		await this.repo.failMoySkladSync(catalogId, 'Отменено пользователем')
	}

	private mapMoySkladIntegration(
		integration: IntegrationRecord
	): MoySkladIntegrationDto {
		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)

		return {
			provider: integration.provider,
			isActive: integration.isActive,
			hasToken: Boolean(metadata.token),
			tokenPreview: maskToken(metadata.token),
			priceTypeName: metadata.priceTypeName,
			importImages: metadata.importImages,
			syncStock: metadata.syncStock,
			scheduleEnabled: metadata.scheduleEnabled,
			schedulePattern: metadata.schedulePattern,
			scheduleTimezone: metadata.scheduleTimezone,
			lastSyncStatus: integration.lastSyncStatus,
			syncStartedAt: integration.syncStartedAt,
			lastSyncAt: integration.lastSyncAt,
			lastSyncError: integration.lastSyncError,
			totalProducts: integration.totalProducts,
			createdProducts: integration.createdProducts,
			updatedProducts: integration.updatedProducts,
			deletedProducts: integration.deletedProducts,
			createdAt: integration.createdAt,
			updatedAt: integration.updatedAt
		}
	}

	private mapSyncRun(run: IntegrationSyncRunRecord): MoySkladSyncRunDto {
		return {
			id: run.id,
			provider: run.provider,
			mode: run.mode,
			trigger: run.trigger,
			status: run.status,
			jobId: run.jobId,
			productId: run.productId,
			externalId: run.externalId,
			error: run.error,
			totalProducts: run.totalProducts,
			createdProducts: run.createdProducts,
			updatedProducts: run.updatedProducts,
			deletedProducts: run.deletedProducts,
			imagesImported: run.imagesImported,
			durationMs: run.durationMs,
			requestedAt: run.requestedAt,
			startedAt: run.startedAt,
			finishedAt: run.finishedAt,
			createdAt: run.createdAt,
			updatedAt: run.updatedAt
		}
	}

	private assertHasUpdateFields(dto: UpdateMoySkladIntegrationDtoReq): void {
		if (
			dto.token === undefined &&
			dto.isActive === undefined &&
			dto.priceTypeName === undefined &&
			dto.importImages === undefined &&
			dto.syncStock === undefined &&
			dto.scheduleEnabled === undefined &&
			dto.schedulePattern === undefined &&
			dto.scheduleTimezone === undefined
		) {
			throw new BadRequestException('Нет полей для обновления')
		}
	}

	private normalizeRunsLimit(limit?: number): number {
		if (limit === undefined || limit === null) {
			return 20
		}
		if (!Number.isInteger(limit) || limit < 1) {
			throw new BadRequestException('limit должен быть положительным целым числом')
		}
		return Math.min(limit, 100)
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
		if (error instanceof Error && error.message) {
			return error.message
		}

		return 'Unknown error'
	}
}

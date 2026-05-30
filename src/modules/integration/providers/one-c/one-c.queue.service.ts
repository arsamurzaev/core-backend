import {
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger,
	IntegrationSyncSnapshotCompleteness
} from '@generated/enums'
import {
	ConflictException,
	Inject,
	Injectable,
	InternalServerErrorException,
	Logger,
	type OnModuleDestroy,
	type OnModuleInit
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Job, Queue, Worker } from 'bullmq'

import { AllInterfaces } from '@/core/config'
import {
	CAPABILITY_ASSERT_PORT,
	CAPABILITY_READER_PORT,
	type CapabilityAssertPort,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'
import {
	OBSERVABILITY_RECORDER_PORT,
	type ObservabilityRecorderPort
} from '@/modules/observability/contracts'
import { buildBullMqSafeJobId } from '@/shared/utils/bullmq-job-id'

import type {
	RunOneCPriceSyncDtoReq,
	RunOneCProductSyncDtoReq,
	RunOneCStockSyncDtoReq,
	RunOneCVariantSyncDtoReq
} from '../../dto/requests/one-c-integration.dto.req'
import { renderSafeProviderErrorMessage } from '../../provider-error-redaction'

import { OneCIntegrationService } from './one-c.integration.service'
import { OneCMetadataCryptoService } from './one-c.metadata'
import {
	type OneCIntegrationRecord,
	OneCIntegrationRepository
} from './one-c.repository'
import type { OneCMetadata } from './one-c.types'

const ONE_C_SYNC_QUEUE_NAME = 'one-c-sync'
const ONE_C_SYNC_QUEUE_CONCURRENCY = 1
const PRODUCT_SYNC_JOB_NAME = 'product-sync'
const VARIANT_SYNC_JOB_NAME = 'variant-sync'
const STOCK_SYNC_JOB_NAME = 'stock-sync'
const PRICE_SYNC_JOB_NAME = 'price-sync'
const SCHEDULED_PRODUCT_SYNC_JOB_NAME = 'product-scheduled-sync'
const SCHEDULED_STOCK_SYNC_JOB_NAME = 'stock-scheduled-sync'
const SCHEDULED_PRICE_SYNC_JOB_NAME = 'price-scheduled-sync'
const MANUAL_JOB_ID_PREFIX = 'one-c-manual'
const ONE_C_SYNC_SCHEDULER_PREFIX = 'one-c:catalog'
type OneCSchedulerKind = 'product' | 'stock' | 'price'

type OneCSyncJob = {
	runId?: string
	catalogId: string
	integrationId: string
	mode: IntegrationSyncRunMode
	trigger: IntegrationSyncRunTrigger
	dto?:
		| RunOneCPriceSyncDtoReq
		| RunOneCProductSyncDtoReq
		| RunOneCVariantSyncDtoReq
		| RunOneCStockSyncDtoReq
}

export type OneCQueuedSyncResult = {
	ok: true
	queued: true
	runId: string
	jobId: string
	mode: IntegrationSyncRunMode
	trigger: IntegrationSyncRunTrigger
}

@Injectable()
export class OneCQueueService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(OneCQueueService.name)
	private readonly queue: Queue<OneCSyncJob>
	private readonly worker: Worker<OneCSyncJob>

	constructor(
		private readonly configService: ConfigService<AllInterfaces>,
		private readonly repo: OneCIntegrationRepository,
		private readonly oneC: OneCIntegrationService,
		private readonly metadataCrypto: OneCMetadataCryptoService,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly featureAssertions: CapabilityAssertPort,
		@Inject(CAPABILITY_READER_PORT)
		private readonly featureReader: CapabilityReaderPort,
		@Inject(OBSERVABILITY_RECORDER_PORT)
		private readonly observability: ObservabilityRecorderPort
	) {
		const redis = this.configService.get('redis', { infer: true })
		const connection: Record<string, any> = {
			host: redis?.host ?? '127.0.0.1',
			port: redis?.port ?? 6379
		}
		if (redis?.user) connection.username = redis.user
		if (redis?.password) connection.password = redis.password

		this.queue = new Queue<OneCSyncJob>(ONE_C_SYNC_QUEUE_NAME, {
			connection,
			defaultJobOptions: {
				attempts: 1,
				removeOnComplete: { age: 86400 },
				removeOnFail: { age: 86400 }
			}
		})

		this.worker = new Worker<OneCSyncJob>(
			ONE_C_SYNC_QUEUE_NAME,
			job => this.processJob(job),
			{
				connection,
				concurrency: ONE_C_SYNC_QUEUE_CONCURRENCY
			}
		)

		this.worker.on('failed', (job, error) => {
			this.logger.error('ONE_C sync queue worker failed', {
				jobId: job?.id,
				error: renderSafeProviderErrorMessage(error)
			})
		})
	}

	async onModuleInit(): Promise<void> {
		await this.syncAllSchedulers()
	}

	async onModuleDestroy(): Promise<void> {
		await this.worker.close()
		await this.queue.close()
	}

	async enqueueProductSync(
		catalogId: string,
		dto: RunOneCProductSyncDtoReq
	): Promise<OneCQueuedSyncResult> {
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const integration = await this.repo.findIntegration(catalogId)
		if (!integration) {
			throw new ConflictException('ONE_C integration is not configured')
		}
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
			status: IntegrationSyncRunStatus.PENDING,
			snapshotCompleteness: IntegrationSyncSnapshotCompleteness.PARTIAL
		})

		try {
			const jobId = buildBullMqSafeJobId(MANUAL_JOB_ID_PREFIX, run.id)
			const job = await this.queue.add(
				PRODUCT_SYNC_JOB_NAME,
				{
					runId: run.id,
					catalogId,
					integrationId: integration.id,
					mode: IntegrationSyncRunMode.PRODUCT,
					trigger: IntegrationSyncRunTrigger.MANUAL,
					dto
				},
				{ jobId }
			)
			const resolvedJobId = String(job.id ?? jobId)
			this.observability.recordQueueJobEnqueued(
				ONE_C_SYNC_QUEUE_NAME,
				PRODUCT_SYNC_JOB_NAME
			)
			await this.repo.attachSyncRunJobId(run.id, resolvedJobId)
			this.logger.log(
				`Queued ONE_C product sync for catalog ${catalogId}: runId=${run.id}, jobId=${resolvedJobId}`
			)

			return {
				ok: true,
				queued: true,
				runId: run.id,
				jobId: resolvedJobId,
				mode: IntegrationSyncRunMode.PRODUCT,
				trigger: IntegrationSyncRunTrigger.MANUAL
			}
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			await this.repo.finishSyncRun({
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
				durationMs: 0
			})
			throw new InternalServerErrorException(
				`Could not queue ONE_C product sync: ${message}`
			)
		}
	}

	async enqueueVariantSync(
		catalogId: string,
		dto: RunOneCVariantSyncDtoReq
	): Promise<OneCQueuedSyncResult> {
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const integration = await this.repo.findIntegration(catalogId)
		if (!integration) {
			throw new ConflictException('ONE_C integration is not configured')
		}
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
			status: IntegrationSyncRunStatus.PENDING,
			snapshotCompleteness: IntegrationSyncSnapshotCompleteness.PARTIAL
		})

		try {
			const jobId = buildBullMqSafeJobId(MANUAL_JOB_ID_PREFIX, run.id)
			const job = await this.queue.add(
				VARIANT_SYNC_JOB_NAME,
				{
					runId: run.id,
					catalogId,
					integrationId: integration.id,
					mode: IntegrationSyncRunMode.VARIANT,
					trigger: IntegrationSyncRunTrigger.MANUAL,
					dto
				},
				{ jobId }
			)
			const resolvedJobId = String(job.id ?? jobId)
			this.observability.recordQueueJobEnqueued(
				ONE_C_SYNC_QUEUE_NAME,
				VARIANT_SYNC_JOB_NAME
			)
			await this.repo.attachSyncRunJobId(run.id, resolvedJobId)
			this.logger.log(
				`Queued ONE_C variant sync for catalog ${catalogId}: runId=${run.id}, jobId=${resolvedJobId}`
			)

			return {
				ok: true,
				queued: true,
				runId: run.id,
				jobId: resolvedJobId,
				mode: IntegrationSyncRunMode.VARIANT,
				trigger: IntegrationSyncRunTrigger.MANUAL
			}
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			await this.repo.finishSyncRun({
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
				durationMs: 0
			})
			throw new InternalServerErrorException(
				`Could not queue ONE_C variant sync: ${message}`
			)
		}
	}

	async enqueueStockSync(
		catalogId: string,
		dto: RunOneCStockSyncDtoReq = {}
	): Promise<OneCQueuedSyncResult> {
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const integration = await this.repo.findIntegration(catalogId)
		if (!integration) {
			throw new ConflictException('ONE_C integration is not configured')
		}
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
			mode: IntegrationSyncRunMode.STOCK,
			trigger: IntegrationSyncRunTrigger.MANUAL,
			status: IntegrationSyncRunStatus.PENDING,
			snapshotCompleteness: IntegrationSyncSnapshotCompleteness.PARTIAL
		})

		try {
			const jobId = buildBullMqSafeJobId(MANUAL_JOB_ID_PREFIX, run.id)
			const job = await this.queue.add(
				STOCK_SYNC_JOB_NAME,
				{
					runId: run.id,
					catalogId,
					integrationId: integration.id,
					mode: IntegrationSyncRunMode.STOCK,
					trigger: IntegrationSyncRunTrigger.MANUAL,
					dto
				},
				{ jobId }
			)
			const resolvedJobId = String(job.id ?? jobId)
			this.observability.recordQueueJobEnqueued(
				ONE_C_SYNC_QUEUE_NAME,
				STOCK_SYNC_JOB_NAME
			)
			await this.repo.attachSyncRunJobId(run.id, resolvedJobId)
			this.logger.log(
				`Queued ONE_C stock sync for catalog ${catalogId}: runId=${run.id}, jobId=${resolvedJobId}`
			)

			return {
				ok: true,
				queued: true,
				runId: run.id,
				jobId: resolvedJobId,
				mode: IntegrationSyncRunMode.STOCK,
				trigger: IntegrationSyncRunTrigger.MANUAL
			}
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			await this.repo.finishSyncRun({
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
				durationMs: 0
			})
			throw new InternalServerErrorException(
				`Could not queue ONE_C stock sync: ${message}`
			)
		}
	}

	async enqueuePriceSync(
		catalogId: string,
		dto: RunOneCPriceSyncDtoReq = {}
	): Promise<OneCQueuedSyncResult> {
		await this.featureAssertions.assertCanUseOneCIntegration(catalogId)
		const integration = await this.repo.findIntegration(catalogId)
		if (!integration) {
			throw new ConflictException('ONE_C integration is not configured')
		}
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
			mode: IntegrationSyncRunMode.PRICE,
			trigger: IntegrationSyncRunTrigger.MANUAL,
			status: IntegrationSyncRunStatus.PENDING,
			snapshotCompleteness: IntegrationSyncSnapshotCompleteness.PARTIAL
		})

		try {
			const jobId = buildBullMqSafeJobId(MANUAL_JOB_ID_PREFIX, run.id)
			const job = await this.queue.add(
				PRICE_SYNC_JOB_NAME,
				{
					runId: run.id,
					catalogId,
					integrationId: integration.id,
					mode: IntegrationSyncRunMode.PRICE,
					trigger: IntegrationSyncRunTrigger.MANUAL,
					dto
				},
				{ jobId }
			)
			const resolvedJobId = String(job.id ?? jobId)
			this.observability.recordQueueJobEnqueued(
				ONE_C_SYNC_QUEUE_NAME,
				PRICE_SYNC_JOB_NAME
			)
			await this.repo.attachSyncRunJobId(run.id, resolvedJobId)
			this.logger.log(
				`Queued ONE_C price sync for catalog ${catalogId}: runId=${run.id}, jobId=${resolvedJobId}`
			)

			return {
				ok: true,
				queued: true,
				runId: run.id,
				jobId: resolvedJobId,
				mode: IntegrationSyncRunMode.PRICE,
				trigger: IntegrationSyncRunTrigger.MANUAL
			}
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			await this.repo.finishSyncRun({
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
				durationMs: 0
			})
			throw new InternalServerErrorException(
				`Could not queue ONE_C price sync: ${message}`
			)
		}
	}

	async syncSchedulerForCatalog(catalogId: string): Promise<void> {
		const integration = await this.repo.findIntegration(catalogId)
		if (!integration) {
			await this.removeScheduler(catalogId)
			return
		}

		await this.syncSchedulerForIntegration(integration)
	}

	async syncSchedulerForIntegration(
		integration: OneCIntegrationRecord
	): Promise<Set<string>> {
		const desiredSchedulerIds = new Set<string>()

		try {
			if (
				!(await this.featureReader.canUseOneCIntegration(integration.catalogId))
			) {
				await this.removeScheduler(integration.catalogId)
				this.logger.log(
					`Removed ONE_C schedulers for catalog ${integration.catalogId}: integration capability disabled`
				)
				return desiredSchedulerIds
			}

			const metadata = this.metadataCrypto.parseStoredMetadata(
				integration.metadata
			)
			if (!integration.isActive) {
				await this.removeScheduler(integration.catalogId)
				this.logger.log(
					`Removed ONE_C schedulers for catalog ${integration.catalogId}: integration inactive`
				)
				return desiredSchedulerIds
			}

			await this.syncSchedulerForKind(
				integration,
				metadata,
				'product',
				desiredSchedulerIds
			)
			await this.syncSchedulerForKind(
				integration,
				metadata,
				'stock',
				desiredSchedulerIds
			)
			await this.syncSchedulerForKind(
				integration,
				metadata,
				'price',
				desiredSchedulerIds
			)

			return desiredSchedulerIds
		} catch (error) {
			this.logger.error('Failed to sync ONE_C scheduler', {
				catalogId: integration.catalogId,
				error: renderSafeProviderErrorMessage(error)
			})
			throw error
		}
	}

	async removeScheduler(catalogId: string): Promise<void> {
		await Promise.all([
			this.queue.removeJobScheduler(this.buildSchedulerId(catalogId, 'product')),
			this.queue.removeJobScheduler(this.buildSchedulerId(catalogId, 'stock')),
			this.queue.removeJobScheduler(this.buildSchedulerId(catalogId, 'price'))
		])
		this.logger.log(`Removed ONE_C schedulers for catalog ${catalogId}`)
	}

	async syncAllSchedulers(): Promise<void> {
		const integrations = await this.repo.findAllIntegrations()
		const desiredSchedulerIds = new Set<string>()

		for (const integration of integrations) {
			try {
				const ids = await this.syncSchedulerForIntegration(integration)
				for (const schedulerId of ids) {
					desiredSchedulerIds.add(schedulerId)
				}
			} catch (error) {
				this.logger.warn(
					`Failed to reconcile ONE_C scheduler for catalog ${integration.catalogId}: ${renderSafeProviderErrorMessage(error)}`
				)
				await this.removeScheduler(integration.catalogId)
			}
		}

		const count = await this.queue.getJobSchedulersCount()
		const existingSchedulers = count
			? await this.queue.getJobSchedulers(0, count - 1, true)
			: []

		for (const scheduler of existingSchedulers) {
			const schedulerId = scheduler.id ?? ''
			if (
				schedulerId.startsWith(ONE_C_SYNC_SCHEDULER_PREFIX) &&
				!desiredSchedulerIds.has(schedulerId)
			) {
				await this.queue.removeJobScheduler(schedulerId)
				this.logger.log(
					`Removed stale ONE_C scheduler ${schedulerId} during startup reconciliation`
				)
			}
		}
	}

	private async processJob(job: Job<OneCSyncJob>): Promise<void> {
		const startedAt = Date.now()
		const jobId = String(job.id ?? '')
		const jobName = this.resolveJobName(job)

		this.observability.incrementQueueJobActive(ONE_C_SYNC_QUEUE_NAME, jobName)

		try {
			const prepared = await this.prepareJob(job, jobId)
			if (!prepared) {
				this.observability.recordQueueJob(
					ONE_C_SYNC_QUEUE_NAME,
					jobName,
					'skipped',
					Date.now() - startedAt
				)
				return
			}

			const syncSubject = this.resolveSyncSubject(prepared.mode)
			this.logger.log(
				`Starting ONE_C ${syncSubject} sync job ${jobId || '<unknown>'}: catalog=${prepared.catalogId}, runId=${prepared.runId}`
			)
			const run =
				prepared.mode === IntegrationSyncRunMode.PRICE
					? await this.oneC.executePriceSyncRun({
							catalogId: prepared.catalogId,
							runId: prepared.runId,
							dto: prepared.dto as RunOneCPriceSyncDtoReq,
							jobId
						})
					: prepared.mode === IntegrationSyncRunMode.STOCK
						? await this.oneC.executeStockSyncRun({
								catalogId: prepared.catalogId,
								runId: prepared.runId,
								dto: prepared.dto as RunOneCStockSyncDtoReq,
								jobId
							})
						: prepared.mode === IntegrationSyncRunMode.VARIANT
							? await this.oneC.executeVariantSyncRun({
									catalogId: prepared.catalogId,
									runId: prepared.runId,
									dto: prepared.dto as RunOneCVariantSyncDtoReq,
									jobId
								})
							: await this.oneC.executeProductSyncRun({
									catalogId: prepared.catalogId,
									runId: prepared.runId,
									dto: prepared.dto as RunOneCProductSyncDtoReq,
									jobId
								})
			const outcome =
				run.status === IntegrationSyncRunStatus.SUCCESS ? 'success' : 'error'
			this.observability.recordQueueJob(
				ONE_C_SYNC_QUEUE_NAME,
				jobName,
				outcome,
				Date.now() - startedAt
			)
			this.observability.recordIntegrationSyncRun(
				'ONE_C',
				job.data.mode,
				job.data.trigger,
				outcome,
				Date.now() - startedAt
			)
			this.logger.log(
				`Finished ONE_C ${syncSubject} sync job ${jobId || '<unknown>'}: catalog=${prepared.catalogId}, runId=${prepared.runId}, status=${run.status}, total=${run.totalProducts}, created=${run.createdProducts}, updated=${run.updatedProducts}, failed=${run.failedProducts}`
			)
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			this.observability.recordQueueJob(
				ONE_C_SYNC_QUEUE_NAME,
				jobName,
				'error',
				Date.now() - startedAt
			)
			this.observability.recordIntegrationSyncRun(
				'ONE_C',
				job.data.mode,
				job.data.trigger,
				'error',
				Date.now() - startedAt
			)
			this.logger.error(
				`ONE_C sync job ${jobId || '<unknown>'} failed for catalog ${job.data.catalogId}: ${message}`
			)
			throw error
		} finally {
			this.observability.decrementQueueJobActive(ONE_C_SYNC_QUEUE_NAME, jobName)
		}
	}

	private async prepareJob(
		job: Job<OneCSyncJob>,
		jobId: string
	): Promise<{
		catalogId: string
		runId: string
		mode: IntegrationSyncRunMode
		dto:
			| RunOneCPriceSyncDtoReq
			| RunOneCProductSyncDtoReq
			| RunOneCVariantSyncDtoReq
			| RunOneCStockSyncDtoReq
	} | null> {
		if (job.data.runId && job.data.dto) {
			return {
				catalogId: job.data.catalogId,
				runId: job.data.runId,
				mode: job.data.mode,
				dto: job.data.dto
			}
		}

		if (job.data.trigger !== IntegrationSyncRunTrigger.SCHEDULED) {
			throw new InternalServerErrorException(
				'ONE_C queue job requires runId and dto'
			)
		}

		const integration = await this.repo.findIntegration(job.data.catalogId)
		if (!integration || !integration.isActive) {
			this.logger.warn(
				`Skipping scheduled ONE_C sync for catalog ${job.data.catalogId}: integration not found or inactive`
			)
			return null
		}
		if (
			!(await this.featureReader.canUseOneCIntegration(integration.catalogId))
		) {
			this.logger.warn(
				`Skipping scheduled ONE_C sync for catalog ${integration.catalogId}: integration capability disabled`
			)
			return null
		}

		const activeRun = await this.repo.findLatestActiveSyncRun(
			integration.catalogId
		)
		if (activeRun) {
			this.logger.warn(
				`Skipping scheduled ONE_C sync for catalog ${integration.catalogId}: sync already queued or running`
			)
			return null
		}

		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		const scheduled = this.resolveScheduledSyncJob(metadata, job.data.mode)
		if (!scheduled) {
			const subject = this.resolveSyncSubject(job.data.mode)
			this.logger.warn(
				`Skipping scheduled ONE_C ${subject} sync for catalog ${integration.catalogId}: schedule disabled or mapping missing`
			)
			return null
		}

		const run = await this.repo.createSyncRun({
			integrationId: integration.id,
			catalogId: integration.catalogId,
			mode: scheduled.mode,
			trigger: IntegrationSyncRunTrigger.SCHEDULED,
			status: IntegrationSyncRunStatus.PENDING,
			snapshotCompleteness: IntegrationSyncSnapshotCompleteness.PARTIAL,
			jobId,
			metadata: {
				schedule: {
					subject: scheduled.subject,
					pattern: scheduled.pattern,
					timezone: scheduled.timezone
				}
			}
		})

		return {
			catalogId: integration.catalogId,
			runId: run.id,
			mode: scheduled.mode,
			dto: scheduled.dto
		}
	}

	private async syncSchedulerForKind(
		integration: OneCIntegrationRecord,
		metadata: OneCMetadata,
		kind: OneCSchedulerKind,
		desiredSchedulerIds: Set<string>
	): Promise<void> {
		const scheduled = this.resolveScheduledSyncJob(
			metadata,
			this.resolveSchedulerMode(kind)
		)
		const schedulerId = this.buildSchedulerId(integration.catalogId, kind)

		if (!scheduled) {
			await this.queue.removeJobScheduler(schedulerId)
			this.logger.log(
				`Removed ONE_C ${kind} scheduler for catalog ${integration.catalogId}: schedule disabled or mapping missing`
			)
			return
		}

		await this.queue.upsertJobScheduler(
			schedulerId,
			{
				pattern: scheduled.pattern,
				tz: scheduled.timezone
			},
			{
				name: this.resolveScheduledJobName(kind),
				data: {
					catalogId: integration.catalogId,
					integrationId: integration.id,
					mode: scheduled.mode,
					trigger: IntegrationSyncRunTrigger.SCHEDULED,
					dto: scheduled.dto
				}
			}
		)
		desiredSchedulerIds.add(schedulerId)
		this.logger.log(
			`Upserted ONE_C ${kind} scheduler for catalog ${integration.catalogId}: pattern="${scheduled.pattern}", timezone="${scheduled.timezone}"`
		)
	}

	private resolveScheduledSyncJob(
		metadata: OneCMetadata,
		mode: IntegrationSyncRunMode
	): {
		subject: OneCSchedulerKind
		mode: IntegrationSyncRunMode
		pattern: string
		timezone: string
		dto:
			| RunOneCProductSyncDtoReq
			| RunOneCStockSyncDtoReq
			| RunOneCPriceSyncDtoReq
	} | null {
		if (mode === IntegrationSyncRunMode.PRODUCT) {
			if (
				!metadata.scheduleEnabled ||
				!metadata.schedulePattern ||
				!metadata.productSyncEntityMappingId
			) {
				return null
			}
			return {
				subject: 'product',
				mode,
				pattern: metadata.schedulePattern,
				timezone: metadata.scheduleTimezone,
				dto: this.buildScheduledProductSyncDto(metadata)
			}
		}
		if (mode === IntegrationSyncRunMode.STOCK) {
			if (
				!metadata.stockScheduleEnabled ||
				!metadata.stockSchedulePattern ||
				!metadata.stockSyncEntityMappingId
			) {
				return null
			}
			return {
				subject: 'stock',
				mode,
				pattern: metadata.stockSchedulePattern,
				timezone: metadata.stockScheduleTimezone,
				dto: this.buildScheduledStockSyncDto(metadata)
			}
		}
		if (mode === IntegrationSyncRunMode.PRICE) {
			if (
				!metadata.priceScheduleEnabled ||
				!metadata.priceSchedulePattern ||
				!metadata.priceSyncEntityMappingId
			) {
				return null
			}
			return {
				subject: 'price',
				mode,
				pattern: metadata.priceSchedulePattern,
				timezone: metadata.priceScheduleTimezone,
				dto: this.buildScheduledPriceSyncDto(metadata)
			}
		}

		return null
	}

	private buildScheduledProductSyncDto(
		metadata: OneCMetadata
	): RunOneCProductSyncDtoReq {
		if (!metadata.productSyncEntityMappingId) {
			throw new InternalServerErrorException(
				'ONE_C scheduled product sync requires productSyncEntityMappingId'
			)
		}

		return {
			entityMappingId: metadata.productSyncEntityMappingId,
			limit: metadata.productSyncLimit,
			filter: metadata.productSyncFilter,
			failOnRowError: false
		}
	}

	private buildScheduledStockSyncDto(
		metadata: OneCMetadata
	): RunOneCStockSyncDtoReq {
		if (!metadata.stockSyncEntityMappingId) {
			throw new InternalServerErrorException(
				'ONE_C scheduled stock sync requires stockSyncEntityMappingId'
			)
		}

		return {
			entityMappingId: metadata.stockSyncEntityMappingId,
			limit: metadata.stockSyncLimit,
			filter: metadata.stockSyncFilter,
			failOnRowError: false
		}
	}

	private buildScheduledPriceSyncDto(
		metadata: OneCMetadata
	): RunOneCPriceSyncDtoReq {
		if (!metadata.priceSyncEntityMappingId) {
			throw new InternalServerErrorException(
				'ONE_C scheduled price sync requires priceSyncEntityMappingId'
			)
		}

		return {
			entityMappingId: metadata.priceSyncEntityMappingId,
			limit: metadata.priceSyncLimit,
			filter: metadata.priceSyncFilter,
			failOnRowError: false
		}
	}

	private buildSchedulerId(
		catalogId: string,
		kind: OneCSchedulerKind = 'product'
	): string {
		const base = `${ONE_C_SYNC_SCHEDULER_PREFIX}:${catalogId}`
		return kind === 'product' ? base : `${base}:${kind}`
	}

	private resolveSchedulerMode(kind: OneCSchedulerKind): IntegrationSyncRunMode {
		if (kind === 'stock') return IntegrationSyncRunMode.STOCK
		if (kind === 'price') return IntegrationSyncRunMode.PRICE
		return IntegrationSyncRunMode.PRODUCT
	}

	private resolveScheduledJobName(kind: OneCSchedulerKind): string {
		if (kind === 'stock') return SCHEDULED_STOCK_SYNC_JOB_NAME
		if (kind === 'price') return SCHEDULED_PRICE_SYNC_JOB_NAME
		return SCHEDULED_PRODUCT_SYNC_JOB_NAME
	}

	private resolveJobName(job: Job<OneCSyncJob>): string {
		if (job.name) return job.name
		if (job.data.mode === IntegrationSyncRunMode.PRICE) {
			return PRICE_SYNC_JOB_NAME
		}
		if (job.data.mode === IntegrationSyncRunMode.STOCK) {
			return STOCK_SYNC_JOB_NAME
		}
		if (job.data.mode === IntegrationSyncRunMode.VARIANT) {
			return VARIANT_SYNC_JOB_NAME
		}
		return PRODUCT_SYNC_JOB_NAME
	}

	private resolveSyncSubject(mode: IntegrationSyncRunMode): string {
		if (mode === IntegrationSyncRunMode.PRICE) return 'price'
		if (mode === IntegrationSyncRunMode.STOCK) return 'stock'
		if (mode === IntegrationSyncRunMode.VARIANT) return 'variant'
		return 'product'
	}
}

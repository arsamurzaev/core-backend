import {
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger
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
import { SpanStatusCode, trace } from '@opentelemetry/api'
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

import {
	type IntegrationRecord,
	IntegrationRepository
} from '../../integration.repository'
import {
	renderSafeProviderErrorMessage,
	toSafeProviderError
} from '../../provider-error-redaction'

import { MoySkladMetadataCryptoService } from './moysklad.metadata'
import { MoySkladSyncOrchestratorService } from './moysklad.sync-orchestrator.service'
import { MoySkladSyncRunRecorderService } from './moysklad.sync-run-recorder.service'
import type {
	MoySkladEntityType,
	MoySkladProductChangeWebhookAction,
	MoySkladProductFolderWebhookAction
} from './moysklad.types'

const MOYSKLAD_SYNC_QUEUE_NAME = 'moysklad-sync'
const MOYSKLAD_SYNC_QUEUE_CONCURRENCY = 1
const MOYSKLAD_SYNC_SCHEDULER_PREFIX = 'moysklad:catalog'
const MANUAL_JOB_ID_PREFIX = 'moysklad-manual'
const WEBHOOK_JOB_ID_PREFIX = 'moysklad-webhook-stock'
const WEBHOOK_PRODUCT_JOB_ID_PREFIX = 'moysklad-webhook-product'
const WEBHOOK_PRODUCT_FOLDER_JOB_ID_PREFIX = 'moysklad-webhook-productfolder'
const FULL_SYNC_JOB_NAME = 'catalog-sync'
const PRODUCT_SYNC_JOB_NAME = 'product-sync'
const STOCK_SYNC_JOB_NAME = 'stock-sync'
const WEBHOOK_STOCK_SYNC_JOB_NAME = 'stock-webhook'
const WEBHOOK_PRODUCT_SYNC_JOB_NAME = 'product-webhook'
const WEBHOOK_PRODUCT_FOLDER_SYNC_JOB_NAME = 'productfolder-webhook'
const WEBHOOK_STOCK_SYNC_DELAY_MS = 5000
const WEBHOOK_PRODUCT_SYNC_DELAY_MS = 5000
const WEBHOOK_PRODUCT_FOLDER_SYNC_DELAY_MS = 5000

type MoySkladSyncJob = {
	runId?: string
	catalogId: string
	integrationId?: string
	mode: IntegrationSyncRunMode
	trigger: IntegrationSyncRunTrigger
	productId?: string
	webhookIntegrationId?: string
	webhookEntityType?: MoySkladEntityType | 'productfolder'
	webhookExternalId?: string
	webhookAction?:
		| MoySkladProductChangeWebhookAction
		| MoySkladProductFolderWebhookAction
}

type QueuedSyncResult = {
	ok: true
	queued: true
	runId: string
	jobId: string
	mode: IntegrationSyncRunMode
	trigger: IntegrationSyncRunTrigger
}

type QueuedWebhookStockResult = {
	ok: true
	queued: true
	jobId: string
}

type MoySkladProductWebhookSyncInput = {
	entityType: MoySkladEntityType
	externalId: string
	action: MoySkladProductChangeWebhookAction
}

type MoySkladProductFolderWebhookSyncInput = {
	externalId: string
	action: MoySkladProductFolderWebhookAction
}

@Injectable()
export class MoySkladQueueService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(MoySkladQueueService.name)
	private readonly queueTracer = trace.getTracer('catalog_backend.queue')
	private readonly queue: Queue<MoySkladSyncJob>
	private readonly worker: Worker<MoySkladSyncJob>

	constructor(
		private readonly configService: ConfigService<AllInterfaces>,
		private readonly repo: IntegrationRepository,
		private readonly moySkladSync: MoySkladSyncOrchestratorService,
		private readonly syncRuns: MoySkladSyncRunRecorderService,
		private readonly metadataCrypto: MoySkladMetadataCryptoService,
		@Inject(OBSERVABILITY_RECORDER_PORT)
		private readonly observability: ObservabilityRecorderPort,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly featureAssertions: CapabilityAssertPort,
		@Inject(CAPABILITY_READER_PORT)
		private readonly featureReader: CapabilityReaderPort
	) {
		const redis = this.configService.get('redis', { infer: true })
		const connection: Record<string, any> = {
			host: redis?.host ?? '127.0.0.1',
			port: redis?.port ?? 6379
		}
		if (redis?.user) connection.username = redis.user
		if (redis?.password) connection.password = redis.password

		this.queue = new Queue<MoySkladSyncJob>(MOYSKLAD_SYNC_QUEUE_NAME, {
			connection,
			defaultJobOptions: {
				attempts: 3,
				backoff: { type: 'exponential', delay: 5000 },
				removeOnComplete: { age: 86400 },
				removeOnFail: { age: 86400 }
			}
		})

		this.worker = new Worker<MoySkladSyncJob>(
			MOYSKLAD_SYNC_QUEUE_NAME,
			job => this.processJob(job),
			{
				connection,
				concurrency: MOYSKLAD_SYNC_QUEUE_CONCURRENCY
			}
		)

		this.worker.on('failed', (job, error) => {
			this.logger.error('MoySklad sync queue worker failed', {
				jobId: job?.id,
				error: this.renderErrorMessage(error)
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

	async enqueueCatalogSync(catalogId: string): Promise<QueuedSyncResult> {
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const integration = await this.getActiveIntegrationOrThrow(catalogId)
		await this.assertNoActiveRun(catalogId)
		this.logger.log(
			`Queueing MoySklad catalog sync for catalog ${catalogId} (integration ${integration.id})`
		)

		const run = await this.repo.createSyncRun({
			integrationId: integration.id,
			catalogId,
			mode: IntegrationSyncRunMode.FULL,
			trigger: IntegrationSyncRunTrigger.MANUAL
		})

		try {
			const jobId = this.buildManualJobId(run.id)
			const job = await this.queue.add(
				FULL_SYNC_JOB_NAME,
				{
					runId: run.id,
					catalogId,
					integrationId: integration.id,
					mode: IntegrationSyncRunMode.FULL,
					trigger: IntegrationSyncRunTrigger.MANUAL
				},
				{ jobId }
			)
			const resolvedJobId = String(job.id ?? jobId)
			this.observability.recordQueueJobEnqueued(
				MOYSKLAD_SYNC_QUEUE_NAME,
				FULL_SYNC_JOB_NAME
			)
			await this.repo.attachSyncRunJobId(run.id, resolvedJobId)
			this.logger.log(
				`Queued MoySklad catalog sync for catalog ${catalogId}: runId=${run.id}, jobId=${resolvedJobId}`
			)

			return {
				ok: true,
				queued: true,
				runId: run.id,
				jobId: resolvedJobId,
				mode: IntegrationSyncRunMode.FULL,
				trigger: IntegrationSyncRunTrigger.MANUAL
			}
		} catch (error) {
			const message = this.renderErrorMessage(error)
			await this.syncRuns.failRun(run.id, message)
			throw new InternalServerErrorException(
				`Не удалось поставить синхронизацию MoySklad в очередь: ${message}`
			)
		}
	}

	async enqueueProductSync(
		catalogId: string,
		productId: string
	): Promise<QueuedSyncResult> {
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const integration = await this.getActiveIntegrationOrThrow(catalogId)
		await this.assertNoActiveRun(catalogId)
		this.logger.log(
			`Queueing MoySklad product sync for catalog ${catalogId}, product ${productId} (integration ${integration.id})`
		)

		const run = await this.repo.createSyncRun({
			integrationId: integration.id,
			catalogId,
			mode: IntegrationSyncRunMode.PRODUCT,
			trigger: IntegrationSyncRunTrigger.MANUAL,
			productId
		})

		try {
			const jobId = this.buildManualJobId(run.id)
			const job = await this.queue.add(
				PRODUCT_SYNC_JOB_NAME,
				{
					runId: run.id,
					catalogId,
					integrationId: integration.id,
					mode: IntegrationSyncRunMode.PRODUCT,
					trigger: IntegrationSyncRunTrigger.MANUAL,
					productId
				},
				{ jobId }
			)
			const resolvedJobId = String(job.id ?? jobId)
			this.observability.recordQueueJobEnqueued(
				MOYSKLAD_SYNC_QUEUE_NAME,
				PRODUCT_SYNC_JOB_NAME
			)
			await this.repo.attachSyncRunJobId(run.id, resolvedJobId)
			this.logger.log(
				`Queued MoySklad product sync for catalog ${catalogId}, product ${productId}: runId=${run.id}, jobId=${resolvedJobId}`
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
			const message = this.renderErrorMessage(error)
			await this.syncRuns.failRun(run.id, message)
			throw new InternalServerErrorException(
				`Не удалось поставить синхронизацию товара с MoySklad в очередь: ${message}`
			)
		}
	}

	async enqueueStockSync(catalogId: string): Promise<QueuedSyncResult> {
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const integration = await this.getActiveIntegrationOrThrow(catalogId)
		await this.assertNoActiveRun(catalogId)
		this.logger.log(
			`Queueing MoySklad stock sync for catalog ${catalogId} (integration ${integration.id})`
		)

		const run = await this.repo.createSyncRun({
			integrationId: integration.id,
			catalogId,
			mode: IntegrationSyncRunMode.STOCK,
			trigger: IntegrationSyncRunTrigger.MANUAL
		})

		try {
			const jobId = this.buildManualJobId(run.id)
			const job = await this.queue.add(
				STOCK_SYNC_JOB_NAME,
				{
					runId: run.id,
					catalogId,
					integrationId: integration.id,
					mode: IntegrationSyncRunMode.STOCK,
					trigger: IntegrationSyncRunTrigger.MANUAL
				},
				{ jobId }
			)
			const resolvedJobId = String(job.id ?? jobId)
			this.observability.recordQueueJobEnqueued(
				MOYSKLAD_SYNC_QUEUE_NAME,
				STOCK_SYNC_JOB_NAME
			)
			await this.repo.attachSyncRunJobId(run.id, resolvedJobId)
			this.logger.log(
				`Queued MoySklad stock sync for catalog ${catalogId}: runId=${run.id}, jobId=${resolvedJobId}`
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
			const message = this.renderErrorMessage(error)
			await this.syncRuns.failRun(run.id, message)
			throw new InternalServerErrorException(
				`Не удалось поставить sync остатков MoySklad в очередь: ${message}`
			)
		}
	}

	async enqueueStockWebhookDrain(
		catalogId: string,
		integrationId: string
	): Promise<QueuedWebhookStockResult> {
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const jobId = buildBullMqSafeJobId(WEBHOOK_JOB_ID_PREFIX, integrationId)
		const job = await this.queue.add(
			WEBHOOK_STOCK_SYNC_JOB_NAME,
			{
				catalogId,
				webhookIntegrationId: integrationId,
				mode: IntegrationSyncRunMode.STOCK,
				trigger: IntegrationSyncRunTrigger.WEBHOOK
			},
			{
				jobId,
				delay: WEBHOOK_STOCK_SYNC_DELAY_MS,
				removeOnComplete: true
			}
		)
		const resolvedJobId = String(job.id ?? jobId)
		this.observability.recordQueueJobEnqueued(
			MOYSKLAD_SYNC_QUEUE_NAME,
			WEBHOOK_STOCK_SYNC_JOB_NAME
		)
		this.logger.log(
			`Queued MoySklad stock webhook drain for catalog ${catalogId}: integration=${integrationId}, jobId=${resolvedJobId}`
		)

		return {
			ok: true,
			queued: true,
			jobId: resolvedJobId
		}
	}

	async enqueueProductWebhookSync(
		catalogId: string,
		integrationId: string,
		event: MoySkladProductWebhookSyncInput
	): Promise<QueuedWebhookStockResult> {
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const jobId = buildBullMqSafeJobId(
			WEBHOOK_PRODUCT_JOB_ID_PREFIX,
			integrationId,
			event.entityType,
			event.externalId
		)
		const job = await this.queue.add(
			WEBHOOK_PRODUCT_SYNC_JOB_NAME,
			{
				catalogId,
				webhookIntegrationId: integrationId,
				webhookEntityType: event.entityType,
				webhookExternalId: event.externalId,
				webhookAction: event.action,
				mode: IntegrationSyncRunMode.PRODUCT,
				trigger: IntegrationSyncRunTrigger.WEBHOOK
			},
			{
				jobId,
				delay: WEBHOOK_PRODUCT_SYNC_DELAY_MS,
				removeOnComplete: true
			}
		)
		const resolvedJobId = String(job.id ?? jobId)
		this.observability.recordQueueJobEnqueued(
			MOYSKLAD_SYNC_QUEUE_NAME,
			WEBHOOK_PRODUCT_SYNC_JOB_NAME
		)
		this.logger.log(
			`Queued MoySklad product webhook sync for catalog ${catalogId}: integration=${integrationId}, entity=${event.entityType}, externalId=${event.externalId}, action=${event.action}, jobId=${resolvedJobId}`
		)

		return {
			ok: true,
			queued: true,
			jobId: resolvedJobId
		}
	}

	async enqueueProductFolderWebhookSync(
		catalogId: string,
		integrationId: string,
		event: MoySkladProductFolderWebhookSyncInput
	): Promise<QueuedWebhookStockResult> {
		await this.featureAssertions.assertCanUseMoySkladIntegration(catalogId)
		const jobId = buildBullMqSafeJobId(
			WEBHOOK_PRODUCT_FOLDER_JOB_ID_PREFIX,
			integrationId,
			event.action,
			event.externalId
		)
		const job = await this.queue.add(
			WEBHOOK_PRODUCT_FOLDER_SYNC_JOB_NAME,
			{
				catalogId,
				webhookIntegrationId: integrationId,
				webhookEntityType: 'productfolder',
				webhookExternalId: event.externalId,
				webhookAction: event.action,
				mode: IntegrationSyncRunMode.PRODUCT,
				trigger: IntegrationSyncRunTrigger.WEBHOOK
			},
			{
				jobId,
				delay: WEBHOOK_PRODUCT_FOLDER_SYNC_DELAY_MS,
				removeOnComplete: true
			}
		)
		const resolvedJobId = String(job.id ?? jobId)
		this.observability.recordQueueJobEnqueued(
			MOYSKLAD_SYNC_QUEUE_NAME,
			WEBHOOK_PRODUCT_FOLDER_SYNC_JOB_NAME
		)
		this.logger.log(
			`Queued MoySklad productfolder webhook sync for catalog ${catalogId}: integration=${integrationId}, externalId=${event.externalId}, action=${event.action}, jobId=${resolvedJobId}`
		)

		return {
			ok: true,
			queued: true,
			jobId: resolvedJobId
		}
	}

	async syncSchedulerForIntegration(
		integration: IntegrationRecord
	): Promise<void> {
		const schedulerId = this.buildSchedulerId(integration.catalogId)

		try {
			if (
				!(await this.featureReader.canUseMoySkladIntegration(integration.catalogId))
			) {
				await this.queue.removeJobScheduler(schedulerId)
				this.logger.log(
					`Removed MoySklad scheduler for catalog ${integration.catalogId}: integration capability disabled`
				)
				return
			}

			const metadata = this.metadataCrypto.parseStoredMetadata(
				integration.metadata
			)
			if (
				!integration.isActive ||
				!metadata.scheduleEnabled ||
				!metadata.schedulePattern
			) {
				await this.queue.removeJobScheduler(schedulerId)
				this.logger.log(
					`Removed MoySklad scheduler for catalog ${integration.catalogId}: integration inactive or schedule disabled`
				)
				return
			}

			await this.queue.upsertJobScheduler(
				schedulerId,
				{
					pattern: metadata.schedulePattern,
					tz: metadata.scheduleTimezone
				},
				{
					name: FULL_SYNC_JOB_NAME,
					data: {
						catalogId: integration.catalogId,
						integrationId: integration.id,
						mode: IntegrationSyncRunMode.FULL,
						trigger: IntegrationSyncRunTrigger.SCHEDULED
					}
				}
			)
			this.logger.log(
				`Upserted MoySklad scheduler for catalog ${integration.catalogId}: pattern="${metadata.schedulePattern}", timezone="${metadata.scheduleTimezone}"`
			)
		} catch (error) {
			this.logger.error('Failed to sync MoySklad scheduler', {
				catalogId: integration.catalogId,
				error: this.renderErrorMessage(error)
			})
			throw this.toError(error)
		}
	}

	async removeScheduler(catalogId: string): Promise<void> {
		await this.queue.removeJobScheduler(this.buildSchedulerId(catalogId))
		this.logger.log(`Removed MoySklad scheduler for catalog ${catalogId}`)
	}

	async syncAllSchedulers(): Promise<void> {
		const integrations = await this.repo.findAllMoySklad()
		const desiredSchedulerIds = new Set<string>()

		for (const integration of integrations) {
			try {
				const metadata = this.metadataCrypto.parseStoredMetadata(
					integration.metadata
				)
				if (
					integration.isActive &&
					metadata.scheduleEnabled &&
					metadata.schedulePattern
				) {
					const schedulerId = this.buildSchedulerId(integration.catalogId)
					desiredSchedulerIds.add(schedulerId)
					await this.syncSchedulerForIntegration(integration)
					continue
				}

				await this.removeScheduler(integration.catalogId)
			} catch (error) {
				this.logger.warn(
					`Failed to reconcile MoySklad scheduler for catalog ${integration.catalogId}: ${this.renderErrorMessage(error)}`
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
				schedulerId.startsWith(MOYSKLAD_SYNC_SCHEDULER_PREFIX) &&
				!desiredSchedulerIds.has(schedulerId)
			) {
				await this.queue.removeJobScheduler(schedulerId)
				this.logger.log(
					`Removed stale MoySklad scheduler ${schedulerId} during startup reconciliation`
				)
			}
		}
	}

	private async processJob(job: Job<MoySkladSyncJob>): Promise<unknown> {
		const jobId = String(job.id ?? '')
		const jobName = this.resolveJobName(job)
		const startedAt = process.hrtime.bigint()
		let runId = job.data.runId ?? null

		this.observability.incrementQueueJobActive(MOYSKLAD_SYNC_QUEUE_NAME, jobName)

		return this.queueTracer.startActiveSpan(
			`bullmq.${MOYSKLAD_SYNC_QUEUE_NAME}.${jobName}`,
			async span => {
				span.setAttributes({
					'queue.name': MOYSKLAD_SYNC_QUEUE_NAME,
					'queue.job.name': jobName,
					'queue.job.id': jobId || '<unknown>',
					'catalog.id': job.data.catalogId,
					'integration.sync.mode': job.data.mode,
					'integration.sync.trigger': job.data.trigger
				})

				try {
					this.logger.log(
						`Starting MoySklad queue job ${jobId || '<unknown>'}: catalog=${job.data.catalogId}, mode=${job.data.mode}, trigger=${job.data.trigger}, runId=${runId ?? 'pending'}`
					)
					if (
						!(await this.featureReader.canUseMoySkladIntegration(job.data.catalogId))
					) {
						if (runId) {
							await this.syncRuns.skipRun(runId, 'feature_disabled')
						}
						this.logger.warn(
							`Skipping MoySklad queue job ${jobId || '<unknown>'}: integration capability disabled for catalog ${job.data.catalogId}`
						)
						this.syncRuns.recordOutcome(
							job.data,
							'skipped',
							this.elapsedMs(startedAt)
						)
						this.recordQueueOutcome(jobName, 'skipped', startedAt)
						return { ok: true, skipped: true, reason: 'feature_disabled' }
					}

					if (!runId) {
						if (
							job.data.mode === IntegrationSyncRunMode.PRODUCT &&
							job.data.trigger === IntegrationSyncRunTrigger.WEBHOOK &&
							job.data.webhookEntityType === 'productfolder'
						) {
							const result = await this.processWebhookProductFolderJob(job, jobId)
							const syncSkipped =
								typeof result === 'object' &&
								result !== null &&
								'skipped' in result &&
								(result as { skipped?: boolean }).skipped === true
							this.syncRuns.recordOutcome(
								job.data,
								syncSkipped ? 'skipped' : 'success',
								this.elapsedMs(startedAt)
							)
							this.recordQueueOutcome(
								jobName,
								syncSkipped ? 'skipped' : 'success',
								startedAt
							)
							return result
						}

						if (
							job.data.mode === IntegrationSyncRunMode.PRODUCT &&
							job.data.trigger === IntegrationSyncRunTrigger.WEBHOOK
						) {
							const result = await this.processWebhookProductJob(job, jobId)
							const syncSkipped =
								typeof result === 'object' &&
								result !== null &&
								'skipped' in result &&
								(result as { skipped?: boolean }).skipped === true
							this.syncRuns.recordOutcome(
								job.data,
								syncSkipped ? 'skipped' : 'success',
								this.elapsedMs(startedAt)
							)
							this.recordQueueOutcome(
								jobName,
								syncSkipped ? 'skipped' : 'success',
								startedAt
							)
							return result
						}

						if (
							job.data.mode === IntegrationSyncRunMode.STOCK &&
							job.data.trigger === IntegrationSyncRunTrigger.WEBHOOK
						) {
							const result = await this.processWebhookStockJob(job, jobId)
							const drainSkipped =
								typeof result === 'object' &&
								result !== null &&
								'drainSkipped' in result &&
								(result as { drainSkipped?: boolean }).drainSkipped === true
							this.syncRuns.recordOutcome(
								job.data,
								drainSkipped ? 'skipped' : 'success',
								this.elapsedMs(startedAt)
							)
							this.recordQueueOutcome(
								jobName,
								drainSkipped ? 'skipped' : 'success',
								startedAt
							)
							return result
						}

						runId = await this.prepareScheduledRun(job.data, jobId)
						if (!runId) {
							this.logger.warn(
								`Skipping MoySklad queue job ${jobId || '<unknown>'}: scheduled run was not created`
							)
							this.syncRuns.recordOutcome(
								job.data,
								'skipped',
								this.elapsedMs(startedAt)
							)
							this.recordQueueOutcome(jobName, 'skipped', startedAt)
							return { ok: true, skipped: true }
						}
					}

					const runningRun = await this.syncRuns.markRunning(runId, jobId)
					if (!runningRun) {
						throw new InternalServerErrorException(
							`Не найден запуск синхронизации MoySklad ${runId}`
						)
					}

					if (job.data.mode === IntegrationSyncRunMode.PRODUCT) {
						if (!job.data.productId) {
							throw new InternalServerErrorException(
								'Для синхронизации товара с MoySklad не указан productId'
							)
						}

						const execution = await this.moySkladSync.syncProduct({
							catalogId: job.data.catalogId,
							productId: job.data.productId,
							runId
						})
						const result = execution.result
						await this.syncRuns.completeProductSync(
							runId,
							job.data,
							execution.completion,
							result
						)
						this.logger.log(
							`Finished MoySklad product sync job ${jobId || '<unknown>'}: catalog=${job.data.catalogId}, product=${job.data.productId}, externalId=${result.externalId}, created=${result.created}, updated=${result.updated}, imagesImported=${result.imagesImported}, durationMs=${result.durationMs}`
						)
						this.recordQueueOutcome(jobName, 'success', startedAt)
						return result
					}

					if (job.data.mode === IntegrationSyncRunMode.STOCK) {
						const execution = await this.moySkladSync.syncStock({
							catalogId: job.data.catalogId,
							runId
						})
						const result = execution.result
						await this.syncRuns.completeStockSync(
							runId,
							job.data,
							execution.completion,
							result
						)
						this.logger.log(
							`Finished MoySklad stock sync job ${jobId || '<unknown>'}: catalog=${job.data.catalogId}, total=${result.total}, updated=${result.updated}, updatedProducts=${result.updatedProducts}, updatedVariants=${result.updatedVariants}, skipped=${result.skipped}, durationMs=${result.durationMs}`
						)
						this.recordQueueOutcome(jobName, 'success', startedAt)
						return result
					}

					const execution = await this.moySkladSync.syncCatalog({
						catalogId: job.data.catalogId,
						runId
					})
					const result = execution.result
					await this.syncRuns.completeCatalogSync(
						runId,
						job.data,
						execution.completion,
						result
					)
					this.logger.log(
						`Finished MoySklad catalog sync job ${jobId || '<unknown>'}: catalog=${job.data.catalogId}, total=${result.total}, created=${result.created}, updated=${result.updated}, deleted=${result.deleted}, durationMs=${result.durationMs}`
					)
					this.recordQueueOutcome(jobName, 'success', startedAt)
					return result
				} catch (error) {
					const message = this.renderErrorMessage(error)

					if (runId) {
						try {
							await this.syncRuns.failRun(runId, message)
						} catch (repoError) {
							this.logger.error('Failed to persist MoySklad sync run error', {
								runId,
								error: this.renderErrorMessage(repoError)
							})
						}
					}

					this.syncRuns.recordOutcome(job.data, 'error', this.elapsedMs(startedAt))
					this.recordQueueOutcome(jobName, 'error', startedAt)
					span.recordException(this.toError(error))
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message
					})
					this.logger.error(
						`MoySklad queue job ${jobId || '<unknown>'} failed for catalog ${job.data.catalogId}: ${message}`
					)
					throw this.toError(error)
				} finally {
					this.observability.decrementQueueJobActive(
						MOYSKLAD_SYNC_QUEUE_NAME,
						jobName
					)
					span.end()
				}
			}
		)
	}

	private async prepareScheduledRun(
		job: MoySkladSyncJob,
		jobId: string
	): Promise<string | null> {
		const integration = await this.repo.findMoySklad(job.catalogId)
		if (!integration) {
			this.logger.warn(
				`Skipping scheduled MoySklad sync for catalog ${job.catalogId}: integration not found`
			)
			return null
		}

		try {
			const metadata = this.metadataCrypto.parseStoredMetadata(
				integration.metadata
			)
			if (
				!integration.isActive ||
				!metadata.scheduleEnabled ||
				!metadata.schedulePattern
			) {
				const skipped = await this.repo.createSyncRun({
					integrationId: integration.id,
					catalogId: job.catalogId,
					mode: job.mode,
					trigger: job.trigger,
					status: IntegrationSyncRunStatus.SKIPPED,
					jobId,
					productId: job.productId ?? null
				})
				await this.syncRuns.skipRun(
					skipped.id,
					'Scheduled MoySklad sync is disabled or not configured'
				)
				this.logger.warn(
					`Skipping scheduled MoySklad sync for catalog ${job.catalogId}: integration inactive or schedule disabled`
				)
				return null
			}
		} catch (error) {
			const skipped = await this.repo.createSyncRun({
				integrationId: integration.id,
				catalogId: job.catalogId,
				mode: job.mode,
				trigger: job.trigger,
				status: IntegrationSyncRunStatus.SKIPPED,
				jobId,
				productId: job.productId ?? null
			})
			const message = this.renderErrorMessage(error)
			await this.syncRuns.skipRun(skipped.id, message)
			return null
		}

		const run = await this.repo.createSyncRun({
			integrationId: integration.id,
			catalogId: job.catalogId,
			mode: job.mode,
			trigger: job.trigger,
			jobId,
			productId: job.productId ?? null
		})
		this.logger.log(
			`Prepared scheduled MoySklad sync run ${run.id} for catalog ${job.catalogId} and job ${jobId || '<unknown>'}`
		)

		return run.id
	}

	private async processWebhookProductJob(
		job: Job<MoySkladSyncJob>,
		jobId: string
	): Promise<unknown> {
		const integrationId = job.data.webhookIntegrationId
		const entityType = job.data.webhookEntityType
		const externalId = job.data.webhookExternalId
		const action = job.data.webhookAction
		if (
			!integrationId ||
			!entityType ||
			entityType === 'productfolder' ||
			!externalId ||
			!action ||
			(action !== 'CREATE' && action !== 'UPDATE')
		) {
			throw new InternalServerErrorException(
				'Р”Р»СЏ webhook-СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё С‚РѕРІР°СЂР° MoySklad РЅРµ СѓРєР°Р·Р°РЅС‹ integrationId, entityType, externalId РёР»Рё action'
			)
		}

		const integration = await this.repo.findMoySkladById(integrationId)
		if (!integration || !integration.isActive) {
			this.logger.warn(
				`Skipping MoySklad product webhook sync ${jobId || '<unknown>'}: integration ${integrationId} not found or inactive`
			)
			return {
				ok: true,
				skipped: true,
				reason: 'integration_inactive'
			}
		}

		if (integration.catalogId !== job.data.catalogId) {
			throw new InternalServerErrorException(
				`MoySklad product webhook job catalog mismatch: job=${job.data.catalogId}, integration=${integration.catalogId}`
			)
		}

		const run = await this.repo.createSyncRun({
			integrationId,
			catalogId: integration.catalogId,
			mode: IntegrationSyncRunMode.PRODUCT,
			trigger: IntegrationSyncRunTrigger.WEBHOOK,
			jobId,
			externalId,
			metadata: {
				webhook: {
					queueJobId: jobId,
					entityType,
					action,
					externalId
				}
			}
		})
		const runningRun = await this.syncRuns.markRunning(run.id, jobId)
		if (!runningRun) {
			throw new InternalServerErrorException(
				`РќРµ РЅР°Р№РґРµРЅ Р·Р°РїСѓСЃРє webhook-СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё С‚РѕРІР°СЂР° MoySklad ${run.id}`
			)
		}

		try {
			const execution = await this.moySkladSync.syncWebhookProduct({
				catalogId: integration.catalogId,
				runId: run.id,
				entityType,
				externalId
			})
			const result = execution.result
			await this.syncRuns.completeProductSync(
				run.id,
				job.data,
				execution.completion,
				result
			)
			await this.repo.patchMoySkladProductChangeWebhookMetadata(integrationId, {
				lastProcessedAt: new Date().toISOString(),
				lastError: null
			})
			this.logger.log(
				`Finished MoySklad product webhook sync ${jobId || '<unknown>'}: catalog=${integration.catalogId}, entity=${entityType}, externalId=${externalId}, action=${action}, productId=${result.productId}, created=${result.created}, updated=${result.updated}, variants=${result.totalVariants}, durationMs=${result.durationMs}`
			)

			return result
		} catch (error) {
			const message = this.renderErrorMessage(error)
			await this.repo.patchMoySkladProductChangeWebhookMetadata(integrationId, {
				lastError: message
			})
			await this.syncRuns.failRun(run.id, message)
			this.logger.error(
				`MoySklad product webhook sync ${jobId || '<unknown>'} failed for catalog ${integration.catalogId}: ${message}`
			)
			throw this.toError(error)
		}
	}

	private async processWebhookProductFolderJob(
		job: Job<MoySkladSyncJob>,
		jobId: string
	): Promise<unknown> {
		const integrationId = job.data.webhookIntegrationId
		const entityType = job.data.webhookEntityType
		const externalId = job.data.webhookExternalId
		const action = job.data.webhookAction
		if (
			!integrationId ||
			entityType !== 'productfolder' ||
			!externalId ||
			(action !== 'CREATE' && action !== 'UPDATE' && action !== 'DELETE')
		) {
			throw new InternalServerErrorException(
				'Для webhook-синхронизации категории MoySklad не указаны integrationId, externalId или action'
			)
		}

		const integration = await this.repo.findMoySkladById(integrationId)
		if (!integration || !integration.isActive) {
			this.logger.warn(
				`Skipping MoySklad productfolder webhook sync ${jobId || '<unknown>'}: integration ${integrationId} not found or inactive`
			)
			return {
				ok: true,
				skipped: true,
				reason: 'integration_inactive'
			}
		}

		if (integration.catalogId !== job.data.catalogId) {
			throw new InternalServerErrorException(
				`MoySklad productfolder webhook job catalog mismatch: job=${job.data.catalogId}, integration=${integration.catalogId}`
			)
		}

		const run = await this.repo.createSyncRun({
			integrationId,
			catalogId: integration.catalogId,
			mode: IntegrationSyncRunMode.PRODUCT,
			trigger: IntegrationSyncRunTrigger.WEBHOOK,
			jobId,
			externalId,
			metadata: {
				webhook: {
					queueJobId: jobId,
					entityType,
					action,
					externalId
				}
			}
		})
		const runningRun = await this.syncRuns.markRunning(run.id, jobId)
		if (!runningRun) {
			throw new InternalServerErrorException(
				`Не найден запуск webhook-синхронизации категории MoySklad ${run.id}`
			)
		}

		try {
			const execution = await this.moySkladSync.syncProductFolder({
				catalogId: integration.catalogId,
				runId: run.id,
				externalId,
				action
			})
			const result = execution.result
			await this.repo.completeSyncRun(run.id, execution.completion)
			await this.repo.patchMoySkladProductFolderWebhookMetadata(integrationId, {
				lastProcessedAt: new Date().toISOString(),
				lastError: null
			})
			this.logger.log(
				`Finished MoySklad productfolder webhook sync ${jobId || '<unknown>'}: catalog=${integration.catalogId}, externalId=${externalId}, action=${action}, categoryId=${result.categoryId ?? '<none>'}, updated=${result.updated}, deleted=${result.deleted}, durationMs=${result.durationMs}`
			)

			return result
		} catch (error) {
			const message = this.renderErrorMessage(error)
			await this.repo.patchMoySkladProductFolderWebhookMetadata(integrationId, {
				lastError: message
			})
			await this.syncRuns.failRun(run.id, message)
			this.logger.error(
				`MoySklad productfolder webhook sync ${jobId || '<unknown>'} failed for catalog ${integration.catalogId}: ${message}`
			)
			throw this.toError(error)
		}
	}

	private async processWebhookStockJob(
		job: Job<MoySkladSyncJob>,
		jobId: string
	): Promise<unknown> {
		const integrationId = job.data.webhookIntegrationId
		if (!integrationId) {
			throw new InternalServerErrorException(
				'Для webhook-синхронизации остатков MoySklad не указан integrationId'
			)
		}

		const integration = await this.repo.findMoySkladById(integrationId)
		if (!integration || !integration.isActive) {
			const events = await this.repo.findPendingWebhookEvents(integrationId)
			await this.repo.markWebhookEventsSkipped(
				events.map(event => event.id),
				'integration_inactive'
			)
			this.logger.warn(
				`Skipping MoySklad stock webhook drain ${jobId || '<unknown>'}: integration ${integrationId} not found or inactive`
			)
			return {
				ok: true,
				drainSkipped: true,
				reason: 'integration_inactive'
			}
		}

		if (integration.catalogId !== job.data.catalogId) {
			throw new InternalServerErrorException(
				`MoySklad stock webhook job catalog mismatch: job=${job.data.catalogId}, integration=${integration.catalogId}`
			)
		}

		const events = await this.repo.findPendingWebhookEvents(integrationId)
		if (!events.length) {
			this.logger.log(
				`Skipping MoySklad stock webhook drain ${jobId || '<unknown>'}: no pending events for integration ${integrationId}`
			)
			return {
				ok: true,
				drainSkipped: true,
				reason: 'no_pending_events'
			}
		}

		const eventIds = events.map(event => event.id)
		await this.repo.markWebhookEventsProcessing(eventIds, jobId)

		const run = await this.repo.createSyncRun({
			integrationId,
			catalogId: integration.catalogId,
			mode: IntegrationSyncRunMode.STOCK,
			trigger: IntegrationSyncRunTrigger.WEBHOOK,
			metadata: {
				webhook: {
					queueJobId: jobId,
					eventIds,
					reportUrlCount: events.length
				}
			}
		})
		const runJobId = buildBullMqSafeJobId(WEBHOOK_JOB_ID_PREFIX, run.id)
		const runningRun = await this.syncRuns.markRunning(run.id, runJobId)
		if (!runningRun) {
			throw new InternalServerErrorException(
				`Не найден запуск webhook-синхронизации MoySklad ${run.id}`
			)
		}

		try {
			const reportUrls = Array.from(
				new Set(events.map(event => event.reportUrl).filter(Boolean))
			)
			const execution = await this.moySkladSync.syncWebhookStock({
				catalogId: integration.catalogId,
				runId: run.id,
				reportUrls
			})
			const result = execution.result
			await this.syncRuns.completeStockSync(
				run.id,
				job.data,
				execution.completion,
				result
			)
			await Promise.all(
				eventIds.map(eventId => this.repo.markWebhookEventProcessed(eventId))
			)
			await this.repo.patchMoySkladStockWebhookMetadata(integrationId, {
				lastProcessedAt: new Date().toISOString(),
				lastError: null
			})
			this.logger.log(
				`Finished MoySklad stock webhook drain ${jobId || '<unknown>'}: catalog=${integration.catalogId}, events=${events.length}, total=${result.total}, updated=${result.updated}, updatedProducts=${result.updatedProducts}, updatedVariants=${result.updatedVariants}, skipped=${result.skipped}, durationMs=${result.durationMs}`
			)

			return result
		} catch (error) {
			const message = this.renderErrorMessage(error)
			await Promise.all(
				eventIds.map(eventId => this.repo.markWebhookEventFailed(eventId, message))
			)
			await this.repo.patchMoySkladStockWebhookMetadata(integrationId, {
				lastError: message
			})
			await this.syncRuns.failRun(run.id, message)
			this.logger.error(
				`MoySklad stock webhook drain ${jobId || '<unknown>'} failed for catalog ${integration.catalogId}: ${message}`
			)
			throw this.toError(error)
		}
	}

	private async assertNoActiveRun(catalogId: string): Promise<void> {
		const activeRun = await this.repo.findLatestActiveSyncRun(catalogId)
		if (!activeRun) return

		throw new ConflictException(
			'Синхронизация MoySklad уже стоит в очереди или выполняется'
		)
	}

	private async getActiveIntegrationOrThrow(
		catalogId: string
	): Promise<IntegrationRecord> {
		const integration = await this.repo.findMoySklad(catalogId)
		if (!integration) {
			throw new ConflictException('Интеграция MoySklad не настроена')
		}
		if (!integration.isActive) {
			throw new ConflictException('Интеграция MoySklad отключена')
		}
		return integration
	}

	private buildSchedulerId(catalogId: string): string {
		return `${MOYSKLAD_SYNC_SCHEDULER_PREFIX}:${catalogId}`
	}

	private buildManualJobId(runId: string): string {
		return buildBullMqSafeJobId(MANUAL_JOB_ID_PREFIX, runId)
	}

	private resolveJobName(job: Job<MoySkladSyncJob>): string {
		if (job.name) {
			return job.name
		}
		if (
			job.data.mode === IntegrationSyncRunMode.STOCK &&
			job.data.trigger === IntegrationSyncRunTrigger.WEBHOOK
		) {
			return WEBHOOK_STOCK_SYNC_JOB_NAME
		}
		if (
			job.data.mode === IntegrationSyncRunMode.PRODUCT &&
			job.data.trigger === IntegrationSyncRunTrigger.WEBHOOK
		) {
			if (job.data.webhookEntityType === 'productfolder') {
				return WEBHOOK_PRODUCT_FOLDER_SYNC_JOB_NAME
			}
			return WEBHOOK_PRODUCT_SYNC_JOB_NAME
		}

		switch (job.data.mode) {
			case IntegrationSyncRunMode.PRODUCT:
				return PRODUCT_SYNC_JOB_NAME
			case IntegrationSyncRunMode.STOCK:
				return STOCK_SYNC_JOB_NAME
			default:
				return FULL_SYNC_JOB_NAME
		}
	}

	private recordQueueOutcome(
		jobName: string,
		status: 'success' | 'error' | 'skipped',
		startedAt: bigint
	) {
		const durationMs = this.elapsedMs(startedAt)
		this.observability.recordQueueJob(
			MOYSKLAD_SYNC_QUEUE_NAME,
			jobName,
			status,
			durationMs
		)
	}

	private elapsedMs(startedAt: bigint): number {
		return Number(process.hrtime.bigint() - startedAt) / 1_000_000
	}

	private renderErrorMessage(error: unknown): string {
		return renderSafeProviderErrorMessage(error)
	}

	private toError(error: unknown): Error {
		return toSafeProviderError(error)
	}
}

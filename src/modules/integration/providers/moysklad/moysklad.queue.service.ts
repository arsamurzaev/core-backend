import {
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger
} from '@generated/enums'
import {
	ConflictException,
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
	type IntegrationRecord,
	IntegrationRepository
} from '../../integration.repository'

import { MoySkladMetadataCryptoService } from './moysklad.metadata'
import { MoySkladSyncService } from './moysklad.sync.service'

const MOYSKLAD_SYNC_QUEUE_NAME = 'moysklad-sync'
const MOYSKLAD_SYNC_QUEUE_CONCURRENCY = 1
const MOYSKLAD_SYNC_SCHEDULER_PREFIX = 'moysklad:catalog'
const MANUAL_JOB_ID_PREFIX = 'moysklad:manual'
const FULL_SYNC_JOB_NAME = 'catalog-sync'
const PRODUCT_SYNC_JOB_NAME = 'product-sync'

type MoySkladSyncJob = {
	runId?: string
	catalogId: string
	mode: IntegrationSyncRunMode
	trigger: IntegrationSyncRunTrigger
	productId?: string
}

type QueuedSyncResult = {
	ok: true
	queued: true
	runId: string
	jobId: string
	mode: IntegrationSyncRunMode
	trigger: IntegrationSyncRunTrigger
}

@Injectable()
export class MoySkladQueueService implements OnModuleInit, OnModuleDestroy {
	private readonly logger = new Logger(MoySkladQueueService.name)
	private readonly queue: Queue<MoySkladSyncJob>
	private readonly worker: Worker<MoySkladSyncJob>

	constructor(
		private readonly configService: ConfigService<AllInterfaces>,
		private readonly repo: IntegrationRepository,
		private readonly moySkladSync: MoySkladSyncService,
		private readonly metadataCrypto: MoySkladMetadataCryptoService
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
				attempts: 1,
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
				error: error?.message ?? error
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
					mode: IntegrationSyncRunMode.FULL,
					trigger: IntegrationSyncRunTrigger.MANUAL
				},
				{ jobId }
			)
			const resolvedJobId = String(job.id ?? jobId)
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
			await this.repo.failSyncRun(run.id, this.renderErrorMessage(error))
			throw new InternalServerErrorException(
				`Не удалось поставить sync MoySklad в очередь: ${this.renderErrorMessage(error)}`
			)
		}
	}

	async enqueueProductSync(
		catalogId: string,
		productId: string
	): Promise<QueuedSyncResult> {
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
					mode: IntegrationSyncRunMode.PRODUCT,
					trigger: IntegrationSyncRunTrigger.MANUAL,
					productId
				},
				{ jobId }
			)
			const resolvedJobId = String(job.id ?? jobId)
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
			await this.repo.failSyncRun(run.id, this.renderErrorMessage(error))
			throw new InternalServerErrorException(
				`Не удалось поставить sync товара MoySklad в очередь: ${this.renderErrorMessage(error)}`
			)
		}
	}

	async syncSchedulerForIntegration(
		integration: IntegrationRecord
	): Promise<void> {
		const schedulerId = this.buildSchedulerId(integration.catalogId)

		try {
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
			throw error
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
		let runId = job.data.runId ?? null
		this.logger.log(
			`Starting MoySklad queue job ${jobId || '<unknown>'}: catalog=${job.data.catalogId}, mode=${job.data.mode}, trigger=${job.data.trigger}, runId=${runId ?? 'pending'}`
		)

		if (!runId) {
			runId = await this.prepareScheduledRun(job.data, jobId)
			if (!runId) {
				this.logger.warn(
					`Skipping MoySklad queue job ${jobId || '<unknown>'}: scheduled run was not created`
				)
				return { ok: true, skipped: true }
			}
		}

		const runningRun = await this.repo.markSyncRunRunning(runId, jobId)
		if (!runningRun) {
			throw new InternalServerErrorException(
				`Не найден sync run MoySklad ${runId}`
			)
		}

		try {
			if (job.data.mode === IntegrationSyncRunMode.PRODUCT) {
				if (!job.data.productId) {
					throw new InternalServerErrorException(
						'Для product sync MoySklad не указан productId'
					)
				}

				const result = await this.moySkladSync.syncProduct(
					job.data.catalogId,
					job.data.productId
				)
				await this.repo.completeSyncRun(runId, {
					externalId: result.externalId,
					totalProducts: 1,
					createdProducts: result.created ? 1 : 0,
					updatedProducts: result.updated ? 1 : 0,
					deletedProducts: 0,
					imagesImported: result.imagesImported,
					durationMs: result.durationMs
				})
				this.logger.log(
					`Finished MoySklad product sync job ${jobId || '<unknown>'}: catalog=${job.data.catalogId}, product=${job.data.productId}, externalId=${result.externalId}, created=${result.created}, updated=${result.updated}, imagesImported=${result.imagesImported}, durationMs=${result.durationMs}`
				)
				return result
			}

			const result = await this.moySkladSync.syncCatalog(job.data.catalogId)
			await this.repo.completeSyncRun(runId, {
				totalProducts: result.total,
				createdProducts: result.created,
				updatedProducts: result.updated,
				deletedProducts: result.deleted,
				imagesImported: 0,
				durationMs: result.durationMs
			})
			this.logger.log(
				`Finished MoySklad catalog sync job ${jobId || '<unknown>'}: catalog=${job.data.catalogId}, total=${result.total}, created=${result.created}, updated=${result.updated}, deleted=${result.deleted}, durationMs=${result.durationMs}`
			)
			return result
		} catch (error) {
			const message = this.renderErrorMessage(error)
			await this.repo.failSyncRun(runId, message)
			this.logger.error(
				`MoySklad queue job ${jobId || '<unknown>'} failed for catalog ${job.data.catalogId}: ${message}`
			)
			throw error
		}
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
				await this.repo.skipSyncRun(
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
			await this.repo.skipSyncRun(skipped.id, this.renderErrorMessage(error))
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
		return `${MANUAL_JOB_ID_PREFIX}:${runId}`
	}

	private renderErrorMessage(error: unknown): string {
		if (error instanceof Error && error.message) {
			return error.message
		}

		return 'Unknown error'
	}
}

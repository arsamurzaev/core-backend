import {
	ConflictException,
	Inject,
	Injectable,
	InternalServerErrorException,
	Logger,
	type OnModuleDestroy
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
	IntegrationProvider,
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger,
	IntegrationSyncSnapshotCompleteness
} from '@generated/enums'
import { Job, Queue, Worker } from 'bullmq'

import { AllInterfaces } from '@/core/config'
import {
	OBSERVABILITY_RECORDER_PORT,
	type ObservabilityRecorderPort
} from '@/modules/observability/contracts'
import { buildBullMqSafeJobId } from '@/shared/utils/bullmq-job-id'

import {
	type IntegrationRecord,
	IntegrationRepository
} from '../../integration.repository'
import { renderSafeProviderErrorMessage } from '../../provider-error-redaction'

import {
	type IikoCatalogSyncResult,
	type IikoProductSyncResult,
	type IikoStopListSyncResult,
	IikoSyncService
} from './iiko.sync.service'

const IIKO_SYNC_QUEUE_NAME = 'iiko-sync'
const IIKO_SYNC_QUEUE_CONCURRENCY = 1
const FULL_SYNC_JOB_NAME = 'catalog-sync'
const PRODUCT_SYNC_JOB_NAME = 'product-sync'
const STOCK_SYNC_JOB_NAME = 'stock-sync'
const FULL_WEBHOOK_SYNC_JOB_NAME = 'catalog-webhook-sync'
const STOCK_WEBHOOK_SYNC_JOB_NAME = 'stock-webhook-sync'
const MANUAL_JOB_ID_PREFIX = 'iiko-manual'
const WEBHOOK_JOB_ID_PREFIX = 'iiko-webhook'

type IikoSyncJob = {
	runId: string
	catalogId: string
	integrationId: string
	mode: IntegrationSyncRunMode
	trigger: IntegrationSyncRunTrigger
	productId?: string | null
}

export type IikoQueuedSyncResult = {
	ok: true
	queued: true
	runId: string
	jobId: string
	mode: IntegrationSyncRunMode
	trigger: IntegrationSyncRunTrigger
}

export type IikoQueuedWebhookSyncResult =
	| IikoQueuedSyncResult
	| {
			ok: true
			queued: false
			reason: string
			mode: IntegrationSyncRunMode
			trigger: IntegrationSyncRunTrigger
	  }

@Injectable()
export class IikoQueueService implements OnModuleDestroy {
	private readonly logger = new Logger(IikoQueueService.name)
	private readonly queue: Queue<IikoSyncJob>
	private readonly worker: Worker<IikoSyncJob>

	constructor(
		private readonly configService: ConfigService<AllInterfaces>,
		private readonly repo: IntegrationRepository,
		private readonly iikoSync: IikoSyncService,
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

		this.queue = new Queue<IikoSyncJob>(IIKO_SYNC_QUEUE_NAME, {
			connection,
			defaultJobOptions: {
				attempts: 3,
				backoff: { type: 'exponential', delay: 5000 },
				removeOnComplete: { age: 86400 },
				removeOnFail: { age: 86400 }
			}
		})

		this.worker = new Worker<IikoSyncJob>(
			IIKO_SYNC_QUEUE_NAME,
			job => this.processJob(job),
			{
				connection,
				concurrency: IIKO_SYNC_QUEUE_CONCURRENCY
			}
		)

		this.worker.on('failed', (job, error) => {
			this.logger.error('iiko sync queue worker failed', {
				jobId: job?.id,
				error: renderSafeProviderErrorMessage(error)
			})
		})
	}

	async onModuleDestroy(): Promise<void> {
		await this.worker.close()
		await this.queue.close()
	}

	async enqueueCatalogSync(catalogId: string): Promise<IikoQueuedSyncResult> {
		return this.enqueueSync(catalogId, IntegrationSyncRunMode.FULL)
	}

	async enqueueStockSync(catalogId: string): Promise<IikoQueuedSyncResult> {
		return this.enqueueSync(catalogId, IntegrationSyncRunMode.STOCK)
	}

	async enqueueProductSync(
		catalogId: string,
		productId: string
	): Promise<IikoQueuedSyncResult> {
		return this.enqueueSync(
			catalogId,
			IntegrationSyncRunMode.PRODUCT,
			IntegrationSyncRunTrigger.MANUAL,
			undefined,
			productId
		)
	}

	async enqueueCatalogWebhookSync(
		integration: IntegrationRecord
	): Promise<IikoQueuedWebhookSyncResult> {
		return this.enqueueWebhookSync(integration, IntegrationSyncRunMode.FULL)
	}

	async enqueueStockWebhookSync(
		integration: IntegrationRecord
	): Promise<IikoQueuedWebhookSyncResult> {
		return this.enqueueWebhookSync(integration, IntegrationSyncRunMode.STOCK)
	}

	private async enqueueWebhookSync(
		integration: IntegrationRecord,
		mode: IntegrationSyncRunMode
	): Promise<IikoQueuedWebhookSyncResult> {
		if (!integration.isActive) {
			return {
				ok: true,
				queued: false,
				reason: 'integration_inactive',
				mode,
				trigger: IntegrationSyncRunTrigger.WEBHOOK
			}
		}

		const activeRun = await this.repo.findLatestActiveSyncRun(
			integration.catalogId,
			IntegrationProvider.IIKO
		)
		if (activeRun) {
			return {
				ok: true,
				queued: false,
				reason: 'sync_already_active',
				mode,
				trigger: IntegrationSyncRunTrigger.WEBHOOK
			}
		}

		return this.enqueueSync(
			integration.catalogId,
			mode,
			IntegrationSyncRunTrigger.WEBHOOK,
			integration
		)
	}

	private async enqueueSync(
		catalogId: string,
		mode: IntegrationSyncRunMode,
		trigger: IntegrationSyncRunTrigger = IntegrationSyncRunTrigger.MANUAL,
		resolvedIntegration?: IntegrationRecord,
		productId?: string | null
	): Promise<IikoQueuedSyncResult> {
		const integration =
			resolvedIntegration ?? (await this.getActiveIntegrationOrThrow(catalogId))
		if (trigger === IntegrationSyncRunTrigger.MANUAL) {
			await this.assertNoActiveRun(catalogId)
		}
		const run = await this.repo.createSyncRun({
			integrationId: integration.id,
			catalogId,
			provider: IntegrationProvider.IIKO,
			mode,
			trigger,
			productId: productId ?? null
		})

		try {
			const jobId = buildBullMqSafeJobId(
				trigger === IntegrationSyncRunTrigger.WEBHOOK
					? WEBHOOK_JOB_ID_PREFIX
					: MANUAL_JOB_ID_PREFIX,
				run.id
			)
			const jobName = resolveIikoSyncJobName(mode, trigger)
			const job = await this.queue.add(
				jobName,
				{
					runId: run.id,
					catalogId,
					integrationId: integration.id,
					mode,
					trigger,
					productId: productId ?? null
				},
				{ jobId }
			)
			const resolvedJobId = String(job.id ?? jobId)
			this.observability.recordQueueJobEnqueued(
				IIKO_SYNC_QUEUE_NAME,
				jobName
			)
			await this.repo.attachSyncRunJobId(run.id, resolvedJobId)

			return {
				ok: true,
				queued: true,
				runId: run.id,
				jobId: resolvedJobId,
				mode,
				trigger
			}
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			await this.repo.failSyncRun(run.id, message, new Date(), null)
			throw new InternalServerErrorException(
				`Could not queue iiko sync: ${message}`
			)
		}
	}

	private async processJob(job: Job<IikoSyncJob>): Promise<void> {
		const startedAt = Date.now()
		await this.repo.markSyncRunRunning(job.data.runId, String(job.id ?? ''))

		try {
			if (job.data.mode === IntegrationSyncRunMode.PRODUCT) {
				if (!job.data.productId) {
					throw new InternalServerErrorException(
						'productId is required for iiko product sync'
					)
				}
				const productResult = await this.iikoSync.syncProduct(
					job.data.catalogId,
					job.data.productId,
					{
						runId: job.data.runId
					}
				)
				await this.repo.completeSyncRun(job.data.runId, {
					externalId: productResult.externalId,
					totalProducts: 1 + productResult.totalVariants,
					createdProducts:
						(productResult.created ? 1 : 0) +
						productResult.createdVariants,
					updatedProducts:
						(productResult.updated ? 1 : 0) +
						productResult.updatedVariants,
					deletedProducts: productResult.deletedVariants,
					imagesImported: productResult.imagesImported,
					durationMs: productResult.durationMs,
					snapshotCompleteness: IntegrationSyncSnapshotCompleteness.PARTIAL,
					metadata: this.buildProductSuccessMetadata(productResult)
				})
				this.recordOutcome(job.data, 'success', Date.now() - startedAt)
				return
			}

			if (job.data.mode === IntegrationSyncRunMode.STOCK) {
				const stockResult = await this.iikoSync.syncStopList(
					job.data.catalogId,
					{
						runId: job.data.runId
					}
				)
				await this.repo.completeSyncRun(job.data.runId, {
					totalProducts: 0,
					createdProducts: 0,
					updatedProducts: 0,
					deletedProducts: 0,
					imagesImported: 0,
					durationMs: stockResult.durationMs,
					snapshotCompleteness:
						IntegrationSyncSnapshotCompleteness.FULL_COMPLETE,
					metadata: this.buildStockSuccessMetadata(stockResult)
				})
				this.recordOutcome(job.data, 'success', Date.now() - startedAt)
				return
			}

			const result = await this.iikoSync.syncCatalog(job.data.catalogId, {
				runId: job.data.runId
			})
			await this.repo.completeSyncRun(job.data.runId, {
				totalProducts: result.totalProducts,
				createdProducts: result.createdProducts,
				updatedProducts: result.updatedProducts,
				deletedProducts: result.deletedProducts,
				imagesImported: result.imagesImported,
				durationMs: result.durationMs,
				snapshotCompleteness:
					IntegrationSyncSnapshotCompleteness.FULL_COMPLETE,
				metadata: this.buildSuccessMetadata(result)
			})
			this.recordOutcome(job.data, 'success', Date.now() - startedAt)
		} catch (error) {
			const message = renderSafeProviderErrorMessage(error)
			await this.repo.failSyncRun(
				job.data.runId,
				message,
				new Date(),
				this.buildFailedMetadata(message)
			)
			this.recordOutcome(job.data, 'error', Date.now() - startedAt)
			throw error
		}
	}

	private async getActiveIntegrationOrThrow(
		catalogId: string
	): Promise<IntegrationRecord> {
		const integration = await this.repo.findIiko(catalogId)
		if (!integration) {
			throw new ConflictException('iiko integration is not configured')
		}
		if (!integration.isActive) {
			throw new ConflictException('iiko integration is disabled')
		}
		return integration
	}

	private async assertNoActiveRun(catalogId: string): Promise<void> {
		const activeRun = await this.repo.findLatestActiveSyncRun(
			catalogId,
			IntegrationProvider.IIKO
		)
		if (!activeRun) return

		if (
			activeRun.status === IntegrationSyncRunStatus.PENDING ||
			activeRun.status === IntegrationSyncRunStatus.RUNNING
		) {
			throw new ConflictException('iiko sync is already queued or running')
		}
	}

	private buildSuccessMetadata(result: IikoCatalogSyncResult) {
		return {
			products: {
				total: result.totalProducts,
				created: result.createdProducts,
				updated: result.updatedProducts,
				deleted: result.deletedProducts,
				skipped: result.skippedProducts
			},
			variants: {
				total: result.createdVariants + result.updatedVariants,
				created: result.createdVariants,
				updated: result.updatedVariants,
				deleted: result.deletedVariants,
				skipped: result.skippedVariants
			},
			stockRows: {
				total: result.stock?.totalStopListItems ?? 0,
				applied: result.stock?.matchedStopListItems ?? 0,
				skipped: result.stock?.unmatchedStopListItems ?? 0,
				diagnostics: result.stock
					? {
							source: 'FULL_SYNC',
							stockRows: result.stock.totalStopListItems,
							matchedStockRows: result.stock.matchedStopListItems,
							unmatchedStockRows: result.stock.unmatchedStopListItems,
							productLinks: 0,
							variantLinks: result.stock.totalVariants,
							ignoredVariantLinks: 0,
							appliedProductLinks: result.stock.changedProducts,
							appliedVariantLinks: result.stock.changedVariants,
							skippedReasons: {
								missingStock: 0,
								productHasVariantLinks: 0,
								variantsCapabilityDisabled: 0,
								stockRowWithoutLocalLink:
									result.stock.unmatchedStopListItems
							}
						}
					: null
			},
			warnings: [],
			errors: [],
			progress: {
				phase: 'COMPLETED',
				message: 'iiko menu sync completed',
				processed: result.totalProducts,
				total: result.totalProducts,
				percent: 100,
				updatedAt: new Date().toISOString()
			},
			revision: result.revision
		}
	}

	private buildStockSuccessMetadata(result: IikoStopListSyncResult) {
		return {
			products: {
				total: 0,
				created: 0,
				updated: result.changedProducts,
				deleted: 0,
				skipped: 0
			},
			variants: {
				total: result.totalVariants,
				created: 0,
				updated: result.changedVariants,
				deleted: 0,
				skipped: 0
			},
			stockRows: {
				total: result.totalStopListItems,
				applied: result.matchedStopListItems,
				skipped: result.unmatchedStopListItems,
				diagnostics: {
					source: 'FULL_SYNC',
					stockRows: result.totalStopListItems,
					matchedStockRows: result.matchedStopListItems,
					unmatchedStockRows: result.unmatchedStopListItems,
					productLinks: 0,
					variantLinks: result.totalVariants,
					ignoredVariantLinks: 0,
					appliedProductLinks: result.changedProducts,
					appliedVariantLinks: result.changedVariants,
					skippedReasons: {
						missingStock: 0,
						productHasVariantLinks: 0,
						variantsCapabilityDisabled: 0,
						stockRowWithoutLocalLink: result.unmatchedStopListItems
					}
				}
			},
			warnings: [],
			errors: [],
			progress: {
				phase: 'COMPLETED',
				message: 'iiko stop-list sync completed',
				processed: result.totalVariants,
				total: result.totalVariants,
				percent: 100,
				updatedAt: new Date().toISOString()
			},
			stopList: {
				totalItems: result.totalStopListItems,
				stoppedItems: result.stoppedStopListItems,
				stoppedVariants: result.stoppedVariants,
				restoredVariants: result.restoredVariants,
				terminalGroupIds: result.terminalGroupIds,
				syncedAt: result.syncedAt.toISOString()
			}
		}
	}

	private buildProductSuccessMetadata(result: IikoProductSyncResult) {
		return {
			products: {
				total: 1,
				created: result.created ? 1 : 0,
				updated: result.updated ? 1 : 0,
				deleted: 0,
				skipped: 0
			},
			variants: {
				total: result.totalVariants,
				created: result.createdVariants,
				updated: result.updatedVariants,
				deleted: result.deletedVariants,
				skipped: result.skippedVariants
			},
			stockRows: {
				total: 0,
				applied: 0,
				skipped: 0,
				diagnostics: null
			},
			product: {
				id: result.productId,
				externalId: result.externalId
			},
			warnings: [],
			errors: [],
			progress: {
				phase: 'COMPLETED',
				message: 'iiko product sync completed',
				processed: 1,
				total: 1,
				percent: 100,
				updatedAt: new Date().toISOString()
			},
			revision: result.revision
		}
	}

	private buildFailedMetadata(message: string) {
		return {
			products: {
				total: 0,
				created: 0,
				updated: 0,
				deleted: 0,
				skipped: 0
			},
			variants: {
				total: 0,
				created: 0,
				updated: 0,
				deleted: 0,
				skipped: 0
			},
			stockRows: {
				total: 0,
				applied: 0,
				skipped: 0
			},
			warnings: [],
			errors: [
				{
					code: 'IIKO_SYNC_RUN_FAILED',
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
				updatedAt: new Date().toISOString()
			}
		}
	}

	private recordOutcome(
		job: IikoSyncJob,
		outcome: 'success' | 'error',
		durationMs: number
	): void {
		this.observability.recordIntegrationSyncRun(
			'IIKO',
			job.mode,
			job.trigger,
			outcome,
			durationMs
		)
	}
}

function resolveIikoSyncJobName(
	mode: IntegrationSyncRunMode,
	trigger: IntegrationSyncRunTrigger
): string {
	if (mode === IntegrationSyncRunMode.PRODUCT) {
		return PRODUCT_SYNC_JOB_NAME
	}

	if (trigger === IntegrationSyncRunTrigger.WEBHOOK) {
		return mode === IntegrationSyncRunMode.STOCK
			? STOCK_WEBHOOK_SYNC_JOB_NAME
			: FULL_WEBHOOK_SYNC_JOB_NAME
	}

	return mode === IntegrationSyncRunMode.STOCK
		? STOCK_SYNC_JOB_NAME
		: FULL_SYNC_JOB_NAME
}

import { IntegrationProvider } from '@generated/enums'
import {
	Inject,
	Injectable,
	Logger,
	type OnModuleDestroy,
	type OnModuleInit
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import { Job, Queue, Worker } from 'bullmq'

import { AllInterfaces } from '@/core/config'
import {
	CAPABILITY_READER_PORT,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'
import {
	OBSERVABILITY_RECORDER_PORT,
	type ObservabilityRecorderPort
} from '@/modules/observability/contracts'
import { buildBullMqSafeJobId } from '@/shared/utils/bullmq-job-id'

import { IntegrationRepository } from '../../integration.repository'
import {
	renderSafeProviderErrorMessage,
	toSafeProviderError
} from '../../provider-error-redaction'

import { MoySkladMetadataCryptoService } from './moysklad.metadata'
import {
	MoySkladOrderExportService,
	NonRetryableMoySkladOrderExportError
} from './moysklad.order-export.service'

const ORDER_EXPORT_QUEUE_NAME = 'order-export'
const MOYSKLAD_ORDER_EXPORT_JOB_NAME = 'moysklad-order-export'
const ORDER_EXPORT_QUEUE_CONCURRENCY = 1
const ORDER_EXPORT_STATUS_SUCCESS = 'SUCCESS'
const ORDER_EXPORT_STATUS_RUNNING = 'RUNNING'
const ORDER_EXPORT_STATUS_SKIPPED = 'SKIPPED'
const ORDER_EXPORT_RECONCILE_MS =
	Number(process.env.MOYSKLAD_ORDER_EXPORT_RECONCILE_MS ?? 5 * 60 * 1000) ||
	5 * 60 * 1000
const ORDER_EXPORT_STALE_RUNNING_MS =
	Number(process.env.MOYSKLAD_ORDER_EXPORT_STALE_RUNNING_MS ?? 15 * 60 * 1000) ||
	15 * 60 * 1000
const ORDER_EXPORT_RECONCILE_LIMIT =
	Number(process.env.MOYSKLAD_ORDER_EXPORT_RECONCILE_LIMIT ?? 100) || 100

type MoySkladOrderExportTrigger =
	| 'ORDER_COMPLETED'
	| 'MANUAL_RETRY'
	| 'RECONCILIATION'

type MoySkladOrderExportJob = {
	exportId: string
	integrationId: string
	orderId: string
	catalogId: string
	provider: 'MOYSKLAD'
	idempotencyKey: string
	trigger: MoySkladOrderExportTrigger
}

type QueueCompletedOrderResult = {
	ok: true
	queued: boolean
	exportId?: string
	jobId?: string
	reason?: string
}

@Injectable()
export class MoySkladOrderExportQueueService
	implements OnModuleInit, OnModuleDestroy
{
	private readonly logger = new Logger(MoySkladOrderExportQueueService.name)
	private readonly queueTracer = trace.getTracer('catalog_backend.queue')
	private readonly queue: Queue<MoySkladOrderExportJob>
	private readonly worker: Worker<MoySkladOrderExportJob>
	private reconcileTimer: NodeJS.Timeout | null = null

	constructor(
		private readonly configService: ConfigService<AllInterfaces>,
		private readonly repo: IntegrationRepository,
		private readonly metadataCrypto: MoySkladMetadataCryptoService,
		private readonly orderExport: MoySkladOrderExportService,
		@Inject(OBSERVABILITY_RECORDER_PORT)
		private readonly observability: ObservabilityRecorderPort,
		@Inject(CAPABILITY_READER_PORT)
		private readonly featureEntitlements: CapabilityReaderPort
	) {
		const redis = this.configService.get('redis', { infer: true })
		const connection: Record<string, any> = {
			host: redis?.host ?? '127.0.0.1',
			port: redis?.port ?? 6379
		}
		if (redis?.user) connection.username = redis.user
		if (redis?.password) connection.password = redis.password

		this.queue = new Queue<MoySkladOrderExportJob>(ORDER_EXPORT_QUEUE_NAME, {
			connection,
			defaultJobOptions: {
				attempts: 5,
				backoff: { type: 'exponential', delay: 10000 },
				removeOnComplete: { age: 86400 },
				removeOnFail: { age: 86400 }
			}
		})

		this.worker = new Worker<MoySkladOrderExportJob>(
			ORDER_EXPORT_QUEUE_NAME,
			job => this.processJob(job),
			{
				connection,
				concurrency: ORDER_EXPORT_QUEUE_CONCURRENCY
			}
		)

		this.worker.on('failed', (job, error) => {
			this.logger.error('MoySklad order export queue worker failed', {
				jobId: job?.id,
				exportId: job?.data.exportId,
				orderId: job?.data.orderId,
				integrationId: job?.data.integrationId,
				error: this.renderErrorMessage(error)
			})
		})
	}

	async onModuleInit(): Promise<void> {
		await this.reconcilePendingOrderExports()

		if (ORDER_EXPORT_RECONCILE_MS > 0) {
			this.reconcileTimer = setInterval(() => {
				void this.reconcilePendingOrderExports().catch(error => {
					this.logger.error('MoySklad order export reconciliation failed', {
						component: 'queue',
						queue: ORDER_EXPORT_QUEUE_NAME,
						error: this.renderErrorMessage(error)
					})
				})
			}, ORDER_EXPORT_RECONCILE_MS)
			this.reconcileTimer.unref?.()
		}
	}

	async onModuleDestroy(): Promise<void> {
		if (this.reconcileTimer) {
			clearInterval(this.reconcileTimer)
			this.reconcileTimer = null
		}
		await this.worker.close()
		await this.queue.close()
	}

	async enqueueCompletedOrder(
		catalogId: string,
		orderId: string
	): Promise<QueueCompletedOrderResult> {
		if (!(await this.featureEntitlements.canUseMoySkladIntegration(catalogId))) {
			return { ok: true, queued: false, reason: 'feature_disabled' }
		}
		const integration = await this.repo.findMoySklad(catalogId)
		if (!integration) {
			return { ok: true, queued: false, reason: 'integration_not_configured' }
		}
		if (!integration.isActive) {
			return { ok: true, queued: false, reason: 'integration_inactive' }
		}

		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		if (!metadata.exportOrders) {
			return { ok: true, queued: false, reason: 'order_export_disabled' }
		}

		const exportRecord = await this.repo.createPendingOrderExport({
			integrationId: integration.id,
			orderId
		})
		if (exportRecord.status === ORDER_EXPORT_STATUS_SUCCESS) {
			return {
				ok: true,
				queued: false,
				exportId: exportRecord.id,
				reason: 'already_exported'
			}
		}

		const resolvedJobId = await this.enqueueExportRecord(
			exportRecord,
			catalogId,
			'ORDER_COMPLETED'
		)

		return {
			ok: true,
			queued: true,
			exportId: exportRecord.id,
			jobId: resolvedJobId
		}
	}

	async retryOrderExport(
		catalogId: string,
		exportId: string
	): Promise<QueueCompletedOrderResult> {
		if (!(await this.featureEntitlements.canUseMoySkladIntegration(catalogId))) {
			return { ok: true, queued: false, reason: 'feature_disabled' }
		}
		const exportRecord = await this.repo.findOrderExportForCatalog(
			catalogId,
			exportId
		)
		if (!exportRecord) {
			this.recordOrderExportEvent('MANUAL_RETRY', 'skipped')
			return { ok: true, queued: false, reason: 'export_not_found' }
		}
		if (exportRecord.status === ORDER_EXPORT_STATUS_SUCCESS) {
			this.recordOrderExportEvent('MANUAL_RETRY', 'skipped')
			return {
				ok: true,
				queued: false,
				exportId: exportRecord.id,
				reason: 'already_exported'
			}
		}
		if (exportRecord.status === ORDER_EXPORT_STATUS_RUNNING) {
			this.recordOrderExportEvent('MANUAL_RETRY', 'skipped')
			return {
				ok: true,
				queued: false,
				exportId: exportRecord.id,
				reason: 'export_running'
			}
		}

		const retryable = await this.repo.resetOrderExportForRetry(exportRecord.id)
		if (!retryable) {
			this.recordOrderExportEvent('MANUAL_RETRY', 'skipped')
			return {
				ok: true,
				queued: false,
				exportId: exportRecord.id,
				reason: 'export_not_retryable'
			}
		}

		const jobId = await this.enqueueExportRecord(
			retryable,
			catalogId,
			'MANUAL_RETRY'
		)

		return {
			ok: true,
			queued: true,
			exportId: retryable.id,
			jobId
		}
	}

	async reconcilePendingOrderExports(): Promise<number> {
		const staleRunningBefore = this.buildStaleRunningCutoff()
		const exports = await this.repo.findRunnableOrderExports({
			limit: ORDER_EXPORT_RECONCILE_LIMIT,
			staleRunningBefore
		})
		let queued = 0

		for (const exportRecord of exports) {
			try {
				if (
					!(await this.featureEntitlements.canUseMoySkladIntegration(
						exportRecord.integration.catalogId
					))
				) {
					this.recordOrderExportEvent('RECONCILIATION', 'skipped')
					continue
				}
				const metadata = this.metadataCrypto.parseStoredMetadata(
					exportRecord.integration.metadata
				)
				if (!metadata.exportOrders) {
					await this.repo.markOrderExportSkipped(
						exportRecord.id,
						'order_export_disabled'
					)
					this.recordOrderExportEvent('RECONCILIATION', 'skipped')
					continue
				}

				await this.enqueueExportRecord(
					exportRecord,
					exportRecord.integration.catalogId,
					'RECONCILIATION'
				)
				queued += 1
			} catch (error) {
				this.logger.warn('Skipped MoySklad order export during reconciliation', {
					component: 'queue',
					queue: ORDER_EXPORT_QUEUE_NAME,
					exportId: exportRecord.id,
					orderId: exportRecord.orderId,
					integrationId: exportRecord.integrationId,
					error: this.renderErrorMessage(error)
				})
			}
		}

		if (queued > 0) {
			this.logger.log('Reconciled MoySklad order exports', {
				component: 'queue',
				queue: ORDER_EXPORT_QUEUE_NAME,
				queued
			})
		}

		return queued
	}

	private async processJob(job: Job<MoySkladOrderExportJob>): Promise<unknown> {
		const jobId = String(job.id ?? '')
		const jobName = job.name || MOYSKLAD_ORDER_EXPORT_JOB_NAME
		const startedAt = process.hrtime.bigint()

		this.observability.incrementQueueJobActive(ORDER_EXPORT_QUEUE_NAME, jobName)

		return this.queueTracer.startActiveSpan(
			`bullmq.${ORDER_EXPORT_QUEUE_NAME}.${jobName}`,
			async span => {
				span.setAttributes({
					'queue.name': ORDER_EXPORT_QUEUE_NAME,
					'queue.job.name': jobName,
					'queue.job.id': jobId || '<unknown>',
					'catalog.id': job.data.catalogId,
					'integration.id': job.data.integrationId,
					'order.id': job.data.orderId,
					'integration.orderExport.id': job.data.exportId,
					'integration.orderExport.trigger': job.data.trigger
				})

				try {
					const exportRecord = await this.repo.findOrderExportById(job.data.exportId)
					if (!exportRecord) {
						this.recordQueueOutcome(jobName, 'skipped', startedAt)
						this.recordOrderExportEvent(job.data.trigger, 'skipped')
						return { ok: true, skipped: true, reason: 'export_not_found' }
					}
					if (exportRecord.status === ORDER_EXPORT_STATUS_SUCCESS) {
						this.recordQueueOutcome(jobName, 'skipped', startedAt)
						this.recordOrderExportEvent(job.data.trigger, 'skipped')
						return { ok: true, skipped: true, reason: 'already_exported' }
					}
					if (exportRecord.status === ORDER_EXPORT_STATUS_SKIPPED) {
						this.recordQueueOutcome(jobName, 'skipped', startedAt)
						this.recordOrderExportEvent(job.data.trigger, 'skipped')
						return { ok: true, skipped: true, reason: 'export_skipped' }
					}
					if (
						!(await this.featureEntitlements.canUseMoySkladIntegration(
							job.data.catalogId
						))
					) {
						await this.repo.markOrderExportSkipped(
							exportRecord.id,
							'feature_disabled'
						)
						this.recordQueueOutcome(jobName, 'skipped', startedAt)
						this.recordOrderExportEvent(job.data.trigger, 'skipped')
						return { ok: true, skipped: true, reason: 'feature_disabled' }
					}

					const running = await this.repo.markOrderExportRunning(
						exportRecord.id,
						new Date(),
						job.data.trigger === 'RECONCILIATION'
							? { staleRunningBefore: this.buildStaleRunningCutoff() }
							: {}
					)
					if (!running) {
						this.recordQueueOutcome(jobName, 'skipped', startedAt)
						this.recordOrderExportEvent(job.data.trigger, 'skipped')
						return { ok: true, skipped: true, reason: 'export_not_runnable' }
					}

					const result = await this.orderExport.exportOrder(running)
					await this.repo.markOrderExportSuccess(running.id, {
						externalId: result.externalId,
						response: result.response
					})
					this.recordQueueOutcome(jobName, 'success', startedAt)
					this.recordOrderExportEvent(job.data.trigger, 'success')
					this.logger.log('Finished MoySklad order export', {
						component: 'queue',
						queue: ORDER_EXPORT_QUEUE_NAME,
						jobName,
						jobId: jobId || '<unknown>',
						exportId: running.id,
						orderId: running.orderId,
						integrationId: running.integrationId,
						idempotencyKey: running.idempotencyKey,
						externalId: result.externalId,
						created: result.created
					})

					return { ok: true, externalId: result.externalId }
				} catch (error) {
					const message = this.renderErrorMessage(error)
					if (error instanceof NonRetryableMoySkladOrderExportError) {
						await this.repo.markOrderExportSkipped(job.data.exportId, message)
						this.recordQueueOutcome(jobName, 'skipped', startedAt)
						this.recordOrderExportEvent(job.data.trigger, 'skipped')
					} else {
						await this.repo.markOrderExportError(job.data.exportId, message)
						this.recordQueueOutcome(jobName, 'error', startedAt)
						this.recordOrderExportEvent(job.data.trigger, 'error')
					}
					span.recordException(this.toError(error))
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message
					})
					this.logger.error('MoySklad order export failed', {
						component: 'queue',
						queue: ORDER_EXPORT_QUEUE_NAME,
						jobName,
						jobId: jobId || '<unknown>',
						exportId: job.data.exportId,
						orderId: job.data.orderId,
						integrationId: job.data.integrationId,
						idempotencyKey: job.data.idempotencyKey,
						error: message
					})

					if (error instanceof NonRetryableMoySkladOrderExportError) {
						return { ok: false, retryable: false, skipped: true, error: message }
					}

					throw this.toError(error)
				} finally {
					this.observability.decrementQueueJobActive(
						ORDER_EXPORT_QUEUE_NAME,
						jobName
					)
					span.end()
				}
			}
		)
	}

	private buildJobId(
		integrationId: string,
		orderId: string,
		...suffixSegments: Array<number | string>
	): string {
		return buildBullMqSafeJobId(
			'moysklad-order-export',
			integrationId,
			orderId,
			...suffixSegments
		)
	}

	private async enqueueExportRecord(
		exportRecord: {
			id: string
			integrationId: string
			orderId: string
			idempotencyKey: string
		},
		catalogId: string,
		trigger: MoySkladOrderExportTrigger
	): Promise<string> {
		const jobId =
			trigger === 'ORDER_COMPLETED'
				? this.buildJobId(exportRecord.integrationId, exportRecord.orderId)
				: this.buildJobId(
						exportRecord.integrationId,
						exportRecord.orderId,
						trigger.toLowerCase(),
						Date.now()
					)
		const job = await this.queue.add(
			MOYSKLAD_ORDER_EXPORT_JOB_NAME,
			{
				exportId: exportRecord.id,
				integrationId: exportRecord.integrationId,
				orderId: exportRecord.orderId,
				catalogId,
				provider: IntegrationProvider.MOYSKLAD,
				idempotencyKey: exportRecord.idempotencyKey,
				trigger
			},
			{ jobId }
		)
		const resolvedJobId = String(job.id ?? jobId)
		this.observability.recordQueueJobEnqueued(
			ORDER_EXPORT_QUEUE_NAME,
			MOYSKLAD_ORDER_EXPORT_JOB_NAME
		)
		this.recordOrderExportEvent(trigger, 'queued')
		this.logger.log('Queued MoySklad order export', {
			component: 'queue',
			queue: ORDER_EXPORT_QUEUE_NAME,
			jobName: MOYSKLAD_ORDER_EXPORT_JOB_NAME,
			jobId: resolvedJobId,
			exportId: exportRecord.id,
			orderId: exportRecord.orderId,
			integrationId: exportRecord.integrationId,
			idempotencyKey: exportRecord.idempotencyKey,
			trigger
		})

		return resolvedJobId
	}

	private buildStaleRunningCutoff(): Date {
		return new Date(Date.now() - ORDER_EXPORT_STALE_RUNNING_MS)
	}

	private recordQueueOutcome(
		jobName: string,
		status: 'success' | 'error' | 'skipped',
		startedAt: bigint
	) {
		const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
		this.observability.recordQueueJob(
			ORDER_EXPORT_QUEUE_NAME,
			jobName,
			status,
			durationMs
		)
	}

	private recordOrderExportEvent(
		trigger: MoySkladOrderExportTrigger,
		outcome: 'queued' | 'success' | 'error' | 'skipped'
	) {
		this.observability.recordOrderExportEvent(
			IntegrationProvider.MOYSKLAD,
			trigger,
			outcome
		)
	}

	private renderErrorMessage(error: unknown): string {
		return renderSafeProviderErrorMessage(error)
	}

	private toError(error: unknown): Error {
		return toSafeProviderError(error)
	}
}

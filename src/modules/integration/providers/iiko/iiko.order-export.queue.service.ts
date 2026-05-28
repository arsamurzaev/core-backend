import type { Prisma } from '@generated/client'
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
import type {
	OrderExportPort,
	OrderExportQueueResult,
	OrderExportWaitResult
} from '@/modules/integration/contracts'
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

import { IikoMetadataCryptoService } from './iiko.metadata'
import {
	IikoOrderExportService,
	NonRetryableIikoOrderExportError
} from './iiko.order-export.service'

const IIKO_ORDER_EXPORT_QUEUE_NAME = 'iiko-order-export'
const IIKO_ORDER_EXPORT_JOB_NAME = 'iiko-order-export'
const ORDER_EXPORT_QUEUE_CONCURRENCY = 1
const ORDER_EXPORT_STATUS_SUCCESS = 'SUCCESS'
const ORDER_EXPORT_STATUS_ERROR = 'ERROR'
const ORDER_EXPORT_STATUS_RUNNING = 'RUNNING'
const ORDER_EXPORT_STATUS_SKIPPED = 'SKIPPED'
const ORDER_EXPORT_WAIT_TIMEOUT_MS =
	Number(process.env.IIKO_ORDER_EXPORT_WAIT_TIMEOUT_MS ?? 45_000) || 45_000
const ORDER_EXPORT_WAIT_INTERVAL_MS =
	Number(process.env.IIKO_ORDER_EXPORT_WAIT_INTERVAL_MS ?? 500) || 500
const ORDER_EXPORT_RECONCILE_MS =
	Number(process.env.IIKO_ORDER_EXPORT_RECONCILE_MS ?? 5 * 60 * 1000) ||
	5 * 60 * 1000
const ORDER_EXPORT_STALE_RUNNING_MS =
	Number(process.env.IIKO_ORDER_EXPORT_STALE_RUNNING_MS ?? 15 * 60 * 1000) ||
	15 * 60 * 1000
const ORDER_EXPORT_RECONCILE_LIMIT =
	Number(process.env.IIKO_ORDER_EXPORT_RECONCILE_LIMIT ?? 100) || 100

type IikoOrderExportTrigger =
	| 'ORDER_COMPLETED'
	| 'MANUAL_RETRY'
	| 'RECONCILIATION'

type IikoOrderExportJob = {
	exportId: string
	integrationId: string
	orderId: string
	catalogId: string
	provider: 'IIKO'
	idempotencyKey: string
	trigger: IikoOrderExportTrigger
}

@Injectable()
export class IikoOrderExportQueueService
	implements OrderExportPort, OnModuleInit, OnModuleDestroy
{
	private readonly logger = new Logger(IikoOrderExportQueueService.name)
	private readonly queueTracer = trace.getTracer('catalog_backend.queue')
	private readonly queue: Queue<IikoOrderExportJob>
	private readonly worker: Worker<IikoOrderExportJob>
	private reconcileTimer: NodeJS.Timeout | null = null

	constructor(
		private readonly configService: ConfigService<AllInterfaces>,
		private readonly repo: IntegrationRepository,
		private readonly metadataCrypto: IikoMetadataCryptoService,
		private readonly orderExport: IikoOrderExportService,
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

		this.queue = new Queue<IikoOrderExportJob>(IIKO_ORDER_EXPORT_QUEUE_NAME, {
			connection,
			defaultJobOptions: {
				attempts: 5,
				backoff: { type: 'exponential', delay: 10000 },
				removeOnComplete: { age: 86400 },
				removeOnFail: { age: 86400 }
			}
		})

		this.worker = new Worker<IikoOrderExportJob>(
			IIKO_ORDER_EXPORT_QUEUE_NAME,
			job => this.processJob(job),
			{
				connection,
				concurrency: ORDER_EXPORT_QUEUE_CONCURRENCY
			}
		)

		this.worker.on('failed', (job, error) => {
			this.logger.error('iiko order export queue worker failed', {
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
					this.logger.error('iiko order export reconciliation failed', {
						component: 'queue',
						queue: IIKO_ORDER_EXPORT_QUEUE_NAME,
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
	): Promise<OrderExportQueueResult> {
		if (!(await this.featureEntitlements.canUseIikoIntegration(catalogId))) {
			return { ok: true, queued: false, reason: 'feature_disabled' }
		}
		const integration = await this.repo.findIiko(catalogId)
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
		if (!metadata.terminalGroupId) {
			return { ok: true, queued: false, reason: 'terminal_group_not_configured' }
		}

		const exportRecord = await this.repo.createPendingOrderExport({
			integrationId: integration.id,
			orderId,
			provider: IntegrationProvider.IIKO
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
	): Promise<OrderExportQueueResult> {
		if (!(await this.featureEntitlements.canUseIikoIntegration(catalogId))) {
			return { ok: true, queued: false, reason: 'feature_disabled' }
		}
		const exportRecord = await this.repo.findOrderExportForCatalog(
			catalogId,
			exportId,
			IntegrationProvider.IIKO
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

	async waitForCompletedOrderExport(
		catalogId: string,
		orderId: string,
		params: {
			timeoutMs?: number
			intervalMs?: number
		} = {}
	): Promise<OrderExportWaitResult> {
		if (!(await this.featureEntitlements.canUseIikoIntegration(catalogId))) {
			return { ok: false, status: 'NOT_QUEUED', reason: 'feature_disabled' }
		}

		const integration = await this.repo.findIiko(catalogId)
		if (!integration) {
			return {
				ok: false,
				status: 'NOT_QUEUED',
				reason: 'integration_not_configured'
			}
		}
		if (!integration.isActive) {
			return { ok: false, status: 'NOT_QUEUED', reason: 'integration_inactive' }
		}

		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		if (!metadata.exportOrders) {
			return {
				ok: false,
				status: 'NOT_QUEUED',
				reason: 'order_export_disabled'
			}
		}
		if (!metadata.terminalGroupId) {
			return {
				ok: false,
				status: 'NOT_QUEUED',
				reason: 'terminal_group_not_configured'
			}
		}

		const timeoutMs = normalizePositiveNumber(
			params.timeoutMs,
			ORDER_EXPORT_WAIT_TIMEOUT_MS
		)
		const intervalMs = normalizePositiveNumber(
			params.intervalMs,
			ORDER_EXPORT_WAIT_INTERVAL_MS
		)
		const deadline = Date.now() + timeoutMs
		let lastExportId: string | undefined

		while (Date.now() <= deadline) {
			const exportRecord = await this.repo.findOrderExportByOrderId(
				integration.id,
				orderId
			)
			if (exportRecord) {
				lastExportId = exportRecord.id
				if (exportRecord.status === ORDER_EXPORT_STATUS_SUCCESS) {
					return { ok: true, status: 'SUCCESS', exportId: exportRecord.id }
				}
				if (exportRecord.status === ORDER_EXPORT_STATUS_ERROR) {
					return {
						ok: false,
						status: 'ERROR',
						exportId: exportRecord.id,
						error: exportRecord.lastError
					}
				}
				if (exportRecord.status === ORDER_EXPORT_STATUS_SKIPPED) {
					return {
						ok: false,
						status: 'SKIPPED',
						exportId: exportRecord.id,
						error: exportRecord.lastError
					}
				}
			}

			await sleep(intervalMs)
		}

		return {
			ok: false,
			status: 'TIMEOUT',
			exportId: lastExportId,
			reason: 'order_export_timeout'
		}
	}

	async reconcilePendingOrderExports(): Promise<number> {
		const staleRunningBefore = this.buildStaleRunningCutoff()
		const exports = await this.repo.findRunnableOrderExports({
			limit: ORDER_EXPORT_RECONCILE_LIMIT,
			staleRunningBefore,
			provider: IntegrationProvider.IIKO
		})
		let queued = 0

		for (const exportRecord of exports) {
			try {
				if (
					!(await this.featureEntitlements.canUseIikoIntegration(
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
				this.logger.warn('Skipped iiko order export during reconciliation', {
					component: 'queue',
					queue: IIKO_ORDER_EXPORT_QUEUE_NAME,
					exportId: exportRecord.id,
					orderId: exportRecord.orderId,
					integrationId: exportRecord.integrationId,
					error: this.renderErrorMessage(error)
				})
			}
		}

		return queued
	}

	private async processJob(job: Job<IikoOrderExportJob>): Promise<unknown> {
		const jobId = String(job.id ?? '')
		const jobName = job.name || IIKO_ORDER_EXPORT_JOB_NAME
		const startedAt = process.hrtime.bigint()

		this.observability.incrementQueueJobActive(
			IIKO_ORDER_EXPORT_QUEUE_NAME,
			jobName
		)

		return this.queueTracer.startActiveSpan(
			`bullmq.${IIKO_ORDER_EXPORT_QUEUE_NAME}.${jobName}`,
			async span => {
				span.setAttributes({
					'queue.name': IIKO_ORDER_EXPORT_QUEUE_NAME,
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
						!(await this.featureEntitlements.canUseIikoIntegration(
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
						response: result.response as unknown as Prisma.InputJsonValue
					})
					this.recordQueueOutcome(jobName, 'success', startedAt)
					this.recordOrderExportEvent(job.data.trigger, 'success')

					return {
						ok: true,
						externalId: result.externalId,
						correlationId: result.correlationId
					}
				} catch (error) {
					const message = this.renderErrorMessage(error)
					if (error instanceof NonRetryableIikoOrderExportError) {
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
					this.logger.error(`iiko order export failed: ${message}`, {
						component: 'queue',
						queue: IIKO_ORDER_EXPORT_QUEUE_NAME,
						jobName,
						jobId: jobId || '<unknown>',
						exportId: job.data.exportId,
						orderId: job.data.orderId,
						integrationId: job.data.integrationId,
						idempotencyKey: job.data.idempotencyKey,
						error: message
					})

					if (error instanceof NonRetryableIikoOrderExportError) {
						return { ok: false, retryable: false, skipped: true, error: message }
					}

					throw this.toError(error)
				} finally {
					this.observability.decrementQueueJobActive(
						IIKO_ORDER_EXPORT_QUEUE_NAME,
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
			'iiko-order-export',
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
		trigger: IikoOrderExportTrigger
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
			IIKO_ORDER_EXPORT_JOB_NAME,
			{
				exportId: exportRecord.id,
				integrationId: exportRecord.integrationId,
				orderId: exportRecord.orderId,
				catalogId,
				provider: IntegrationProvider.IIKO,
				idempotencyKey: exportRecord.idempotencyKey,
				trigger
			},
			{ jobId }
		)
		const resolvedJobId = String(job.id ?? jobId)
		this.observability.recordQueueJobEnqueued(
			IIKO_ORDER_EXPORT_QUEUE_NAME,
			IIKO_ORDER_EXPORT_JOB_NAME
		)
		this.recordOrderExportEvent(trigger, 'queued')
		this.logger.log('Queued iiko order export', {
			component: 'queue',
			queue: IIKO_ORDER_EXPORT_QUEUE_NAME,
			jobName: IIKO_ORDER_EXPORT_JOB_NAME,
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
			IIKO_ORDER_EXPORT_QUEUE_NAME,
			jobName,
			status,
			durationMs
		)
	}

	private recordOrderExportEvent(
		trigger: IikoOrderExportTrigger,
		outcome: 'queued' | 'success' | 'error' | 'skipped'
	) {
		this.observability.recordOrderExportEvent(
			IntegrationProvider.IIKO,
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

function normalizePositiveNumber(
	value: number | undefined,
	fallback: number
): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
	return value > 0 ? Math.floor(value) : fallback
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}

import {
	IntegrationSyncRunMode,
	IntegrationSyncRunTrigger
} from '@generated/enums'
import { Injectable } from '@nestjs/common'

import { ObservabilityService } from '@/modules/observability/observability.service'

import { IntegrationRepository } from '../../integration.repository'

import type {
	MoySkladSyncRunCompletionInput,
	MoySkladSyncRunJsonObject
} from './moysklad.sync-orchestrator.service'

const MOYSKLAD_PROVIDER_LABEL = 'MOYSKLAD'

type SyncJobContext = {
	catalogId: string
	mode: IntegrationSyncRunMode
	trigger: IntegrationSyncRunTrigger
	productId?: string
}

type SyncRunOutcome = 'success' | 'error' | 'skipped'

type CatalogSyncMetricsResult = {
	createdProducts?: number
	createdVariants?: number
	updatedProducts?: number
	updatedVariants?: number
	deleted: number
	skippedProducts?: number
	skippedVariants?: number
	durationMs: number
}

type ProductSyncMetricsResult = {
	created: boolean
	updated: boolean
	productUpdated?: boolean
	createdVariants?: number
	updatedVariants?: number
	deletedVariants?: number
	skippedVariants?: number
	durationMs: number
}

type StockSyncMetricsResult = {
	updated: number
	updatedProducts: number
	updatedVariants: number
	skipped: number
	durationMs: number
	syncedAt: Date
}

@Injectable()
export class MoySkladSyncRunRecorderService {
	constructor(
		private readonly repo: IntegrationRepository,
		private readonly observability: ObservabilityService
	) {}

	async markRunning(runId: string, jobId: string): Promise<boolean> {
		return Boolean(await this.repo.markSyncRunRunning(runId, jobId))
	}

	async failRun(runId: string, message: string): Promise<void> {
		await this.repo.failSyncRun(
			runId,
			message,
			new Date(),
			this.buildFailedSyncMetadata(message)
		)
	}

	async skipRun(runId: string, message: string): Promise<void> {
		await this.repo.skipSyncRun(
			runId,
			message,
			new Date(),
			this.buildSkippedSyncMetadata(message)
		)
	}

	async completeCatalogSync(
		runId: string,
		job: SyncJobContext,
		completion: MoySkladSyncRunCompletionInput,
		result: CatalogSyncMetricsResult
	): Promise<void> {
		await this.repo.completeSyncRun(runId, completion)
		this.recordCatalogSyncMetrics(job, result)
	}

	async completeProductSync(
		runId: string,
		job: SyncJobContext,
		completion: MoySkladSyncRunCompletionInput,
		result: ProductSyncMetricsResult
	): Promise<void> {
		await this.repo.completeSyncRun(runId, completion)
		this.recordProductSyncMetrics(job, result)
	}

	async completeStockSync(
		runId: string,
		job: SyncJobContext,
		completion: MoySkladSyncRunCompletionInput,
		result: StockSyncMetricsResult
	): Promise<void> {
		await this.repo.completeSyncRun(runId, completion)
		this.recordStockSyncMetrics(job, result)
		this.observability.recordIntegrationStockFreshness(
			MOYSKLAD_PROVIDER_LABEL,
			job.catalogId,
			result.syncedAt
		)
	}

	recordOutcome(
		job: SyncJobContext,
		outcome: SyncRunOutcome,
		durationMs: number
	): void {
		this.observability.recordIntegrationSyncRun(
			MOYSKLAD_PROVIDER_LABEL,
			job.mode,
			job.trigger,
			outcome,
			durationMs
		)
	}

	private recordCatalogSyncMetrics(
		job: SyncJobContext,
		result: CatalogSyncMetricsResult
	) {
		this.recordOutcome(job, 'success', result.durationMs)
		this.recordSyncItems(
			job.mode,
			'product',
			'created',
			result.createdProducts ?? 0
		)
		this.recordSyncItems(
			job.mode,
			'variant',
			'created',
			result.createdVariants ?? 0
		)
		this.recordSyncItems(
			job.mode,
			'product',
			'updated',
			result.updatedProducts ?? 0
		)
		this.recordSyncItems(
			job.mode,
			'variant',
			'updated',
			result.updatedVariants ?? 0
		)
		this.recordSyncItems(job.mode, 'product', 'deleted', result.deleted)
		this.recordSyncItems(
			job.mode,
			'product',
			'skipped',
			result.skippedProducts ?? 0
		)
		this.recordSyncItems(
			job.mode,
			'variant',
			'skipped',
			result.skippedVariants ?? 0
		)
	}

	private recordProductSyncMetrics(
		job: SyncJobContext,
		result: ProductSyncMetricsResult
	) {
		this.recordOutcome(job, 'success', result.durationMs)
		this.recordSyncItems(
			job.mode,
			'product',
			result.created
				? 'created'
				: (result.productUpdated ?? result.updated)
					? 'updated'
					: 'skipped',
			1
		)
		this.recordSyncItems(
			job.mode,
			'variant',
			'created',
			result.createdVariants ?? 0
		)
		this.recordSyncItems(
			job.mode,
			'variant',
			'updated',
			result.updatedVariants ?? 0
		)
		this.recordSyncItems(
			job.mode,
			'variant',
			'deleted',
			result.deletedVariants ?? 0
		)
		this.recordSyncItems(
			job.mode,
			'variant',
			'skipped',
			result.skippedVariants ?? 0
		)
	}

	private recordStockSyncMetrics(
		job: SyncJobContext,
		result: StockSyncMetricsResult
	) {
		this.recordOutcome(job, 'success', result.durationMs)
		this.recordSyncItems(job.mode, 'stock_row', 'applied', result.updated)
		this.recordSyncItems(job.mode, 'stock_row', 'skipped', result.skipped)
		this.recordSyncItems(job.mode, 'product', 'updated', result.updatedProducts)
		this.recordSyncItems(job.mode, 'variant', 'updated', result.updatedVariants)
	}

	private recordSyncItems(
		mode: IntegrationSyncRunMode,
		entity: 'product' | 'variant' | 'stock_row',
		outcome: 'created' | 'updated' | 'deleted' | 'skipped' | 'applied',
		count: number
	) {
		this.observability.recordIntegrationSyncItems(
			MOYSKLAD_PROVIDER_LABEL,
			mode,
			entity,
			outcome,
			count
		)
	}

	private buildFailedSyncMetadata(message: string) {
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
					code: 'MOYSKLAD_SYNC_RUN_FAILED',
					message,
					externalId: null
				}
			],
			progress: this.buildTerminalProgress('FAILED', message, 0, null)
		}
	}

	private buildSkippedSyncMetadata(message: string) {
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
			warnings: [
				{
					code: 'MOYSKLAD_SYNC_RUN_SKIPPED',
					message,
					externalId: null
				}
			],
			errors: [],
			progress: this.buildTerminalProgress('FAILED', message, 0, null)
		}
	}

	private buildTerminalProgress(
		phase: 'COMPLETED' | 'FAILED',
		message: string,
		processed = 0,
		total: number | null = processed
	): MoySkladSyncRunJsonObject {
		const normalizedProcessed = Math.max(0, Math.trunc(processed))
		const normalizedTotal =
			typeof total === 'number' && Number.isFinite(total)
				? Math.max(0, Math.trunc(total))
				: null
		const percent =
			normalizedTotal !== null && normalizedTotal > 0
				? Math.min(
						100,
						Math.max(0, Math.round((normalizedProcessed / normalizedTotal) * 100))
					)
				: normalizedTotal === 0
					? 100
					: phase === 'COMPLETED'
						? 100
						: null

		return {
			phase,
			message,
			processed: normalizedProcessed,
			total: normalizedTotal,
			percent,
			updatedAt: new Date().toISOString()
		}
	}
}

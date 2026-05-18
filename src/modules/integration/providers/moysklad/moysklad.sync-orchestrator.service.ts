import { IntegrationSyncSnapshotCompleteness } from '@generated/enums'
import { Injectable } from '@nestjs/common'

import type { MoySkladExternalStockDiagnostics } from './moysklad.stock-sync.service'
import { MoySkladSyncService } from './moysklad.sync.service'
import type {
	MoySkladEntityType,
	MoySkladProductFolderWebhookAction
} from './moysklad.types'

export type MoySkladSyncRunJsonValue =
	| string
	| number
	| boolean
	| null
	| MoySkladSyncRunJsonObject
	| MoySkladSyncRunJsonValue[]

export type MoySkladSyncRunJsonObject = {
	[key: string]: MoySkladSyncRunJsonValue
}

type SyncItemIssue = {
	code: string
	message: string
	externalId: string | null
	count?: number | null
}

type SyncCatalogResult = {
	ok: true
	total: number
	totalProducts: number
	totalVariants: number
	created: number
	createdProducts: number
	createdVariants: number
	updated: number
	updatedProducts: number
	updatedVariants: number
	deleted: number
	skippedProducts: number
	skippedVariants: number
	warnings: SyncItemIssue[]
	errors: SyncItemIssue[]
	durationMs: number
	syncedAt: Date
}

type SyncProductResult = {
	ok: true
	productId: string
	externalId: string
	created: boolean
	updated: boolean
	productUpdated: boolean
	imagesImported: number
	totalVariants: number
	createdVariants: number
	updatedVariants: number
	deletedVariants: number
	skippedVariants: number
	warnings: SyncItemIssue[]
	errors: SyncItemIssue[]
	durationMs: number
}

type SyncStockResult = {
	ok: true
	total: number
	updated: number
	updatedProducts: number
	updatedVariants: number
	skipped: number
	diagnostics?: MoySkladExternalStockDiagnostics
	durationMs: number
	syncedAt: Date
}

type SyncProductFolderResult = {
	ok: true
	externalId: string
	action: MoySkladProductFolderWebhookAction
	categoryId: string | null
	updated: boolean
	deleted: number
	durationMs: number
}

export type MoySkladSyncRunCompletionInput = {
	externalId?: string | null
	totalProducts: number
	createdProducts: number
	updatedProducts: number
	deletedProducts: number
	imagesImported: number
	durationMs: number
	snapshotCompleteness?: IntegrationSyncSnapshotCompleteness
	metadata: MoySkladSyncRunJsonObject
}

@Injectable()
export class MoySkladSyncOrchestratorService {
	constructor(private readonly sync: MoySkladSyncService) {}

	async syncCatalog(input: { catalogId: string; runId: string }): Promise<{
		result: SyncCatalogResult
		completion: MoySkladSyncRunCompletionInput
	}> {
		const result = await this.sync.syncCatalog(input.catalogId, {
			runId: input.runId
		})

		return {
			result,
			completion: {
				totalProducts: result.total,
				createdProducts: result.created,
				updatedProducts: result.updated,
				deletedProducts: result.deleted,
				imagesImported: 0,
				durationMs: result.durationMs,
				snapshotCompleteness: this.resolveCatalogSnapshotCompleteness(result),
				metadata: this.buildCatalogSyncMetadata(result)
			}
		}
	}

	async syncProduct(input: {
		catalogId: string
		productId: string
		runId: string
	}): Promise<{
		result: SyncProductResult
		completion: MoySkladSyncRunCompletionInput
	}> {
		const result = await this.sync.syncProduct(input.catalogId, input.productId, {
			runId: input.runId
		})
		const productUpdated = result.productUpdated ?? result.updated
		const createdItems = (result.created ? 1 : 0) + result.createdVariants
		const updatedItems = (productUpdated ? 1 : 0) + result.updatedVariants

		return {
			result,
			completion: {
				externalId: result.externalId,
				totalProducts: 1 + result.totalVariants,
				createdProducts: createdItems,
				updatedProducts: updatedItems,
				deletedProducts: result.deletedVariants,
				imagesImported: result.imagesImported,
				durationMs: result.durationMs,
				snapshotCompleteness: IntegrationSyncSnapshotCompleteness.PARTIAL,
				metadata: this.buildProductSyncMetadata(result)
			}
		}
	}

	async syncWebhookProduct(input: {
		catalogId: string
		runId: string
		entityType: MoySkladEntityType
		externalId: string
	}): Promise<{
		result: SyncProductResult
		completion: MoySkladSyncRunCompletionInput
	}> {
		const result = await this.sync.syncExternalProduct(input.catalogId, {
			entityType: input.entityType,
			externalId: input.externalId,
			runId: input.runId
		})
		const productUpdated = result.productUpdated ?? result.updated
		const createdItems = (result.created ? 1 : 0) + result.createdVariants
		const updatedItems = (productUpdated ? 1 : 0) + result.updatedVariants

		return {
			result,
			completion: {
				externalId: result.externalId,
				totalProducts: 1 + result.totalVariants,
				createdProducts: createdItems,
				updatedProducts: updatedItems,
				deletedProducts: result.deletedVariants,
				imagesImported: result.imagesImported,
				durationMs: result.durationMs,
				snapshotCompleteness: IntegrationSyncSnapshotCompleteness.WEBHOOK_DELTA,
				metadata: {
					...this.buildProductSyncMetadata(result),
					webhook: {
						entityType: input.entityType,
						externalId: input.externalId
					}
				}
			}
		}
	}

	async syncProductFolder(input: {
		catalogId: string
		runId: string
		externalId: string
		action: MoySkladProductFolderWebhookAction
	}): Promise<{
		result: SyncProductFolderResult
		completion: MoySkladSyncRunCompletionInput
	}> {
		const result = await this.sync.syncProductFolder(input.catalogId, {
			runId: input.runId,
			externalId: input.externalId,
			action: input.action
		})

		return {
			result,
			completion: {
				externalId: result.externalId,
				totalProducts: 0,
				createdProducts: 0,
				updatedProducts: result.updated ? 1 : 0,
				deletedProducts: result.deleted,
				imagesImported: 0,
				durationMs: result.durationMs,
				snapshotCompleteness: IntegrationSyncSnapshotCompleteness.WEBHOOK_DELTA,
				metadata: {
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
					categories: {
						total: 1,
						updated: result.updated ? 1 : 0,
						deleted: result.deleted
					},
					warnings: [],
					errors: [],
					webhook: {
						entityType: 'productfolder',
						externalId: input.externalId,
						action: input.action
					},
					progress: this.buildTerminalProgress(
						'COMPLETED',
						'Синхронизация категории MoySklad завершена',
						1,
						1
					)
				}
			}
		}
	}

	async syncStock(input: { catalogId: string; runId: string }): Promise<{
		result: SyncStockResult
		completion: MoySkladSyncRunCompletionInput
	}> {
		const result = await this.sync.syncStock(input.catalogId, {
			runId: input.runId
		})

		return {
			result,
			completion: {
				totalProducts: result.total,
				createdProducts: 0,
				updatedProducts: result.updated,
				deletedProducts: 0,
				imagesImported: 0,
				durationMs: result.durationMs,
				snapshotCompleteness: IntegrationSyncSnapshotCompleteness.PARTIAL,
				metadata: this.buildStockSyncMetadata(result)
			}
		}
	}

	async syncWebhookStock(input: {
		catalogId: string
		runId: string
		reportUrls: string[]
	}): Promise<{
		result: SyncStockResult
		completion: MoySkladSyncRunCompletionInput
	}> {
		const result = await this.sync.syncWebhookStock(input.catalogId, {
			runId: input.runId,
			reportUrls: input.reportUrls
		})

		return {
			result,
			completion: {
				totalProducts: result.total,
				createdProducts: 0,
				updatedProducts: result.updated,
				deletedProducts: 0,
				imagesImported: 0,
				durationMs: result.durationMs,
				snapshotCompleteness: IntegrationSyncSnapshotCompleteness.WEBHOOK_DELTA,
				metadata: this.buildStockSyncMetadata(result)
			}
		}
	}

	private resolveCatalogSnapshotCompleteness(
		result: SyncCatalogResult
	): IntegrationSyncSnapshotCompleteness {
		if (
			result.totalProducts > 0 &&
			result.errors.length === 0 &&
			result.skippedProducts === 0
		) {
			return IntegrationSyncSnapshotCompleteness.FULL_COMPLETE
		}

		return IntegrationSyncSnapshotCompleteness.PARTIAL
	}

	private buildCatalogSyncMetadata(result: SyncCatalogResult) {
		const total = result.totalProducts + result.totalVariants

		return {
			products: {
				total: result.totalProducts,
				created: result.createdProducts,
				updated: result.updatedProducts,
				deleted: result.deleted,
				skipped: result.skippedProducts
			},
			variants: {
				total: result.totalVariants,
				created: result.createdVariants,
				updated: result.updatedVariants,
				deleted: 0,
				skipped: result.skippedVariants
			},
			stockRows: {
				total: 0,
				applied: 0,
				skipped: 0
			},
			warnings: this.mapIssues(result.warnings),
			errors: this.mapIssues(result.errors),
			progress: this.buildTerminalProgress(
				'COMPLETED',
				'Синхронизация MoySklad завершена',
				total,
				total
			)
		}
	}

	private buildProductSyncMetadata(result: SyncProductResult) {
		const productUpdated = result.productUpdated ?? result.updated
		const total = 1 + result.totalVariants

		return {
			products: {
				total: 1,
				created: result.created ? 1 : 0,
				updated: productUpdated ? 1 : 0,
				deleted: 0,
				skipped: result.created || productUpdated ? 0 : 1
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
				skipped: 0
			},
			warnings: this.mapIssues(result.warnings),
			errors: this.mapIssues(result.errors),
			progress: this.buildTerminalProgress(
				'COMPLETED',
				'Синхронизация товара MoySklad завершена',
				total,
				total
			)
		}
	}

	private buildStockSyncMetadata(result: SyncStockResult) {
		return {
			products: {
				total: 0,
				created: 0,
				updated: result.updatedProducts,
				deleted: 0,
				skipped: 0
			},
			variants: {
				total: 0,
				created: 0,
				updated: result.updatedVariants,
				deleted: 0,
				skipped: 0
			},
			stockRows: {
				total: result.total,
				applied: result.updated,
				skipped: result.skipped,
				diagnostics: result.diagnostics
					? (result.diagnostics as unknown as MoySkladSyncRunJsonObject)
					: null,
				lastStockSyncedAt: result.syncedAt.toISOString()
			},
			warnings: [],
			errors: [],
			progress: this.buildTerminalProgress(
				'COMPLETED',
				'Синхронизация остатков MoySklad завершена',
				result.total,
				result.total
			)
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

	private mapIssues(issues: SyncItemIssue[]): MoySkladSyncRunJsonValue[] {
		return issues.map(issue => ({
			code: issue.code,
			message: issue.message,
			externalId: issue.externalId,
			...(issue.count !== undefined ? { count: issue.count } : {})
		}))
	}
}

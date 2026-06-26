export const OBSERVABILITY_RECORDER_PORT = Symbol('OBSERVABILITY_RECORDER_PORT')

export interface ObservabilityRecorderPort {
	recordPrismaSlowQuery(durationMs: number): void
	recordCacheOperation(
		operation: 'get_version' | 'bump_version' | 'get_json' | 'set_json' | 'del',
		outcome: 'success' | 'error' | 'hit' | 'miss' | 'corrupted',
		durationMs: number
	): void
	recordCronRun(
		name: string,
		status: 'success' | 'error',
		durationMs: number
	): void
	recordQueueJobEnqueued(queue: string, jobName: string): void
	incrementQueueJobActive(queue: string, jobName: string): void
	decrementQueueJobActive(queue: string, jobName: string): void
	recordQueueJob(
		queue: string,
		jobName: string,
		status: 'success' | 'error' | 'skipped',
		durationMs: number
	): void
	recordOrderExportEvent(
		provider: string,
		trigger: string,
		outcome: 'queued' | 'success' | 'error' | 'skipped'
	): void
	recordIntegrationSyncRun(
		provider: string,
		mode: string,
		trigger: string,
		outcome: 'success' | 'error' | 'skipped',
		durationMs: number
	): void
	recordIntegrationSyncItems(
		provider: string,
		mode: string,
		entity: 'product' | 'variant' | 'stock_row',
		outcome: 'created' | 'updated' | 'deleted' | 'skipped' | 'applied',
		count: number
	): void
	recordIntegrationStockFreshness(
		provider: string,
		catalogId: string,
		lastSyncedAt: Date
	): void
	recordInventoryMovement(
		type: string,
		source: string,
		outcome?: 'success' | 'error',
		count?: number
	): void
	recordAuthEvent(
		flow: 'admin' | 'catalog' | 'session' | 'admin_sso',
		action: 'login' | 'logout' | 'handoff_issue' | 'handoff_exchange',
		outcome: 'success' | 'failure',
		reason:
			| 'none'
			| 'credentials'
			| 'access'
			| 'token'
			| 'session'
			| 'not_found'
			| 'other'
	): void
	recordAdminAction(
		action: string,
		outcome: 'success' | 'error',
		actorId: string
	): void
}

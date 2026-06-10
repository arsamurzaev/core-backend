import {
	IntegrationProvider,
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger
} from '@generated/enums'

import type { ObservabilityRecorderPort } from '@/modules/observability/contracts'
import { createDomainEvent } from '@/shared/domain-events/domain-event.utils'
import { InProcessDomainEventBus } from '@/shared/domain-events/in-process-domain-event-bus'

import {
	IntegrationRepository,
	type IntegrationSyncRunRecord
} from '../../integration.repository'

import { MoySkladSyncCompletedDiagnosticsHandler } from './moysklad.sync-completed-diagnostics.handler'

describe('MoySkladSyncCompletedDiagnosticsHandler', () => {
	it('updates stock freshness from integration.sync_completed stock run metadata', async () => {
		const bus = new InProcessDomainEventBus()
		const repo = {
			findSyncRunById: jest.fn().mockResolvedValue(
				createSyncRunRecord({
					metadata: {
						stockRows: {
							lastStockSyncedAt: '2026-05-17T09:30:00.000Z'
						}
					}
				})
			)
		} as unknown as jest.Mocked<IntegrationRepository>
		const observability = {
			recordIntegrationStockFreshness: jest.fn()
		} as unknown as jest.Mocked<ObservabilityRecorderPort>
		const handler = new MoySkladSyncCompletedDiagnosticsHandler(
			bus,
			repo,
			observability
		)
		handler.onModuleInit()

		await bus.dispatch(
			createDomainEvent({
				type: 'integration.sync_completed',
				catalogId: 'catalog-1',
				integrationId: 'integration-1',
				runId: 'run-1',
				mode: IntegrationSyncRunMode.STOCK,
				trigger: IntegrationSyncRunTrigger.WEBHOOK
			})
		)

		expect(repo.findSyncRunById).toHaveBeenCalledWith('run-1')
		expect(observability.recordIntegrationStockFreshness).toHaveBeenCalledWith(
			'MOYSKLAD',
			'catalog-1',
			new Date('2026-05-17T09:30:00.000Z')
		)
	})

	it('ignores non-stock sync runs', async () => {
		const bus = new InProcessDomainEventBus()
		const repo = {
			findSyncRunById: jest.fn().mockResolvedValue(
				createSyncRunRecord({
					mode: IntegrationSyncRunMode.FULL,
					metadata: {
						stockRows: {
							lastStockSyncedAt: '2026-05-17T09:30:00.000Z'
						}
					}
				})
			)
		} as unknown as jest.Mocked<IntegrationRepository>
		const observability = {
			recordIntegrationStockFreshness: jest.fn()
		} as unknown as jest.Mocked<ObservabilityRecorderPort>
		const handler = new MoySkladSyncCompletedDiagnosticsHandler(
			bus,
			repo,
			observability
		)
		handler.onModuleInit()

		await bus.dispatch(
			createDomainEvent({
				type: 'integration.sync_completed',
				catalogId: 'catalog-1',
				integrationId: 'integration-1',
				runId: 'run-1',
				mode: IntegrationSyncRunMode.FULL,
				trigger: IntegrationSyncRunTrigger.MANUAL
			})
		)

		expect(observability.recordIntegrationStockFreshness).not.toHaveBeenCalled()
	})
})

function createSyncRunRecord(
	overrides: Partial<IntegrationSyncRunRecord> = {}
): IntegrationSyncRunRecord {
	const now = new Date('2026-05-17T09:31:00.000Z')
	return {
		id: 'run-1',
		integrationId: 'integration-1',
		catalogId: 'catalog-1',
		provider: IntegrationProvider.MOYSKLAD,
		mode: IntegrationSyncRunMode.STOCK,
		trigger: IntegrationSyncRunTrigger.WEBHOOK,
		status: IntegrationSyncRunStatus.SUCCESS,
		snapshotCompleteness: 'WEBHOOK_DELTA',
		jobId: null,
		productId: null,
		externalId: null,
		error: null,
		metadata: null,
		totalProducts: 0,
		createdProducts: 0,
		updatedProducts: 0,
		deletedProducts: 0,
		imagesImported: 0,
		durationMs: 0,
		requestedAt: now,
		startedAt: now,
		finishedAt: now,
		createdAt: now,
		updatedAt: now,
		...overrides
	}
}

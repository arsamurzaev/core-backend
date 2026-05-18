import {
	IntegrationSyncRunMode,
	IntegrationSyncRunTrigger
} from '@generated/enums'

import type { ObservabilityRecorderPort } from '@/modules/observability/contracts'
import type { DomainEventDispatcher } from '@/shared/domain-events/domain-events.contract'

import { IntegrationRepository } from '../../integration.repository'

import { MoySkladSyncRunRecorderService } from './moysklad.sync-run-recorder.service'

describe('MoySkladSyncRunRecorderService', () => {
	it('publishes integration.sync_completed when a stock run completes', async () => {
		const repo = {
			completeSyncRun: jest.fn().mockResolvedValue(undefined)
		} as unknown as jest.Mocked<IntegrationRepository>
		const observability = {
			recordIntegrationSyncRun: jest.fn(),
			recordIntegrationSyncItems: jest.fn(),
			recordIntegrationStockFreshness: jest.fn()
		} as unknown as jest.Mocked<ObservabilityRecorderPort>
		const events = {
			dispatch: jest.fn().mockResolvedValue(undefined)
		} as unknown as jest.Mocked<DomainEventDispatcher>
		const service = new MoySkladSyncRunRecorderService(
			repo,
			observability,
			events
		)
		const syncedAt = new Date('2026-05-17T12:00:00.000Z')

		await service.completeStockSync(
			'run-1',
			{
				catalogId: 'catalog-1',
				integrationId: 'integration-1',
				mode: IntegrationSyncRunMode.STOCK,
				trigger: IntegrationSyncRunTrigger.WEBHOOK
			},
			{
				totalProducts: 1,
				createdProducts: 0,
				updatedProducts: 1,
				deletedProducts: 0,
				imagesImported: 0,
				durationMs: 25,
				metadata: {}
			},
			{
				updated: 1,
				updatedProducts: 1,
				updatedVariants: 0,
				skipped: 0,
				durationMs: 25,
				syncedAt
			}
		)

		expect(events.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'integration.sync_completed',
				catalogId: 'catalog-1',
				integrationId: 'integration-1',
				runId: 'run-1',
				mode: IntegrationSyncRunMode.STOCK,
				trigger: IntegrationSyncRunTrigger.WEBHOOK
			})
		)
		expect(observability.recordIntegrationStockFreshness).toHaveBeenCalledWith(
			'MOYSKLAD',
			'catalog-1',
			syncedAt
		)
	})
})

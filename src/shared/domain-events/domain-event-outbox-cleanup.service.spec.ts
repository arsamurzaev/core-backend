import { DomainEventOutboxCleanupService } from './domain-event-outbox-cleanup.service'
import { DomainEventOutboxDiagnosticsService } from './domain-event-outbox-diagnostics.service'

describe('DomainEventOutboxCleanupService', () => {
	it('runs cleanup with configured defaults', async () => {
		const diagnostics = {
			cleanupProcessed: jest.fn().mockResolvedValue({
				deleted: 0,
				retentionDays: 30,
				cutoff: new Date('2026-04-17T00:00:00.000Z'),
				limit: 5000
			})
		}
		const service = new DomainEventOutboxCleanupService(
			diagnostics as unknown as DomainEventOutboxDiagnosticsService
		)

		await service.cleanupProcessed()

		expect(diagnostics.cleanupProcessed).toHaveBeenCalledWith({
			retentionDays: expect.any(Number),
			limit: expect.any(Number)
		})
	})
})

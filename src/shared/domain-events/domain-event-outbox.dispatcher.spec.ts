import { DomainEventOutboxStatus } from '@generated/enums'

import { createDomainEvent } from './domain-event.utils'
import { DomainEventOutboxDispatcher } from './domain-event-outbox.dispatcher'
import type {
	DomainEventOutboxRecord,
	DomainEventOutboxRepository
} from './domain-event-outbox.repository'
import { serializeDomainEvent } from './domain-event-outbox.utils'
import type { DomainEventBus } from './domain-events.contract'

describe('DomainEventOutboxDispatcher', () => {
	const event = createDomainEvent({
		type: 'variant.stock_changed',
		catalogId: '11111111-1111-1111-1111-111111111111',
		productId: '22222222-2222-2222-2222-222222222222',
		variantId: '33333333-3333-3333-3333-333333333333',
		previousStock: 2,
		nextStock: 1,
		source: 'cart',
		reason: 'cart_reservation'
	})

	function createRow(): DomainEventOutboxRecord {
		return {
			id: '44444444-4444-4444-4444-444444444444',
			eventId: event.eventId,
			eventType: event.type,
			payload: serializeDomainEvent(event),
			status: DomainEventOutboxStatus.PENDING,
			attempts: 0
		}
	}

	function createSubject(row = createRow()) {
		const repo = {
			append: jest.fn().mockResolvedValue(undefined),
			findDispatchableByEventIds: jest.fn().mockResolvedValue([row]),
			findDueForProcessing: jest.fn().mockResolvedValue([row]),
			markProcessing: jest.fn().mockResolvedValue(true),
			markProcessed: jest.fn().mockResolvedValue(undefined),
			markFailed: jest.fn().mockResolvedValue(undefined)
		}
		const bus = {
			dispatch: jest.fn().mockResolvedValue(undefined),
			dispatchMany: jest.fn(),
			subscribe: jest.fn()
		}
		const dispatcher = new DomainEventOutboxDispatcher(
			repo as unknown as DomainEventOutboxRepository,
			bus as unknown as DomainEventBus
		)

		return { dispatcher, repo, bus, row }
	}

	it('persists events before dispatching dispatchMany calls', async () => {
		const { dispatcher, repo, bus, row } = createSubject()

		await dispatcher.dispatchMany([event])

		expect(repo.append).toHaveBeenCalledWith([event])
		expect(repo.findDispatchableByEventIds).toHaveBeenCalledWith([
			event.eventId
		])
		expect(repo.markProcessing).toHaveBeenCalledWith(row.id, expect.any(Date))
		expect(bus.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				eventId: event.eventId,
				type: event.type,
				occurredAt: expect.any(Date)
			})
		)
		expect(repo.markProcessed).toHaveBeenCalledWith(row.id)
		expect(repo.markFailed).not.toHaveBeenCalled()
	})

	it('marks failed rows and rethrows direct dispatch errors', async () => {
		const { dispatcher, repo, bus, row } = createSubject()
		const error = new Error('handler boom')
		bus.dispatch.mockRejectedValueOnce(error)

		await expect(dispatcher.dispatch(event)).rejects.toThrow('handler boom')

		expect(repo.markFailed).toHaveBeenCalledWith(row.id, 'handler boom')
		expect(repo.markProcessed).not.toHaveBeenCalled()
	})

	it('drains pending rows without creating new outbox records', async () => {
		const { dispatcher, repo, bus, row } = createSubject()

		await expect(
			dispatcher.drainPending({
				limit: 10,
				maxAttempts: 3,
				staleProcessingMs: 1000
			})
		).resolves.toEqual({
			processed: 1,
			failed: 0,
			skipped: 0
		})

		expect(repo.append).not.toHaveBeenCalled()
		expect(repo.findDueForProcessing).toHaveBeenCalledWith({
			limit: 10,
			maxAttempts: 3,
			staleProcessingBefore: expect.any(Date)
		})
		expect(bus.dispatch).toHaveBeenCalledTimes(1)
		expect(repo.markProcessed).toHaveBeenCalledWith(row.id)
	})
})

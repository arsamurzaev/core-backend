import { DomainEventOutboxStatus } from '@generated/enums'
import { BadRequestException, NotFoundException } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { DomainEventOutboxDiagnosticsService } from './domain-event-outbox-diagnostics.service'
import { DomainEventOutboxDispatcher } from './domain-event-outbox.dispatcher'

describe('DomainEventOutboxDiagnosticsService', () => {
	let service: DomainEventOutboxDiagnosticsService
	let prisma: {
		domainEventOutbox: {
			count: jest.Mock
			findMany: jest.Mock
			groupBy: jest.Mock
			findFirst: jest.Mock
			findUnique: jest.Mock
		}
	}
	let dispatcher: jest.Mocked<
		Pick<DomainEventOutboxDispatcher, 'retryByIds' | 'drainPending'>
	>
	let outbox: {
		countProcessedBefore: jest.Mock
		countFailedBefore: jest.Mock
		deleteProcessedBefore: jest.Mock
	}

	beforeEach(() => {
		prisma = {
			domainEventOutbox: {
				count: jest.fn(),
				findMany: jest.fn(),
				groupBy: jest.fn(),
				findFirst: jest.fn(),
				findUnique: jest.fn()
			}
		}
		dispatcher = {
			retryByIds: jest.fn().mockResolvedValue({
				processed: 1,
				failed: 0,
				skipped: 0
			}),
			drainPending: jest.fn().mockResolvedValue({
				processed: 2,
				failed: 0,
				skipped: 1
			})
		}
		outbox = {
			countProcessedBefore: jest.fn().mockResolvedValue(0),
			countFailedBefore: jest.fn().mockResolvedValue(0),
			deleteProcessedBefore: jest.fn().mockResolvedValue(0)
		}
		service = new DomainEventOutboxDiagnosticsService(
			prisma as unknown as PrismaService,
			dispatcher as unknown as DomainEventOutboxDispatcher,
			outbox as any
		)
	})

	it('lists outbox rows with filters and safe limit', async () => {
		const rows = [{ id: 'outbox-1' }]
		prisma.domainEventOutbox.count.mockResolvedValue(1)
		prisma.domainEventOutbox.findMany.mockResolvedValue(rows)

		await expect(
			service.list({
				status: DomainEventOutboxStatus.FAILED,
				catalogId: '11111111-1111-1111-1111-111111111111',
				eventType: 'variant.stock_changed',
				limit: 1000
			})
		).resolves.toEqual({ total: 1, limit: 200, items: rows })

		expect(prisma.domainEventOutbox.count).toHaveBeenCalledWith({
			where: {
				status: DomainEventOutboxStatus.FAILED,
				catalogId: '11111111-1111-1111-1111-111111111111',
				eventType: 'variant.stock_changed'
			}
		})
		expect(prisma.domainEventOutbox.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				take: 200,
				orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }]
			})
		)
	})

	it('returns status counters with empty defaults', async () => {
		const pendingAt = new Date('2026-05-17T00:00:00.000Z')
		const failedAt = new Date('2026-05-17T01:00:00.000Z')
		prisma.domainEventOutbox.count
			.mockResolvedValueOnce(4)
			.mockResolvedValueOnce(1)
		prisma.domainEventOutbox.groupBy.mockResolvedValue([
			{
				status: DomainEventOutboxStatus.PENDING,
				_count: { _all: 3 }
			}
		])
		prisma.domainEventOutbox.findFirst
			.mockResolvedValueOnce({ occurredAt: pendingAt })
			.mockResolvedValueOnce({ occurredAt: failedAt })
		outbox.countProcessedBefore.mockResolvedValue(11)
		outbox.countFailedBefore
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce(2)
			.mockResolvedValueOnce(3)

		await expect(service.stats()).resolves.toEqual({
			total: 4,
			byStatus: {
				PENDING: 3,
				PROCESSING: 0,
				PROCESSED: 0,
				FAILED: 0
			},
			oldestPendingAt: pendingAt,
			newestFailedAt: failedAt,
			failedWithLastError: 1,
			processedRetentionDays: expect.any(Number),
			processedRetentionCutoff: expect.any(Date),
			processedOlderThanRetention: 11,
			failedOlderThan1Day: 1,
			failedOlderThan7Days: 2,
			failedOlderThan30Days: 3
		})
		expect(outbox.countProcessedBefore).toHaveBeenCalledWith(expect.any(Date))
	})

	it('retries one non-processed row by id', async () => {
		prisma.domainEventOutbox.findUnique.mockResolvedValue({
			id: '11111111-1111-1111-1111-111111111111',
			status: DomainEventOutboxStatus.FAILED
		})

		await expect(
			service.retryOne('11111111-1111-1111-1111-111111111111')
		).resolves.toEqual({
			matched: 1,
			processed: 1,
			failed: 0,
			skipped: 0
		})
		expect(dispatcher.retryByIds).toHaveBeenCalledWith([
			'11111111-1111-1111-1111-111111111111'
		])
	})

	it('rejects retry for processed or missing rows', async () => {
		prisma.domainEventOutbox.findUnique.mockResolvedValueOnce(null)
		await expect(
			service.retryOne('11111111-1111-1111-1111-111111111111')
		).rejects.toBeInstanceOf(NotFoundException)

		prisma.domainEventOutbox.findUnique.mockResolvedValueOnce({
			id: '11111111-1111-1111-1111-111111111111',
			status: DomainEventOutboxStatus.PROCESSED
		})
		await expect(
			service.retryOne('11111111-1111-1111-1111-111111111111')
		).rejects.toBeInstanceOf(BadRequestException)
	})

	it('retries failed rows by optional filters', async () => {
		prisma.domainEventOutbox.findMany.mockResolvedValue([
			{ id: '11111111-1111-1111-1111-111111111111' },
			{ id: '22222222-2222-2222-2222-222222222222' }
		])

		await expect(
			service.retryFailed({
				catalogId: '33333333-3333-3333-3333-333333333333',
				eventType: 'variant.stock_changed',
				limit: 2
			})
		).resolves.toEqual({
			matched: 2,
			processed: 1,
			failed: 0,
			skipped: 0
		})
		expect(dispatcher.retryByIds).toHaveBeenCalledWith([
			'11111111-1111-1111-1111-111111111111',
			'22222222-2222-2222-2222-222222222222'
		])
	})

	it('delegates manual drain to dispatcher', async () => {
		await expect(service.drainPending({ limit: 5 })).resolves.toEqual({
			processed: 2,
			failed: 0,
			skipped: 1
		})
		expect(dispatcher.drainPending).toHaveBeenCalledWith({ limit: 5 })
	})

	it('cleans processed rows older than retention in bounded batches', async () => {
		const now = new Date('2026-05-17T00:00:00.000Z')
		outbox.deleteProcessedBefore.mockResolvedValue(7)

		await expect(
			service.cleanupProcessed({
				retentionDays: 10,
				limit: 100,
				now
			})
		).resolves.toEqual({
			deleted: 7,
			retentionDays: 10,
			cutoff: new Date('2026-05-07T00:00:00.000Z'),
			limit: 100
		})
		expect(outbox.deleteProcessedBefore).toHaveBeenCalledWith({
			cutoff: new Date('2026-05-07T00:00:00.000Z'),
			limit: 100
		})
	})
})

import type { Prisma } from '@generated/client'
import { DomainEventOutboxStatus } from '@generated/enums'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import {
	resolveDomainEventAggregate,
	serializeDomainEvent
} from './domain-event-outbox.utils'
import type {
	DomainEvent,
	DomainEventOutboxWriter
} from './domain-events.contract'

const domainEventOutboxSelect = {
	id: true,
	eventId: true,
	eventType: true,
	payload: true,
	status: true,
	attempts: true
} as const satisfies Prisma.DomainEventOutboxSelect

export type DomainEventOutboxRecord = Prisma.DomainEventOutboxGetPayload<{
	select: typeof domainEventOutboxSelect
}>

type DomainEventOutboxWriteClient = Pick<
	Prisma.TransactionClient,
	'domainEventOutbox'
>

@Injectable()
export class DomainEventOutboxRepository implements DomainEventOutboxWriter {
	constructor(private readonly prisma: PrismaService) {}

	append(events: DomainEvent[]): Promise<void> {
		return this.appendWithClient(this.prisma, events)
	}

	appendTx(tx: unknown, events: DomainEvent[]): Promise<void> {
		return this.appendWithClient(tx as DomainEventOutboxWriteClient, events)
	}

	findDispatchableByEventIds(
		eventIds: string[]
	): Promise<DomainEventOutboxRecord[]> {
		if (!eventIds.length) return Promise.resolve<DomainEventOutboxRecord[]>([])

		return this.prisma.domainEventOutbox.findMany({
			where: {
				eventId: { in: [...new Set(eventIds)] },
				status: {
					in: [DomainEventOutboxStatus.PENDING, DomainEventOutboxStatus.FAILED]
				}
			},
			orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
			select: domainEventOutboxSelect
		})
	}

	findProcessableByIds(ids: string[]): Promise<DomainEventOutboxRecord[]> {
		if (!ids.length) return Promise.resolve<DomainEventOutboxRecord[]>([])

		return this.prisma.domainEventOutbox.findMany({
			where: {
				id: { in: [...new Set(ids)] },
				status: {
					in: [
						DomainEventOutboxStatus.PENDING,
						DomainEventOutboxStatus.PROCESSING,
						DomainEventOutboxStatus.FAILED
					]
				}
			},
			orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
			select: domainEventOutboxSelect
		})
	}

	findDueForProcessing(params: {
		limit: number
		maxAttempts: number
		staleProcessingBefore: Date
	}): Promise<DomainEventOutboxRecord[]> {
		return this.prisma.domainEventOutbox.findMany({
			where: {
				attempts: { lt: params.maxAttempts },
				OR: [
					{ status: DomainEventOutboxStatus.PENDING },
					{ status: DomainEventOutboxStatus.FAILED },
					{
						status: DomainEventOutboxStatus.PROCESSING,
						lockedAt: { lt: params.staleProcessingBefore }
					}
				]
			},
			orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
			take: params.limit,
			select: domainEventOutboxSelect
		})
	}

	async markProcessing(
		id: string,
		staleProcessingBefore: Date
	): Promise<boolean> {
		const result = await this.prisma.domainEventOutbox.updateMany({
			where: {
				id,
				OR: [
					{ status: DomainEventOutboxStatus.PENDING },
					{ status: DomainEventOutboxStatus.FAILED },
					{
						status: DomainEventOutboxStatus.PROCESSING,
						lockedAt: { lt: staleProcessingBefore }
					}
				]
			},
			data: {
				status: DomainEventOutboxStatus.PROCESSING,
				attempts: { increment: 1 },
				lockedAt: new Date(),
				lastError: null
			}
		})

		return result.count === 1
	}

	async markProcessed(id: string): Promise<void> {
		await this.prisma.domainEventOutbox.update({
			where: { id },
			data: {
				status: DomainEventOutboxStatus.PROCESSED,
				processedAt: new Date(),
				lockedAt: null,
				lastError: null
			}
		})
	}

	async markFailed(id: string, error: string): Promise<void> {
		await this.prisma.domainEventOutbox.update({
			where: { id },
			data: {
				status: DomainEventOutboxStatus.FAILED,
				lastError: error,
				lockedAt: null
			}
		})
	}

	countProcessedBefore(cutoff: Date): Promise<number> {
		return this.prisma.domainEventOutbox.count({
			where: {
				status: DomainEventOutboxStatus.PROCESSED,
				processedAt: { lt: cutoff }
			}
		})
	}

	countFailedBefore(cutoff: Date): Promise<number> {
		return this.prisma.domainEventOutbox.count({
			where: {
				status: DomainEventOutboxStatus.FAILED,
				occurredAt: { lt: cutoff }
			}
		})
	}

	async deleteProcessedBefore(params: {
		cutoff: Date
		limit: number
	}): Promise<number> {
		const rows = await this.prisma.domainEventOutbox.findMany({
			where: {
				status: DomainEventOutboxStatus.PROCESSED,
				processedAt: { lt: params.cutoff }
			},
			select: { id: true },
			orderBy: [{ processedAt: 'asc' }, { createdAt: 'asc' }],
			take: params.limit
		})
		if (!rows.length) return 0

		const result = await this.prisma.domainEventOutbox.deleteMany({
			where: { id: { in: rows.map(row => row.id) } }
		})

		return result.count
	}

	private async appendWithClient(
		client: DomainEventOutboxWriteClient,
		events: DomainEvent[]
	): Promise<void> {
		if (!events.length) return

		await client.domainEventOutbox.createMany({
			data: events.map(event => {
				const aggregate = resolveDomainEventAggregate(event)
				return {
					eventId: event.eventId,
					eventType: event.type,
					aggregateType: aggregate.aggregateType,
					aggregateId: aggregate.aggregateId,
					catalogId: event.catalogId,
					payload: serializeDomainEvent(event),
					occurredAt: event.occurredAt
				}
			}),
			skipDuplicates: true
		})
	}
}

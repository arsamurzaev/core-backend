import type { Prisma } from '@generated/client'
import { DomainEventOutboxStatus } from '@generated/enums'
import {
	BadRequestException,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import {
	DomainEventOutboxDispatcher,
	type DomainEventOutboxDrainResult
} from './domain-event-outbox.dispatcher'
import { DomainEventOutboxRepository } from './domain-event-outbox.repository'

const DEFAULT_LIST_LIMIT = 50
const DEFAULT_RETRY_LIMIT = 50
export const DEFAULT_PROCESSED_RETENTION_DAYS = 30
export const DEFAULT_CLEANUP_LIMIT = 5000
const MAX_LIST_LIMIT = 200
const MAX_RETRY_LIMIT = 500
const MAX_CLEANUP_LIMIT = 50_000
const MS_PER_DAY = 24 * 60 * 60 * 1000

const domainEventOutboxDiagnosticsSelect = {
	id: true,
	eventId: true,
	eventType: true,
	aggregateType: true,
	aggregateId: true,
	catalogId: true,
	status: true,
	attempts: true,
	lastError: true,
	lockedAt: true,
	occurredAt: true,
	processedAt: true,
	createdAt: true,
	updatedAt: true,
	payload: true,
	catalog: {
		select: {
			slug: true,
			name: true
		}
	}
} satisfies Prisma.DomainEventOutboxSelect

export type DomainEventOutboxDiagnosticsItem =
	Prisma.DomainEventOutboxGetPayload<{
		select: typeof domainEventOutboxDiagnosticsSelect
	}>

export type DomainEventOutboxListQuery = {
	status?: DomainEventOutboxStatus
	catalogId?: string
	eventType?: string
	aggregateType?: string
	aggregateId?: string
	limit?: number
}

export type DomainEventOutboxRetryFailedParams = {
	catalogId?: string
	eventType?: string
	limit?: number
}

export type DomainEventOutboxDrainParams = {
	limit?: number
	maxAttempts?: number
	staleProcessingMs?: number
}

export type DomainEventOutboxCleanupParams = {
	retentionDays?: number
	limit?: number
	now?: Date
}

export type DomainEventOutboxListResult = {
	items: DomainEventOutboxDiagnosticsItem[]
	total: number
	limit: number
}

export type DomainEventOutboxStatsResult = {
	total: number
	byStatus: Record<DomainEventOutboxStatus, number>
	oldestPendingAt: Date | null
	newestFailedAt: Date | null
	failedWithLastError: number
	processedRetentionDays: number
	processedRetentionCutoff: Date
	processedOlderThanRetention: number
	failedOlderThan1Day: number
	failedOlderThan7Days: number
	failedOlderThan30Days: number
}

export type DomainEventOutboxRetryResult = DomainEventOutboxDrainResult & {
	matched: number
}

export type DomainEventOutboxCleanupResult = {
	deleted: number
	retentionDays: number
	cutoff: Date
	limit: number
}

@Injectable()
export class DomainEventOutboxDiagnosticsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly dispatcher: DomainEventOutboxDispatcher,
		private readonly outbox: DomainEventOutboxRepository
	) {}

	async list(
		query: DomainEventOutboxListQuery = {}
	): Promise<DomainEventOutboxListResult> {
		const limit = normalizeLimit(query.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT)
		const where = buildOutboxWhere(query)
		const [total, items] = await Promise.all([
			this.prisma.domainEventOutbox.count({ where }),
			this.prisma.domainEventOutbox.findMany({
				where,
				select: domainEventOutboxDiagnosticsSelect,
				orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
				take: limit
			})
		])

		return { total, limit, items }
	}

	async stats(): Promise<DomainEventOutboxStatsResult> {
		const now = new Date()
		const processedRetentionDays = normalizeRetentionDays(
			Number(process.env.DOMAIN_EVENT_OUTBOX_PROCESSED_RETENTION_DAYS),
			DEFAULT_PROCESSED_RETENTION_DAYS
		)
		const processedRetentionCutoff = buildRetentionCutoff(
			processedRetentionDays,
			now
		)
		const [
			total,
			grouped,
			oldestPending,
			newestFailed,
			failedWithLastError,
			processedOlderThanRetention,
			failedOlderThan1Day,
			failedOlderThan7Days,
			failedOlderThan30Days
		] = await Promise.all([
			this.prisma.domainEventOutbox.count(),
			this.prisma.domainEventOutbox.groupBy({
				by: ['status'],
				_count: { _all: true }
			}),
			this.prisma.domainEventOutbox.findFirst({
				where: { status: DomainEventOutboxStatus.PENDING },
				orderBy: { occurredAt: 'asc' },
				select: { occurredAt: true }
			}),
			this.prisma.domainEventOutbox.findFirst({
				where: { status: DomainEventOutboxStatus.FAILED },
				orderBy: { occurredAt: 'desc' },
				select: { occurredAt: true }
			}),
			this.prisma.domainEventOutbox.count({
				where: {
					status: DomainEventOutboxStatus.FAILED,
					lastError: { not: null }
				}
			}),
			this.outbox.countProcessedBefore(processedRetentionCutoff),
			this.outbox.countFailedBefore(buildRetentionCutoff(1, now)),
			this.outbox.countFailedBefore(buildRetentionCutoff(7, now)),
			this.outbox.countFailedBefore(buildRetentionCutoff(30, now))
		])
		const byStatus = createEmptyStatusCounts()
		for (const item of grouped) {
			byStatus[item.status] = item._count._all
		}

		return {
			total,
			byStatus,
			oldestPendingAt: oldestPending?.occurredAt ?? null,
			newestFailedAt: newestFailed?.occurredAt ?? null,
			failedWithLastError,
			processedRetentionDays,
			processedRetentionCutoff,
			processedOlderThanRetention,
			failedOlderThan1Day,
			failedOlderThan7Days,
			failedOlderThan30Days
		}
	}

	async retryOne(id: string): Promise<DomainEventOutboxRetryResult> {
		const row = await this.prisma.domainEventOutbox.findUnique({
			where: { id },
			select: { id: true, status: true }
		})
		if (!row) throw new NotFoundException('Domain event outbox row not found')
		if (row.status === DomainEventOutboxStatus.PROCESSED) {
			throw new BadRequestException('Processed domain event cannot be retried')
		}

		const result = await this.dispatcher.retryByIds([id])
		return { matched: 1, ...result }
	}

	async retryFailed(
		params: DomainEventOutboxRetryFailedParams = {}
	): Promise<DomainEventOutboxRetryResult> {
		const limit = normalizeLimit(
			params.limit,
			DEFAULT_RETRY_LIMIT,
			MAX_RETRY_LIMIT
		)
		const rows = await this.prisma.domainEventOutbox.findMany({
			where: {
				status: DomainEventOutboxStatus.FAILED,
				...(params.catalogId ? { catalogId: params.catalogId } : {}),
				...(params.eventType ? { eventType: params.eventType } : {})
			},
			select: { id: true },
			orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
			take: limit
		})

		const result = await this.dispatcher.retryByIds(rows.map(row => row.id))
		return { matched: rows.length, ...result }
	}

	async drainPending(
		params: DomainEventOutboxDrainParams = {}
	): Promise<DomainEventOutboxDrainResult> {
		return this.dispatcher.drainPending(params)
	}

	async cleanupProcessed(
		params: DomainEventOutboxCleanupParams = {}
	): Promise<DomainEventOutboxCleanupResult> {
		const retentionDays = normalizeRetentionDays(
			params.retentionDays ??
				Number(process.env.DOMAIN_EVENT_OUTBOX_PROCESSED_RETENTION_DAYS),
			DEFAULT_PROCESSED_RETENTION_DAYS
		)
		const limit = normalizeLimit(
			params.limit ?? Number(process.env.DOMAIN_EVENT_OUTBOX_CLEANUP_LIMIT),
			DEFAULT_CLEANUP_LIMIT,
			MAX_CLEANUP_LIMIT
		)
		const cutoff = buildRetentionCutoff(retentionDays, params.now)
		const deleted = await this.outbox.deleteProcessedBefore({ cutoff, limit })

		return {
			deleted,
			retentionDays,
			cutoff,
			limit
		}
	}
}

function buildOutboxWhere(
	query: DomainEventOutboxListQuery
): Prisma.DomainEventOutboxWhereInput {
	return {
		...(query.status ? { status: query.status } : {}),
		...(query.catalogId ? { catalogId: query.catalogId } : {}),
		...(query.eventType ? { eventType: query.eventType } : {}),
		...(query.aggregateType ? { aggregateType: query.aggregateType } : {}),
		...(query.aggregateId ? { aggregateId: query.aggregateId } : {})
	}
}

function createEmptyStatusCounts(): Record<DomainEventOutboxStatus, number> {
	return {
		[DomainEventOutboxStatus.PENDING]: 0,
		[DomainEventOutboxStatus.PROCESSING]: 0,
		[DomainEventOutboxStatus.PROCESSED]: 0,
		[DomainEventOutboxStatus.FAILED]: 0
	}
}

function normalizeLimit(
	value: number | undefined,
	fallback: number,
	max: number
): number {
	if (!Number.isInteger(value) || !value || value < 1) return fallback
	return Math.min(value, max)
}

function normalizeRetentionDays(
	value: number | undefined,
	fallback: number
): number {
	if (!Number.isInteger(value) || !value || value < 1) return fallback
	return value
}

function buildRetentionCutoff(days: number, now = new Date()): Date {
	return new Date(now.getTime() - days * MS_PER_DAY)
}

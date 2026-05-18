import { Inject, Injectable, Logger } from '@nestjs/common'

import {
	DOMAIN_EVENT_BUS,
	type DomainEvent,
	type DomainEventBus,
	type DomainEventDispatcher
} from './domain-events.contract'
import {
	DomainEventOutboxRecord,
	DomainEventOutboxRepository
} from './domain-event-outbox.repository'
import {
	deserializeDomainEvent,
	formatDomainEventError
} from './domain-event-outbox.utils'

const DEFAULT_DRAIN_LIMIT = 100
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_PROCESSING_STALE_MS = 5 * 60 * 1000

export type DomainEventOutboxDrainResult = {
	processed: number
	failed: number
	skipped: number
}

@Injectable()
export class DomainEventOutboxDispatcher implements DomainEventDispatcher {
	private readonly logger = new Logger(DomainEventOutboxDispatcher.name)

	constructor(
		private readonly outbox: DomainEventOutboxRepository,
		@Inject(DOMAIN_EVENT_BUS)
		private readonly bus: DomainEventBus
	) {}

	async dispatch(event: DomainEvent): Promise<void> {
		await this.dispatchMany([event])
	}

	async dispatchMany(events: DomainEvent[]): Promise<void> {
		if (!events.length) return

		await this.outbox.append(events)
		const rows = await this.outbox.findDispatchableByEventIds(
			events.map(event => event.eventId)
		)
		await this.processRows(rows, { throwOnError: true })
	}

	async drainPending(params: {
		limit?: number
		maxAttempts?: number
		staleProcessingMs?: number
	} = {}): Promise<DomainEventOutboxDrainResult> {
		const staleProcessingMs =
			params.staleProcessingMs ?? DEFAULT_PROCESSING_STALE_MS
		const rows = await this.outbox.findDueForProcessing({
			limit: normalizePositiveInt(params.limit, DEFAULT_DRAIN_LIMIT),
			maxAttempts: normalizePositiveInt(
				params.maxAttempts,
				DEFAULT_MAX_ATTEMPTS
			),
			staleProcessingBefore: new Date(Date.now() - staleProcessingMs)
		})

		return this.processRows(rows, { throwOnError: false, staleProcessingMs })
	}

	async retryByIds(
		ids: string[],
		params: { staleProcessingMs?: number } = {}
	): Promise<DomainEventOutboxDrainResult> {
		const rows = await this.outbox.findProcessableByIds(ids)
		return this.processRows(rows, {
			throwOnError: false,
			staleProcessingMs: params.staleProcessingMs
		})
	}

	private async processRows(
		rows: DomainEventOutboxRecord[],
		options: { throwOnError: boolean; staleProcessingMs?: number }
	): Promise<DomainEventOutboxDrainResult> {
		const result: DomainEventOutboxDrainResult = {
			processed: 0,
			failed: 0,
			skipped: 0
		}
		const staleProcessingBefore = new Date(
			Date.now() -
				(options.staleProcessingMs ?? DEFAULT_PROCESSING_STALE_MS)
		)

		for (const row of rows) {
			const claimed = await this.outbox.markProcessing(
				row.id,
				staleProcessingBefore
			)
			if (!claimed) {
				result.skipped += 1
				continue
			}

			try {
				await this.bus.dispatch(deserializeDomainEvent(row.payload))
				await this.outbox.markProcessed(row.id)
				result.processed += 1
			} catch (error) {
				const message = formatDomainEventError(error)
				await this.outbox.markFailed(row.id, message)
				result.failed += 1
				this.logger.error(
					`Domain event outbox dispatch failed: eventType=${row.eventType}, eventId=${row.eventId}`,
					error instanceof Error ? error.stack : String(error)
				)

				if (options.throwOnError) throw error
			}
		}

		return result
	}
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
	return Number.isInteger(value) && value && value > 0 ? value : fallback
}

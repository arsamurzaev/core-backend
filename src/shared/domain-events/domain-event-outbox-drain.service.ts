import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'

import { DomainEventOutboxDispatcher } from './domain-event-outbox.dispatcher'

const OUTBOX_DRAIN_CRON =
	process.env.DOMAIN_EVENT_OUTBOX_DRAIN_CRON ?? '*/30 * * * * *'
const OUTBOX_DRAIN_TIMEZONE =
	process.env.DOMAIN_EVENT_OUTBOX_DRAIN_TIMEZONE ?? 'Europe/Moscow'
const OUTBOX_DRAIN_LIMIT = Number(process.env.DOMAIN_EVENT_OUTBOX_DRAIN_LIMIT)
const OUTBOX_MAX_ATTEMPTS = Number(process.env.DOMAIN_EVENT_OUTBOX_MAX_ATTEMPTS)
const OUTBOX_PROCESSING_STALE_MS = Number(
	process.env.DOMAIN_EVENT_OUTBOX_PROCESSING_STALE_MS
)
const OUTBOX_DRAIN_JOB_NAME = 'domain-event-outbox-drain'

@Injectable()
export class DomainEventOutboxDrainService {
	private readonly logger = new Logger(DomainEventOutboxDrainService.name)

	constructor(private readonly dispatcher: DomainEventOutboxDispatcher) {}

	@Cron(OUTBOX_DRAIN_CRON, {
		name: OUTBOX_DRAIN_JOB_NAME,
		timeZone: OUTBOX_DRAIN_TIMEZONE
	})
	async drainPending(): Promise<void> {
		const result = await this.dispatcher.drainPending({
			limit: positiveOrUndefined(OUTBOX_DRAIN_LIMIT),
			maxAttempts: positiveOrUndefined(OUTBOX_MAX_ATTEMPTS),
			staleProcessingMs: positiveOrUndefined(OUTBOX_PROCESSING_STALE_MS)
		})

		if (!result.processed && !result.failed && !result.skipped) return

		this.logger.log(
			`Domain event outbox drain finished: processed=${result.processed}, failed=${result.failed}, skipped=${result.skipped}`
		)
	}
}

function positiveOrUndefined(value: number): number | undefined {
	return Number.isFinite(value) && value > 0 ? value : undefined
}

import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'

import {
	DEFAULT_CLEANUP_LIMIT,
	DEFAULT_PROCESSED_RETENTION_DAYS,
	DomainEventOutboxDiagnosticsService
} from './domain-event-outbox-diagnostics.service'

const OUTBOX_CLEANUP_CRON =
	process.env.DOMAIN_EVENT_OUTBOX_CLEANUP_CRON ?? '0 4 * * *'
const OUTBOX_CLEANUP_TIMEZONE =
	process.env.DOMAIN_EVENT_OUTBOX_CLEANUP_TIMEZONE ?? 'Europe/Moscow'
const OUTBOX_CLEANUP_RETENTION_DAYS = Number(
	process.env.DOMAIN_EVENT_OUTBOX_PROCESSED_RETENTION_DAYS
)
const OUTBOX_CLEANUP_LIMIT = Number(
	process.env.DOMAIN_EVENT_OUTBOX_CLEANUP_LIMIT
)
const OUTBOX_CLEANUP_JOB_NAME = 'domain-event-outbox-cleanup'

@Injectable()
export class DomainEventOutboxCleanupService {
	private readonly logger = new Logger(DomainEventOutboxCleanupService.name)

	constructor(private readonly diagnostics: DomainEventOutboxDiagnosticsService) {}

	@Cron(OUTBOX_CLEANUP_CRON, {
		name: OUTBOX_CLEANUP_JOB_NAME,
		timeZone: OUTBOX_CLEANUP_TIMEZONE
	})
	async cleanupProcessed(): Promise<void> {
		const result = await this.diagnostics.cleanupProcessed({
			retentionDays:
				positiveOrUndefined(OUTBOX_CLEANUP_RETENTION_DAYS) ??
				DEFAULT_PROCESSED_RETENTION_DAYS,
			limit: positiveOrUndefined(OUTBOX_CLEANUP_LIMIT) ?? DEFAULT_CLEANUP_LIMIT
		})

		if (!result.deleted) return

		this.logger.log(
			`Domain event outbox cleanup finished: deleted=${result.deleted}, retentionDays=${result.retentionDays}, cutoff=${result.cutoff.toISOString()}, limit=${result.limit}`
		)
	}
}

function positiveOrUndefined(value: number): number | undefined {
	return Number.isFinite(value) && value > 0 ? value : undefined
}

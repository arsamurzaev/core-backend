import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { SpanStatusCode, trace } from '@opentelemetry/api'

import {
	INVENTORY_RESERVATION_PORT,
	type InventoryReservationPort
} from '@/modules/inventory/contracts'
import {
	OBSERVABILITY_RECORDER_PORT,
	type ObservabilityRecorderPort
} from '@/modules/observability/contracts'

const INVENTORY_RESERVATION_EXPIRY_CRON =
	process.env.INVENTORY_RESERVATION_EXPIRY_CRON ?? '*/5 * * * *'
const INVENTORY_RESERVATION_EXPIRY_TIMEZONE =
	process.env.INVENTORY_RESERVATION_EXPIRY_TIMEZONE ?? 'Europe/Moscow'
const INVENTORY_RESERVATION_EXPIRY_JOB_NAME = 'inventory-reservation-expiry'

@Injectable()
export class InventoryReservationCronService {
	private readonly logger = new Logger(InventoryReservationCronService.name)
	private readonly tracer = trace.getTracer('catalog_backend.cron')

	constructor(
		@Inject(INVENTORY_RESERVATION_PORT)
		private readonly inventory: InventoryReservationPort,
		@Inject(OBSERVABILITY_RECORDER_PORT)
		private readonly observability: ObservabilityRecorderPort
	) {}

	@Cron(INVENTORY_RESERVATION_EXPIRY_CRON, {
		name: INVENTORY_RESERVATION_EXPIRY_JOB_NAME,
		timeZone: INVENTORY_RESERVATION_EXPIRY_TIMEZONE
	})
	async releaseExpiredReservations(): Promise<void> {
		return this.tracer.startActiveSpan(
			'cron.inventory_reservation_expiry',
			async span => {
				const startedAt = process.hrtime.bigint()

				try {
					const result = await this.inventory.releaseExpiredReservations()
					const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000

					span.setAttributes({
						'cron.name': INVENTORY_RESERVATION_EXPIRY_JOB_NAME,
						'catalog.inventory.reservations.released': result.releasedReservations,
						'catalog.inventory.variants.affected': result.affectedVariants
					})
					span.setStatus({ code: SpanStatusCode.OK })
					this.observability.recordCronRun(
						INVENTORY_RESERVATION_EXPIRY_JOB_NAME,
						'success',
						durationMs
					)
					this.logger.log(
						`Inventory reservation expiry cron finished: releasedReservations=${result.releasedReservations}, affectedVariants=${result.affectedVariants}`
					)
				} catch (error) {
					const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
					const message = error instanceof Error ? error.message : String(error)

					span.recordException(error instanceof Error ? error : new Error(message))
					span.setStatus({ code: SpanStatusCode.ERROR, message })
					this.observability.recordCronRun(
						INVENTORY_RESERVATION_EXPIRY_JOB_NAME,
						'error',
						durationMs
					)
					this.logger.error(
						`Inventory reservation expiry cron failed: ${message}`,
						error instanceof Error ? error.stack : undefined
					)
				} finally {
					span.end()
				}
			}
		)
	}
}

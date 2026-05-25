import { IntegrationProvider } from '@generated/enums'
import { Injectable, Logger } from '@nestjs/common'

import type {
	OrderExportPort,
	OrderExportQueueResult,
	OrderExportWaitResult
} from './contracts'
import { IikoOrderExportQueueService } from './providers/iiko/iiko.order-export.queue.service'
import { MoySkladOrderExportQueueService } from './providers/moysklad/moysklad.order-export.queue.service'

@Injectable()
export class IntegrationOrderExportDispatcherService implements OrderExportPort {
	private readonly logger = new Logger(
		IntegrationOrderExportDispatcherService.name
	)

	constructor(
		private readonly moySklad: MoySkladOrderExportQueueService,
		private readonly iiko: IikoOrderExportQueueService
	) {}

	async enqueueCompletedOrder(
		catalogId: string,
		orderId: string
	): Promise<OrderExportQueueResult> {
		const settled = await Promise.allSettled([
			this.moySklad.enqueueCompletedOrder(catalogId, orderId),
			this.iiko.enqueueCompletedOrder(catalogId, orderId)
		])

		for (const result of settled) {
			if (result.status === 'rejected') {
				const message =
					result.reason instanceof Error
						? (result.reason.stack ?? result.reason.message)
						: String(result.reason)
				this.logger.warn(
					`Completed order ${orderId} export provider failed to enqueue: ${message}`
				)
			}
		}

		const fulfilled = settled.flatMap(result =>
			result.status === 'fulfilled' ? [result.value] : []
		)
		const queued = fulfilled.find(result => result.queued)
		if (queued) return queued

		return {
			ok: true,
			queued: false,
			reason: fulfilled
				.map(result => result.reason)
				.filter(Boolean)
				.join(',')
		}
	}

	async waitForCompletedOrderExport(
		catalogId: string,
		orderId: string,
		params: {
			provider?: IntegrationProvider
			timeoutMs?: number
			intervalMs?: number
		} = {}
	): Promise<OrderExportWaitResult> {
		if (params.provider && params.provider !== IntegrationProvider.IIKO) {
			return {
				ok: false,
				status: 'NOT_QUEUED',
				reason: 'provider_wait_not_supported'
			}
		}

		return this.iiko.waitForCompletedOrderExport(catalogId, orderId, params)
	}
}

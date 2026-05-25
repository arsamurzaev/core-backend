import { IntegrationProvider } from '@generated/enums'
import { Inject, Injectable, Logger } from '@nestjs/common'

import {
	ORDER_EXPORT_PORT,
	type OrderExportPort,
	type OrderExportQueueResult,
	type OrderExportWaitResult
} from '@/modules/integration/contracts'

const ORDER_EXPORT_ENQUEUE_FAILED_RESULT: OrderExportQueueResult = {
	ok: true,
	queued: false,
	reason: 'enqueue_failed'
}

@Injectable()
export class CartOrderExportService {
	private readonly logger = new Logger(CartOrderExportService.name)

	constructor(
		@Inject(ORDER_EXPORT_PORT)
		private readonly orderExport: OrderExportPort
	) {}

	async enqueueCompletedOrderSafely(
		catalogId: string,
		orderId: string
	): Promise<OrderExportQueueResult> {
		try {
			return await this.orderExport.enqueueCompletedOrder(catalogId, orderId)
		} catch (error) {
			const message =
				error instanceof Error ? (error.stack ?? error.message) : String(error)
			this.logger.warn(
				`Completed order ${orderId} was saved, but order export was not queued: ${message}`
			)
			return ORDER_EXPORT_ENQUEUE_FAILED_RESULT
		}
	}

	async waitForIikoCompletedOrder(
		catalogId: string,
		orderId: string,
		params: { timeoutMs?: number; intervalMs?: number } = {}
	): Promise<OrderExportWaitResult> {
		if (!this.orderExport.waitForCompletedOrderExport) {
			return {
				ok: false,
				status: 'NOT_QUEUED',
				reason: 'order_export_wait_not_supported'
			}
		}

		return this.orderExport.waitForCompletedOrderExport(catalogId, orderId, {
			...params,
			provider: IntegrationProvider.IIKO
		})
	}
}

import { Inject, Injectable, Logger } from '@nestjs/common'

import {
	ORDER_EXPORT_PORT,
	type OrderExportPort
} from '@/modules/integration/contracts'

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
	): Promise<void> {
		try {
			await this.orderExport.enqueueCompletedOrder(catalogId, orderId)
		} catch (error) {
			const message =
				error instanceof Error ? (error.stack ?? error.message) : String(error)
			this.logger.warn(
				`Completed order ${orderId} was saved, but order export was not queued: ${message}`
			)
		}
	}
}

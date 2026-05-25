import { Test, TestingModule } from '@nestjs/testing'

import { IntegrationOrderExportDispatcherService } from './integration-order-export-dispatcher.service'
import { IikoOrderExportQueueService } from './providers/iiko/iiko.order-export.queue.service'
import { MoySkladOrderExportQueueService } from './providers/moysklad/moysklad.order-export.queue.service'

describe('IntegrationOrderExportDispatcherService', () => {
	let service: IntegrationOrderExportDispatcherService
	let moySklad: jest.Mocked<MoySkladOrderExportQueueService>
	let iiko: jest.Mocked<IikoOrderExportQueueService>

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				IntegrationOrderExportDispatcherService,
				{
					provide: MoySkladOrderExportQueueService,
					useValue: {
						enqueueCompletedOrder: jest.fn()
					}
				},
				{
					provide: IikoOrderExportQueueService,
					useValue: {
						enqueueCompletedOrder: jest.fn()
					}
				}
			]
		}).compile()

		service = module.get(IntegrationOrderExportDispatcherService)
		moySklad = module.get(MoySkladOrderExportQueueService)
		iiko = module.get(IikoOrderExportQueueService)
	})

	it('enqueues completed admin orders for all configured providers', async () => {
		moySklad.enqueueCompletedOrder.mockResolvedValue({
			ok: true,
			queued: false,
			reason: 'order_export_disabled'
		})
		iiko.enqueueCompletedOrder.mockResolvedValue({
			ok: true,
			queued: true,
			exportId: 'iiko-export-1',
			jobId: 'iiko-job-1'
		})

		const result = await service.enqueueCompletedOrder('catalog-1', 'order-1')

		expect(moySklad.enqueueCompletedOrder).toHaveBeenCalledWith(
			'catalog-1',
			'order-1'
		)
		expect(iiko.enqueueCompletedOrder).toHaveBeenCalledWith(
			'catalog-1',
			'order-1'
		)
		expect(result).toEqual({
			ok: true,
			queued: true,
			exportId: 'iiko-export-1',
			jobId: 'iiko-job-1'
		})
	})

	it('keeps other providers running when one enqueue fails', async () => {
		moySklad.enqueueCompletedOrder.mockRejectedValue(new Error('redis down'))
		iiko.enqueueCompletedOrder.mockResolvedValue({
			ok: true,
			queued: true,
			exportId: 'iiko-export-1'
		})

		await expect(
			service.enqueueCompletedOrder('catalog-1', 'order-1')
		).resolves.toEqual({
			ok: true,
			queued: true,
			exportId: 'iiko-export-1'
		})
	})
})

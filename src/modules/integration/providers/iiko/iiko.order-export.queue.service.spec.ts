import { IntegrationProvider, IntegrationSyncStatus } from '@generated/enums'
import { ConfigService } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'
import { Queue, Worker } from 'bullmq'

import { CapabilityService } from '@/modules/capability/capability.service'
import { CAPABILITY_READER_PORT } from '@/modules/capability/contracts'
import { OBSERVABILITY_RECORDER_PORT } from '@/modules/observability/contracts'
import { ObservabilityService } from '@/modules/observability/observability.service'

import { IntegrationRepository } from '../../integration.repository'

import { IikoMetadataCryptoService } from './iiko.metadata'
import { IikoOrderExportQueueService } from './iiko.order-export.queue.service'
import { IikoOrderExportService } from './iiko.order-export.service'

jest.mock('bullmq', () => ({
	Queue: jest.fn().mockImplementation(() => ({
		add: jest.fn(),
		close: jest.fn()
	})),
	Worker: jest.fn().mockImplementation(() => ({
		on: jest.fn(),
		close: jest.fn()
	})),
	Job: class {}
}))

describe('IikoOrderExportQueueService', () => {
	let service: IikoOrderExportQueueService
	let repo: jest.Mocked<IntegrationRepository>
	let metadataCrypto: jest.Mocked<IikoMetadataCryptoService>
	let observability: jest.Mocked<ObservabilityService>

	const queueMock = () =>
		(Queue as unknown as jest.Mock).mock.results[0]?.value as {
			add: jest.Mock
			close: jest.Mock
		}

	const integrationRecord = {
		id: 'integration-1',
		catalogId: 'catalog-1',
		provider: IntegrationProvider.IIKO,
		metadata: {},
		isActive: true,
		syncStartedAt: null,
		lastSyncAt: null,
		lastSyncStatus: IntegrationSyncStatus.IDLE,
		lastSyncError: null,
		totalProducts: 0,
		createdProducts: 0,
		updatedProducts: 0,
		deletedProducts: 0,
		deleteAt: null,
		createdAt: new Date('2026-05-21T09:00:00.000Z'),
		updatedAt: new Date('2026-05-21T09:00:00.000Z')
	}

	const exportRecord = {
		id: 'export-1',
		integrationId: 'integration-1',
		orderId: 'order-1',
		provider: IntegrationProvider.IIKO,
		idempotencyKey: 'IIKO:integration-1:order-1',
		externalId: null,
		status: 'PENDING',
		attempts: 0,
		lastError: null,
		payload: null,
		response: null,
		requestedAt: new Date('2026-05-21T09:00:00.000Z'),
		startedAt: null,
		exportedAt: null,
		createdAt: new Date('2026-05-21T09:00:00.000Z'),
		updatedAt: new Date('2026-05-21T09:00:00.000Z')
	}

	beforeEach(async () => {
		;(Queue as unknown as jest.Mock).mockClear()
		;(Worker as unknown as jest.Mock).mockClear()

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				IikoOrderExportQueueService,
				{
					provide: ConfigService,
					useValue: {
						get: jest.fn((key: string) => {
							if (key === 'redis') return { host: '127.0.0.1', port: 6379 }
							return undefined
						})
					}
				},
				{
					provide: IntegrationRepository,
					useValue: {
						findIiko: jest.fn(),
						createPendingOrderExport: jest.fn(),
						findRunnableOrderExports: jest.fn(),
						findOrderExportForCatalog: jest.fn(),
						findOrderExportByOrderId: jest.fn(),
						findOrderExportById: jest.fn(),
						resetOrderExportForRetry: jest.fn(),
						markOrderExportRunning: jest.fn(),
						markOrderExportSuccess: jest.fn(),
						markOrderExportError: jest.fn(),
						markOrderExportSkipped: jest.fn()
					}
				},
				{
					provide: IikoMetadataCryptoService,
					useValue: {
						parseStoredMetadata: jest.fn()
					}
				},
				{
					provide: IikoOrderExportService,
					useValue: {
						exportOrder: jest.fn()
					}
				},
				{
					provide: ObservabilityService,
					useValue: {
						recordQueueJobEnqueued: jest.fn(),
						incrementQueueJobActive: jest.fn(),
						decrementQueueJobActive: jest.fn(),
						recordQueueJob: jest.fn(),
						recordOrderExportEvent: jest.fn()
					}
				},
				{
					provide: OBSERVABILITY_RECORDER_PORT,
					useExisting: ObservabilityService
				},
				{
					provide: CapabilityService,
					useValue: {
						canUseIikoIntegration: jest.fn().mockResolvedValue(true)
					}
				},
				{
					provide: CAPABILITY_READER_PORT,
					useExisting: CapabilityService
				}
			]
		}).compile()

		service = module.get(IikoOrderExportQueueService)
		repo = module.get(IntegrationRepository)
		metadataCrypto = module.get(IikoMetadataCryptoService)
		observability = module.get(ObservabilityService)
	})

	it('does not enqueue when iiko order export is disabled', async () => {
		repo.findIiko.mockResolvedValue(integrationRecord)
		metadataCrypto.parseStoredMetadata.mockReturnValue({
			exportOrders: false
		} as any)

		const result = await service.enqueueCompletedOrder('catalog-1', 'order-1')

		expect(result).toEqual({
			ok: true,
			queued: false,
			reason: 'order_export_disabled'
		})
		expect(repo.createPendingOrderExport).not.toHaveBeenCalled()
		expect(queueMock().add).not.toHaveBeenCalled()
	})

	it('creates a pending iiko export and enqueues a provider-specific job', async () => {
		repo.findIiko.mockResolvedValue(integrationRecord)
		repo.createPendingOrderExport.mockResolvedValue(exportRecord as any)
		metadataCrypto.parseStoredMetadata.mockReturnValue({
			exportOrders: true,
			terminalGroupId: 'terminal-1'
		} as any)
		queueMock().add.mockResolvedValue({ id: 'job-1' })

		const result = await service.enqueueCompletedOrder('catalog-1', 'order-1')

		expect(repo.createPendingOrderExport).toHaveBeenCalledWith({
			integrationId: 'integration-1',
			orderId: 'order-1',
			provider: IntegrationProvider.IIKO
		})
		expect(queueMock().add).toHaveBeenCalledWith(
			'iiko-order-export',
			expect.objectContaining({
				exportId: 'export-1',
				integrationId: 'integration-1',
				orderId: 'order-1',
				catalogId: 'catalog-1',
				provider: 'IIKO',
				idempotencyKey: 'IIKO:integration-1:order-1',
				trigger: 'ORDER_COMPLETED'
			}),
			{
				jobId: 'iiko-order-export--integration-1--order-1'
			}
		)
		expect(observability.recordQueueJobEnqueued).toHaveBeenCalledWith(
			'iiko-order-export',
			'iiko-order-export'
		)
		expect(result).toEqual({
			ok: true,
			queued: true,
			exportId: 'export-1',
			jobId: 'job-1'
		})
	})

	it('retries a failed iiko order export', async () => {
		repo.findOrderExportForCatalog.mockResolvedValue({
			...exportRecord,
			status: 'ERROR',
			lastError: 'provider failed'
		} as any)
		repo.resetOrderExportForRetry.mockResolvedValue(exportRecord as any)
		queueMock().add.mockResolvedValue({ id: 'retry-job-1' })

		const result = await service.retryOrderExport('catalog-1', 'export-1')

		expect(repo.findOrderExportForCatalog).toHaveBeenCalledWith(
			'catalog-1',
			'export-1',
			IntegrationProvider.IIKO
		)
		expect(repo.resetOrderExportForRetry).toHaveBeenCalledWith('export-1')
		expect(queueMock().add).toHaveBeenCalledWith(
			'iiko-order-export',
			expect.objectContaining({
				exportId: 'export-1',
				trigger: 'MANUAL_RETRY'
			}),
			{
				jobId: expect.stringMatching(
					/^iiko-order-export--integration-1--order-1--manual_retry--\d+$/
				)
			}
		)
		expect(result).toEqual({
			ok: true,
			queued: true,
			exportId: 'export-1',
			jobId: 'retry-job-1'
		})
	})

	it('waits for a completed iiko order export', async () => {
		repo.findIiko.mockResolvedValue(integrationRecord)
		metadataCrypto.parseStoredMetadata.mockReturnValue({
			exportOrders: true,
			terminalGroupId: 'terminal-1'
		} as any)
		repo.findOrderExportByOrderId.mockResolvedValue({
			...exportRecord,
			status: 'SUCCESS'
		} as any)

		const result = await service.waitForCompletedOrderExport(
			'catalog-1',
			'order-1',
			{ timeoutMs: 10, intervalMs: 1 }
		)

		expect(repo.findOrderExportByOrderId).toHaveBeenCalledWith(
			'integration-1',
			'order-1'
		)
		expect(result).toEqual({
			ok: true,
			status: 'SUCCESS',
			exportId: 'export-1'
		})
	})

	it('returns an error state when iiko order export is skipped', async () => {
		repo.findIiko.mockResolvedValue(integrationRecord)
		metadataCrypto.parseStoredMetadata.mockReturnValue({
			exportOrders: true,
			terminalGroupId: 'terminal-1'
		} as any)
		repo.findOrderExportByOrderId.mockResolvedValue({
			...exportRecord,
			status: 'SKIPPED',
			lastError: 'iiko command failed'
		} as any)

		const result = await service.waitForCompletedOrderExport(
			'catalog-1',
			'order-1',
			{ timeoutMs: 10, intervalMs: 1 }
		)

		expect(result).toEqual({
			ok: false,
			status: 'SKIPPED',
			exportId: 'export-1',
			error: 'iiko command failed'
		})
	})

	it('times out while waiting for iiko export confirmation', async () => {
		repo.findIiko.mockResolvedValue(integrationRecord)
		metadataCrypto.parseStoredMetadata.mockReturnValue({
			exportOrders: true,
			terminalGroupId: 'terminal-1'
		} as any)
		repo.findOrderExportByOrderId.mockResolvedValue({
			...exportRecord,
			status: 'RUNNING'
		} as any)

		const result = await service.waitForCompletedOrderExport(
			'catalog-1',
			'order-1',
			{ timeoutMs: 1, intervalMs: 1 }
		)

		expect(result).toEqual({
			ok: false,
			status: 'TIMEOUT',
			exportId: 'export-1',
			reason: 'order_export_timeout'
		})
	})
})

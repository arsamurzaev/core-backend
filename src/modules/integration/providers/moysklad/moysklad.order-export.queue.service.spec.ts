import { IntegrationProvider, IntegrationSyncStatus } from '@generated/enums'
import { ConfigService } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'
import { Queue, Worker } from 'bullmq'

import { CapabilityService } from '@/modules/capability/capability.service'
import { CAPABILITY_READER_PORT } from '@/modules/capability/contracts'
import { OBSERVABILITY_RECORDER_PORT } from '@/modules/observability/contracts'
import { ObservabilityService } from '@/modules/observability/observability.service'

import { IntegrationRepository } from '../../integration.repository'

import { MoySkladMetadataCryptoService } from './moysklad.metadata'
import { MoySkladOrderExportQueueService } from './moysklad.order-export.queue.service'
import {
	MoySkladOrderExportService,
	NonRetryableMoySkladOrderExportError
} from './moysklad.order-export.service'

let workerProcessor:
	| ((job: {
			id?: string
			name?: string
			data: Record<string, unknown>
	  }) => Promise<unknown>)
	| undefined

jest.mock('bullmq', () => ({
	Queue: jest.fn().mockImplementation(() => ({
		add: jest.fn(),
		close: jest.fn()
	})),
	Worker: jest
		.fn()
		.mockImplementation((_name: string, processor: typeof workerProcessor) => {
			workerProcessor = processor
			return {
				on: jest.fn(),
				close: jest.fn()
			}
		}),
	Job: class {}
}))

describe('MoySkladOrderExportQueueService', () => {
	let service: MoySkladOrderExportQueueService
	let repo: jest.Mocked<IntegrationRepository>
	let metadataCrypto: any
	let orderExportService: jest.Mocked<MoySkladOrderExportService>
	let observability: jest.Mocked<ObservabilityService>

	const queueMock = () =>
		(Queue as unknown as jest.Mock).mock.results[0]?.value as {
			add: jest.Mock
			close: jest.Mock
		}

	const integrationRecord = {
		id: 'integration-1',
		catalogId: 'catalog-1',
		provider: IntegrationProvider.MOYSKLAD,
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
		createdAt: new Date('2026-03-23T12:00:00.000Z'),
		updatedAt: new Date('2026-03-23T12:00:00.000Z')
	}

	const exportRecord = {
		id: 'export-1',
		integrationId: 'integration-1',
		orderId: 'order-1',
		provider: IntegrationProvider.MOYSKLAD,
		idempotencyKey: 'MOYSKLAD:integration-1:order-1',
		externalId: null,
		status: 'PENDING',
		attempts: 0,
		lastError: null,
		payload: null,
		response: null,
		requestedAt: new Date('2026-03-23T12:00:00.000Z'),
		startedAt: null,
		exportedAt: null,
		createdAt: new Date('2026-03-23T12:00:00.000Z'),
		updatedAt: new Date('2026-03-23T12:00:00.000Z')
	}

	beforeEach(async () => {
		;(Queue as unknown as jest.Mock).mockClear()
		;(Worker as unknown as jest.Mock).mockClear()
		workerProcessor = undefined

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				MoySkladOrderExportQueueService,
				{
					provide: ConfigService,
					useValue: {
						get: jest.fn((key: string) => {
							if (key === 'redis') {
								return {
									host: '127.0.0.1',
									port: 6379
								}
							}
							return undefined
						})
					}
				},
				{
					provide: IntegrationRepository,
					useValue: {
						findMoySklad: jest.fn(),
						createPendingOrderExport: jest.fn(),
						findOrderExportForCatalog: jest.fn(),
						findRunnableOrderExports: jest.fn(),
						findOrderExportById: jest.fn(),
						resetOrderExportForRetry: jest.fn(),
						markOrderExportRunning: jest.fn(),
						markOrderExportSuccess: jest.fn(),
						markOrderExportError: jest.fn(),
						markOrderExportSkipped: jest.fn()
					}
				},
				{
					provide: MoySkladMetadataCryptoService,
					useValue: {
						parseStoredMetadata: jest.fn()
					}
				},
				{
					provide: MoySkladOrderExportService,
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
						canUseMoySkladIntegration: jest.fn().mockResolvedValue(true)
					}
				},
				{
					provide: CAPABILITY_READER_PORT,
					useExisting: CapabilityService
				}
			]
		}).compile()

		service = module.get(MoySkladOrderExportQueueService)
		repo = module.get(IntegrationRepository)
		metadataCrypto = module.get(MoySkladMetadataCryptoService)
		orderExportService = module.get(MoySkladOrderExportService)
		observability = module.get(ObservabilityService)
		repo.findRunnableOrderExports.mockResolvedValue([])
	})

	it('does not create an export record when order export is disabled', async () => {
		repo.findMoySklad.mockResolvedValue(integrationRecord as any)
		metadataCrypto.parseStoredMetadata.mockReturnValue({
			token: 'token',
			priceTypeName: 'Retail',
			importImages: true,
			syncStock: true,
			exportOrders: false,
			orderExportOrganizationId: null,
			orderExportCounterpartyId: null,
			orderExportStoreId: null,
			scheduleEnabled: false,
			schedulePattern: null,
			scheduleTimezone: 'Europe/Moscow'
		})

		const result = await service.enqueueCompletedOrder('catalog-1', 'order-1')

		expect(result).toEqual({
			ok: true,
			queued: false,
			reason: 'order_export_disabled'
		})
		expect(repo.createPendingOrderExport).not.toHaveBeenCalled()
		expect(queueMock().add).not.toHaveBeenCalled()
	})

	it('creates a pending export and enqueues a compact BullMQ job', async () => {
		repo.findMoySklad.mockResolvedValue(integrationRecord as any)
		repo.createPendingOrderExport.mockResolvedValue(exportRecord as any)
		metadataCrypto.parseStoredMetadata.mockReturnValue({
			token: 'token',
			priceTypeName: 'Retail',
			importImages: true,
			syncStock: true,
			exportOrders: true,
			orderExportOrganizationId: 'organization-1',
			orderExportCounterpartyId: 'counterparty-1',
			orderExportStoreId: 'store-1',
			scheduleEnabled: false,
			schedulePattern: null,
			scheduleTimezone: 'Europe/Moscow'
		})
		queueMock().add.mockResolvedValue({ id: 'job-1' })

		const result = await service.enqueueCompletedOrder('catalog-1', 'order-1')

		expect(repo.createPendingOrderExport).toHaveBeenCalledWith({
			integrationId: 'integration-1',
			orderId: 'order-1'
		})
		expect(queueMock().add).toHaveBeenCalledWith(
			'moysklad-order-export',
			expect.objectContaining({
				exportId: 'export-1',
				integrationId: 'integration-1',
				orderId: 'order-1',
				catalogId: 'catalog-1',
				provider: 'MOYSKLAD',
				idempotencyKey: 'MOYSKLAD:integration-1:order-1',
				trigger: 'ORDER_COMPLETED'
			}),
			{
				jobId: 'moysklad-order-export--integration-1--order-1'
			}
		)
		expect(observability.recordQueueJobEnqueued).toHaveBeenCalledWith(
			'order-export',
			'moysklad-order-export'
		)
		expect(observability.recordOrderExportEvent).toHaveBeenCalledWith(
			'MOYSKLAD',
			'ORDER_COMPLETED',
			'queued'
		)
		expect(result).toEqual(
			expect.objectContaining({
				ok: true,
				queued: true,
				exportId: 'export-1',
				jobId: 'job-1'
			})
		)
	})

	it('uses BullMQ-safe order export job ids even when source ids contain colons', async () => {
		repo.findMoySklad.mockResolvedValue({
			...integrationRecord,
			id: 'integration:1'
		} as any)
		repo.createPendingOrderExport.mockResolvedValue({
			...exportRecord,
			integrationId: 'integration:1',
			orderId: 'order:1',
			idempotencyKey: 'MOYSKLAD:integration:1:order:1'
		} as any)
		metadataCrypto.parseStoredMetadata.mockReturnValue({
			token: 'token',
			priceTypeName: 'Retail',
			importImages: true,
			syncStock: true,
			exportOrders: true,
			orderExportOrganizationId: 'organization-1',
			orderExportCounterpartyId: 'counterparty-1',
			orderExportStoreId: 'store-1',
			scheduleEnabled: false,
			schedulePattern: null,
			scheduleTimezone: 'Europe/Moscow'
		})
		queueMock().add.mockImplementation(
			async (_name: string, _data: unknown, options: { jobId?: string }) => {
				if (String(options?.jobId ?? '').includes(':')) {
					throw new Error('Custom Id cannot contain :')
				}
				return { id: options.jobId }
			}
		)

		const result = await service.enqueueCompletedOrder('catalog-1', 'order:1')

		expect(queueMock().add).toHaveBeenCalledWith(
			'moysklad-order-export',
			expect.objectContaining({
				integrationId: 'integration:1',
				orderId: 'order:1',
				idempotencyKey: 'MOYSKLAD:integration:1:order:1'
			}),
			{
				jobId: 'moysklad-order-export--integration-1--order-1'
			}
		)
		expect(result).toEqual(
			expect.objectContaining({
				ok: true,
				queued: true,
				jobId: 'moysklad-order-export--integration-1--order-1'
			})
		)
	})

	it('resets a failed export and queues manual retry', async () => {
		repo.findOrderExportForCatalog.mockResolvedValue({
			...exportRecord,
			status: 'ERROR',
			lastError: 'previous failure'
		} as any)
		repo.resetOrderExportForRetry.mockResolvedValue(exportRecord as any)
		queueMock().add.mockResolvedValue({ id: 'retry-job-1' })

		const result = await service.retryOrderExport('catalog-1', 'export-1')

		expect(repo.findOrderExportForCatalog).toHaveBeenCalledWith(
			'catalog-1',
			'export-1'
		)
		expect(repo.resetOrderExportForRetry).toHaveBeenCalledWith('export-1')
		expect(queueMock().add).toHaveBeenCalledWith(
			'moysklad-order-export',
			expect.objectContaining({
				exportId: 'export-1',
				trigger: 'MANUAL_RETRY'
			}),
			{
				jobId: expect.stringMatching(
					/^moysklad-order-export--integration-1--order-1--manual_retry--/
				)
			}
		)
		expect(result).toEqual({
			ok: true,
			queued: true,
			exportId: 'export-1',
			jobId: 'retry-job-1'
		})
		expect(observability.recordOrderExportEvent).toHaveBeenCalledWith(
			'MOYSKLAD',
			'MANUAL_RETRY',
			'queued'
		)
	})

	it('resets a skipped export and queues manual retry', async () => {
		repo.findOrderExportForCatalog.mockResolvedValue({
			...exportRecord,
			status: 'SKIPPED',
			lastError: 'order_export_disabled'
		} as any)
		repo.resetOrderExportForRetry.mockResolvedValue(exportRecord as any)
		queueMock().add.mockResolvedValue({ id: 'retry-skipped-job-1' })

		const result = await service.retryOrderExport('catalog-1', 'export-1')

		expect(repo.resetOrderExportForRetry).toHaveBeenCalledWith('export-1')
		expect(queueMock().add).toHaveBeenCalledWith(
			'moysklad-order-export',
			expect.objectContaining({
				exportId: 'export-1',
				trigger: 'MANUAL_RETRY'
			}),
			{
				jobId: expect.stringMatching(
					/^moysklad-order-export--integration-1--order-1--manual_retry--/
				)
			}
		)
		expect(result).toEqual({
			ok: true,
			queued: true,
			exportId: 'export-1',
			jobId: 'retry-skipped-job-1'
		})
	})

	it('requeues pending and stale order exports during reconciliation', async () => {
		repo.findRunnableOrderExports.mockResolvedValue([
			{
				...exportRecord,
				integration: {
					catalogId: 'catalog-1',
					isActive: true,
					deleteAt: null,
					metadata: {}
				}
			}
		] as any)
		metadataCrypto.parseStoredMetadata.mockReturnValue({
			token: 'token',
			priceTypeName: 'Retail',
			importImages: true,
			syncStock: true,
			exportOrders: true,
			orderExportOrganizationId: 'organization-1',
			orderExportCounterpartyId: 'counterparty-1',
			orderExportStoreId: 'store-1',
			scheduleEnabled: false,
			schedulePattern: null,
			scheduleTimezone: 'Europe/Moscow'
		})
		queueMock().add.mockResolvedValue({ id: 'reconcile-job-1' })

		const result = await service.reconcilePendingOrderExports()

		expect(repo.findRunnableOrderExports).toHaveBeenCalledWith(
			expect.objectContaining({
				limit: 100,
				staleRunningBefore: expect.any(Date)
			})
		)
		expect(queueMock().add).toHaveBeenCalledWith(
			'moysklad-order-export',
			expect.objectContaining({
				exportId: 'export-1',
				catalogId: 'catalog-1',
				trigger: 'RECONCILIATION'
			}),
			{
				jobId: expect.stringMatching(
					/^moysklad-order-export--integration-1--order-1--reconciliation--/
				)
			}
		)
		expect(result).toBe(1)
	})

	it('marks runnable exports as skipped during reconciliation when export is disabled', async () => {
		repo.findRunnableOrderExports.mockResolvedValue([
			{
				...exportRecord,
				integration: {
					catalogId: 'catalog-1',
					isActive: true,
					deleteAt: null,
					metadata: {}
				}
			}
		] as any)
		metadataCrypto.parseStoredMetadata.mockReturnValue({
			token: 'token',
			priceTypeName: 'Retail',
			importImages: true,
			syncStock: true,
			exportOrders: false,
			orderExportOrganizationId: null,
			orderExportCounterpartyId: null,
			orderExportStoreId: null,
			scheduleEnabled: false,
			schedulePattern: null,
			scheduleTimezone: 'Europe/Moscow'
		})
		repo.markOrderExportSkipped.mockResolvedValue({
			...exportRecord,
			status: 'SKIPPED',
			lastError: 'order_export_disabled'
		} as any)

		const result = await service.reconcilePendingOrderExports()

		expect(repo.markOrderExportSkipped).toHaveBeenCalledWith(
			'export-1',
			'order_export_disabled'
		)
		expect(queueMock().add).not.toHaveBeenCalled()
		expect(result).toBe(0)
		expect(observability.recordOrderExportEvent).toHaveBeenCalledWith(
			'MOYSKLAD',
			'RECONCILIATION',
			'skipped'
		)
	})

	it('records success domain metric for processed order export jobs', async () => {
		repo.findOrderExportById.mockResolvedValue(exportRecord as any)
		repo.markOrderExportRunning.mockResolvedValue(exportRecord as any)
		orderExportService.exportOrder.mockResolvedValue({
			externalId: 'external-order-1',
			response: { id: 'external-order-1' },
			created: true
		})
		repo.markOrderExportSuccess.mockResolvedValue({
			...exportRecord,
			status: 'SUCCESS'
		} as any)

		await workerProcessor?.({
			id: 'job-1',
			name: 'moysklad-order-export',
			data: {
				exportId: 'export-1',
				integrationId: 'integration-1',
				orderId: 'order-1',
				catalogId: 'catalog-1',
				provider: 'MOYSKLAD',
				idempotencyKey: 'MOYSKLAD:integration-1:order-1',
				trigger: 'MANUAL_RETRY'
			}
		})

		expect(observability.recordOrderExportEvent).toHaveBeenCalledWith(
			'MOYSKLAD',
			'MANUAL_RETRY',
			'success'
		)
	})

	it('records error domain metric for failed order export jobs', async () => {
		repo.findOrderExportById.mockResolvedValue(exportRecord as any)
		repo.markOrderExportRunning.mockResolvedValue(exportRecord as any)
		orderExportService.exportOrder.mockRejectedValue(new Error('provider failed'))
		repo.markOrderExportError.mockResolvedValue({
			...exportRecord,
			status: 'ERROR'
		} as any)

		await expect(
			workerProcessor?.({
				id: 'job-1',
				name: 'moysklad-order-export',
				data: {
					exportId: 'export-1',
					integrationId: 'integration-1',
					orderId: 'order-1',
					catalogId: 'catalog-1',
					provider: 'MOYSKLAD',
					idempotencyKey: 'MOYSKLAD:integration-1:order-1',
					trigger: 'MANUAL_RETRY'
				}
			})
		).rejects.toThrow('provider failed')

		expect(observability.recordOrderExportEvent).toHaveBeenCalledWith(
			'MOYSKLAD',
			'MANUAL_RETRY',
			'error'
		)
	})

	it('marks non-retryable order export errors as skipped', async () => {
		repo.findOrderExportById.mockResolvedValue(exportRecord as any)
		repo.markOrderExportRunning.mockResolvedValue(exportRecord as any)
		orderExportService.exportOrder.mockRejectedValue(
			new NonRetryableMoySkladOrderExportError('order export disabled')
		)
		repo.markOrderExportSkipped.mockResolvedValue({
			...exportRecord,
			status: 'SKIPPED',
			lastError: 'order export disabled'
		} as any)

		await expect(
			workerProcessor?.({
				id: 'job-1',
				name: 'moysklad-order-export',
				data: {
					exportId: 'export-1',
					integrationId: 'integration-1',
					orderId: 'order-1',
					catalogId: 'catalog-1',
					provider: 'MOYSKLAD',
					idempotencyKey: 'MOYSKLAD:integration-1:order-1',
					trigger: 'MANUAL_RETRY'
				}
			})
		).resolves.toEqual({
			ok: false,
			retryable: false,
			skipped: true,
			error: 'order export disabled'
		})

		expect(repo.markOrderExportSkipped).toHaveBeenCalledWith(
			'export-1',
			'order export disabled'
		)
		expect(repo.markOrderExportError).not.toHaveBeenCalled()
		expect(observability.recordOrderExportEvent).toHaveBeenCalledWith(
			'MOYSKLAD',
			'MANUAL_RETRY',
			'skipped'
		)
	})
})

import {
	IntegrationProvider,
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger,
	IntegrationSyncStatus
} from '@generated/enums'
import { ConfigService } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'
import { Queue, Worker } from 'bullmq'

import { CapabilityService } from '@/modules/capability/capability.service'
import {
	CAPABILITY_ASSERT_PORT,
	CAPABILITY_READER_PORT
} from '@/modules/capability/contracts'
import { OBSERVABILITY_RECORDER_PORT } from '@/modules/observability/contracts'
import { ObservabilityService } from '@/modules/observability/observability.service'

import { IntegrationRepository } from '../../integration.repository'

import {
	buildMoySkladMetadata,
	MoySkladMetadataCryptoService
} from './moysklad.metadata'
import { MoySkladQueueService } from './moysklad.queue.service'
import { MoySkladSyncOrchestratorService } from './moysklad.sync-orchestrator.service'
import { MoySkladSyncRunRecorderService } from './moysklad.sync-run-recorder.service'
import { MoySkladSyncService } from './moysklad.sync.service'

let workerProcessor:
	| ((job: { id?: string; data: Record<string, unknown> }) => Promise<unknown>)
	| undefined

jest.mock('bullmq', () => ({
	Queue: jest.fn().mockImplementation(() => ({
		add: jest.fn(),
		upsertJobScheduler: jest.fn(),
		removeJobScheduler: jest.fn(),
		getJobSchedulersCount: jest.fn().mockResolvedValue(0),
		getJobSchedulers: jest.fn().mockResolvedValue([]),
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

describe('MoySkladQueueService', () => {
	let service: MoySkladQueueService
	let repo: jest.Mocked<IntegrationRepository>
	let sync: jest.Mocked<MoySkladSyncService>
	let metadataCrypto: jest.Mocked<MoySkladMetadataCryptoService>
	let observability: {
		recordQueueJobEnqueued: jest.Mock
		incrementQueueJobActive: jest.Mock
		decrementQueueJobActive: jest.Mock
		recordQueueJob: jest.Mock
		recordIntegrationSyncRun: jest.Mock
		recordIntegrationSyncItems: jest.Mock
		recordIntegrationStockFreshness: jest.Mock
	}

	const queueMock = () =>
		(Queue as unknown as jest.Mock).mock.results[0]?.value as {
			add: jest.Mock
			upsertJobScheduler: jest.Mock
			removeJobScheduler: jest.Mock
			getJobSchedulersCount: jest.Mock
			getJobSchedulers: jest.Mock
			close: jest.Mock
		}

	const decryptedMetadata = buildMoySkladMetadata({
		token: 'token-12345678',
		priceTypeName: 'Цена продажи',
		importImages: true,
		syncStock: true,
		scheduleEnabled: true,
		schedulePattern: '0 */6 * * *',
		scheduleTimezone: 'Europe/Moscow'
	})

	const integrationRecord = {
		id: 'integration-1',
		catalogId: 'catalog-1',
		provider: IntegrationProvider.MOYSKLAD,
		metadata: {
			priceTypeName: decryptedMetadata.priceTypeName,
			importImages: decryptedMetadata.importImages,
			syncStock: decryptedMetadata.syncStock,
			scheduleEnabled: decryptedMetadata.scheduleEnabled,
			schedulePattern: decryptedMetadata.schedulePattern,
			scheduleTimezone: decryptedMetadata.scheduleTimezone,
			tokenEncrypted: {
				format: 'enc-v1' as const,
				alg: 'aes-256-gcm' as const,
				keyVersion: 'v1',
				iv: 'iv',
				tag: 'tag',
				ciphertext: 'cipher'
			}
		},
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

	const syncRunRecord = {
		id: 'run-1',
		integrationId: 'integration-1',
		catalogId: 'catalog-1',
		provider: IntegrationProvider.MOYSKLAD,
		mode: IntegrationSyncRunMode.FULL,
		trigger: IntegrationSyncRunTrigger.MANUAL,
		status: IntegrationSyncRunStatus.PENDING,
		jobId: null,
		productId: null,
		externalId: null,
		error: null,
		metadata: null,
		totalProducts: 0,
		createdProducts: 0,
		updatedProducts: 0,
		deletedProducts: 0,
		imagesImported: 0,
		durationMs: null,
		requestedAt: new Date('2026-03-23T12:10:00.000Z'),
		startedAt: null,
		finishedAt: null,
		createdAt: new Date('2026-03-23T12:10:00.000Z'),
		updatedAt: new Date('2026-03-23T12:10:00.000Z')
	}

	beforeEach(async () => {
		;(Queue as unknown as jest.Mock).mockClear()
		;(Worker as unknown as jest.Mock).mockClear()
		workerProcessor = undefined

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				MoySkladQueueService,
				MoySkladSyncOrchestratorService,
				MoySkladSyncRunRecorderService,
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
						findMoySkladById: jest.fn(),
						findAllMoySklad: jest.fn().mockResolvedValue([]),
						findLatestActiveSyncRun: jest.fn(),
						createSyncRun: jest.fn(),
						attachSyncRunJobId: jest.fn(),
						markSyncRunRunning: jest.fn(),
						completeSyncRun: jest.fn(),
						failSyncRun: jest.fn(),
						skipSyncRun: jest.fn(),
						patchMoySkladProductChangeWebhookMetadata: jest.fn(),
						patchMoySkladProductFolderWebhookMetadata: jest.fn()
					}
				},
				{
					provide: MoySkladSyncService,
					useValue: {
						syncCatalog: jest.fn(),
						syncProduct: jest.fn(),
						syncExternalProduct: jest.fn(),
						syncProductFolder: jest.fn(),
						syncStock: jest.fn()
					}
				},
				{
					provide: MoySkladMetadataCryptoService,
					useValue: {
						parseStoredMetadata: jest.fn(() => decryptedMetadata)
					}
				},
				{
					provide: ObservabilityService,
					useValue: {
						recordQueueJobEnqueued: jest.fn(),
						incrementQueueJobActive: jest.fn(),
						decrementQueueJobActive: jest.fn(),
						recordQueueJob: jest.fn(),
						recordIntegrationSyncRun: jest.fn(),
						recordIntegrationSyncItems: jest.fn(),
						recordIntegrationStockFreshness: jest.fn()
					}
				},
				{
					provide: OBSERVABILITY_RECORDER_PORT,
					useExisting: ObservabilityService
				},
				{
					provide: CapabilityService,
					useValue: {
						assertCanUseMoySkladIntegration: jest.fn().mockResolvedValue(undefined),
						canUseMoySkladIntegration: jest.fn().mockResolvedValue(true)
					}
				},
				{
					provide: CAPABILITY_ASSERT_PORT,
					useExisting: CapabilityService
				},
				{
					provide: CAPABILITY_READER_PORT,
					useExisting: CapabilityService
				}
			]
		}).compile()

		service = module.get(MoySkladQueueService)
		repo = module.get(IntegrationRepository)
		sync = module.get(MoySkladSyncService)
		metadataCrypto = module.get(MoySkladMetadataCryptoService)
		observability = module.get(ObservabilityService)
	})

	it('queues manual catalog sync and stores job id', async () => {
		repo.findMoySklad.mockResolvedValue(integrationRecord as any)
		repo.findLatestActiveSyncRun.mockResolvedValue(null)
		repo.createSyncRun.mockResolvedValue(syncRunRecord as any)
		queueMock().add.mockResolvedValue({ id: 'job-1' })

		const result = await service.enqueueCatalogSync('catalog-1')

		expect(repo.createSyncRun).toHaveBeenCalledWith(
			expect.objectContaining({
				integrationId: 'integration-1',
				catalogId: 'catalog-1',
				mode: IntegrationSyncRunMode.FULL,
				trigger: IntegrationSyncRunTrigger.MANUAL
			})
		)
		expect(queueMock().add).toHaveBeenCalledWith(
			'catalog-sync',
			expect.objectContaining({
				runId: 'run-1',
				catalogId: 'catalog-1',
				mode: IntegrationSyncRunMode.FULL,
				trigger: IntegrationSyncRunTrigger.MANUAL
			}),
			expect.objectContaining({
				jobId: 'moysklad-manual--run-1'
			})
		)
		expect(repo.attachSyncRunJobId).toHaveBeenCalledWith('run-1', 'job-1')
		expect(observability.recordQueueJobEnqueued).toHaveBeenCalledWith(
			'moysklad-sync',
			'catalog-sync'
		)
		expect(result.jobId).toBe('job-1')
	})

	it('queues manual product sync and stores job id', async () => {
		repo.findMoySklad.mockResolvedValue(integrationRecord as any)
		repo.findLatestActiveSyncRun.mockResolvedValue(null)
		repo.createSyncRun.mockResolvedValue({
			...syncRunRecord,
			mode: IntegrationSyncRunMode.PRODUCT,
			productId: 'product-1'
		} as any)
		queueMock().add.mockResolvedValue({ id: 'job-product' })

		const result = await service.enqueueProductSync('catalog-1', 'product-1')

		expect(repo.createSyncRun).toHaveBeenCalledWith(
			expect.objectContaining({
				integrationId: 'integration-1',
				catalogId: 'catalog-1',
				mode: IntegrationSyncRunMode.PRODUCT,
				trigger: IntegrationSyncRunTrigger.MANUAL,
				productId: 'product-1'
			})
		)
		expect(queueMock().add).toHaveBeenCalledWith(
			'product-sync',
			expect.objectContaining({
				runId: 'run-1',
				catalogId: 'catalog-1',
				mode: IntegrationSyncRunMode.PRODUCT,
				trigger: IntegrationSyncRunTrigger.MANUAL,
				productId: 'product-1'
			}),
			expect.objectContaining({
				jobId: 'moysklad-manual--run-1'
			})
		)
		expect(repo.attachSyncRunJobId).toHaveBeenCalledWith('run-1', 'job-product')
		expect(observability.recordQueueJobEnqueued).toHaveBeenCalledWith(
			'moysklad-sync',
			'product-sync'
		)
		expect(result.mode).toBe(IntegrationSyncRunMode.PRODUCT)
	})

	it('queues manual stock sync and stores job id', async () => {
		repo.findMoySklad.mockResolvedValue(integrationRecord as any)
		repo.findLatestActiveSyncRun.mockResolvedValue(null)
		repo.createSyncRun.mockResolvedValue({
			...syncRunRecord,
			mode: IntegrationSyncRunMode.STOCK
		} as any)
		queueMock().add.mockResolvedValue({ id: 'job-stock' })

		const result = await service.enqueueStockSync('catalog-1')

		expect(repo.createSyncRun).toHaveBeenCalledWith(
			expect.objectContaining({
				integrationId: 'integration-1',
				catalogId: 'catalog-1',
				mode: IntegrationSyncRunMode.STOCK,
				trigger: IntegrationSyncRunTrigger.MANUAL
			})
		)
		expect(queueMock().add).toHaveBeenCalledWith(
			'stock-sync',
			expect.objectContaining({
				runId: 'run-1',
				catalogId: 'catalog-1',
				mode: IntegrationSyncRunMode.STOCK,
				trigger: IntegrationSyncRunTrigger.MANUAL
			}),
			expect.objectContaining({
				jobId: 'moysklad-manual--run-1'
			})
		)
		expect(repo.attachSyncRunJobId).toHaveBeenCalledWith('run-1', 'job-stock')
		expect(observability.recordQueueJobEnqueued).toHaveBeenCalledWith(
			'moysklad-sync',
			'stock-sync'
		)
		expect(result.mode).toBe(IntegrationSyncRunMode.STOCK)
	})

	it('queues MoySklad product webhook sync with entity debounce id', async () => {
		queueMock().add.mockResolvedValue({ id: 'product-webhook-job-1' })

		const result = await service.enqueueProductWebhookSync(
			'catalog-1',
			'integration-1',
			{
				entityType: 'variant',
				externalId: 'variant-1',
				action: 'UPDATE'
			}
		)

		expect(queueMock().add).toHaveBeenCalledWith(
			'product-webhook',
			expect.objectContaining({
				catalogId: 'catalog-1',
				webhookIntegrationId: 'integration-1',
				webhookEntityType: 'variant',
				webhookExternalId: 'variant-1',
				webhookAction: 'UPDATE',
				mode: IntegrationSyncRunMode.PRODUCT,
				trigger: IntegrationSyncRunTrigger.WEBHOOK
			}),
			expect.objectContaining({
				jobId: 'moysklad-webhook-product--integration-1--variant--variant-1',
				delay: 5000,
				removeOnComplete: true
			})
		)
		expect(observability.recordQueueJobEnqueued).toHaveBeenCalledWith(
			'moysklad-sync',
			'product-webhook'
		)
		expect(result.jobId).toBe('product-webhook-job-1')
	})

	it('queues MoySklad productfolder webhook sync with action debounce id', async () => {
		queueMock().add.mockResolvedValue({ id: 'folder-webhook-job-1' })

		const result = await service.enqueueProductFolderWebhookSync(
			'catalog-1',
			'integration-1',
			{
				externalId: 'folder-1',
				action: 'DELETE'
			}
		)

		expect(queueMock().add).toHaveBeenCalledWith(
			'productfolder-webhook',
			expect.objectContaining({
				catalogId: 'catalog-1',
				webhookIntegrationId: 'integration-1',
				webhookEntityType: 'productfolder',
				webhookExternalId: 'folder-1',
				webhookAction: 'DELETE',
				mode: IntegrationSyncRunMode.PRODUCT,
				trigger: IntegrationSyncRunTrigger.WEBHOOK
			}),
			expect.objectContaining({
				jobId: 'moysklad-webhook-productfolder--integration-1--DELETE--folder-1',
				delay: 5000,
				removeOnComplete: true
			})
		)
		expect(observability.recordQueueJobEnqueued).toHaveBeenCalledWith(
			'moysklad-sync',
			'productfolder-webhook'
		)
		expect(result.jobId).toBe('folder-webhook-job-1')
	})

	it('upserts scheduler for enabled integration', async () => {
		await service.syncSchedulerForIntegration(integrationRecord as any)

		expect(metadataCrypto.parseStoredMetadata).toHaveBeenCalledWith(
			integrationRecord.metadata
		)
		expect(queueMock().upsertJobScheduler).toHaveBeenCalledWith(
			'moysklad:catalog:catalog-1',
			{
				pattern: '0 */6 * * *',
				tz: 'Europe/Moscow'
			},
			expect.objectContaining({
				name: 'catalog-sync',
				data: expect.objectContaining({
					catalogId: 'catalog-1',
					mode: IntegrationSyncRunMode.FULL,
					trigger: IntegrationSyncRunTrigger.SCHEDULED
				})
			})
		)
	})

	it('processes scheduled catalog sync run', async () => {
		repo.findMoySklad.mockResolvedValue(integrationRecord as any)
		repo.createSyncRun.mockResolvedValue({
			...syncRunRecord,
			trigger: IntegrationSyncRunTrigger.SCHEDULED
		} as any)
		repo.markSyncRunRunning.mockResolvedValue({
			...syncRunRecord,
			trigger: IntegrationSyncRunTrigger.SCHEDULED,
			status: IntegrationSyncRunStatus.RUNNING,
			jobId: 'job-2',
			startedAt: new Date('2026-03-23T12:10:05.000Z')
		} as any)
		sync.syncCatalog.mockResolvedValue({
			ok: true,
			total: 2,
			totalProducts: 1,
			totalVariants: 1,
			created: 1,
			createdProducts: 1,
			createdVariants: 0,
			updated: 1,
			updatedProducts: 0,
			updatedVariants: 1,
			deleted: 0,
			skippedProducts: 0,
			skippedVariants: 0,
			warnings: [
				{
					code: 'MOYSKLAD_PRODUCT_FOLDER_MISSING',
					message: 'Skipped without folder',
					externalId: null,
					count: 1
				}
			],
			errors: [],
			durationMs: 250,
			syncedAt: new Date('2026-03-23T12:15:00.000Z')
		})

		await workerProcessor?.({
			id: 'job-2',
			data: {
				catalogId: 'catalog-1',
				mode: IntegrationSyncRunMode.FULL,
				trigger: IntegrationSyncRunTrigger.SCHEDULED
			}
		})

		expect(repo.createSyncRun).toHaveBeenCalledWith(
			expect.objectContaining({
				integrationId: 'integration-1',
				catalogId: 'catalog-1',
				mode: IntegrationSyncRunMode.FULL,
				trigger: IntegrationSyncRunTrigger.SCHEDULED,
				jobId: 'job-2'
			})
		)
		expect(sync.syncCatalog).toHaveBeenCalledWith('catalog-1', { runId: 'run-1' })
		expect(repo.completeSyncRun).toHaveBeenCalledWith(
			'run-1',
			expect.objectContaining({
				totalProducts: 2,
				createdProducts: 1,
				updatedProducts: 1,
				deletedProducts: 0,
				imagesImported: 0,
				durationMs: 250,
				metadata: expect.objectContaining({
					products: expect.objectContaining({
						total: 1,
						created: 1,
						updated: 0,
						deleted: 0,
						skipped: 0
					}),
					variants: expect.objectContaining({
						total: 1,
						created: 0,
						updated: 1,
						deleted: 0,
						skipped: 0
					}),
					warnings: [
						expect.objectContaining({
							code: 'MOYSKLAD_PRODUCT_FOLDER_MISSING'
						})
					],
					errors: []
				})
			})
		)
		expect(observability.incrementQueueJobActive).toHaveBeenCalledWith(
			'moysklad-sync',
			'catalog-sync'
		)
		expect(observability.recordQueueJob).toHaveBeenCalledWith(
			'moysklad-sync',
			'catalog-sync',
			'success',
			expect.any(Number)
		)
		expect(observability.recordIntegrationSyncRun).toHaveBeenCalledWith(
			'MOYSKLAD',
			IntegrationSyncRunMode.FULL,
			IntegrationSyncRunTrigger.SCHEDULED,
			'success',
			250
		)
		expect(observability.recordIntegrationSyncItems).toHaveBeenCalledWith(
			'MOYSKLAD',
			IntegrationSyncRunMode.FULL,
			'product',
			'created',
			1
		)
		expect(observability.recordIntegrationSyncItems).toHaveBeenCalledWith(
			'MOYSKLAD',
			IntegrationSyncRunMode.FULL,
			'variant',
			'updated',
			1
		)
		expect(observability.decrementQueueJobActive).toHaveBeenCalledWith(
			'moysklad-sync',
			'catalog-sync'
		)
	})

	it('processes MoySklad product webhook sync run', async () => {
		repo.findMoySkladById.mockResolvedValue(integrationRecord as any)
		repo.createSyncRun.mockResolvedValue({
			...syncRunRecord,
			mode: IntegrationSyncRunMode.PRODUCT,
			trigger: IntegrationSyncRunTrigger.WEBHOOK,
			externalId: 'variant-1'
		} as any)
		repo.markSyncRunRunning.mockResolvedValue({
			...syncRunRecord,
			mode: IntegrationSyncRunMode.PRODUCT,
			trigger: IntegrationSyncRunTrigger.WEBHOOK,
			status: IntegrationSyncRunStatus.RUNNING,
			jobId: 'product-webhook-job-1',
			externalId: 'variant-1',
			startedAt: new Date('2026-03-23T12:10:05.000Z')
		} as any)
		repo.patchMoySkladProductChangeWebhookMetadata.mockResolvedValue(
			integrationRecord as any
		)
		sync.syncExternalProduct.mockResolvedValue({
			ok: true,
			productId: 'product-1',
			externalId: 'variant-1',
			created: false,
			updated: true,
			productUpdated: false,
			imagesImported: 0,
			totalVariants: 1,
			createdVariants: 0,
			updatedVariants: 1,
			deletedVariants: 0,
			skippedVariants: 0,
			warnings: [],
			errors: [],
			durationMs: 120
		})

		await workerProcessor?.({
			id: 'product-webhook-job-1',
			data: {
				catalogId: 'catalog-1',
				webhookIntegrationId: 'integration-1',
				webhookEntityType: 'variant',
				webhookExternalId: 'variant-1',
				webhookAction: 'UPDATE',
				mode: IntegrationSyncRunMode.PRODUCT,
				trigger: IntegrationSyncRunTrigger.WEBHOOK
			}
		})

		expect(repo.createSyncRun).toHaveBeenCalledWith(
			expect.objectContaining({
				integrationId: 'integration-1',
				catalogId: 'catalog-1',
				mode: IntegrationSyncRunMode.PRODUCT,
				trigger: IntegrationSyncRunTrigger.WEBHOOK,
				jobId: 'product-webhook-job-1',
				externalId: 'variant-1'
			})
		)
		expect(sync.syncExternalProduct).toHaveBeenCalledWith('catalog-1', {
			entityType: 'variant',
			externalId: 'variant-1',
			runId: 'run-1'
		})
		expect(repo.completeSyncRun).toHaveBeenCalledWith(
			'run-1',
			expect.objectContaining({
				externalId: 'variant-1',
				totalProducts: 2,
				createdProducts: 0,
				updatedProducts: 1,
				deletedProducts: 0,
				snapshotCompleteness: 'WEBHOOK_DELTA',
				metadata: expect.objectContaining({
					webhook: {
						entityType: 'variant',
						externalId: 'variant-1'
					}
				})
			})
		)
		expect(repo.patchMoySkladProductChangeWebhookMetadata).toHaveBeenCalledWith(
			'integration-1',
			expect.objectContaining({
				lastProcessedAt: expect.any(String),
				lastError: null
			})
		)
		expect(observability.incrementQueueJobActive).toHaveBeenCalledWith(
			'moysklad-sync',
			'product-webhook'
		)
		expect(observability.recordQueueJob).toHaveBeenCalledWith(
			'moysklad-sync',
			'product-webhook',
			'success',
			expect.any(Number)
		)
	})

	it('processes MoySklad productfolder webhook sync run', async () => {
		repo.findMoySkladById.mockResolvedValue(integrationRecord as any)
		repo.createSyncRun.mockResolvedValue({
			...syncRunRecord,
			mode: IntegrationSyncRunMode.PRODUCT,
			trigger: IntegrationSyncRunTrigger.WEBHOOK,
			externalId: 'folder-1'
		} as any)
		repo.markSyncRunRunning.mockResolvedValue({
			...syncRunRecord,
			mode: IntegrationSyncRunMode.PRODUCT,
			trigger: IntegrationSyncRunTrigger.WEBHOOK,
			status: IntegrationSyncRunStatus.RUNNING,
			jobId: 'folder-webhook-job-1',
			externalId: 'folder-1',
			startedAt: new Date('2026-03-23T12:10:05.000Z')
		} as any)
		repo.patchMoySkladProductFolderWebhookMetadata.mockResolvedValue(
			integrationRecord as any
		)
		sync.syncProductFolder.mockResolvedValue({
			ok: true,
			externalId: 'folder-1',
			action: 'DELETE',
			categoryId: 'category-1',
			updated: false,
			deleted: 2,
			durationMs: 90
		})

		await workerProcessor?.({
			id: 'folder-webhook-job-1',
			data: {
				catalogId: 'catalog-1',
				webhookIntegrationId: 'integration-1',
				webhookEntityType: 'productfolder',
				webhookExternalId: 'folder-1',
				webhookAction: 'DELETE',
				mode: IntegrationSyncRunMode.PRODUCT,
				trigger: IntegrationSyncRunTrigger.WEBHOOK
			}
		})

		expect(repo.createSyncRun).toHaveBeenCalledWith(
			expect.objectContaining({
				integrationId: 'integration-1',
				catalogId: 'catalog-1',
				mode: IntegrationSyncRunMode.PRODUCT,
				trigger: IntegrationSyncRunTrigger.WEBHOOK,
				jobId: 'folder-webhook-job-1',
				externalId: 'folder-1'
			})
		)
		expect(sync.syncProductFolder).toHaveBeenCalledWith('catalog-1', {
			externalId: 'folder-1',
			action: 'DELETE',
			runId: 'run-1'
		})
		expect(repo.completeSyncRun).toHaveBeenCalledWith(
			'run-1',
			expect.objectContaining({
				externalId: 'folder-1',
				totalProducts: 0,
				createdProducts: 0,
				updatedProducts: 0,
				deletedProducts: 2,
				snapshotCompleteness: 'WEBHOOK_DELTA',
				metadata: expect.objectContaining({
					categories: {
						total: 1,
						updated: 0,
						deleted: 2
					},
					webhook: {
						entityType: 'productfolder',
						externalId: 'folder-1',
						action: 'DELETE'
					}
				})
			})
		)
		expect(repo.patchMoySkladProductFolderWebhookMetadata).toHaveBeenCalledWith(
			'integration-1',
			expect.objectContaining({
				lastProcessedAt: expect.any(String),
				lastError: null
			})
		)
		expect(observability.incrementQueueJobActive).toHaveBeenCalledWith(
			'moysklad-sync',
			'productfolder-webhook'
		)
		expect(observability.recordQueueJob).toHaveBeenCalledWith(
			'moysklad-sync',
			'productfolder-webhook',
			'success',
			expect.any(Number)
		)
	})

	it('processes stock sync run', async () => {
		repo.markSyncRunRunning.mockResolvedValue({
			...syncRunRecord,
			mode: IntegrationSyncRunMode.STOCK,
			status: IntegrationSyncRunStatus.RUNNING,
			jobId: 'job-stock',
			startedAt: new Date('2026-03-23T12:10:05.000Z')
		} as any)
		sync.syncStock.mockResolvedValue({
			ok: true,
			total: 4,
			updated: 3,
			updatedProducts: 1,
			updatedVariants: 2,
			skipped: 1,
			durationMs: 180,
			syncedAt: new Date('2026-03-23T12:15:00.000Z')
		})

		await workerProcessor?.({
			id: 'job-stock',
			data: {
				runId: 'run-1',
				catalogId: 'catalog-1',
				mode: IntegrationSyncRunMode.STOCK,
				trigger: IntegrationSyncRunTrigger.MANUAL
			}
		})

		expect(sync.syncStock).toHaveBeenCalledWith('catalog-1', { runId: 'run-1' })
		expect(repo.completeSyncRun).toHaveBeenCalledWith(
			'run-1',
			expect.objectContaining({
				totalProducts: 4,
				createdProducts: 0,
				updatedProducts: 3,
				deletedProducts: 0,
				imagesImported: 0,
				durationMs: 180,
				metadata: expect.objectContaining({
					stockRows: expect.objectContaining({
						lastStockSyncedAt: '2026-03-23T12:15:00.000Z'
					})
				})
			})
		)
		expect(observability.incrementQueueJobActive).toHaveBeenCalledWith(
			'moysklad-sync',
			'stock-sync'
		)
		expect(observability.recordQueueJob).toHaveBeenCalledWith(
			'moysklad-sync',
			'stock-sync',
			'success',
			expect.any(Number)
		)
		expect(observability.recordIntegrationSyncRun).toHaveBeenCalledWith(
			'MOYSKLAD',
			IntegrationSyncRunMode.STOCK,
			IntegrationSyncRunTrigger.MANUAL,
			'success',
			180
		)
		expect(observability.recordIntegrationSyncItems).toHaveBeenCalledWith(
			'MOYSKLAD',
			IntegrationSyncRunMode.STOCK,
			'stock_row',
			'applied',
			3
		)
		expect(observability.recordIntegrationSyncItems).toHaveBeenCalledWith(
			'MOYSKLAD',
			IntegrationSyncRunMode.STOCK,
			'variant',
			'updated',
			2
		)
		expect(observability.recordIntegrationStockFreshness).toHaveBeenCalledWith(
			'MOYSKLAD',
			'catalog-1',
			new Date('2026-03-23T12:15:00.000Z')
		)
	})
})

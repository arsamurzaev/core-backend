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

import { ObservabilityService } from '@/modules/observability/observability.service'

import { IntegrationRepository } from '../../integration.repository'

import {
	buildMoySkladMetadata,
	MoySkladMetadataCryptoService
} from './moysklad.metadata'
import { MoySkladQueueService } from './moysklad.queue.service'
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
						findAllMoySklad: jest.fn().mockResolvedValue([]),
						findLatestActiveSyncRun: jest.fn(),
						createSyncRun: jest.fn(),
						attachSyncRunJobId: jest.fn(),
						markSyncRunRunning: jest.fn(),
						completeSyncRun: jest.fn(),
						failSyncRun: jest.fn(),
						skipSyncRun: jest.fn()
					}
				},
				{
					provide: MoySkladSyncService,
					useValue: {
						syncCatalog: jest.fn(),
						syncProduct: jest.fn()
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
						recordQueueJob: jest.fn()
					}
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
				jobId: 'moysklad:manual:run-1'
			})
		)
		expect(repo.attachSyncRunJobId).toHaveBeenCalledWith('run-1', 'job-1')
		expect(observability.recordQueueJobEnqueued).toHaveBeenCalledWith(
			'moysklad-sync',
			'catalog-sync'
		)
		expect(result.jobId).toBe('job-1')
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
			created: 1,
			updated: 1,
			deleted: 0,
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
		expect(sync.syncCatalog).toHaveBeenCalledWith('catalog-1')
		expect(repo.completeSyncRun).toHaveBeenCalledWith(
			'run-1',
			expect.objectContaining({
				totalProducts: 2,
				createdProducts: 1,
				updatedProducts: 1,
				deletedProducts: 0,
				imagesImported: 0,
				durationMs: 250
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
		expect(observability.decrementQueueJobActive).toHaveBeenCalledWith(
			'moysklad-sync',
			'catalog-sync'
		)
	})
})

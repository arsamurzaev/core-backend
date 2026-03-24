import {
	IntegrationProvider,
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger,
	IntegrationSyncStatus
} from '@generated/enums'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { RequestContext } from '@/shared/tenancy/request-context'

import { IntegrationRepository } from './integration.repository'
import { IntegrationService } from './integration.service'
import {
	buildMoySkladMetadata,
	MoySkladMetadataCryptoService
} from './providers/moysklad/moysklad.metadata'
import { MoySkladQueueService } from './providers/moysklad/moysklad.queue.service'
import { MoySkladSyncService } from './providers/moysklad/moysklad.sync.service'

function buildEncryptedMetadata(input: {
	token: string
	priceTypeName?: string
	importImages?: boolean
	syncStock?: boolean
	scheduleEnabled?: boolean
	schedulePattern?: string | null
	scheduleTimezone?: string
}) {
	const normalized = buildMoySkladMetadata(input)

	return {
		priceTypeName: normalized.priceTypeName,
		importImages: normalized.importImages,
		syncStock: normalized.syncStock,
		scheduleEnabled: normalized.scheduleEnabled,
		schedulePattern: normalized.schedulePattern,
		scheduleTimezone: normalized.scheduleTimezone,
		tokenEncrypted: {
			format: 'enc-v1' as const,
			alg: 'aes-256-gcm' as const,
			keyVersion: 'v1',
			iv: 'iv',
			tag: 'tag',
			ciphertext: 'cipher'
		}
	}
}

describe('IntegrationService', () => {
	let service: IntegrationService
	let repo: jest.Mocked<IntegrationRepository>
	let sync: jest.Mocked<MoySkladSyncService>
	let queue: jest.Mocked<MoySkladQueueService>
	let metadataCrypto: jest.Mocked<MoySkladMetadataCryptoService>

	const runWithCatalog = <T>(fn: () => Promise<T>) =>
		RequestContext.run(
			{
				requestId: 'req-1',
				host: 'example.test',
				catalogId: 'catalog-1'
			},
			fn
		)

	const decryptedMetadata = buildMoySkladMetadata({
		token: 'token-12345678',
		priceTypeName: 'Цена продажи',
		importImages: true,
		syncStock: true,
		scheduleEnabled: false,
		schedulePattern: null,
		scheduleTimezone: 'Europe/Moscow'
	})

	const integrationRecord = {
		id: 'integration-1',
		catalogId: 'catalog-1',
		provider: IntegrationProvider.MOYSKLAD,
		metadata: buildEncryptedMetadata({
			token: 'token-12345678',
			priceTypeName: 'Цена продажи',
			importImages: true,
			syncStock: true,
			scheduleEnabled: false,
			schedulePattern: null,
			scheduleTimezone: 'Europe/Moscow'
		}),
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
		status: IntegrationSyncRunStatus.RUNNING,
		jobId: 'job-1',
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
		startedAt: new Date('2026-03-23T12:10:05.000Z'),
		finishedAt: null,
		createdAt: new Date('2026-03-23T12:10:00.000Z'),
		updatedAt: new Date('2026-03-23T12:10:05.000Z')
	}

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				IntegrationService,
				{
					provide: IntegrationRepository,
					useValue: {
						findMoySklad: jest.fn(),
						findLatestActiveSyncRun: jest.fn(),
						findLatestFinishedSyncRun: jest.fn(),
						findRecentSyncRuns: jest.fn(),
						upsertMoySklad: jest.fn(),
						updateMoySklad: jest.fn(),
						softDeleteMoySklad: jest.fn(),
						failMoySkladSync: jest.fn()
					}
				},
				{
					provide: MoySkladSyncService,
					useValue: {
						testConnection: jest.fn()
					}
				},
				{
					provide: MoySkladQueueService,
					useValue: {
						syncSchedulerForIntegration: jest.fn(),
						removeScheduler: jest.fn(),
						enqueueCatalogSync: jest.fn(),
						enqueueProductSync: jest.fn()
					}
				},
				{
					provide: MoySkladMetadataCryptoService,
					useValue: {
						buildStoredMetadata: jest.fn((input: any) =>
							buildEncryptedMetadata(input)
						),
						parseStoredMetadata: jest.fn((metadata: any) =>
							buildMoySkladMetadata({
								token: 'token-12345678',
								priceTypeName:
									typeof metadata?.priceTypeName === 'string'
										? metadata.priceTypeName
										: decryptedMetadata.priceTypeName,
								importImages:
									typeof metadata?.importImages === 'boolean'
										? metadata.importImages
										: decryptedMetadata.importImages,
								syncStock:
									typeof metadata?.syncStock === 'boolean'
										? metadata.syncStock
										: decryptedMetadata.syncStock,
								scheduleEnabled:
									typeof metadata?.scheduleEnabled === 'boolean'
										? metadata.scheduleEnabled
										: decryptedMetadata.scheduleEnabled,
								schedulePattern:
									typeof metadata?.schedulePattern === 'string' ||
									metadata?.schedulePattern === null
										? metadata.schedulePattern
										: decryptedMetadata.schedulePattern,
								scheduleTimezone:
									typeof metadata?.scheduleTimezone === 'string'
										? metadata.scheduleTimezone
										: decryptedMetadata.scheduleTimezone
							})
						)
					}
				}
			]
		}).compile()

		service = module.get(IntegrationService)
		repo = module.get(IntegrationRepository)
		sync = module.get(MoySkladSyncService)
		queue = module.get(MoySkladQueueService)
		metadataCrypto = module.get(MoySkladMetadataCryptoService)
		queue.enqueueCatalogSync.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-queued',
			jobId: 'job-queued',
			mode: IntegrationSyncRunMode.FULL,
			trigger: IntegrationSyncRunTrigger.MANUAL
		} as any)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	it('returns configured false when integration is missing', async () => {
		repo.findMoySklad.mockResolvedValue(null)
		repo.findLatestActiveSyncRun.mockResolvedValue(null)
		repo.findLatestFinishedSyncRun.mockResolvedValue(null)

		const result = await runWithCatalog(() => service.getMoySkladStatus())

		expect(result).toEqual({
			configured: false,
			integration: null,
			activeRun: null,
			lastRun: null
		})
	})

	it('returns sync runs history', async () => {
		repo.findRecentSyncRuns.mockResolvedValue([syncRunRecord as any])

		const result = await runWithCatalog(() => service.getMoySkladRuns(5))

		expect(repo.findRecentSyncRuns).toHaveBeenCalledWith('catalog-1', 5)
		expect(result).toHaveLength(1)
		expect(result[0]?.id).toBe('run-1')
	})

	it('upserts moysklad settings and syncs scheduler', async () => {
		repo.findMoySklad.mockResolvedValue(null)
		repo.upsertMoySklad.mockResolvedValue(integrationRecord as any)

		const result = await runWithCatalog(() =>
			service.upsertMoySklad({
				token: 'token-12345678',
				isActive: true,
				priceTypeName: 'Цена продажи',
				importImages: true,
				syncStock: true,
				scheduleEnabled: true,
				schedulePattern: '0 */6 * * *',
				scheduleTimezone: 'Europe/Moscow'
			})
		)

		expect(metadataCrypto.buildStoredMetadata).toHaveBeenCalledWith(
			expect.objectContaining({
				token: 'token-12345678',
				priceTypeName: 'Цена продажи',
				importImages: true,
				syncStock: true
			})
		)
		expect(repo.upsertMoySklad).toHaveBeenCalledWith(
			'catalog-1',
			expect.objectContaining({
				isActive: true,
				metadata: expect.objectContaining({
					tokenEncrypted: expect.any(Object),
					priceTypeName: 'Цена продажи'
				})
			})
		)
		expect(queue.syncSchedulerForIntegration).toHaveBeenCalledWith(
			integrationRecord
		)
		expect(queue.enqueueCatalogSync).toHaveBeenCalledWith('catalog-1')
		expect(result.provider).toBe(IntegrationProvider.MOYSKLAD)
		expect(result.hasToken).toBe(true)
	})

	it('does not queue initial sync when integration was already synced', async () => {
		const syncedIntegration = {
			...integrationRecord,
			lastSyncAt: new Date('2026-03-23T13:00:00.000Z')
		}
		repo.findMoySklad.mockResolvedValue(syncedIntegration as any)
		repo.upsertMoySklad.mockResolvedValue(syncedIntegration as any)

		await runWithCatalog(() =>
			service.upsertMoySklad({
				token: 'token-12345678',
				isActive: true,
				priceTypeName: 'Цена продажи',
				importImages: true,
				syncStock: true,
				scheduleEnabled: true,
				schedulePattern: '0 */6 * * *',
				scheduleTimezone: 'Europe/Moscow'
			})
		)

		expect(queue.enqueueCatalogSync).not.toHaveBeenCalled()
	})

	it('throws when update payload is empty', async () => {
		await expect(
			runWithCatalog(() => service.updateMoySklad({}))
		).rejects.toBeInstanceOf(BadRequestException)
	})

	it('merges stored metadata during update', async () => {
		repo.findMoySklad.mockResolvedValue(integrationRecord as any)
		repo.updateMoySklad.mockResolvedValue({
			...integrationRecord,
			isActive: false,
			metadata: buildEncryptedMetadata({
				token: 'token-12345678',
				priceTypeName: 'Опт',
				importImages: false,
				syncStock: true,
				scheduleEnabled: true,
				schedulePattern: '0 */12 * * *',
				scheduleTimezone: 'Europe/Moscow'
			})
		} as any)

		const result = await runWithCatalog(() =>
			service.updateMoySklad({
				isActive: false,
				priceTypeName: 'Опт',
				importImages: false,
				scheduleEnabled: true,
				schedulePattern: '0 */12 * * *'
			})
		)

		expect(metadataCrypto.parseStoredMetadata).toHaveBeenCalledWith(
			integrationRecord.metadata
		)
		expect(metadataCrypto.buildStoredMetadata).toHaveBeenCalledWith(
			expect.objectContaining({
				token: 'token-12345678',
				priceTypeName: 'Опт',
				importImages: false,
				syncStock: true
			})
		)
		expect(repo.updateMoySklad).toHaveBeenCalledWith(
			'catalog-1',
			expect.objectContaining({
				isActive: false,
				metadata: expect.objectContaining({
					tokenEncrypted: expect.any(Object),
					priceTypeName: 'Опт'
				})
			})
		)
		expect(queue.syncSchedulerForIntegration).toHaveBeenCalled()
		expect(result.isActive).toBe(false)
		expect(result.priceTypeName).toBe('Опт')
	})

	it('removes integration and scheduler', async () => {
		repo.findMoySklad.mockResolvedValue(integrationRecord as any)
		repo.softDeleteMoySklad.mockResolvedValue(integrationRecord as any)

		const result = await runWithCatalog(() => service.removeMoySklad())

		expect(queue.removeScheduler).toHaveBeenCalledWith('catalog-1')
		expect(result).toEqual({ ok: true })
	})

	it('throws when removing a missing integration', async () => {
		repo.findMoySklad.mockResolvedValue(null)

		await expect(
			runWithCatalog(() => service.removeMoySklad())
		).rejects.toBeInstanceOf(NotFoundException)
	})

	it('delegates test connection to sync service', async () => {
		sync.testConnection.mockResolvedValue({ ok: true })

		const result = await runWithCatalog(() =>
			service.testMoySkladConnection({ token: 'token-12345678' })
		)

		expect(sync.testConnection).toHaveBeenCalledWith('token-12345678')
		expect(result).toEqual({ ok: true })
	})

	it('queues full catalog sync', async () => {
		queue.enqueueCatalogSync.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-2',
			jobId: 'job-2',
			mode: IntegrationSyncRunMode.FULL,
			trigger: IntegrationSyncRunTrigger.MANUAL
		})

		const result = await runWithCatalog(() => service.syncMoySkladCatalog())

		expect(queue.enqueueCatalogSync).toHaveBeenCalledWith('catalog-1')
		expect(result.runId).toBe('run-2')
	})

	it('queues product sync', async () => {
		queue.enqueueProductSync.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-3',
			jobId: 'job-3',
			mode: IntegrationSyncRunMode.PRODUCT,
			trigger: IntegrationSyncRunTrigger.MANUAL
		})

		const result = await runWithCatalog(() =>
			service.syncMoySkladProduct('product-1')
		)

		expect(queue.enqueueProductSync).toHaveBeenCalledWith(
			'catalog-1',
			'product-1'
		)
		expect(result.mode).toBe(IntegrationSyncRunMode.PRODUCT)
	})
})

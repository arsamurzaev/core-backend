import {
	DataType,
	IntegrationProvider,
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger,
	IntegrationSyncStatus
} from '@generated/enums'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'
import { createHash } from 'crypto'

import { AuditService } from '@/modules/audit/audit.service'
import { AUDIT_RECORDER_PORT } from '@/modules/audit/contracts'
import { CapabilityService } from '@/modules/capability/capability.service'
import {
	CAPABILITY_ASSERT_PORT,
	CAPABILITY_READER_PORT
} from '@/modules/capability/contracts'
import {
	PRODUCT_EXTERNAL_SYNC_PORT,
	type ProductExternalSyncPort
} from '@/modules/product/public'
import { RequestContext } from '@/shared/tenancy/request-context'

import { IntegrationRepository } from './integration.repository'
import { IntegrationService } from './integration.service'
import { IikoClient } from './providers/iiko/iiko.client'
import { IikoMetadataCryptoService } from './providers/iiko/iiko.metadata'
import { IikoOrderExportQueueService } from './providers/iiko/iiko.order-export.queue.service'
import { IikoQueueService } from './providers/iiko/iiko.queue.service'
import { IikoSyncService } from './providers/iiko/iiko.sync.service'
import { buildIikoWebhookSettingsFilter } from './providers/iiko/iiko.webhooks'
import { MoySkladClient } from './providers/moysklad/moysklad.client'
import {
	buildMoySkladMetadata,
	MoySkladMetadataCryptoService
} from './providers/moysklad/moysklad.metadata'
import { MoySkladOrderExportQueueService } from './providers/moysklad/moysklad.order-export.queue.service'
import { MoySkladQueueService } from './providers/moysklad/moysklad.queue.service'
import { MoySkladSyncService } from './providers/moysklad/moysklad.sync.service'

function buildEncryptedMetadata(input: {
	token: string
	priceTypeName?: string
	importImages?: boolean
	syncStock?: boolean
	exportOrders?: boolean
	orderExportOrganizationId?: string | null
	orderExportCounterpartyId?: string | null
	orderExportStoreId?: string | null
	scheduleEnabled?: boolean
	schedulePattern?: string | null
	scheduleTimezone?: string
	lastStockSyncedAt?: string | null
	stockWebhookEnabled?: boolean
	stockWebhook?: any
	productDeleteWebhook?: any
	productChangeWebhook?: any
	productFolderWebhook?: any
	fieldOwnership?: any
}) {
	const normalized = buildMoySkladMetadata(input)

	return {
		priceTypeName: normalized.priceTypeName,
		importImages: normalized.importImages,
		syncStock: normalized.syncStock,
		exportOrders: normalized.exportOrders,
		orderExportOrganizationId: normalized.orderExportOrganizationId,
		orderExportCounterpartyId: normalized.orderExportCounterpartyId,
		orderExportStoreId: normalized.orderExportStoreId,
		scheduleEnabled: normalized.scheduleEnabled,
		schedulePattern: normalized.schedulePattern,
		scheduleTimezone: normalized.scheduleTimezone,
		lastStockSyncedAt: normalized.lastStockSyncedAt,
		fieldOwnership: normalized.fieldOwnership,
		stockWebhookEnabled: normalized.stockWebhookEnabled,
		stockWebhook: normalized.stockWebhook,
		productDeleteWebhook: normalized.productDeleteWebhook,
		productChangeWebhook: normalized.productChangeWebhook,
		productFolderWebhook: normalized.productFolderWebhook,
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

function hashWebhookSecret(secret: string): string {
	return createHash('sha256').update(secret).digest('hex')
}

function hashIikoWebhookSettingsFilter(): string {
	return createHash('sha256')
		.update(JSON.stringify(buildIikoWebhookSettingsFilter()))
		.digest('hex')
}

describe('IntegrationService', () => {
	let service: IntegrationService
	let repo: jest.Mocked<IntegrationRepository>
	let sync: jest.Mocked<MoySkladSyncService>
	let queue: jest.Mocked<MoySkladQueueService>
	let orderExportQueue: jest.Mocked<MoySkladOrderExportQueueService>
	let metadataCrypto: jest.Mocked<MoySkladMetadataCryptoService>
	let iikoSync: jest.Mocked<IikoSyncService>
	let iikoQueue: jest.Mocked<IikoQueueService>
	let iikoOrderExportQueue: jest.Mocked<IikoOrderExportQueueService>
	let iikoMetadataCrypto: jest.Mocked<IikoMetadataCryptoService>
	let audit: jest.Mocked<AuditService>
	let products: jest.Mocked<ProductExternalSyncPort>

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
		exportOrders: false,
		orderExportOrganizationId: null,
		orderExportCounterpartyId: null,
		orderExportStoreId: null,
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

	const orderExportRecord = {
		id: 'export-1',
		integrationId: 'integration-1',
		orderId: 'order-1',
		provider: IntegrationProvider.MOYSKLAD,
		idempotencyKey: 'MOYSKLAD:integration-1:order-1',
		externalId: null,
		status: 'ERROR',
		attempts: 2,
		lastError: 'MoySklad API error',
		payload: null,
		response: null,
		requestedAt: new Date('2026-03-23T12:20:00.000Z'),
		startedAt: new Date('2026-03-23T12:21:00.000Z'),
		exportedAt: null,
		createdAt: new Date('2026-03-23T12:20:00.000Z'),
		updatedAt: new Date('2026-03-23T12:21:00.000Z')
	}

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				IntegrationService,
				{
					provide: IntegrationRepository,
					useValue: {
						findMoySklad: jest.fn(),
						findIiko: jest.fn(),
						findLatestActiveSyncRun: jest.fn(),
						findLatestFinishedSyncRun: jest.fn(),
						findSyncRunById: jest.fn(),
						findRecentSyncRuns: jest.fn(),
						findOrderExportsByCatalog: jest.fn(),
						findMoySkladMappingPreviewAttributes: jest.fn(),
						findMoySkladVariantAttributeById: jest.fn(),
						upsertMoySkladVariantAttributeForMapping: jest.fn(),
						upsertMoySkladImportedEnumValue: jest.fn(),
						upsertMoySkladEnumValueAlias: jest.fn(),
						upsertMoySkladAttributeMappings: jest.fn(),
						upsertMoySklad: jest.fn(),
						upsertIiko: jest.fn(),
						updateMoySklad: jest.fn(),
						updateIiko: jest.fn(),
						findMoySkladById: jest.fn(),
						findIikoById: jest.fn(),
						updateMoySkladMetadataById: jest.fn(),
						updateIikoMetadataById: jest.fn(),
						patchMoySkladStockWebhookMetadata: jest.fn(),
						patchMoySkladProductDeleteWebhookMetadata: jest.fn(),
						patchMoySkladProductChangeWebhookMetadata: jest.fn(),
						patchMoySkladProductFolderWebhookMetadata: jest.fn(),
						findProductLinksByIntegration: jest.fn(),
						softDeleteIntegratedVariantByExternalId: jest.fn(),
						recomputeProductStatusFromVariants: jest.fn(),
						createWebhookEventIfNew: jest.fn(),
						markWebhookEventsProcessing: jest.fn(),
						markWebhookEventProcessed: jest.fn(),
						markWebhookEventFailed: jest.fn(),
						markWebhookEventsSkipped: jest.fn(),
						findOrderExportByOrderId: jest.fn(),
						findOrderExportByExternalId: jest.fn(),
						markOrderExportSuccess: jest.fn(),
						markOrderExportError: jest.fn(),
						softDeleteMoySklad: jest.fn(),
						softDeleteIiko: jest.fn(),
						failMoySkladSync: jest.fn()
					}
				},
				{
					provide: MoySkladSyncService,
					useValue: {
						testConnection: jest.fn(),
						syncCatalog: jest.fn()
					}
				},
				{
					provide: MoySkladQueueService,
					useValue: {
						syncSchedulerForIntegration: jest.fn(),
						removeScheduler: jest.fn(),
						enqueueCatalogSync: jest.fn(),
						enqueueProductSync: jest.fn(),
						enqueueStockSync: jest.fn(),
						enqueueStockWebhookDrain: jest.fn(),
						enqueueProductWebhookSync: jest.fn(),
						enqueueProductFolderWebhookSync: jest.fn()
					}
				},
				{
					provide: MoySkladOrderExportQueueService,
					useValue: {
						retryOrderExport: jest.fn()
					}
				},
				{
					provide: PRODUCT_EXTERNAL_SYNC_PORT,
					useValue: {
						softDeleteExternalProduct: jest.fn(),
						recomputeProductCommercialState: jest.fn()
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
								exportOrders:
									typeof metadata?.exportOrders === 'boolean'
										? metadata.exportOrders
										: decryptedMetadata.exportOrders,
								orderExportOrganizationId:
									typeof metadata?.orderExportOrganizationId === 'string' ||
									metadata?.orderExportOrganizationId === null
										? metadata.orderExportOrganizationId
										: decryptedMetadata.orderExportOrganizationId,
								orderExportCounterpartyId:
									typeof metadata?.orderExportCounterpartyId === 'string' ||
									metadata?.orderExportCounterpartyId === null
										? metadata.orderExportCounterpartyId
										: decryptedMetadata.orderExportCounterpartyId,
								orderExportStoreId:
									typeof metadata?.orderExportStoreId === 'string' ||
									metadata?.orderExportStoreId === null
										? metadata.orderExportStoreId
										: decryptedMetadata.orderExportStoreId,
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
										: decryptedMetadata.scheduleTimezone,
								lastStockSyncedAt:
									typeof metadata?.lastStockSyncedAt === 'string' ||
									metadata?.lastStockSyncedAt === null
										? metadata.lastStockSyncedAt
										: decryptedMetadata.lastStockSyncedAt,
								stockWebhookEnabled:
									typeof metadata?.stockWebhookEnabled === 'boolean'
										? metadata.stockWebhookEnabled
										: decryptedMetadata.stockWebhookEnabled,
								stockWebhook:
									metadata?.stockWebhook && typeof metadata.stockWebhook === 'object'
										? metadata.stockWebhook
										: decryptedMetadata.stockWebhook,
								productDeleteWebhook:
									metadata?.productDeleteWebhook &&
									typeof metadata.productDeleteWebhook === 'object'
										? metadata.productDeleteWebhook
										: decryptedMetadata.productDeleteWebhook,
								productChangeWebhook:
									metadata?.productChangeWebhook &&
									typeof metadata.productChangeWebhook === 'object'
										? metadata.productChangeWebhook
										: decryptedMetadata.productChangeWebhook,
								productFolderWebhook:
									metadata?.productFolderWebhook &&
									typeof metadata.productFolderWebhook === 'object'
										? metadata.productFolderWebhook
										: decryptedMetadata.productFolderWebhook,
								fieldOwnership:
									metadata?.fieldOwnership && typeof metadata.fieldOwnership === 'object'
										? metadata.fieldOwnership
										: decryptedMetadata.fieldOwnership
							})
						)
					}
				},
				{
					provide: IikoSyncService,
					useValue: {
						testConnection: jest.fn(),
						previewExternalMenu: jest.fn(),
						syncCatalog: jest.fn()
					}
				},
				{
					provide: IikoQueueService,
					useValue: {
						enqueueCatalogSync: jest.fn(),
						enqueueCatalogWebhookSync: jest.fn(),
						enqueueProductSync: jest.fn(),
						enqueueStockSync: jest.fn(),
						enqueueStockWebhookSync: jest.fn()
					}
				},
				{
					provide: IikoOrderExportQueueService,
					useValue: {
						retryOrderExport: jest.fn()
					}
				},
				{
					provide: IikoMetadataCryptoService,
					useValue: {
						buildStoredMetadata: jest.fn((input: any) => input),
						parseStoredMetadata: jest.fn((metadata: any) => ({
							apiLogin: metadata?.apiLogin ?? 'iiko-login',
							organizationId: metadata?.organizationId ?? 'organization-1',
							organizationName: metadata?.organizationName ?? null,
							externalMenuId: metadata?.externalMenuId ?? null,
							externalMenuName: metadata?.externalMenuName ?? null,
							priceCategoryId: metadata?.priceCategoryId ?? null,
							priceCategoryName: metadata?.priceCategoryName ?? null,
							terminalGroupId: metadata?.terminalGroupId ?? null,
							terminalGroupName: metadata?.terminalGroupName ?? null,
							menuVersion: metadata?.menuVersion ?? 4,
							syncSource: metadata?.syncSource ?? 'external_menu',
							importImages: metadata?.importImages ?? true,
							exportOrders: metadata?.exportOrders ?? false,
							orderExportServiceType: metadata?.orderExportServiceType ?? null,
							orderExportSourceKey: metadata?.orderExportSourceKey ?? null,
							lastRevision: metadata?.lastRevision ?? null,
							lastMenuSyncedAt: metadata?.lastMenuSyncedAt ?? null,
							lastStopListSyncedAt: metadata?.lastStopListSyncedAt ?? null,
							webhook: metadata?.webhook ?? {
								enabled: false,
								urlPreview: null,
								secretHash: null,
								lastConfiguredAt: null,
								lastReceivedAt: null,
								lastEventType: null,
								lastError: null
							}
						}))
					}
				},
				{
					provide: ConfigService,
					useValue: {
						get: jest.fn((key: string) => {
							if (key === 'integration') {
								return {
									moySkladWebhookBaseUrl: 'https://api.example.test',
									iikoWebhookBaseUrl: 'https://api.example.test',
									iikoApiBaseUrl: 'https://iiko.example'
								}
							}
							return undefined
						})
					}
				},
				{
					provide: AuditService,
					useValue: {
						record: jest.fn()
					}
				},
				{
					provide: AUDIT_RECORDER_PORT,
					useExisting: AuditService
				},
				{
					provide: CapabilityService,
					useValue: {
						assertCanUseMoySkladIntegration: jest.fn().mockResolvedValue(undefined),
						assertCanUseIikoIntegration: jest.fn().mockResolvedValue(undefined),
						assertCanUseProductTypes: jest.fn().mockResolvedValue(undefined),
						assertCanUseProductVariants: jest.fn().mockResolvedValue(undefined),
						canUseMoySkladIntegration: jest.fn().mockResolvedValue(true),
						canUseIikoIntegration: jest.fn().mockResolvedValue(true)
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

		service = module.get(IntegrationService)
		repo = module.get(IntegrationRepository)
		sync = module.get(MoySkladSyncService)
		queue = module.get(MoySkladQueueService)
		orderExportQueue = module.get(MoySkladOrderExportQueueService)
		metadataCrypto = module.get(MoySkladMetadataCryptoService)
		iikoSync = module.get(IikoSyncService)
		iikoQueue = module.get(IikoQueueService)
		iikoOrderExportQueue = module.get(IikoOrderExportQueueService)
		iikoMetadataCrypto = module.get(IikoMetadataCryptoService)
		audit = module.get(AuditService)
		products = module.get(PRODUCT_EXTERNAL_SYNC_PORT)
		jest.spyOn(MoySkladClient.prototype, 'createWebhook').mockResolvedValue({
			id: 'product-delete-webhook-1',
			accountId: 'account-1',
			enabled: true,
			action: 'DELETE',
			entityType: 'product',
			url: 'https://api.example.test/integration/webhooks/moysklad/product-delete/integration-1/secret'
		})
		jest.spyOn(MoySkladClient.prototype, 'updateWebhook').mockResolvedValue({
			id: 'product-delete-webhook-1',
			accountId: 'account-1',
			enabled: true,
			action: 'DELETE',
			entityType: 'product',
			url: 'https://api.example.test/integration/webhooks/moysklad/product-delete/integration-1/secret'
		})
		jest.spyOn(MoySkladClient.prototype, 'disableWebhook').mockResolvedValue({
			id: 'product-delete-webhook-1',
			accountId: 'account-1',
			enabled: false,
			action: 'DELETE',
			entityType: 'product',
			url: 'https://api.example.test/integration/webhooks/moysklad/product-delete/integration-1/secret'
		})
		jest.spyOn(MoySkladClient.prototype, 'deleteWebhook').mockResolvedValue()
		queue.enqueueCatalogSync.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-queued',
			jobId: 'job-queued',
			mode: IntegrationSyncRunMode.FULL,
			trigger: IntegrationSyncRunTrigger.MANUAL
		} as any)
	})

	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	it('returns iiko configured false when integration is missing', async () => {
		repo.findIiko.mockResolvedValue(null)
		repo.findLatestActiveSyncRun.mockResolvedValue(null)
		repo.findLatestFinishedSyncRun.mockResolvedValue(null)

		const result = await runWithCatalog(() => service.getIikoStatus())

		expect(result).toEqual({
			configured: false,
			integration: null,
			activeRun: null,
			lastRun: null
		})
		expect(repo.findLatestActiveSyncRun).toHaveBeenCalledWith(
			'catalog-1',
			IntegrationProvider.IIKO
		)
	})

	it('upserts iiko integration with encrypted apiLogin metadata', async () => {
		const iikoRecord = {
			...integrationRecord,
			provider: IntegrationProvider.IIKO,
			metadata: {
				apiLogin: 'iiko-login',
				organizationId: 'organization-1',
				organizationName: 'Demo',
				externalMenuId: '81651',
				externalMenuName: 'Main menu',
				priceCategoryId: 'price-1',
				priceCategoryName: 'Base',
				menuVersion: 4,
				importImages: true
			}
		}
		repo.findIiko.mockResolvedValue(null)
		repo.upsertIiko.mockResolvedValue(iikoRecord as any)

		const result = await runWithCatalog(() =>
			service.upsertIiko({
				apiLogin: 'iiko-login',
				organizationId: 'organization-1',
				organizationName: 'Demo',
				externalMenuId: '81651',
				externalMenuName: 'Main menu',
				priceCategoryId: 'price-1',
				priceCategoryName: 'Base',
				importImages: true
			})
		)

		expect(iikoMetadataCrypto.buildStoredMetadata).toHaveBeenCalledWith(
			expect.objectContaining({
				apiLogin: 'iiko-login',
				organizationId: 'organization-1',
				organizationName: 'Demo',
				externalMenuId: '81651',
				externalMenuName: 'Main menu',
				priceCategoryId: 'price-1',
				priceCategoryName: 'Base',
				importImages: true
			})
		)
		expect(repo.upsertIiko).toHaveBeenCalledWith(
			'catalog-1',
			expect.objectContaining({
				isActive: true
			})
		)
		expect(result.provider).toBe(IntegrationProvider.IIKO)
		expect(result.organizationId).toBe('organization-1')
	})

	it('preserves iiko webhook metadata when saving unchanged api login and organization', async () => {
		const webhook = {
			enabled: true,
			urlPreview:
				'https://api.example.test/integration/webhooks/iiko/integration-1/***',
			secretHash: 'secret-hash',
			lastConfiguredAt: '2026-05-28T09:00:00.000Z',
			lastReceivedAt: null,
			lastEventType: null,
			lastError: null
		}
		repo.findIiko.mockResolvedValue({
			...integrationRecord,
			provider: IntegrationProvider.IIKO,
			metadata: {
				apiLogin: 'iiko-login',
				organizationId: 'organization-1',
				terminalGroupId: 'terminal-1',
				webhook
			}
		} as any)
		repo.updateIiko.mockImplementation(
			async (_catalogId, params) =>
				({
					...integrationRecord,
					provider: IntegrationProvider.IIKO,
					metadata: params.metadata,
					isActive: params.isActive ?? true
				}) as any
		)

		const result = await runWithCatalog(() =>
			service.updateIiko({
				organizationId: 'organization-1',
				terminalGroupId: 'terminal-2',
				terminalGroupName: 'Main terminal'
			})
		)

		expect(iikoMetadataCrypto.buildStoredMetadata).toHaveBeenCalledWith(
			expect.objectContaining({
				apiLogin: 'iiko-login',
				organizationId: 'organization-1',
				terminalGroupId: 'terminal-2',
				webhook
			})
		)
		expect(result.webhook).toEqual(
			expect.objectContaining({
				enabled: true,
				hasSecret: true,
				urlPreview:
					'https://api.example.test/integration/webhooks/iiko/integration-1/***'
			})
		)
	})

	it('clears iiko webhook metadata when organization changes', async () => {
		repo.findIiko.mockResolvedValue({
			...integrationRecord,
			provider: IntegrationProvider.IIKO,
			metadata: {
				apiLogin: 'iiko-login',
				organizationId: 'organization-1',
				webhook: {
					enabled: true,
					urlPreview:
						'https://api.example.test/integration/webhooks/iiko/integration-1/***',
					secretHash: 'secret-hash',
					lastConfiguredAt: '2026-05-28T09:00:00.000Z',
					lastReceivedAt: null,
					lastEventType: null,
					lastError: null
				}
			}
		} as any)
		repo.updateIiko.mockImplementation(
			async (_catalogId, params) =>
				({
					...integrationRecord,
					provider: IntegrationProvider.IIKO,
					metadata: params.metadata,
					isActive: params.isActive ?? true
				}) as any
		)

		const result = await runWithCatalog(() =>
			service.updateIiko({
				organizationId: 'organization-2',
				organizationName: 'Other'
			})
		)

		expect(iikoMetadataCrypto.buildStoredMetadata).toHaveBeenCalledWith(
			expect.objectContaining({
				apiLogin: 'iiko-login',
				organizationId: 'organization-2',
				webhook: null
			})
		)
		expect(result.webhook.enabled).toBe(false)
		expect(result.webhook.hasSecret).toBe(false)
	})

	it('tests iiko connection through sync service', async () => {
		iikoSync.testConnection.mockResolvedValue({
			ok: true,
			organizations: [{ id: 'org-1', name: 'Demo', isActive: true }],
			externalMenus: [{ id: '81651', name: 'Main menu' }],
			priceCategories: [{ id: 'price-1', name: 'Base' }],
			terminalGroups: [
				{
					id: 'terminal-1',
					name: 'Main terminal',
					organizationId: 'org-1',
					isActive: true,
					isAlive: true
				}
			]
		})

		const result = await runWithCatalog(() =>
			service.testIikoConnection({ apiLogin: 'iiko-login' })
		)

		expect(iikoSync.testConnection).toHaveBeenCalledWith('iiko-login')
		expect(result.organizations).toHaveLength(1)
		expect(result.externalMenus).toHaveLength(1)
	})

	it('tests iiko connection with stored apiLogin when omitted', async () => {
		repo.findIiko.mockResolvedValue({
			...integrationRecord,
			provider: IntegrationProvider.IIKO,
			metadata: {
				apiLogin: 'stored-iiko-login',
				organizationId: 'organization-1'
			}
		} as any)
		iikoSync.testConnection.mockResolvedValue({
			ok: true,
			organizations: [{ id: 'org-1', name: 'Demo', isActive: true }],
			externalMenus: [{ id: '81651', name: 'Main menu' }],
			priceCategories: [{ id: 'price-1', name: 'Base' }],
			terminalGroups: [
				{
					id: 'terminal-1',
					name: 'Main terminal',
					organizationId: 'org-1',
					isActive: true,
					isAlive: true
				}
			]
		})

		const result = await runWithCatalog(() => service.testIikoConnection({}))

		expect(repo.findIiko).toHaveBeenCalledWith('catalog-1')
		expect(iikoMetadataCrypto.parseStoredMetadata).toHaveBeenCalledWith({
			apiLogin: 'stored-iiko-login',
			organizationId: 'organization-1'
		})
		expect(iikoSync.testConnection).toHaveBeenCalledWith('stored-iiko-login')
		expect(result.terminalGroups).toHaveLength(1)
	})

	it('previews iiko external menu import', async () => {
		repo.findIiko.mockResolvedValue({
			...integrationRecord,
			provider: IntegrationProvider.IIKO,
			metadata: {
				apiLogin: 'iiko-login',
				organizationId: 'organization-1',
				externalMenuId: '81651',
				priceCategoryId: 'price-1'
			}
		} as any)
		iikoSync.previewExternalMenu.mockResolvedValue({
			ok: true,
			source: 'external_menu',
			revision: 1,
			externalMenuId: '81651',
			externalMenuName: 'Main menu',
			stats: {
				categories: 1,
				items: 1,
				visibleItems: 1,
				hiddenItems: 0,
				itemsWithoutPrice: 0,
				itemsWithModifiers: 0,
				combos: 0,
				variants: 1
			},
			categories: [],
			items: []
		})

		const result = await runWithCatalog(() => service.previewIikoImport({}))

		expect(iikoSync.previewExternalMenu).toHaveBeenCalledWith(
			expect.objectContaining({
				apiLogin: 'iiko-login',
				organizationId: 'organization-1',
				externalMenuId: '81651',
				priceCategoryId: 'price-1'
			})
		)
		expect(result.stats.visibleItems).toBe(1)
	})

	it('queues iiko catalog sync', async () => {
		iikoQueue.enqueueCatalogSync.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-iiko',
			jobId: 'job-iiko',
			mode: IntegrationSyncRunMode.FULL,
			trigger: IntegrationSyncRunTrigger.MANUAL
		})

		const result = await runWithCatalog(() => service.syncIikoCatalog())

		expect(iikoQueue.enqueueCatalogSync).toHaveBeenCalledWith('catalog-1')
		expect(result.runId).toBe('run-iiko')
	})

	it('queues iiko stock sync', async () => {
		iikoQueue.enqueueStockSync.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-iiko-stock',
			jobId: 'job-iiko-stock',
			mode: IntegrationSyncRunMode.STOCK,
			trigger: IntegrationSyncRunTrigger.MANUAL
		})

		const result = await runWithCatalog(() => service.syncIikoStock())

		expect(iikoQueue.enqueueStockSync).toHaveBeenCalledWith('catalog-1')
		expect(result.mode).toBe(IntegrationSyncRunMode.STOCK)
	})

	it('queues iiko product sync', async () => {
		iikoQueue.enqueueProductSync.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-iiko-product',
			jobId: 'job-iiko-product',
			mode: IntegrationSyncRunMode.PRODUCT,
			trigger: IntegrationSyncRunTrigger.MANUAL
		})

		const result = await runWithCatalog(() =>
			service.syncIikoProduct('product-1')
		)

		expect(iikoQueue.enqueueProductSync).toHaveBeenCalledWith(
			'catalog-1',
			'product-1'
		)
		expect(result.mode).toBe(IntegrationSyncRunMode.PRODUCT)
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

	it('returns sync run progress from metadata', async () => {
		repo.findSyncRunById.mockResolvedValue({
			...syncRunRecord,
			metadata: {
				progress: {
					phase: 'SYNCING_PRODUCTS',
					message: 'Syncing products',
					processed: 2,
					total: 10,
					percent: 20,
					updatedAt: '2026-03-23T12:10:08.000Z'
				}
			}
		} as any)

		const result = await runWithCatalog(() =>
			service.getMoySkladRunProgress('run-1')
		)

		expect(repo.findSyncRunById).toHaveBeenCalledWith('run-1')
		expect(result).toEqual(
			expect.objectContaining({
				runId: 'run-1',
				status: IntegrationSyncRunStatus.RUNNING,
				phase: 'SYNCING_PRODUCTS',
				message: 'Syncing products',
				processed: 2,
				total: 10,
				percent: 20
			})
		)
	})

	it.each([
		[undefined, 20],
		[5, 5],
		['5', 5],
		[101, 100]
	])('normalizes sync history limit %p to %p', async (input, expected) => {
		repo.findRecentSyncRuns.mockResolvedValue([])

		await runWithCatalog(() => service.getMoySkladRuns(input))

		expect(repo.findRecentSyncRuns).toHaveBeenCalledWith('catalog-1', expected)
	})

	it.each([0, '0', 'abc', 1.5, '1.5'])(
		'rejects invalid sync history limit %p',
		async input => {
			await expect(
				runWithCatalog(() => service.getMoySkladRuns(input as any))
			).rejects.toBeInstanceOf(BadRequestException)

			expect(repo.findRecentSyncRuns).not.toHaveBeenCalled()
		}
	)

	it('returns sync run metadata counters and redacted item issues', async () => {
		repo.findRecentSyncRuns.mockResolvedValue([
			{
				...syncRunRecord,
				metadata: {
					products: {
						total: 3,
						created: 1,
						updated: 1,
						deleted: 0,
						skipped: 1
					},
					variants: {
						total: 2,
						created: 1,
						updated: 0,
						deleted: 0,
						skipped: 1
					},
					stockRows: {
						total: 5,
						applied: 4,
						skipped: 1,
						diagnostics: {
							source: 'WEBHOOK',
							stockRows: 5,
							matchedStockRows: 4,
							unmatchedStockRows: 1,
							productLinks: 2,
							variantLinks: 3,
							ignoredVariantLinks: 0,
							appliedProductLinks: 1,
							appliedVariantLinks: 3,
							skippedReasons: {
								missingStock: 0,
								productHasVariantLinks: 1,
								variantsCapabilityDisabled: 0,
								stockRowWithoutLocalLink: 1
							}
						}
					},
					warnings: [
						{
							code: 'MOYSKLAD_PRODUCT_FOLDER_MISSING',
							message: 'Skipped without folder',
							externalId: null,
							count: 1
						}
					],
					errors: [
						{
							code: 'MOYSKLAD_PRODUCT_SYNC_FAILED',
							message: 'Authorization: Bearer moysklad-secret-token',
							externalId: 'external-key-1'
						}
					]
				}
			} as any
		])

		const result = await runWithCatalog(() => service.getMoySkladRuns(5))

		expect(result[0]?.products).toEqual({
			total: 3,
			created: 1,
			updated: 1,
			deleted: 0,
			skipped: 1
		})
		expect(result[0]?.variants).toEqual({
			total: 2,
			created: 1,
			updated: 0,
			deleted: 0,
			skipped: 1
		})
		expect(result[0]?.stockRows).toEqual({
			total: 5,
			applied: 4,
			skipped: 1,
			diagnostics: {
				source: 'WEBHOOK',
				stockRows: 5,
				matchedStockRows: 4,
				unmatchedStockRows: 1,
				productLinks: 2,
				variantLinks: 3,
				ignoredVariantLinks: 0,
				appliedProductLinks: 1,
				appliedVariantLinks: 3,
				skippedReasons: {
					missingStock: 0,
					productHasVariantLinks: 1,
					variantsCapabilityDisabled: 0,
					stockRowWithoutLocalLink: 1
				}
			}
		})
		expect(result[0]?.warnings).toEqual([
			expect.objectContaining({
				code: 'MOYSKLAD_PRODUCT_FOLDER_MISSING',
				count: 1
			})
		])
		expect(result[0]?.errors).toEqual([
			expect.objectContaining({
				code: 'MOYSKLAD_PRODUCT_SYNC_FAILED',
				externalId: 'external-key-1',
				message: expect.stringContaining('[redacted]')
			})
		])
		expect(JSON.stringify(result)).not.toContain('moysklad-secret-token')
	})

	it('redacts stored provider errors before returning integration status', async () => {
		repo.findMoySklad.mockResolvedValue({
			...integrationRecord,
			lastSyncError: 'Authorization: Bearer moysklad-secret-token'
		} as any)
		repo.findLatestActiveSyncRun.mockResolvedValue({
			...syncRunRecord,
			error: 'access_token=moysklad-secret-token'
		} as any)
		repo.findLatestFinishedSyncRun.mockResolvedValue({
			...syncRunRecord,
			id: 'run-2',
			error: '{"token":"moysklad-secret-token"}'
		} as any)

		const result = await runWithCatalog(() => service.getMoySkladStatus())

		expect(result.integration?.capabilities).toEqual({
			productImport: true,
			variantImport: true,
			stockImport: true,
			imageImport: true,
			orderExport: true,
			reservation: false,
			webhook: true
		})
		expect(result.integration?.lastSyncError).toContain('[redacted]')
		expect(result.activeRun?.error).toContain('[redacted]')
		expect(result.lastRun?.error).toContain('[redacted]')
		expect(JSON.stringify(result)).not.toContain('moysklad-secret-token')
	})

	it('returns order export history without payloads', async () => {
		repo.findOrderExportsByCatalog.mockResolvedValue([orderExportRecord as any])

		const result = await runWithCatalog(() =>
			service.getMoySkladOrderExports('10')
		)

		expect(repo.findOrderExportsByCatalog).toHaveBeenCalledWith('catalog-1', 10)
		expect(result).toEqual([
			expect.objectContaining({
				id: 'export-1',
				orderId: 'order-1',
				status: 'ERROR',
				attempts: 2,
				lastError: 'MoySklad API error'
			})
		])
		expect(result[0]).not.toHaveProperty('payload')
		expect(result[0]).not.toHaveProperty('response')
	})

	it('returns iiko order export history without payloads', async () => {
		repo.findOrderExportsByCatalog.mockResolvedValue([
			{
				...orderExportRecord,
				provider: IntegrationProvider.IIKO,
				idempotencyKey: 'IIKO:integration-1:order-1',
				lastError: 'iiko API error'
			} as any
		])

		const result = await runWithCatalog(() => service.getIikoOrderExports('10'))

		expect(repo.findOrderExportsByCatalog).toHaveBeenCalledWith(
			'catalog-1',
			10,
			IntegrationProvider.IIKO
		)
		expect(result).toEqual([
			expect.objectContaining({
				id: 'export-1',
				provider: IntegrationProvider.IIKO,
				orderId: 'order-1',
				status: 'ERROR',
				attempts: 2,
				lastError: 'iiko API error'
			})
		])
		expect(result[0]).not.toHaveProperty('payload')
		expect(result[0]).not.toHaveProperty('response')
	})

	it('does not re-register iiko webhook when the saved setup is current', async () => {
		const iikoRecord = {
			...integrationRecord,
			id: 'iiko-integration-1',
			provider: IntegrationProvider.IIKO,
			metadata: {
				apiLogin: 'iiko-login',
				organizationId: 'organization-1',
				webhook: {
					enabled: true,
					urlPreview:
						'https://api.example.test/integration/webhooks/iiko/iiko-integration-1/***',
					secretHash: 'secret-hash',
					filterHash: hashIikoWebhookSettingsFilter(),
					lastConfiguredAt: '2026-05-28T09:00:00.000Z',
					lastReceivedAt: null,
					lastEventType: null,
					lastError: null
				}
			}
		}
		repo.findIiko.mockResolvedValue(iikoRecord as any)
		const updateWebhookSettings = jest
			.spyOn(IikoClient.prototype, 'updateWebhookSettings')
			.mockResolvedValue({ correlationId: 'corr-1' })

		const result = await runWithCatalog(() => service.setupIikoWebhooks())

		expect(updateWebhookSettings).not.toHaveBeenCalled()
		expect(repo.updateIikoMetadataById).not.toHaveBeenCalled()
		expect(result).toEqual({
			ok: true,
			enabled: true,
			correlationId: null,
			webhook: expect.objectContaining({
				enabled: true,
				urlPreview:
					'https://api.example.test/integration/webhooks/iiko/iiko-integration-1/***',
				hasSecret: true,
				lastError: null
			})
		})
	})

	it('returns 429 when iiko rate-limits webhook registration', async () => {
		repo.findIiko.mockResolvedValue({
			...integrationRecord,
			id: 'iiko-integration-1',
			provider: IntegrationProvider.IIKO,
			metadata: {
				apiLogin: 'iiko-login',
				organizationId: 'organization-1',
				webhook: {
					enabled: false,
					urlPreview: null,
					secretHash: null,
					lastConfiguredAt: null,
					lastReceivedAt: null,
					lastEventType: null,
					lastError: null
				}
			}
		} as any)
		jest
			.spyOn(IikoClient.prototype, 'updateWebhookSettings')
			.mockRejectedValue(
				new Error('iiko API error 429: {"error":"TOO_MANY_REQUESTS"}')
			)

		try {
			await runWithCatalog(() => service.setupIikoWebhooks())
			throw new Error('Expected setupIikoWebhooks to fail')
		} catch (error) {
			expect((error as { getStatus?: () => number }).getStatus?.()).toBe(429)
			expect(String((error as Error).message)).toContain(
				'iiko API temporarily rate-limited'
			)
		}
		expect(repo.updateIikoMetadataById).not.toHaveBeenCalled()
	})

	it('stores iiko stop-list webhook event and queues stock sync', async () => {
		const secret = 'iiko-secret-1'
		const iikoRecord = {
			...integrationRecord,
			id: 'iiko-integration-1',
			provider: IntegrationProvider.IIKO,
			metadata: {
				apiLogin: 'iiko-login',
				organizationId: 'organization-1',
				webhook: {
					enabled: true,
					urlPreview:
						'https://api.example.test/integration/webhooks/iiko/iiko-integration-1/***',
					secretHash: hashWebhookSecret(secret),
					lastConfiguredAt: '2026-05-28T09:00:00.000Z',
					lastReceivedAt: null,
					lastEventType: null,
					lastError: null
				}
			}
		}
		const storedEvent = {
			id: 'webhook-event-1',
			integrationId: 'iiko-integration-1',
			provider: IntegrationProvider.IIKO,
			requestId: 'iiko:StopListUpdate:corr-1',
			reportUrl: 'StopListUpdate',
			payload: {},
			status: 'PENDING',
			attempts: 0,
			lastError: null,
			jobId: null,
			receivedAt: new Date('2026-05-28T09:10:00.000Z'),
			processedAt: null,
			createdAt: new Date('2026-05-28T09:10:00.000Z'),
			updatedAt: new Date('2026-05-28T09:10:00.000Z')
		}
		repo.findIikoById.mockResolvedValue(iikoRecord as any)
		repo.createWebhookEventIfNew.mockResolvedValue({
			event: storedEvent,
			created: true
		} as any)
		iikoQueue.enqueueStockWebhookSync.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-iiko-webhook',
			jobId: 'job-iiko-webhook',
			mode: IntegrationSyncRunMode.STOCK,
			trigger: IntegrationSyncRunTrigger.WEBHOOK
		} as any)

		await service.receiveIikoWebhook({
			integrationId: 'iiko-integration-1',
			secret,
			payload: {
				eventType: 'StopListUpdate',
				eventTime: '2026-05-28 12:10:00.000',
				organizationId: 'organization-1',
				correlationId: 'corr-1',
				eventInfo: {}
			}
		})

		expect(repo.createWebhookEventIfNew).toHaveBeenCalledWith(
			expect.objectContaining({
				integrationId: 'iiko-integration-1',
				provider: IntegrationProvider.IIKO,
				requestId: 'iiko:StopListUpdate:corr-1',
				reportUrl: 'StopListUpdate'
			})
		)
		expect(repo.markWebhookEventsProcessing).toHaveBeenCalledWith(
			['webhook-event-1'],
			'inline'
		)
		expect(iikoQueue.enqueueStockWebhookSync).toHaveBeenCalledWith(iikoRecord)
		expect(repo.markWebhookEventProcessed).toHaveBeenCalledWith('webhook-event-1')
		expect(repo.updateIikoMetadataById).toHaveBeenCalledWith(
			'iiko-integration-1',
			expect.objectContaining({
				webhook: expect.objectContaining({
					enabled: true,
					lastEventType: 'StopListUpdate',
					lastError: null
				})
			})
		)
	})

	it('accepts empty iiko webhook probes without queuing sync', async () => {
		const secret = 'iiko-secret-1'
		const iikoRecord = {
			...integrationRecord,
			id: 'iiko-integration-1',
			provider: IntegrationProvider.IIKO,
			metadata: {
				apiLogin: 'iiko-login',
				organizationId: 'organization-1',
				webhook: {
					enabled: true,
					urlPreview:
						'https://api.example.test/integration/webhooks/iiko/iiko-integration-1/***',
					secretHash: hashWebhookSecret(secret),
					lastConfiguredAt: '2026-05-28T09:00:00.000Z',
					lastReceivedAt: null,
					lastEventType: null,
					lastError: null
				}
			}
		}
		repo.findIikoById.mockResolvedValue(iikoRecord as any)

		await service.receiveIikoWebhook({
			integrationId: 'iiko-integration-1',
			secret,
			payload: undefined
		})

		expect(repo.createWebhookEventIfNew).not.toHaveBeenCalled()
		expect(iikoQueue.enqueueStockWebhookSync).not.toHaveBeenCalled()
		expect(iikoQueue.enqueueCatalogWebhookSync).not.toHaveBeenCalled()
		expect(repo.updateIikoMetadataById).toHaveBeenCalledWith(
			'iiko-integration-1',
			expect.objectContaining({
				webhook: expect.objectContaining({
					enabled: true,
					lastEventType: 'WebhookProbe',
					lastError: null
				})
			})
		)
	})

	it('falls back to stock sync when iiko webhook payload is not an event object', async () => {
		const secret = 'iiko-secret-1'
		const iikoRecord = {
			...integrationRecord,
			id: 'iiko-integration-1',
			provider: IntegrationProvider.IIKO,
			metadata: {
				apiLogin: 'iiko-login',
				organizationId: 'organization-1',
				webhook: {
					enabled: true,
					urlPreview:
						'https://api.example.test/integration/webhooks/iiko/iiko-integration-1/***',
					secretHash: hashWebhookSecret(secret),
					lastConfiguredAt: '2026-05-28T09:00:00.000Z',
					lastReceivedAt: null,
					lastEventType: null,
					lastError: null
				}
			}
		}
		repo.findIikoById.mockResolvedValue(iikoRecord as any)
		iikoQueue.enqueueStockWebhookSync.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-iiko-webhook',
			jobId: 'job-iiko-webhook',
			mode: IntegrationSyncRunMode.STOCK,
			trigger: IntegrationSyncRunTrigger.WEBHOOK
		} as any)

		await service.receiveIikoWebhook({
			integrationId: 'iiko-integration-1',
			secret,
			payload: '["StopListUpdate"]'
		})

		expect(repo.createWebhookEventIfNew).not.toHaveBeenCalled()
		expect(iikoQueue.enqueueStockWebhookSync).toHaveBeenCalledWith(iikoRecord)
		expect(repo.updateIikoMetadataById).toHaveBeenCalledWith(
			'iiko-integration-1',
			expect.objectContaining({
				webhook: expect.objectContaining({
					enabled: true,
					lastEventType: 'WebhookFallback',
					lastError: null
				})
			})
		)
	})

	it('loads MoySklad order export reference options from provider', async () => {
		repo.findMoySklad.mockResolvedValue(integrationRecord as any)
		jest
			.spyOn(MoySkladClient.prototype, 'getAllOrganizations')
			.mockResolvedValue([
				{
					id: 'organization-1',
					name: 'Основная организация',
					code: 'ORG',
					archived: false
				}
			] as any)
		jest
			.spyOn(MoySkladClient.prototype, 'getAllCounterparties')
			.mockResolvedValue([
				{
					id: 'counterparty-1',
					name: 'Интернет-магазин',
					externalCode: 'site-agent',
					archived: false
				}
			] as any)
		jest.spyOn(MoySkladClient.prototype, 'getAllStores').mockResolvedValue([
			{
				id: 'store-2',
				name: 'Архивный склад',
				archived: true
			},
			{
				id: 'store-1',
				name: 'Основной склад',
				archived: false
			}
		] as any)

		const result = await runWithCatalog(() =>
			service.getMoySkladOrderExportRefs()
		)

		expect(repo.findMoySklad).toHaveBeenCalledWith('catalog-1')
		expect(MoySkladClient.prototype.getAllOrganizations).toHaveBeenCalledWith()
		expect(MoySkladClient.prototype.getAllCounterparties).toHaveBeenCalledWith()
		expect(MoySkladClient.prototype.getAllStores).toHaveBeenCalledWith()
		expect(result.organizations).toEqual([
			{
				id: 'organization-1',
				name: 'Основная организация',
				code: 'ORG',
				externalCode: null,
				archived: false
			}
		])
		expect(result.counterparties[0]).toEqual(
			expect.objectContaining({
				id: 'counterparty-1',
				externalCode: 'site-agent'
			})
		)
		expect(result.stores.map(item => item.id)).toEqual(['store-1', 'store-2'])
	})

	it('previews MoySklad characteristic mapping without running sync or upserts', async () => {
		repo.findMoySklad.mockResolvedValue(integrationRecord as any)
		repo.findMoySkladMappingPreviewAttributes.mockResolvedValue([
			{
				id: 'attribute-color',
				key: 'color',
				displayName: 'Color',
				dataType: DataType.ENUM,
				isVariantAttribute: true,
				displayOrder: 1,
				enumValues: [
					{
						id: 'value-green',
						value: 'green',
						displayName: 'Green',
						displayOrder: 1
					}
				]
			}
		] as any)
		jest.spyOn(MoySkladClient.prototype, 'getAllAssortment').mockResolvedValue([
			{
				id: 'assortment-1',
				name: 'Product 1',
				updated: '2026-03-23 14:00:00',
				archived: false,
				characteristics: [
					{
						name: 'Size',
						value: 'XL'
					}
				]
			}
		] as any)
		jest.spyOn(MoySkladClient.prototype, 'getAllVariants').mockResolvedValue([
			{
				id: 'variant-1',
				name: 'Product 1 / Green',
				updated: '2026-03-23 14:00:00',
				archived: false,
				product: {
					meta: {
						href: 'https://api.moysklad.ru/api/remap/1.2/entity/product/product-1',
						type: 'product',
						mediaType: 'application/json'
					}
				},
				characteristics: [
					{
						name: 'Color',
						value: 'gren'
					},
					{
						name: 'Material',
						value: 'Cotton'
					}
				]
			}
		] as any)

		const result = await runWithCatalog(() => service.previewMoySkladMapping())

		expect(repo.findMoySklad).toHaveBeenCalledWith('catalog-1')
		expect(repo.findMoySkladMappingPreviewAttributes).toHaveBeenCalledWith(
			'catalog-1'
		)
		expect(MoySkladClient.prototype.getAllAssortment).toHaveBeenCalledWith()
		expect(MoySkladClient.prototype.getAllVariants).toHaveBeenCalledWith()
		expect(sync.syncCatalog).not.toHaveBeenCalled()
		expect(queue.enqueueCatalogSync).not.toHaveBeenCalled()
		expect(queue.enqueueProductSync).not.toHaveBeenCalled()
		expect(queue.enqueueStockSync).not.toHaveBeenCalled()
		expect(repo.upsertMoySklad).not.toHaveBeenCalled()
		expect(repo.updateMoySklad).not.toHaveBeenCalled()

		expect(result.unknownAttributes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					externalName: 'Material',
					suggestedKey: 'moysklad_material',
					sampledExternalIds: ['variant-1']
				}),
				expect.objectContaining({
					externalName: 'Size',
					suggestedKey: 'moysklad_size',
					sampledExternalIds: ['assortment-1']
				})
			])
		)
		expect(result.unknownAttributes).toHaveLength(2)
		expect(result.unknownEnumValues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					externalAttributeName: 'Material',
					externalValue: 'Cotton',
					attributeId: null
				}),
				expect.objectContaining({
					externalAttributeName: 'Size',
					externalValue: 'XL',
					attributeId: null
				}),
				expect.objectContaining({
					externalAttributeName: 'Color',
					externalValue: 'gren',
					attributeId: 'attribute-color'
				})
			])
		)
		expect(result.suggestedExistingValues).toEqual([
			expect.objectContaining({
				externalAttributeName: 'Color',
				externalValue: 'gren',
				enumValue: expect.objectContaining({
					id: 'value-green',
					value: 'green'
				})
			})
		])
		expect(result.counters).toEqual(
			expect.objectContaining({
				assortmentItems: 1,
				variantItems: 1,
				unknownAttributes: 2,
				unknownEnumValues: 3,
				suggestedExistingValues: 1
			})
		)
	})

	it('applies MoySklad mapping by linking existing dictionaries and creating trusted imports', async () => {
		repo.findMoySklad.mockResolvedValue(integrationRecord as any)
		repo.findMoySkladVariantAttributeById.mockImplementation(
			async (_catalogId: string, attributeId: string) => {
				if (attributeId === 'attribute-color') {
					return {
						id: 'attribute-color',
						key: 'color',
						displayName: 'Color',
						displayOrder: 1
					} as any
				}
				if (attributeId === 'attribute-size') {
					return {
						id: 'attribute-size',
						key: 'moysklad_size',
						displayName: 'Size',
						displayOrder: 2
					} as any
				}
				return null
			}
		)
		repo.upsertMoySkladVariantAttributeForMapping.mockResolvedValue({
			attribute: {
				id: 'attribute-size',
				key: 'moysklad_size',
				displayName: 'Size',
				displayOrder: 2
			},
			created: true
		} as any)
		repo.upsertMoySkladEnumValueAlias.mockResolvedValue({
			enumValue: {
				id: 'value-green',
				attributeId: 'attribute-color',
				value: 'green',
				displayName: 'Green'
			},
			created: true,
			conflict: false
		} as any)
		repo.upsertMoySkladImportedEnumValue.mockResolvedValue({
			enumValue: {
				id: 'value-xl',
				attributeId: 'attribute-size',
				value: 'xl',
				displayName: 'XL',
				source: 'IMPORTED'
			},
			created: true
		} as any)
		repo.upsertMoySkladAttributeMappings.mockResolvedValue(true)
		const assortmentSpy = jest
			.spyOn(MoySkladClient.prototype, 'getAllAssortment')
			.mockResolvedValue([])
		const variantsSpy = jest
			.spyOn(MoySkladClient.prototype, 'getAllVariants')
			.mockResolvedValue([])

		const result = await runWithCatalog(() =>
			service.applyMoySkladMapping({
				trustedCatalog: true,
				attributes: [
					{
						externalName: ' Color ',
						action: 'LINK',
						attributeId: 'attribute-color'
					},
					{
						externalName: ' Size ',
						action: 'CREATE'
					}
				],
				enumValues: [
					{
						externalAttributeName: 'Color',
						externalValue: 'gren',
						action: 'LINK',
						enumValueId: 'value-green'
					},
					{
						externalAttributeName: 'Size',
						externalValue: ' XL ',
						action: 'CREATE'
					}
				]
			})
		)

		expect(result.applied).toEqual({
			total: 4,
			attributes: 2,
			enumValues: 2
		})
		expect(result.created).toEqual({
			total: 2,
			attributes: 1,
			enumValues: 1
		})
		expect(result.linked).toEqual({
			total: 2,
			attributes: 1,
			enumValues: 1
		})
		expect(result.attributes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					externalName: 'Color',
					status: 'linked',
					attributeId: 'attribute-color'
				}),
				expect.objectContaining({
					externalName: 'Size',
					status: 'created',
					attributeId: 'attribute-size'
				})
			])
		)
		expect(repo.upsertMoySkladImportedEnumValue).toHaveBeenCalledWith(
			'catalog-1',
			'attribute-size',
			{
				value: 'xl',
				displayName: 'XL'
			}
		)
		expect(repo.upsertMoySkladAttributeMappings).toHaveBeenCalledWith(
			'catalog-1',
			'integration-1',
			expect.arrayContaining([
				{ normalizedName: 'color', attributeId: 'attribute-color' },
				{ normalizedName: 'size', attributeId: 'attribute-size' }
			])
		)
		expect(sync.syncCatalog).not.toHaveBeenCalled()
		expect(queue.enqueueCatalogSync).not.toHaveBeenCalled()
		expect(assortmentSpy).not.toHaveBeenCalled()
		expect(variantsSpy).not.toHaveBeenCalled()
		expect(JSON.stringify(result)).not.toContain('token-12345678')
	})

	it('skips trusted-only auto-created attributes for untrusted mapping apply', async () => {
		repo.findMoySklad.mockResolvedValue(integrationRecord as any)

		const result = await runWithCatalog(() =>
			service.applyMoySkladMapping({
				attributes: [
					{
						externalName: 'Size',
						action: 'CREATE'
					}
				]
			})
		)

		expect(result.skipped).toEqual({
			total: 1,
			attributes: 1,
			enumValues: 0
		})
		expect(result.attributes[0]).toEqual(
			expect.objectContaining({
				status: 'skipped',
				reason: 'auto_create_attribute_requires_trusted_catalog'
			})
		)
		expect(repo.upsertMoySkladVariantAttributeForMapping).not.toHaveBeenCalled()
		expect(repo.upsertMoySkladAttributeMappings).not.toHaveBeenCalled()
	})

	it('queues manual order export retry', async () => {
		orderExportQueue.retryOrderExport.mockResolvedValue({
			ok: true,
			queued: true,
			exportId: 'export-1',
			jobId: 'job-1'
		})

		const result = await runWithCatalog(() =>
			service.retryMoySkladOrderExport('export-1')
		)

		expect(orderExportQueue.retryOrderExport).toHaveBeenCalledWith(
			'catalog-1',
			'export-1'
		)
		expect(result).toEqual({
			ok: true,
			queued: true,
			exportId: 'export-1',
			jobId: 'job-1'
		})
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'integration.moysklad.order_export.retry',
				targetId: 'export-1',
				targetCatalogId: 'catalog-1',
				metadata: expect.objectContaining({
					queued: true,
					jobId: 'job-1'
				})
			})
		)
	})

	it('queues manual iiko order export retry', async () => {
		iikoOrderExportQueue.retryOrderExport.mockResolvedValue({
			ok: true,
			queued: true,
			exportId: 'export-1',
			jobId: 'job-1'
		})

		const result = await runWithCatalog(() =>
			service.retryIikoOrderExport('export-1')
		)

		expect(iikoOrderExportQueue.retryOrderExport).toHaveBeenCalledWith(
			'catalog-1',
			'export-1'
		)
		expect(result).toEqual({
			ok: true,
			queued: true,
			exportId: 'export-1',
			jobId: 'job-1'
		})
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'integration.iiko.order_export.retry',
				targetId: 'export-1',
				targetCatalogId: 'catalog-1',
				metadata: expect.objectContaining({
					provider: IntegrationProvider.IIKO,
					queued: true,
					jobId: 'job-1'
				})
			})
		)
	})

	it('audits skipped manual order export retry', async () => {
		orderExportQueue.retryOrderExport.mockResolvedValue({
			ok: true,
			queued: false,
			exportId: 'export-1',
			reason: 'already_exported'
		})

		const result = await runWithCatalog(() =>
			service.retryMoySkladOrderExport('export-1')
		)

		expect(result.queued).toBe(false)
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'integration.moysklad.order_export.retry',
				reason: 'already_exported',
				metadata: expect.objectContaining({
					queued: false,
					reason: 'already_exported'
				})
			})
		)
	})

	it('rejects enabling order export on upsert without required refs', async () => {
		repo.findMoySklad.mockResolvedValue(null)

		await expect(
			runWithCatalog(() =>
				service.upsertMoySklad({
					token: 'token-12345678',
					exportOrders: true
				})
			)
		).rejects.toThrow(
			'For MoySklad order export, organization, counterparty and store ids are required'
		)

		expect(repo.upsertMoySklad).not.toHaveBeenCalled()
		expect(queue.syncSchedulerForIntegration).not.toHaveBeenCalled()
		expect(queue.enqueueCatalogSync).not.toHaveBeenCalled()
	})

	it('rejects enabling order export on update without required refs', async () => {
		repo.findMoySklad.mockResolvedValue(integrationRecord as any)

		await expect(
			runWithCatalog(() =>
				service.updateMoySklad({
					exportOrders: true
				})
			)
		).rejects.toThrow(
			'For MoySklad order export, organization, counterparty and store ids are required'
		)

		expect(repo.updateMoySklad).not.toHaveBeenCalled()
		expect(queue.syncSchedulerForIntegration).not.toHaveBeenCalled()
		expect(queue.enqueueCatalogSync).not.toHaveBeenCalled()
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
		const existingWithStockFreshness = {
			...integrationRecord,
			metadata: buildEncryptedMetadata({
				token: 'token-12345678',
				priceTypeName: 'Цена продажи',
				importImages: true,
				syncStock: true,
				scheduleEnabled: false,
				schedulePattern: null,
				scheduleTimezone: 'Europe/Moscow',
				lastStockSyncedAt: '2026-03-23T12:15:00.000Z'
			})
		}
		repo.findMoySklad.mockResolvedValue(existingWithStockFreshness as any)
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
				scheduleTimezone: 'Europe/Moscow',
				lastStockSyncedAt: '2026-03-23T12:15:00.000Z'
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
			existingWithStockFreshness.metadata
		)
		expect(metadataCrypto.buildStoredMetadata).toHaveBeenCalledWith(
			expect.objectContaining({
				token: 'token-12345678',
				priceTypeName: 'Опт',
				importImages: false,
				syncStock: true,
				lastStockSyncedAt: '2026-03-23T12:15:00.000Z'
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
		expect(result.lastStockSyncedAt).toBe('2026-03-23T12:15:00.000Z')
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

	it('queues stock sync', async () => {
		queue.enqueueStockSync.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-4',
			jobId: 'job-4',
			mode: IntegrationSyncRunMode.STOCK,
			trigger: IntegrationSyncRunTrigger.MANUAL
		})

		const result = await runWithCatalog(() => service.syncMoySkladStock())

		expect(queue.enqueueStockSync).toHaveBeenCalledWith('catalog-1')
		expect(result.mode).toBe(IntegrationSyncRunMode.STOCK)
	})

	it('stores MoySklad stock webhook event and queues drain job', async () => {
		const secret = 'webhook-secret'
		repo.findMoySkladById.mockResolvedValue({
			...integrationRecord,
			metadata: buildEncryptedMetadata({
				token: 'token-12345678',
				stockWebhookEnabled: true,
				stockWebhook: {
					externalId: 'webhook-1',
					accountId: 'account-1',
					secretHash: hashWebhookSecret(secret),
					reportType: 'all',
					stockType: 'stock',
					lastReceivedAt: null,
					lastProcessedAt: null,
					lastError: null
				}
			})
		} as any)
		repo.createWebhookEventIfNew.mockResolvedValue({
			created: true,
			event: { id: 'event-1' }
		} as any)
		repo.patchMoySkladStockWebhookMetadata.mockResolvedValue(
			integrationRecord as any
		)
		queue.enqueueStockWebhookDrain.mockResolvedValue({
			ok: true,
			queued: true,
			jobId: 'webhook-job-1'
		})

		await service.receiveMoySkladStockWebhook({
			integrationId: 'integration-1',
			secret,
			requestId: 'request-1',
			payload: {
				events: [
					{
						accountId: 'account-1',
						reportUrl:
							'https://api.moysklad.ru/api/remap/1.2/report/stock/all/current?filter=assortmentId%3Dassortment-1'
					}
				]
			}
		})

		expect(repo.createWebhookEventIfNew).toHaveBeenCalledWith(
			expect.objectContaining({
				integrationId: 'integration-1',
				requestId: 'request-1',
				reportUrl:
					'https://api.moysklad.ru/api/remap/1.2/report/stock/all/current?filter=assortmentId%3Dassortment-1'
			})
		)
		expect(queue.enqueueStockWebhookDrain).toHaveBeenCalledWith(
			'catalog-1',
			'integration-1'
		)
	})

	it('does not queue webhook drain for duplicate MoySklad requestId', async () => {
		const secret = 'webhook-secret'
		repo.findMoySkladById.mockResolvedValue({
			...integrationRecord,
			metadata: buildEncryptedMetadata({
				token: 'token-12345678',
				stockWebhookEnabled: true,
				stockWebhook: {
					externalId: 'webhook-1',
					accountId: 'account-1',
					secretHash: hashWebhookSecret(secret),
					reportType: 'all',
					stockType: 'stock',
					lastReceivedAt: null,
					lastProcessedAt: null,
					lastError: null
				}
			})
		} as any)
		repo.createWebhookEventIfNew.mockResolvedValue({
			created: false,
			event: { id: 'event-1' }
		} as any)
		repo.patchMoySkladStockWebhookMetadata.mockResolvedValue(
			integrationRecord as any
		)

		await service.receiveMoySkladStockWebhook({
			integrationId: 'integration-1',
			secret,
			requestId: 'request-1',
			payload: {
				accountId: 'account-1',
				reportUrl: 'https://api.moysklad.ru/api/remap/1.2/report/stock/all/current'
			}
		})

		expect(queue.enqueueStockWebhookDrain).not.toHaveBeenCalled()
	})

	it('soft deletes a linked product from MoySklad delete webhook', async () => {
		const secret = 'delete-webhook-secret'
		repo.findMoySkladById.mockResolvedValue({
			...integrationRecord,
			metadata: buildEncryptedMetadata({
				token: 'token-12345678',
				productDeleteWebhook: {
					enabled: true,
					externalIds: {
						product: 'delete-webhook-product',
						service: 'delete-webhook-service',
						bundle: 'delete-webhook-bundle'
					},
					accountId: 'account-1',
					secretHash: hashWebhookSecret(secret),
					lastReceivedAt: null,
					lastProcessedAt: null,
					lastError: null
				}
			})
		} as any)
		repo.findProductLinksByIntegration.mockResolvedValue([
			{
				id: 'link-1',
				integrationId: 'integration-1',
				productId: 'product-1',
				externalId: 'external-code-1',
				externalCode: 'code-1',
				rawMeta: { id: 'moysklad-product-1' }
			}
		] as any)
		products.softDeleteExternalProduct.mockResolvedValue(true)
		repo.patchMoySkladProductDeleteWebhookMetadata.mockResolvedValue(
			integrationRecord as any
		)

		await service.receiveMoySkladProductDeleteWebhook({
			integrationId: 'integration-1',
			secret,
			payload: {
				events: [
					{
						accountId: 'account-1',
						action: 'DELETE',
						meta: {
							href:
								'https://api.moysklad.ru/api/remap/1.2/entity/product/moysklad-product-1',
							type: 'product',
							mediaType: 'application/json'
						}
					}
				]
			}
		})

		expect(products.softDeleteExternalProduct).toHaveBeenCalledWith({
			catalogId: 'catalog-1',
			productId: 'product-1'
		})
		expect(repo.patchMoySkladProductDeleteWebhookMetadata).toHaveBeenCalledWith(
			'integration-1',
			expect.objectContaining({
				lastReceivedAt: expect.any(String),
				lastProcessedAt: expect.any(String),
				lastError: null
			})
		)
	})

	it('soft deletes a linked variant from MoySklad delete webhook', async () => {
		const secret = 'delete-webhook-secret'
		repo.findMoySkladById.mockResolvedValue({
			...integrationRecord,
			metadata: buildEncryptedMetadata({
				token: 'token-12345678',
				productDeleteWebhook: {
					enabled: true,
					externalIds: {
						product: 'delete-webhook-product',
						service: 'delete-webhook-service',
						bundle: 'delete-webhook-bundle',
						variant: 'delete-webhook-variant'
					},
					accountId: 'account-1',
					secretHash: hashWebhookSecret(secret),
					lastReceivedAt: null,
					lastProcessedAt: null,
					lastError: null
				}
			})
		} as any)
		repo.softDeleteIntegratedVariantByExternalId.mockResolvedValue({
			deleted: true,
			productId: 'product-1',
			variantId: 'variant-1'
		})
		repo.recomputeProductStatusFromVariants.mockResolvedValue(true)
		products.recomputeProductCommercialState.mockResolvedValue(true)
		repo.patchMoySkladProductDeleteWebhookMetadata.mockResolvedValue(
			integrationRecord as any
		)

		await service.receiveMoySkladProductDeleteWebhook({
			integrationId: 'integration-1',
			secret,
			payload: {
				events: [
					{
						accountId: 'account-1',
						action: 'DELETE',
						meta: {
							href:
								'https://api.moysklad.ru/api/remap/1.2/entity/variant/moysklad-variant-1',
							type: 'variant',
							mediaType: 'application/json'
						}
					}
				]
			}
		})

		expect(repo.softDeleteIntegratedVariantByExternalId).toHaveBeenCalledWith({
			integrationId: 'integration-1',
			catalogId: 'catalog-1',
			externalId: 'moysklad-variant-1'
		})
		expect(products.softDeleteExternalProduct).not.toHaveBeenCalled()
		expect(repo.recomputeProductStatusFromVariants).toHaveBeenCalledWith(
			'catalog-1',
			'product-1'
		)
		expect(products.recomputeProductCommercialState).toHaveBeenCalledWith({
			catalogId: 'catalog-1',
			productId: 'product-1'
		})
	})

	it('queues product sync from MoySklad product change webhook', async () => {
		const secret = 'change-webhook-secret'
		repo.findMoySkladById.mockResolvedValue({
			...integrationRecord,
			metadata: buildEncryptedMetadata({
				token: 'token-12345678',
				productChangeWebhook: {
					enabled: true,
					externalIds: {
						product: {
							CREATE: 'change-webhook-product-create',
							UPDATE: 'change-webhook-product-update'
						},
						service: {
							CREATE: 'change-webhook-service-create',
							UPDATE: 'change-webhook-service-update'
						},
						bundle: {
							CREATE: 'change-webhook-bundle-create',
							UPDATE: 'change-webhook-bundle-update'
						},
						variant: {
							CREATE: 'change-webhook-variant-create',
							UPDATE: 'change-webhook-variant-update'
						}
					},
					accountId: 'account-1',
					secretHash: hashWebhookSecret(secret),
					lastReceivedAt: null,
					lastProcessedAt: null,
					lastError: null
				}
			})
		} as any)
		queue.enqueueProductWebhookSync.mockResolvedValue({
			ok: true,
			queued: true,
			jobId: 'product-webhook-job-1'
		})
		repo.patchMoySkladProductChangeWebhookMetadata.mockResolvedValue(
			integrationRecord as any
		)

		await service.receiveMoySkladProductChangeWebhook({
			integrationId: 'integration-1',
			secret,
			payload: {
				events: [
					{
						accountId: 'account-1',
						action: 'UPDATE',
						meta: {
							href:
								'https://api.moysklad.ru/api/remap/1.2/entity/variant/moysklad-variant-1',
							type: 'variant',
							mediaType: 'application/json'
						}
					}
				]
			}
		})

		expect(queue.enqueueProductWebhookSync).toHaveBeenCalledWith(
			'catalog-1',
			'integration-1',
			{
				entityType: 'variant',
				externalId: 'moysklad-variant-1',
				action: 'UPDATE'
			}
		)
		expect(repo.patchMoySkladProductChangeWebhookMetadata).toHaveBeenCalledWith(
			'integration-1',
			expect.objectContaining({
				lastReceivedAt: expect.any(String),
				lastError: null
			})
		)
	})

	it('queues category sync from MoySklad productfolder webhook', async () => {
		const secret = 'folder-webhook-secret'
		repo.findMoySkladById.mockResolvedValue({
			...integrationRecord,
			metadata: buildEncryptedMetadata({
				token: 'token-12345678',
				productFolderWebhook: {
					enabled: true,
					externalIds: {
						CREATE: 'folder-webhook-create',
						UPDATE: 'folder-webhook-update',
						DELETE: 'folder-webhook-delete'
					},
					accountId: 'account-1',
					secretHash: hashWebhookSecret(secret),
					lastReceivedAt: null,
					lastProcessedAt: null,
					lastError: null
				}
			})
		} as any)
		queue.enqueueProductFolderWebhookSync.mockResolvedValue({
			ok: true,
			queued: true,
			jobId: 'folder-webhook-job-1'
		})
		repo.patchMoySkladProductFolderWebhookMetadata.mockResolvedValue(
			integrationRecord as any
		)

		await service.receiveMoySkladProductFolderWebhook({
			integrationId: 'integration-1',
			secret,
			payload: {
				events: [
					{
						accountId: 'account-1',
						action: 'UPDATE',
						meta: {
							href:
								'https://api.moysklad.ru/api/remap/1.2/entity/productfolder/folder-1',
							type: 'productfolder',
							mediaType: 'application/json'
						}
					}
				]
			}
		})

		expect(queue.enqueueProductFolderWebhookSync).toHaveBeenCalledWith(
			'catalog-1',
			'integration-1',
			{
				externalId: 'folder-1',
				action: 'UPDATE'
			}
		)
		expect(repo.patchMoySkladProductFolderWebhookMetadata).toHaveBeenCalledWith(
			'integration-1',
			expect.objectContaining({
				lastReceivedAt: expect.any(String),
				lastError: null
			})
		)
	})

	it('marks active MoySklad sync as cancelled', async () => {
		await runWithCatalog(() => service.cancelMoySkladSync())

		expect(repo.failMoySkladSync).toHaveBeenCalledWith(
			'catalog-1',
			'Отменено пользователем'
		)
	})
})

import {
	IntegrationSyncRunMode,
	IntegrationSyncRunTrigger
} from '@generated/enums'
import { Test, TestingModule } from '@nestjs/testing'

import { overrideControllerAuthGuards } from '@/shared/testing/controller-guards.testing'

import { IntegrationController } from './integration.controller'
import { IntegrationService } from './integration.service'

describe('IntegrationController', () => {
	let controller: IntegrationController
	let service: jest.Mocked<IntegrationService>

	beforeEach(async () => {
		const module: TestingModule = await overrideControllerAuthGuards(
			Test.createTestingModule({
				controllers: [IntegrationController],
				providers: [
					{
						provide: IntegrationService,
						useValue: {
							getMoySklad: jest.fn(),
							getMoySkladStatus: jest.fn(),
							getIiko: jest.fn(),
							getIikoStatus: jest.fn(),
							getMoySkladRuns: jest.fn(),
							getIikoOrderExports: jest.fn(),
							getMoySkladOrderExports: jest.fn(),
							getMoySkladOrderExportRefs: jest.fn(),
							previewMoySkladMapping: jest.fn(),
							applyMoySkladMapping: jest.fn(),
							upsertMoySklad: jest.fn(),
							updateMoySklad: jest.fn(),
							removeMoySklad: jest.fn(),
							upsertIiko: jest.fn(),
							updateIiko: jest.fn(),
							removeIiko: jest.fn(),
							previewIikoImport: jest.fn(),
							testMoySkladConnection: jest.fn(),
							testIikoConnection: jest.fn(),
							syncMoySkladCatalog: jest.fn(),
							syncIikoCatalog: jest.fn(),
							syncIikoStock: jest.fn(),
							syncIikoProduct: jest.fn(),
							syncMoySkladProduct: jest.fn(),
							syncMoySkladStock: jest.fn(),
							receiveMoySkladStockWebhook: jest.fn(),
							receiveMoySkladProductDeleteWebhook: jest.fn(),
							receiveMoySkladProductChangeWebhook: jest.fn(),
							receiveMoySkladProductFolderWebhook: jest.fn(),
							receiveIikoWebhook: jest.fn(),
							retryIikoOrderExport: jest.fn(),
							retryMoySkladOrderExport: jest.fn(),
							cancelMoySkladSync: jest.fn()
						}
					}
				]
			})
		).compile()

		controller = module.get(IntegrationController)
		service = module.get(IntegrationService)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})

	it('delegates iiko upsert to service', async () => {
		service.upsertIiko.mockResolvedValue({ organizationId: 'org-1' } as any)

		const dto = {
			apiLogin: 'login',
			organizationId: 'org-1',
			importImages: true
		}
		const result = await controller.upsertIiko(dto)

		expect(service.upsertIiko).toHaveBeenCalledWith(dto)
		expect(result.organizationId).toBe('org-1')
	})

	it('delegates iiko connection test to service', async () => {
		service.testIikoConnection.mockResolvedValue({
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

		const result = await controller.testIikoConnection({ apiLogin: 'login' })

		expect(service.testIikoConnection).toHaveBeenCalledWith({
			apiLogin: 'login'
		})
		expect(result.organizations).toHaveLength(1)
	})

	it('delegates iiko import preview to service', async () => {
		service.previewIikoImport.mockResolvedValue({
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
		const dto = { externalMenuId: '81651', organizationId: 'org-1' }

		const result = await controller.previewIikoImport(dto)

		expect(service.previewIikoImport).toHaveBeenCalledWith(dto)
		expect(result.stats.visibleItems).toBe(1)
	})

	it('delegates iiko sync to service', async () => {
		service.syncIikoCatalog.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-iiko',
			jobId: 'job-iiko',
			mode: IntegrationSyncRunMode.FULL,
			trigger: IntegrationSyncRunTrigger.MANUAL
		})

		const result = await controller.syncIikoCatalog()

		expect(service.syncIikoCatalog).toHaveBeenCalledWith()
		expect(result.runId).toBe('run-iiko')
	})

	it('delegates iiko stock sync to service', async () => {
		service.syncIikoStock.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-iiko-stock',
			jobId: 'job-iiko-stock',
			mode: IntegrationSyncRunMode.STOCK,
			trigger: IntegrationSyncRunTrigger.MANUAL
		})

		const result = await controller.syncIikoStock()

		expect(service.syncIikoStock).toHaveBeenCalledWith()
		expect(result.mode).toBe(IntegrationSyncRunMode.STOCK)
	})

	it('delegates iiko product sync to service', async () => {
		service.syncIikoProduct.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-iiko-product',
			jobId: 'job-iiko-product',
			mode: IntegrationSyncRunMode.PRODUCT,
			trigger: IntegrationSyncRunTrigger.MANUAL
		})

		const result = await controller.syncIikoProduct('product-1')

		expect(service.syncIikoProduct).toHaveBeenCalledWith('product-1')
		expect(result.mode).toBe(IntegrationSyncRunMode.PRODUCT)
	})

	it('delegates product sync to service', async () => {
		service.syncMoySkladProduct.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-1',
			jobId: 'job-1',
			mode: IntegrationSyncRunMode.PRODUCT,
			trigger: IntegrationSyncRunTrigger.MANUAL
		})

		const result = await controller.syncMoySkladProduct('product-1')

		expect(service.syncMoySkladProduct).toHaveBeenCalledWith('product-1')
		expect(result.runId).toBe('run-1')
	})

	it('delegates stock sync to service', async () => {
		service.syncMoySkladStock.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-stock',
			jobId: 'job-stock',
			mode: IntegrationSyncRunMode.STOCK,
			trigger: IntegrationSyncRunTrigger.MANUAL
		})

		const result = await controller.syncMoySkladStock()

		expect(service.syncMoySkladStock).toHaveBeenCalledWith()
		expect(result.mode).toBe(IntegrationSyncRunMode.STOCK)
	})

	it('delegates MoySklad stock webhook to service', async () => {
		service.receiveMoySkladStockWebhook.mockResolvedValue(undefined)
		const payload = {
			events: [
				{
					accountId: 'account-1',
					reportUrl: 'https://api.moysklad.ru/api/remap/1.2/report/stock/all/current'
				}
			]
		}

		await controller.receiveMoySkladStockWebhook(
			'integration-1',
			'secret-1',
			'request-1',
			payload
		)

		expect(service.receiveMoySkladStockWebhook).toHaveBeenCalledWith({
			integrationId: 'integration-1',
			secret: 'secret-1',
			requestId: 'request-1',
			payload
		})
	})

	it('delegates MoySklad product delete webhook to service', async () => {
		service.receiveMoySkladProductDeleteWebhook.mockResolvedValue(undefined)
		const payload = {
			events: [
				{
					accountId: 'account-1',
					action: 'DELETE',
					meta: {
						href: 'https://api.moysklad.ru/api/remap/1.2/entity/product/product-1',
						type: 'product'
					}
				}
			]
		}

		await controller.receiveMoySkladProductDeleteWebhook(
			'integration-1',
			'secret-1',
			payload
		)

		expect(service.receiveMoySkladProductDeleteWebhook).toHaveBeenCalledWith({
			integrationId: 'integration-1',
			secret: 'secret-1',
			payload
		})
	})

	it('delegates MoySklad product change webhook to service', async () => {
		service.receiveMoySkladProductChangeWebhook.mockResolvedValue(undefined)
		const payload = {
			events: [
				{
					accountId: 'account-1',
					action: 'UPDATE',
					meta: {
						href: 'https://api.moysklad.ru/api/remap/1.2/entity/variant/variant-1',
						type: 'variant'
					}
				}
			]
		}

		await controller.receiveMoySkladProductChangeWebhook(
			'integration-1',
			'secret-1',
			payload
		)

		expect(service.receiveMoySkladProductChangeWebhook).toHaveBeenCalledWith({
			integrationId: 'integration-1',
			secret: 'secret-1',
			payload
		})
	})

	it('delegates MoySklad productfolder webhook to service', async () => {
		service.receiveMoySkladProductFolderWebhook.mockResolvedValue(undefined)
		const payload = {
			events: [
				{
					accountId: 'account-1',
					action: 'UPDATE',
					meta: {
						href:
							'https://api.moysklad.ru/api/remap/1.2/entity/productfolder/folder-1',
						type: 'productfolder'
					}
				}
			]
		}

		await controller.receiveMoySkladProductFolderWebhook(
			'integration-1',
			'secret-1',
			payload
		)

		expect(service.receiveMoySkladProductFolderWebhook).toHaveBeenCalledWith({
			integrationId: 'integration-1',
			secret: 'secret-1',
			payload
		})
	})

	it('delegates iiko webhook to service', async () => {
		service.receiveIikoWebhook.mockResolvedValue(undefined)
		const headers = { 'x-request-id': 'request-1' }
		const payload = {
			eventType: 'StopListUpdate',
			organizationId: 'organization-1',
			correlationId: 'corr-1'
		}

		await controller.receiveIikoWebhook(
			'integration-1',
			'secret-1',
			headers,
			payload
		)

		expect(service.receiveIikoWebhook).toHaveBeenCalledWith({
			integrationId: 'integration-1',
			secret: 'secret-1',
			headers,
			payload
		})
	})

	it('delegates order export history to service', async () => {
		service.getMoySkladOrderExports.mockResolvedValue([] as any)

		const result = await controller.getMoySkladOrderExports('10')

		expect(service.getMoySkladOrderExports).toHaveBeenCalledWith('10')
		expect(result).toEqual([])
	})

	it('delegates iiko order export history to service', async () => {
		service.getIikoOrderExports.mockResolvedValue([] as any)

		const result = await controller.getIikoOrderExports('5')

		expect(service.getIikoOrderExports).toHaveBeenCalledWith('5')
		expect(result).toEqual([])
	})

	it('delegates order export refs to service', async () => {
		service.getMoySkladOrderExportRefs.mockResolvedValue({
			organizations: [],
			counterparties: [],
			stores: []
		})

		const result = await controller.getMoySkladOrderExportRefs()

		expect(service.getMoySkladOrderExportRefs).toHaveBeenCalledWith()
		expect(result).toEqual({
			organizations: [],
			counterparties: [],
			stores: []
		})
	})

	it('delegates sync run history to service', async () => {
		service.getMoySkladRuns.mockResolvedValue([] as any)

		const result = await controller.getMoySkladRuns('10')

		expect(service.getMoySkladRuns).toHaveBeenCalledWith('10')
		expect(result).toEqual([])
	})

	it('delegates sync cancellation to service', async () => {
		service.cancelMoySkladSync.mockResolvedValue(undefined)

		const result = await controller.cancelMoySkladSync()

		expect(service.cancelMoySkladSync).toHaveBeenCalledWith()
		expect(result).toEqual({ ok: true })
	})

	it('delegates MoySklad mapping preview to service', async () => {
		service.previewMoySkladMapping.mockResolvedValue({
			unknownAttributes: [],
			unknownEnumValues: [],
			suggestedExistingValues: [],
			counters: {
				assortmentItems: 0,
				variantItems: 0,
				itemsWithCharacteristics: 0,
				characteristics: 0,
				knownAttributes: 0,
				unknownAttributes: 0,
				knownEnumValues: 0,
				unknownEnumValues: 0,
				suggestedExistingValues: 0
			},
			sampledExternalIds: []
		})

		const result = await controller.previewMoySkladMapping()

		expect(service.previewMoySkladMapping).toHaveBeenCalledWith()
		expect(result.unknownAttributes).toEqual([])
	})

	it('delegates MoySklad mapping apply to service', async () => {
		const dto = {
			trustedCatalog: true,
			attributes: [
				{
					externalName: 'Size',
					action: 'CREATE' as const
				}
			]
		}
		service.applyMoySkladMapping.mockResolvedValue({
			ok: true,
			applied: { total: 1, attributes: 1, enumValues: 0 },
			skipped: { total: 0, attributes: 0, enumValues: 0 },
			created: { total: 1, attributes: 1, enumValues: 0 },
			linked: { total: 0, attributes: 0, enumValues: 0 },
			attributes: [
				{
					externalName: 'Size',
					normalizedName: 'size',
					status: 'created',
					attributeId: 'attribute-size',
					attributeKey: 'moysklad_size'
				}
			],
			enumValues: []
		})

		const result = await controller.applyMoySkladMapping(dto)

		expect(service.applyMoySkladMapping).toHaveBeenCalledWith(dto)
		expect(result.created.attributes).toBe(1)
	})

	it('delegates order export retry to service', async () => {
		service.retryMoySkladOrderExport.mockResolvedValue({
			ok: true,
			queued: true,
			exportId: 'export-1',
			jobId: 'job-1'
		})
		const req = { user: { id: 'user-1' } } as any

		const result = await controller.retryMoySkladOrderExport('export-1', req)

		expect(service.retryMoySkladOrderExport).toHaveBeenCalledWith('export-1', req)
		expect(result.jobId).toBe('job-1')
	})

	it('delegates iiko order export retry to service', async () => {
		service.retryIikoOrderExport.mockResolvedValue({
			ok: true,
			queued: true,
			exportId: 'export-1',
			jobId: 'job-1'
		})
		const req = { user: { id: 'user-1' } } as any

		const result = await controller.retryIikoOrderExport('export-1', req)

		expect(service.retryIikoOrderExport).toHaveBeenCalledWith('export-1', req)
		expect(result.jobId).toBe('job-1')
	})
})

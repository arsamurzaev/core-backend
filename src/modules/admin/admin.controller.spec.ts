import { Test, TestingModule } from '@nestjs/testing'

import { DomainEventOutboxDiagnosticsService } from '@/shared/domain-events/domain-event-outbox-diagnostics.service'
import { overrideControllerAuthGuards } from '@/shared/testing/controller-guards.testing'

import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

describe('AdminController', () => {
	let controller: AdminController
	let service: jest.Mocked<
		Pick<
			AdminService,
			| 'deleteCatalogContent'
			| 'diagnoseCatalogDefaultVariants'
			| 'getCatalogMoySkladStockDiagnostics'
			| 'repairCatalogDefaultVariantPriceMismatches'
			| 'repairCatalogMissingDefaultVariants'
		>
	>
	let outbox: jest.Mocked<DomainEventOutboxDiagnosticsService>

	beforeEach(async () => {
		const module: TestingModule = await overrideControllerAuthGuards(
			Test.createTestingModule({
				controllers: [AdminController],
				providers: [
					{
						provide: AdminService,
						useValue: {
							deleteCatalogContent: jest.fn(),
							diagnoseCatalogDefaultVariants: jest.fn(),
							getCatalogMoySkladStockDiagnostics: jest.fn(),
							repairCatalogDefaultVariantPriceMismatches: jest.fn(),
							repairCatalogMissingDefaultVariants: jest.fn()
						}
					},
					{
						provide: DomainEventOutboxDiagnosticsService,
						useValue: {
							list: jest.fn(),
							stats: jest.fn(),
							retryOne: jest.fn(),
							retryFailed: jest.fn(),
							drainPending: jest.fn(),
							cleanupProcessed: jest.fn()
						}
					}
				]
			})
		).compile()

		controller = module.get<AdminController>(AdminController)
		service = module.get(AdminService)
		outbox = module.get(
			DomainEventOutboxDiagnosticsService
		) as jest.Mocked<DomainEventOutboxDiagnosticsService>
	})

	it('delegates catalog content soft-delete to service', async () => {
		const result = {
			ok: true,
			catalogId: 'catalog-1',
			deletedAt: new Date('2026-05-10T00:00:00.000Z'),
			counts: {
				products: 1,
				productVariants: 2,
				productAttributes: 3,
				variantAttributes: 4,
				categories: 5,
				brands: 6,
				seoSettings: 7,
				productMediaLinks: 8,
				categoryProductLinks: 9,
				integrationProductLinks: 10,
				integrationCategoryLinks: 11
			}
		}
		service.deleteCatalogContent.mockResolvedValue(result)

		await expect(controller.deleteCatalogContent('catalog-1')).resolves.toBe(
			result
		)
		expect(service.deleteCatalogContent).toHaveBeenCalledWith('catalog-1')
	})

	it('delegates MoySklad stock diagnostics to service', async () => {
		const result = {
			catalogId: 'catalog-1',
			integrationId: 'integration-1',
			hasIntegration: true,
			integrationActive: true,
			syncStockEnabled: true,
			stockFieldOwnedByMoySklad: true,
			stockWebhookEnabled: true,
			stockWebhookRegistered: true,
			lastStockSyncedAt: '2026-05-17T08:00:00.000Z',
			links: {
				productLinks: 1,
				variantLinks: 2,
				productLinksWithStockSync: 1,
				variantLinksWithStockSync: 2,
				productLinksMissing: 0,
				variantLinksMissing: 0,
				productLinksWithErrors: 0,
				variantLinksWithErrors: 0,
				productSkippedReasons: [],
				variantSkippedReasons: []
			},
			latestRun: null
		}
		service.getCatalogMoySkladStockDiagnostics.mockResolvedValue(result)

		await expect(
			controller.getCatalogMoySkladStockDiagnostics('catalog-1')
		).resolves.toBe(result)
		expect(service.getCatalogMoySkladStockDiagnostics).toHaveBeenCalledWith(
			'catalog-1'
		)
	})

	it('delegates default variant diagnostics to service', async () => {
		const result = {
			catalogId: 'catalog-1',
			sampleLimit: 5,
			checks: [],
			warnCount: 0,
			failCount: 0,
			ok: true
		}
		service.diagnoseCatalogDefaultVariants.mockResolvedValue(result)

		await expect(
			controller.diagnoseCatalogDefaultVariants('catalog-1', {
				sampleLimit: 5
			})
		).resolves.toBe(result)
		expect(service.diagnoseCatalogDefaultVariants).toHaveBeenCalledWith(
			'catalog-1',
			5
		)
	})

	it('delegates missing default variant repair to service', async () => {
		const result = {
			checkedProducts: 2,
			repairedProducts: 1,
			affectedCatalogs: 1
		}
		service.repairCatalogMissingDefaultVariants.mockResolvedValue(result)

		await expect(
			controller.repairCatalogMissingDefaultVariants('catalog-1')
		).resolves.toBe(result)
		expect(service.repairCatalogMissingDefaultVariants).toHaveBeenCalledWith(
			'catalog-1'
		)
	})

	it('delegates default variant price mismatch repair to service', async () => {
		const dto = { apply: false, batchSize: 25, sampleLimit: 5 }
		const result = {
			catalogId: 'catalog-1',
			dryRun: true,
			checkedProducts: 3,
			repairableProducts: 3,
			updatedProducts: 0,
			affectedCatalogs: 0,
			batchSize: 25,
			sampleLimit: 5,
			samples: []
		}
		service.repairCatalogDefaultVariantPriceMismatches.mockResolvedValue(result)

		await expect(
			controller.repairCatalogDefaultVariantPriceMismatches('catalog-1', dto)
		).resolves.toBe(result)
		expect(
			service.repairCatalogDefaultVariantPriceMismatches
		).toHaveBeenCalledWith('catalog-1', dto)
	})

	it('delegates one domain event outbox retry to diagnostics service', async () => {
		const result = { matched: 1, processed: 1, failed: 0, skipped: 0 }
		outbox.retryOne.mockResolvedValue(result)

		await expect(
			controller.retryDomainEventOutboxItem(
				'11111111-1111-1111-1111-111111111111'
			)
		).resolves.toBe(result)
		expect(outbox.retryOne).toHaveBeenCalledWith(
			'11111111-1111-1111-1111-111111111111'
		)
	})

	it('delegates domain event outbox cleanup to diagnostics service', async () => {
		const result = {
			deleted: 5,
			retentionDays: 30,
			cutoff: new Date('2026-04-17T00:00:00.000Z'),
			limit: 5000
		}
		outbox.cleanupProcessed.mockResolvedValue(result)

		await expect(
			controller.cleanupDomainEventOutbox({ retentionDays: 30 })
		).resolves.toBe(result)
		expect(outbox.cleanupProcessed).toHaveBeenCalledWith({
			retentionDays: 30
		})
	})
})

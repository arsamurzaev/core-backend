import { Test } from '@nestjs/testing'

import { INVENTORY_EXTERNAL_STOCK_PORT } from '@/modules/inventory/contracts'

import { IntegrationRepository } from '../../integration.repository'

import { MoySkladStockSyncService } from './moysklad.stock-sync.service'

describe('MoySkladStockSyncService', () => {
	it('is exposed through InventoryExternalStockPort', async () => {
		const module = await Test.createTestingModule({
			providers: [
				MoySkladStockSyncService,
				{
					provide: IntegrationRepository,
					useValue: {
						findProductLinksByIntegration: jest.fn(),
						findVariantLinksByIntegration: jest.fn(),
						findProductIdsWithVariantLinks: jest.fn()
					}
				},
				{
					provide: INVENTORY_EXTERNAL_STOCK_PORT,
					useExisting: MoySkladStockSyncService
				}
			]
		}).compile()

		expect(module.get(INVENTORY_EXTERNAL_STOCK_PORT)).toBe(
			module.get(MoySkladStockSyncService)
		)
	})

	it('reports ignored variant rows separately when variants capability is disabled', async () => {
		const repo = {
			findProductLinksByIntegration: jest.fn().mockResolvedValue([
				{
					productId: 'product-simple',
					externalId: 'simple-external-code',
					rawMeta: { id: 'simple-raw-id' }
				}
			]),
			findVariantLinksByIntegration: jest.fn().mockResolvedValue([
				{
					variantId: 'variant-1',
					externalId: 'variant-external-code',
					rawMeta: { id: 'variant-raw-id' }
				}
			]),
			findProductIdsWithVariantLinks: jest.fn().mockResolvedValue([]),
			updateLinkedProductStock: jest.fn().mockResolvedValue(false),
			updateLinkedVariantStock: jest.fn(),
			touchProductLinkStockSynced: jest.fn().mockResolvedValue(1),
			markVariantLinkStockSkipped: jest.fn().mockResolvedValue(1)
		} as unknown as jest.Mocked<IntegrationRepository>
		const service = new MoySkladStockSyncService(repo)

		const result = await service.applyExternalStockMap({
			catalogId: 'catalog-1',
			integrationId: 'integration-1',
			stockMap: new Map([
				['simple-raw-id', 5],
				['variant-raw-id', 7],
				['unlinked-raw-id', 9]
			]),
			source: 'FULL_SYNC',
			canSyncVariants: false,
			progress: { report: jest.fn().mockResolvedValue(undefined) }
		})

		expect(result).toEqual(
			expect.objectContaining({
				total: 3,
				updated: 0,
				skipped: 0,
				diagnostics: {
					source: 'FULL_SYNC',
					stockRows: 3,
					matchedStockRows: 2,
					unmatchedStockRows: 1,
					productLinks: 1,
					variantLinks: 1,
					ignoredVariantLinks: 1,
					appliedProductLinks: 1,
					appliedVariantLinks: 0,
					skippedReasons: {
						missingStock: 0,
						productHasVariantLinks: 0,
						variantsCapabilityDisabled: 1,
						stockRowWithoutLocalLink: 1,
						capabilityDisabled: 1,
						internalInventory: 0,
						missingMapping: 1,
						snapshotIncomplete: 0,
						priceUnknown: 0,
						stockNotTracked: 0
					}
				}
			})
		)
		expect(repo.updateLinkedProductStock).toHaveBeenCalledWith(
			'catalog-1',
			'product-simple',
			5
		)
		expect(repo.updateLinkedVariantStock).not.toHaveBeenCalled()
		expect(repo.markVariantLinkStockSkipped).toHaveBeenCalledWith(
			'integration-1',
			'variant-1',
			'variants_capability_disabled'
		)
	})

	it('counts parent product stock rows as matched when variant links own stock updates', async () => {
		const repo = {
			findProductLinksByIntegration: jest.fn().mockResolvedValue([
				{
					productId: 'product-with-variants',
					externalId: 'parent-external-code',
					rawMeta: { id: 'parent-raw-id' }
				}
			]),
			findVariantLinksByIntegration: jest.fn().mockResolvedValue([
				{
					variantId: 'variant-1',
					externalId: 'variant-external-code',
					rawMeta: { id: 'variant-raw-id' }
				}
			]),
			findProductIdsWithVariantLinks: jest
				.fn()
				.mockResolvedValue(['product-with-variants']),
			updateLinkedVariantStock: jest.fn().mockResolvedValue({
				changed: false,
				productId: 'product-with-variants',
				variantId: 'variant-1',
				previousStock: 3,
				nextStock: 3
			}),
			updateLinkedProductStock: jest.fn(),
			touchVariantLinkStockSynced: jest.fn().mockResolvedValue(1),
			markProductLinkStockSkipped: jest.fn().mockResolvedValue(1),
			recomputeProductStatusFromVariants: jest.fn().mockResolvedValue(false)
		} as unknown as jest.Mocked<IntegrationRepository>
		const service = new MoySkladStockSyncService(repo)

		const result = await service.applyExternalStockMap({
			catalogId: 'catalog-1',
			integrationId: 'integration-1',
			stockMap: new Map([
				['parent-raw-id', 12],
				['variant-raw-id', 3]
			]),
			source: 'WEBHOOK',
			canSyncVariants: true,
			progress: { report: jest.fn().mockResolvedValue(undefined) }
		})

		expect(result.diagnostics).toEqual({
			source: 'WEBHOOK',
			stockRows: 2,
			matchedStockRows: 2,
			unmatchedStockRows: 0,
			productLinks: 1,
			variantLinks: 1,
			ignoredVariantLinks: 0,
			appliedProductLinks: 0,
			appliedVariantLinks: 1,
			skippedReasons: {
				missingStock: 0,
				productHasVariantLinks: 1,
				variantsCapabilityDisabled: 0,
				stockRowWithoutLocalLink: 0,
				capabilityDisabled: 0,
				internalInventory: 0,
				missingMapping: 0,
				snapshotIncomplete: 0,
				priceUnknown: 0,
				stockNotTracked: 0
			}
		})
		expect(result.skipped).toBe(1)
		expect(repo.updateLinkedProductStock).not.toHaveBeenCalled()
		expect(repo.markProductLinkStockSkipped).toHaveBeenCalledWith(
			'integration-1',
			'product-with-variants',
			'stock_owned_by_variant_links'
		)
	})

	it('marks product and variant links when stock row is missing in external report', async () => {
		const repo = {
			findProductLinksByIntegration: jest.fn().mockResolvedValue([
				{
					productId: 'product-simple',
					externalId: 'simple-external-code',
					rawMeta: { id: 'simple-raw-id' }
				}
			]),
			findVariantLinksByIntegration: jest.fn().mockResolvedValue([
				{
					variantId: 'variant-1',
					externalId: 'variant-external-code',
					rawMeta: { id: 'variant-raw-id' }
				}
			]),
			findProductIdsWithVariantLinks: jest.fn().mockResolvedValue([]),
			updateLinkedProductStock: jest.fn(),
			updateLinkedVariantStock: jest.fn(),
			markProductLinkStockSkipped: jest.fn().mockResolvedValue(1),
			markVariantLinkStockSkipped: jest.fn().mockResolvedValue(1)
		} as unknown as jest.Mocked<IntegrationRepository>
		const service = new MoySkladStockSyncService(repo)

		const result = await service.applyExternalStockMap({
			catalogId: 'catalog-1',
			integrationId: 'integration-1',
			stockMap: new Map([['unlinked-raw-id', 9]]),
			source: 'FULL_SYNC',
			canSyncVariants: true,
			progress: { report: jest.fn().mockResolvedValue(undefined) }
		})

		expect(result.skipped).toBe(2)
		expect(result.diagnostics.skippedReasons).toEqual({
			missingStock: 2,
			productHasVariantLinks: 0,
			variantsCapabilityDisabled: 0,
			stockRowWithoutLocalLink: 1,
			capabilityDisabled: 0,
			internalInventory: 0,
			missingMapping: 1,
			snapshotIncomplete: 2,
			priceUnknown: 0,
			stockNotTracked: 0
		})
		expect(repo.markProductLinkStockSkipped).toHaveBeenCalledWith(
			'integration-1',
			'product-simple',
			'stock_missing_in_external_report'
		)
		expect(repo.markVariantLinkStockSkipped).toHaveBeenCalledWith(
			'integration-1',
			'variant-1',
			'stock_missing_in_external_report'
		)
		expect(repo.updateLinkedProductStock).not.toHaveBeenCalled()
		expect(repo.updateLinkedVariantStock).not.toHaveBeenCalled()
	})
})

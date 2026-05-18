import { ProductStatus } from '@generated/enums'

import { IntegrationRepository } from '../../integration.repository'

import { MoySkladStockSyncService } from './moysklad.stock-sync.service'
import { MoySkladVariantAttributeResolverService } from './moysklad.variant-attribute-resolver.service'
import { MoySkladVariantSyncService } from './moysklad.variant-sync.service'

describe('MoySklad domain events', () => {
	it('dispatches a stock changed event from stock apply', async () => {
		const repo = {
			findProductLinksByIntegration: jest.fn().mockResolvedValue([]),
			findVariantLinksByIntegration: jest.fn().mockResolvedValue([
				{
					variantId: 'variant-1',
					externalId: 'external-variant-1',
					rawMeta: { id: 'external-variant-1' }
				}
			]),
			findProductIdsWithVariantLinks: jest.fn().mockResolvedValue([]),
			updateLinkedVariantStock: jest.fn().mockResolvedValue({
				changed: true,
				productId: 'product-1',
				variantId: 'variant-1',
				previousStock: 1,
				nextStock: 3
			}),
			touchVariantLinkStockSynced: jest.fn().mockResolvedValue(1),
			recomputeProductStatusFromVariants: jest.fn().mockResolvedValue(false)
		} as unknown as jest.Mocked<IntegrationRepository>
		const events = {
			dispatch: jest.fn().mockResolvedValue(undefined)
		}
		const service = new MoySkladStockSyncService(repo, events as any)

		await service.applyExternalStockMap({
			catalogId: 'catalog-1',
			integrationId: 'integration-1',
			stockMap: new Map([['external-variant-1', 3]]),
			source: 'FULL_SYNC',
			canSyncVariants: true,
			progress: { report: jest.fn().mockResolvedValue(undefined) }
		})

		expect(events.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'variant.stock_changed',
				catalogId: 'catalog-1',
				productId: 'product-1',
				variantId: 'variant-1',
				previousStock: 1,
				nextStock: 3,
				source: 'integration',
				reason: 'moysklad_stock_full_sync',
				integrationId: 'integration-1',
				externalId: 'external-variant-1'
			})
		)
	})

	it('marks webhook stock events with webhook reason', async () => {
		const repo = {
			findProductLinksByIntegration: jest.fn().mockResolvedValue([]),
			findVariantLinksByIntegration: jest.fn().mockResolvedValue([
				{
					variantId: 'variant-1',
					externalId: 'external-variant-1',
					rawMeta: { id: 'external-variant-1' }
				}
			]),
			findProductIdsWithVariantLinks: jest.fn().mockResolvedValue([]),
			updateLinkedVariantStock: jest.fn().mockResolvedValue({
				changed: true,
				productId: 'product-1',
				variantId: 'variant-1',
				previousStock: 0,
				nextStock: 2
			}),
			touchVariantLinkStockSynced: jest.fn().mockResolvedValue(1),
			recomputeProductStatusFromVariants: jest.fn().mockResolvedValue(false)
		} as unknown as jest.Mocked<IntegrationRepository>
		const events = {
			dispatch: jest.fn().mockResolvedValue(undefined)
		}
		const service = new MoySkladStockSyncService(repo, events as any)

		await service.applyExternalStockMap({
			catalogId: 'catalog-1',
			integrationId: 'integration-1',
			stockMap: new Map([['external-variant-1', 2]]),
			source: 'WEBHOOK',
			canSyncVariants: true,
			progress: { report: jest.fn().mockResolvedValue(undefined) }
		})

		expect(events.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'variant.stock_changed',
				reason: 'moysklad_stock_webhook',
				integrationId: 'integration-1',
				externalId: 'external-variant-1'
			})
		)
	})

	it('dispatches price and stock changed events from variant sync', async () => {
		const repo = {
			upsertIntegratedProductVariant: jest.fn().mockResolvedValue({
				variant: {
					id: 'variant-1',
					sku: 'SKU-1',
					variantKey: 'moysklad=external-variant-1'
				},
				link: { id: 'link-1' },
				created: false,
				updated: true,
				priceChanged: true,
				previousPrice: 100,
				nextPrice: 120,
				stockChanged: true,
				previousStock: 1,
				nextStock: 5
			})
		} as unknown as jest.Mocked<IntegrationRepository>
		const variantAttributes = {
			resolveForVariant: jest.fn().mockResolvedValue([]),
			buildVariantKey: jest.fn().mockReturnValue('')
		} as unknown as jest.Mocked<MoySkladVariantAttributeResolverService>
		const events = {
			dispatchMany: jest.fn().mockResolvedValue(undefined)
		}
		const service = new MoySkladVariantSyncService(
			repo,
			variantAttributes,
			events as any
		)

		await service.syncExternalVariant({
			catalogId: 'catalog-1',
			integration: {
				id: 'integration-1',
				catalogId: 'catalog-1',
				metadata: {}
			},
			product: {
				id: 'external-variant-1',
				name: 'Variant',
				meta: { type: 'variant' },
				stock: 5,
				salePrices: [
					{
						value: 12000,
						priceType: { name: 'Retail' }
					}
				]
			} as any,
			priceTypeName: 'Retail',
			syncStock: true,
			syncPrice: true,
			syncContent: false,
			parentProductId: 'product-1',
			parentProduct: {
				id: 'product-1',
				sku: 'PRODUCT-1',
				price: 100,
				status: ProductStatus.ACTIVE
			}
		})

		expect(events.dispatchMany).toHaveBeenCalledWith([
			expect.objectContaining({
				type: 'variant.price_changed',
				catalogId: 'catalog-1',
				productId: 'product-1',
				variantId: 'variant-1',
				previousPrice: 100,
				nextPrice: 120,
				source: 'integration',
				reason: 'moysklad_variant_sync'
			}),
			expect.objectContaining({
				type: 'variant.stock_changed',
				catalogId: 'catalog-1',
				productId: 'product-1',
				variantId: 'variant-1',
				previousStock: 1,
				nextStock: 5,
				source: 'integration',
				reason: 'moysklad_variant_sync'
			})
		])
	})
})

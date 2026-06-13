import { CatalogPriceListPriceTarget } from '@generated/enums'

import { RequestContext } from '@/shared/tenancy/request-context'

import { CatalogPriceListService } from './catalog-price-list.service'

describe('CatalogPriceListService', () => {
	let service: CatalogPriceListService
	let repo: {
		findCatalogContext: jest.Mock
		findById: jest.Mock
		findPrices: jest.Mock
	}
	let capabilities: {
		assertCanUseCatalogPriceLists: jest.Mock
		assertCanUseProductVariants: jest.Mock
		assertCanUseCatalogSaleUnits: jest.Mock
	}

	const runWithCatalog = <T>(fn: () => Promise<T>) =>
		RequestContext.run(
			{
				requestId: 'req-1',
				host: 'example.test',
				catalogId: 'catalog-1',
				typeId: 'type-1'
			},
			fn
		)

	beforeEach(() => {
		repo = {
			findCatalogContext: jest.fn().mockResolvedValue({
				id: 'catalog-1',
				parentId: null
			}),
			findById: jest.fn(),
			findPrices: jest.fn().mockResolvedValue([])
		}
		capabilities = {
			assertCanUseCatalogPriceLists: jest.fn().mockResolvedValue(undefined),
			assertCanUseProductVariants: jest.fn().mockResolvedValue(undefined),
			assertCanUseCatalogSaleUnits: jest.fn().mockResolvedValue(undefined)
		}
		service = new CatalogPriceListService(
			repo as any,
			{} as any,
			{} as any,
			capabilities as any
		)
	})

	it('rejects bulk variant prices when variants are disabled', async () => {
		capabilities.assertCanUseProductVariants.mockRejectedValue(
			new Error('variants disabled')
		)

		await expect(
			runWithCatalog(() =>
				service.bulkUpsertPrices('price-list-1', {
					prices: [
						{
							target: CatalogPriceListPriceTarget.VARIANT,
							targetId: 'variant-1',
							price: 100
						}
					]
				})
			)
		).rejects.toThrow('variants disabled')

		expect(capabilities.assertCanUseCatalogPriceLists).toHaveBeenCalledWith(
			'catalog-1'
		)
		expect(capabilities.assertCanUseProductVariants).toHaveBeenCalledWith(
			'catalog-1'
		)
		expect(repo.findById).not.toHaveBeenCalled()
	})

	it('rejects bulk sale-unit prices when sale units are disabled', async () => {
		capabilities.assertCanUseCatalogSaleUnits.mockRejectedValue(
			new Error('sale units disabled')
		)

		await expect(
			runWithCatalog(() =>
				service.bulkUpsertPrices('price-list-1', {
					prices: [
						{
							target: CatalogPriceListPriceTarget.SALE_UNIT,
							targetId: 'sale-unit-1',
							price: 100
						}
					]
				})
			)
		).rejects.toThrow('sale units disabled')

		expect(capabilities.assertCanUseCatalogPriceLists).toHaveBeenCalledWith(
			'catalog-1'
		)
		expect(capabilities.assertCanUseCatalogSaleUnits).toHaveBeenCalledWith(
			'catalog-1'
		)
		expect(repo.findById).not.toHaveBeenCalled()
	})

	it('archives stale sale-unit prices when saving a variant price', async () => {
		const tx = {
			catalogPriceListPrice: {
				updateMany: jest.fn().mockResolvedValue({ count: 1 }),
				upsert: jest.fn().mockResolvedValue({})
			}
		}
		const prisma = {
			product: { findMany: jest.fn().mockResolvedValue([]) },
			productVariant: {
				findMany: jest
					.fn()
					.mockResolvedValue([{ id: 'variant-1', productId: 'product-1' }])
			},
			productVariantSaleUnit: { findMany: jest.fn().mockResolvedValue([]) },
			$transaction: jest.fn(async callback => callback(tx))
		}
		const cache = { bumpVersion: jest.fn().mockResolvedValue(undefined) }
		repo.findById.mockResolvedValue({
			id: 'price-list-1',
			catalogId: 'catalog-1',
			code: 'retail',
			name: 'Розница',
			isActive: true,
			displayOrder: 0,
			deleteAt: null
		})
		service = new CatalogPriceListService(
			repo as any,
			prisma as any,
			cache as any,
			capabilities as any
		)

		await runWithCatalog(() =>
			service.bulkUpsertPrices('price-list-1', {
				prices: [
					{
						target: CatalogPriceListPriceTarget.VARIANT,
						targetId: 'variant-1',
						price: 12
					}
				]
			})
		)

		expect(tx.catalogPriceListPrice.updateMany).toHaveBeenCalledWith({
			where: {
				priceListId: 'price-list-1',
				variantId: 'variant-1',
				target: CatalogPriceListPriceTarget.SALE_UNIT,
				deleteAt: null
			},
			data: { deleteAt: expect.any(Date) }
		})
		expect(tx.catalogPriceListPrice.upsert).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					priceListId_target_targetId: {
						priceListId: 'price-list-1',
						target: CatalogPriceListPriceTarget.VARIANT,
						targetId: 'variant-1'
					}
				}
			})
		)
	})
})

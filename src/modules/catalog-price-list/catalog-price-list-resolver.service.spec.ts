import { CatalogPriceListPriceTarget } from '@generated/enums'

import { CatalogPriceListResolverService } from './catalog-price-list-resolver.service'

describe('CatalogPriceListResolverService', () => {
	let service: CatalogPriceListResolverService
	let capabilities: { canUseCatalogPriceLists: jest.Mock }
	let prisma: {
		catalog: { findFirst: jest.Mock }
		catalogPriceList: { findFirst: jest.Mock }
		catalogPriceListPrice: { findMany: jest.Mock; findFirst: jest.Mock }
		productVariantSaleUnit: { findMany: jest.Mock; findFirst: jest.Mock }
	}

	beforeEach(() => {
		capabilities = {
			canUseCatalogPriceLists: jest.fn().mockResolvedValue(true)
		}
		prisma = {
			catalog: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'catalog-1',
					parentId: null,
					settings: { activePriceListId: 'price-list-1' }
				})
			},
			catalogPriceList: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'price-list-1',
					code: 'retail',
					name: 'Retail'
				})
			},
			catalogPriceListPrice: {
				findMany: jest.fn(),
				findFirst: jest.fn()
			},
			productVariantSaleUnit: {
				findMany: jest.fn(),
				findFirst: jest.fn()
			}
		}
		service = new CatalogPriceListResolverService(
			prisma as never,
			capabilities as never
		)
	})

	it('does not map detached sale unit price rows to current sale units', async () => {
		const decimalLikePrice = {
			toNumber: () => Number.NaN,
			toString: () => '1200.55'
		}
		prisma.catalogPriceListPrice.findMany.mockResolvedValueOnce([
			{
				target: CatalogPriceListPriceTarget.SALE_UNIT,
				targetId: 'old-sale-unit-box',
				productId: 'product-1',
				variantId: 'variant-1',
				saleUnitId: 'old-sale-unit-box',
				price: decimalLikePrice,
				saleUnit: {
					id: 'old-sale-unit-box',
					variantId: 'variant-1',
					catalogSaleUnitId: 'catalog-sale-unit-box',
					code: 'box',
					name: '6 штук',
					baseQuantity: '6.0000',
					deleteAt: new Date('2026-06-01T00:00:00.000Z')
				}
			}
		])
		prisma.productVariantSaleUnit.findMany.mockResolvedValueOnce([
			{
				id: 'new-sale-unit-box',
				variantId: 'variant-1',
				catalogSaleUnitId: 'catalog-sale-unit-box',
				code: 'box',
				name: '6 штук',
				baseQuantity: '6.0000'
			}
		])

		const context = await service.resolveProductPriceContext({
			buyerCatalogId: 'catalog-1',
			ownerCatalogId: 'catalog-1',
			productIds: ['product-1']
		})

		expect(context.saleUnitPrices.get('old-sale-unit-box')).toBe('1200.55')
		expect(context.saleUnitPrices.get('new-sale-unit-box')).toBeUndefined()
		expect(prisma.productVariantSaleUnit.findMany).not.toHaveBeenCalled()
	})

	it('does not map detached sale unit prices to recreated variants by variant key', async () => {
		prisma.catalogPriceListPrice.findMany.mockResolvedValueOnce([
			{
				target: CatalogPriceListPriceTarget.SALE_UNIT,
				targetId: 'old-sale-unit-piece',
				productId: 'product-1',
				variantId: 'old-variant-s',
				saleUnitId: 'old-sale-unit-piece',
				price: 350,
				saleUnit: {
					id: 'old-sale-unit-piece',
					variantId: 'old-variant-s',
					catalogSaleUnitId: 'catalog-sale-unit-piece',
					code: 'piece',
					name: 'piece',
					baseQuantity: '1.0000',
					deleteAt: new Date('2026-06-01T00:00:00.000Z'),
					variant: {
						productId: 'product-1',
						variantKey: 'size=s'
					}
				}
			}
		])
		prisma.productVariantSaleUnit.findMany.mockResolvedValueOnce([
			{
				id: 'new-sale-unit-piece',
				variantId: 'new-variant-s',
				catalogSaleUnitId: 'catalog-sale-unit-piece',
				code: 'piece',
				name: 'piece',
				baseQuantity: '1.0000',
				variant: {
					productId: 'product-1',
					variantKey: 'size=s'
				}
			}
		])

		const context = await service.resolveProductPriceContext({
			buyerCatalogId: 'catalog-1',
			ownerCatalogId: 'catalog-1',
			productIds: ['product-1']
		})

		expect(context.saleUnitPrices.get('old-sale-unit-piece')).toBe('350.00')
		expect(context.saleUnitPrices.get('new-sale-unit-piece')).toBeUndefined()
		expect(prisma.productVariantSaleUnit.findMany).not.toHaveBeenCalled()
	})

	it('does not use detached sale unit price as line price fallback', async () => {
		prisma.catalogPriceListPrice.findFirst.mockResolvedValueOnce(null)
		prisma.productVariantSaleUnit.findFirst.mockResolvedValueOnce({
			id: 'new-sale-unit-box',
			variantId: 'variant-1',
			catalogSaleUnitId: 'catalog-sale-unit-box',
			code: 'box',
			name: '6 штук',
			baseQuantity: '6.0000'
		})
		prisma.catalogPriceListPrice.findMany.mockResolvedValueOnce([{ price: 1200 }])

		const line = await service.resolveLinePrice({
			buyerCatalogId: 'catalog-1',
			ownerCatalogId: 'catalog-1',
			productId: 'product-1',
			variantId: 'variant-1',
			saleUnitId: 'new-sale-unit-box',
			mode: 'SIMPLE'
		})

		expect(line).toEqual({
			priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
			price: null,
			target: CatalogPriceListPriceTarget.SALE_UNIT,
			targetId: 'new-sale-unit-box'
		})
		expect(prisma.productVariantSaleUnit.findFirst).not.toHaveBeenCalled()
	})

	it('does not resolve child active price list when owner capability is disabled', async () => {
		prisma.catalog.findFirst.mockResolvedValueOnce({
			id: 'child-catalog-1',
			parentId: 'catalog-1',
			settings: { activePriceListId: 'price-list-1' }
		})
		capabilities.canUseCatalogPriceLists.mockResolvedValueOnce(true)
		capabilities.canUseCatalogPriceLists.mockResolvedValueOnce(false)

		const activePriceList = await service.resolveActivePriceList({
			buyerCatalogId: 'child-catalog-1',
			ownerCatalogId: 'catalog-1'
		})

		expect(activePriceList).toBeNull()
		expect(prisma.catalogPriceList.findFirst).not.toHaveBeenCalled()
		expect(capabilities.canUseCatalogPriceLists).toHaveBeenNthCalledWith(
			1,
			'child-catalog-1'
		)
		expect(capabilities.canUseCatalogPriceLists).toHaveBeenNthCalledWith(
			2,
			'catalog-1'
		)
	})
})

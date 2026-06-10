import { BadRequestException } from '@nestjs/common'

import { CartOrderSnapshotService } from './cart-order-snapshot.service'

describe('CartOrderSnapshotService', () => {
	let service: CartOrderSnapshotService
	let sellableReader: {
		resolveProductSellable: jest.Mock
		resolveVariantSellable: jest.Mock
	}
	let tx: {
		integrationProductLink: { findMany: jest.Mock }
		integrationVariantLink: { findMany: jest.Mock }
	}

	beforeEach(() => {
		sellableReader = {
			resolveProductSellable: jest.fn(),
			resolveVariantSellable: jest.fn()
		}
		tx = {
			integrationProductLink: { findMany: jest.fn().mockResolvedValue([]) },
			integrationVariantLink: { findMany: jest.fn().mockResolvedValue([]) }
		}
		service = new CartOrderSnapshotService(sellableReader as never)
	})

	it('uses current commercial projection instead of stale cart price snapshot', async () => {
		sellableReader.resolveVariantSellable.mockResolvedValue({
			catalogId: 'catalog-1',
			productId: 'product-1',
			mode: 'SIMPLE',
			variantId: 'variant-1',
			defaultVariantId: 'variant-1',
			requiresVariantSelection: false,
			priceState: 'KNOWN',
			displayPrice: '1200.00',
			minPrice: '1200.00',
			maxPrice: '1200.00',
			availabilityState: 'AVAILABLE',
			stock: 5
		})

		const [item] = await service.buildSnapshotItems(tx as never, 'catalog-1', [
			{
				id: 'cart-item-1',
				productId: 'product-1',
				variantId: 'variant-1',
				saleUnitId: null,
				quantity: 2,
				baseQuantity: 2,
				unitPriceSnapshot: 900,
				product: {
					id: 'product-1',
					catalogId: 'catalog-1',
					name: 'Product',
					slug: 'product',
					price: 900,
					productAttributes: []
				},
				variant: {
					id: 'variant-1',
					sku: 'SKU-1',
					variantKey: 'default',
					price: 900,
					stock: 5,
					status: 'ACTIVE',
					isAvailable: true,
					attributes: []
				},
				saleUnit: null
			}
		])

		expect(item).toEqual(
			expect.objectContaining({
				variantId: 'variant-1',
				priceState: 'KNOWN',
				displayPrice: '1200.00',
				baseUnitPrice: 1200,
				unitPrice: 1200,
				unitPriceSnapshot: 1200,
				lineTotal: 2400
			})
		)
		expect(sellableReader.resolveVariantSellable).toHaveBeenCalledWith(
			'catalog-1',
			'product-1',
			'variant-1',
			{ quantity: 2, enforceStock: false, buyerCatalogId: 'catalog-1' }
		)
	})

	it('stores hidden default variant id for simple products without selected variant', async () => {
		sellableReader.resolveProductSellable.mockResolvedValue({
			catalogId: 'catalog-1',
			productId: 'product-1',
			mode: 'SIMPLE',
			variantId: 'default-variant',
			defaultVariantId: 'default-variant',
			requiresVariantSelection: false,
			priceState: 'KNOWN',
			displayPrice: '500.00',
			minPrice: '500.00',
			maxPrice: '500.00',
			availabilityState: 'AVAILABLE',
			stock: 3
		})

		const [item] = await service.buildSnapshotItems(
			tx as never,
			'catalog-1',
			[
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: null,
					saleUnitId: null,
					quantity: 1,
					unitPriceSnapshot: null,
					product: {
						id: 'product-1',
						catalogId: 'catalog-1',
						name: 'Product',
						slug: 'product',
						price: null,
						productAttributes: []
					}
				}
			],
			{ canUseProductVariants: false }
		)

		expect(item).toEqual(
			expect.objectContaining({
				variantId: 'default-variant',
				variantHidden: true,
				priceState: 'KNOWN',
				unitPrice: 500,
				lineTotal: 500
			})
		)
	})

	it('keeps sale unit snapshot when product variants are disabled but sale units are enabled', async () => {
		sellableReader.resolveVariantSellable.mockResolvedValue({
			catalogId: 'catalog-1',
			productId: 'product-1',
			mode: 'SIMPLE',
			variantId: 'default-variant',
			defaultVariantId: 'default-variant',
			requiresVariantSelection: false,
			priceState: 'KNOWN',
			displayPrice: '500.00',
			minPrice: '500.00',
			maxPrice: '500.00',
			availabilityState: 'AVAILABLE',
			stock: 30
		})

		const [item] = await service.buildSnapshotItems(
			tx as never,
			'catalog-1',
			[
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: 'default-variant',
					saleUnitId: 'sale-unit-box',
					quantity: 2,
					baseQuantity: 24,
					unitPriceSnapshot: 1000,
					product: {
						id: 'product-1',
						catalogId: 'catalog-1',
						name: 'Product',
						slug: 'product',
						price: 500,
						productAttributes: []
					},
					variant: {
						id: 'default-variant',
						sku: 'SKU-1',
						variantKey: 'default',
						price: 500,
						stock: 30,
						status: 'ACTIVE',
						isAvailable: true,
						attributes: []
					},
					saleUnit: {
						id: 'sale-unit-box',
						variantId: 'default-variant',
						code: 'box',
						name: 'Box',
						baseQuantity: 12,
						price: 1000,
						isDefault: true,
						isActive: true,
						displayOrder: 0
					}
				}
			],
			{ canUseProductVariants: false, canUseCatalogSaleUnits: true }
		)

		expect(item).toEqual(
			expect.objectContaining({
				variantId: 'default-variant',
				variantHidden: true,
				variant: null,
				saleUnitId: 'sale-unit-box',
				saleUnitHidden: false,
				saleUnit: expect.objectContaining({
					name: 'Box',
					baseQuantity: 12,
					price: 1000
				}),
				baseQuantity: 24,
				displayPrice: '1000.00',
				unitPrice: 1000,
				lineTotal: 2000
			})
		)
		expect(sellableReader.resolveVariantSellable).toHaveBeenCalledWith(
			'catalog-1',
			'product-1',
			'default-variant',
			{ quantity: 24, enforceStock: false, buyerCatalogId: 'catalog-1' }
		)
	})

	it('uses decimal-like sale unit prices in order snapshots', async () => {
		const decimalLike = {
			toNumber: () => Number.NaN,
			toString: () => '350.00'
		}
		sellableReader.resolveVariantSellable.mockResolvedValue({
			catalogId: 'catalog-1',
			productId: 'product-1',
			mode: 'SIMPLE',
			variantId: 'default-variant',
			defaultVariantId: 'default-variant',
			requiresVariantSelection: false,
			priceState: 'KNOWN',
			displayPrice: '500.00',
			minPrice: '500.00',
			maxPrice: '500.00',
			availabilityState: 'AVAILABLE',
			stock: 30
		})

		const [item] = await service.buildSnapshotItems(tx as never, 'catalog-1', [
			{
				id: 'cart-item-1',
				productId: 'product-1',
				variantId: 'default-variant',
				saleUnitId: 'sale-unit-piece',
				quantity: 2,
				baseQuantity: 2,
				unitPriceSnapshot: null,
				product: {
					id: 'product-1',
					catalogId: 'catalog-1',
					name: 'Product',
					slug: 'product',
					price: 500,
					productAttributes: []
				},
				variant: {
					id: 'default-variant',
					sku: 'SKU-1',
					variantKey: 'default',
					price: 500,
					stock: 30,
					status: 'ACTIVE',
					isAvailable: true,
					attributes: []
				},
				saleUnit: {
					id: 'sale-unit-piece',
					variantId: 'default-variant',
					code: 'piece',
					name: 'Piece',
					baseQuantity: 1,
					price: decimalLike,
					isDefault: true,
					isActive: true,
					displayOrder: 0
				}
			}
		])

		expect(item).toEqual(
			expect.objectContaining({
				displayPrice: '350.00',
				unitPrice: 350,
				unitPriceSnapshot: 350,
				lineTotal: 700
			})
		)
	})

	it('ignores hidden sale unit pricing and quantity when sale units are disabled', async () => {
		sellableReader.resolveVariantSellable.mockResolvedValue({
			catalogId: 'catalog-1',
			productId: 'product-1',
			mode: 'SIMPLE',
			variantId: 'variant-1',
			defaultVariantId: 'variant-1',
			requiresVariantSelection: false,
			priceState: 'KNOWN',
			displayPrice: '500.00',
			minPrice: '500.00',
			maxPrice: '500.00',
			availabilityState: 'AVAILABLE',
			stock: 10
		})

		const [item] = await service.buildSnapshotItems(
			tx as never,
			'catalog-1',
			[
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-1',
					saleUnitId: 'sale-unit-1',
					quantity: 2,
					baseQuantity: 24,
					unitPriceSnapshot: 100,
					product: {
						id: 'product-1',
						catalogId: 'catalog-1',
						name: 'Product',
						slug: 'product',
						price: 300,
						productAttributes: []
					},
					variant: {
						id: 'variant-1',
						sku: 'SKU-1',
						variantKey: 'default',
						price: 300,
						stock: 10,
						status: 'ACTIVE',
						isAvailable: true,
						attributes: []
					},
					saleUnit: {
						id: 'sale-unit-1',
						variantId: 'variant-1',
						code: 'pack',
						name: 'Pack',
						baseQuantity: 12,
						price: 100,
						isDefault: false,
						isActive: true,
						displayOrder: 0
					}
				}
			],
			{ canUseProductVariants: true, canUseCatalogSaleUnits: false }
		)

		expect(item).toEqual(
			expect.objectContaining({
				saleUnitId: null,
				saleUnitHidden: true,
				saleUnit: null,
				baseQuantity: 2,
				priceState: 'KNOWN',
				displayPrice: '500.00',
				unitPrice: 500,
				lineTotal: 1000
			})
		)
		expect(sellableReader.resolveVariantSellable).toHaveBeenCalledWith(
			'catalog-1',
			'product-1',
			'variant-1',
			{ quantity: 2, enforceStock: false, buyerCatalogId: 'catalog-1' }
		)
	})

	it('rejects matrix product checkout without selected variant', async () => {
		sellableReader.resolveProductSellable.mockResolvedValue({
			catalogId: 'catalog-1',
			productId: 'product-1',
			mode: 'MATRIX',
			variantId: null,
			defaultVariantId: 'default-variant',
			requiresVariantSelection: true,
			priceState: 'RANGE',
			displayPrice: '500.00',
			minPrice: '500.00',
			maxPrice: '700.00',
			availabilityState: 'AVAILABLE',
			stock: 3
		})

		await expect(
			service.buildSnapshotItems(tx as never, 'catalog-1', [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: null,
					saleUnitId: null,
					quantity: 1,
					unitPriceSnapshot: null,
					product: {
						id: 'product-1',
						catalogId: 'catalog-1',
						name: 'Product',
						slug: 'product',
						price: null,
						productAttributes: []
					}
				}
			])
		).rejects.toBeInstanceOf(BadRequestException)
	})

	it('keeps unknown price explicit in order snapshot', async () => {
		sellableReader.resolveProductSellable.mockResolvedValue({
			catalogId: 'catalog-1',
			productId: 'product-1',
			mode: 'SIMPLE',
			variantId: null,
			defaultVariantId: null,
			requiresVariantSelection: false,
			priceState: 'UNKNOWN',
			displayPrice: null,
			minPrice: null,
			maxPrice: null,
			availabilityState: 'AVAILABLE',
			stock: null
		})

		const [item] = await service.buildSnapshotItems(tx as never, 'catalog-1', [
			{
				id: 'cart-item-1',
				productId: 'product-1',
				variantId: null,
				saleUnitId: null,
				quantity: 1,
				unitPriceSnapshot: 100,
				product: {
					id: 'product-1',
					catalogId: 'catalog-1',
					name: 'Product',
					slug: 'product',
					price: null,
					productAttributes: []
				}
			}
		])

		expect(item).toEqual(
			expect.objectContaining({
				priceState: 'UNKNOWN',
				displayPrice: null,
				baseUnitPrice: 0,
				unitPrice: 0,
				unitPriceSnapshot: 0,
				lineTotal: 0
			})
		)
	})
})

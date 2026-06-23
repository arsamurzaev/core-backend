import {
	ProductStatus,
	ProductVariantKind,
	ProductVariantStatus
} from '@generated/enums'
import { NotFoundException } from '@nestjs/common'

import { ProductSellableService } from './product-sellable.service'

describe('ProductSellableService', () => {
	let service: ProductSellableService
	let prisma: {
		product: {
			findFirst: jest.Mock
			findMany: jest.Mock
		}
	}

	beforeEach(() => {
		prisma = {
			product: {
				findFirst: jest.fn(),
				findMany: jest.fn()
			}
		}
		service = new ProductSellableService(prisma as never)
	})

	it('resolves a simple product through hidden default variant', async () => {
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: null,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'default-variant',
					variantKey: 'default',
					price: 1200,
					stock: 3,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: []
				}
			]
		})

		await expect(
			service.resolveProductSellable('catalog-1', 'product-1')
		).resolves.toEqual(
			expect.objectContaining({
				mode: 'SIMPLE',
				variantId: 'default-variant',
				defaultVariantId: 'default-variant',
				requiresVariantSelection: false,
				priceState: 'KNOWN',
				displayPrice: '1200.00',
				availabilityState: 'AVAILABLE',
				stock: 3
			})
		)
	})

	it('treats zero stock as available when stock enforcement is disabled', async () => {
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: null,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'default-variant',
					variantKey: 'default',
					price: 1200,
					stock: 0,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: []
				}
			]
		})

		await expect(
			service.resolveProductSellable('catalog-1', 'product-1', {
				enforceStock: false
			})
		).resolves.toEqual(
			expect.objectContaining({
				availabilityState: 'AVAILABLE',
				stock: 0
			})
		)

		await expect(
			service.resolveVariantSellable('catalog-1', 'product-1', 'default-variant', {
				enforceStock: false
			})
		).resolves.toEqual(
			expect.objectContaining({
				mode: 'SIMPLE',
				variantId: 'default-variant',
				availabilityState: 'AVAILABLE',
				stock: 0
			})
		)

		await expect(
			service.resolveVariantSellable('catalog-1', 'product-1', 'default-variant', {
				enforceStock: true
			})
		).resolves.toEqual(
			expect.objectContaining({
				availabilityState: 'OUT_OF_STOCK',
				stock: 0
			})
		)
	})

	it('uses default sale unit price as simple product display price', async () => {
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: 700,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'default-variant',
					variantKey: 'default',
					kind: ProductVariantKind.DEFAULT,
					price: 1200,
					stock: 24,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [],
					saleUnits: [
						{
							id: 'sale-unit-box',
							price: 6000,
							baseQuantity: 12,
							isDefault: true,
							displayOrder: 0
						}
					]
				}
			]
		})

		await expect(
			service.resolveProductSellable('catalog-1', 'product-1')
		).resolves.toEqual(
			expect.objectContaining({
				mode: 'SIMPLE',
				priceState: 'KNOWN',
				displayPrice: '6000.00',
				minPrice: '6000.00',
				maxPrice: '6000.00'
			})
		)
	})

	it('requires variant selection for matrix products and exposes a price range', async () => {
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: null,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'default-variant',
					variantKey: 'default',
					price: null,
					stock: 0,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: []
				},
				{
					id: 'variant-s',
					variantKey: 'size=s',
					price: 1000,
					stock: 2,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [{ id: 'attribute-size-s' }]
				},
				{
					id: 'variant-m',
					variantKey: 'size=m',
					price: 1500,
					stock: 4,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [{ id: 'attribute-size-m' }]
				}
			]
		})

		await expect(
			service.resolveProductSellable('catalog-1', 'product-1')
		).resolves.toEqual(
			expect.objectContaining({
				mode: 'MATRIX',
				variantId: null,
				defaultVariantId: 'default-variant',
				requiresVariantSelection: true,
				priceState: 'RANGE',
				minPrice: '1000.00',
				maxPrice: '1500.00',
				stock: 6
			})
		)
	})

	it('uses default sale unit prices for matrix min and max', async () => {
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: null,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'variant-s',
					variantKey: 'size=s',
					kind: ProductVariantKind.MATRIX,
					price: 1000,
					stock: 2,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [{ id: 'attribute-size-s' }],
					saleUnits: [
						{
							id: 'sale-unit-s',
							price: 900,
							baseQuantity: 1,
							isDefault: true,
							displayOrder: 0
						}
					]
				},
				{
					id: 'variant-m',
					variantKey: 'size=m',
					kind: ProductVariantKind.MATRIX,
					price: 1500,
					stock: 4,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [{ id: 'attribute-size-m' }],
					saleUnits: [
						{
							id: 'sale-unit-m',
							price: 1800,
							baseQuantity: 1,
							isDefault: true,
							displayOrder: 0
						}
					]
				}
			]
		})

		await expect(
			service.resolveProductSellable('catalog-1', 'product-1')
		).resolves.toEqual(
			expect.objectContaining({
				mode: 'MATRIX',
				requiresVariantSelection: true,
				priceState: 'RANGE',
				minPrice: '900.00',
				maxPrice: '1800.00'
			})
		)
	})

	it('resolves selected variant state inside matrix product', async () => {
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: null,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'variant-s',
					variantKey: 'size=s',
					price: null,
					stock: 0,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [{ id: 'attribute-size-s' }]
				}
			]
		})

		await expect(
			service.resolveVariantSellable('catalog-1', 'product-1', 'variant-s', {
				enforceStock: true
			})
		).resolves.toEqual(
			expect.objectContaining({
				mode: 'MATRIX',
				variantId: 'variant-s',
				requiresVariantSelection: false,
				priceState: 'UNKNOWN',
				availabilityState: 'OUT_OF_STOCK'
			})
		)
	})

	it('blocks selected out-of-stock variant even when stock enforcement is disabled', async () => {
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: null,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'variant-s',
					variantKey: 'size=s',
					kind: ProductVariantKind.MATRIX,
					price: 1000,
					stock: 0,
					status: ProductVariantStatus.OUT_OF_STOCK,
					isAvailable: false,
					attributes: [{ id: 'attribute-size-s' }]
				},
				{
					id: 'variant-m',
					variantKey: 'size=m',
					kind: ProductVariantKind.MATRIX,
					price: 1200,
					stock: null,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [{ id: 'attribute-size-m' }]
				}
			]
		})

		await expect(
			service.resolveVariantSellable('catalog-1', 'product-1', 'variant-s')
		).resolves.toEqual(
			expect.objectContaining({
				variantId: 'variant-s',
				availabilityState: 'OUT_OF_STOCK',
				stock: 0
			})
		)
	})

	it('blocks selected unavailable variant even when stock is not enforced', async () => {
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: null,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'variant-s',
					variantKey: 'size=s',
					kind: ProductVariantKind.MATRIX,
					price: 1000,
					stock: null,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: false,
					attributes: [{ id: 'attribute-size-s' }]
				}
			]
		})

		await expect(
			service.resolveVariantSellable('catalog-1', 'product-1', 'variant-s')
		).resolves.toEqual(
			expect.objectContaining({
				variantId: 'variant-s',
				availabilityState: 'OUT_OF_STOCK',
				stock: null
			})
		)
	})

	it('treats null variant stock as untracked stock', async () => {
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: null,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'variant-s',
					variantKey: 'size=s',
					price: 1000,
					stock: null,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [{ id: 'attribute-size-s' }]
				}
			]
		})

		await expect(
			service.resolveVariantSellable('catalog-1', 'product-1', 'variant-s', {
				enforceStock: true,
				quantity: 500
			})
		).resolves.toEqual(
			expect.objectContaining({
				availabilityState: 'AVAILABLE',
				stock: null
			})
		)
	})

	it('falls back to legacy product price for simple products when default variant price is unknown', async () => {
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: 990,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'default-variant',
					variantKey: 'default',
					price: null,
					stock: 0,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: []
				}
			]
		})

		await expect(
			service.resolveProductSellable('catalog-1', 'product-1')
		).resolves.toEqual(
			expect.objectContaining({
				priceState: 'KNOWN',
				displayPrice: '990.00'
			})
		)
	})

	it('does not fall back to legacy product price for matrix products without variant prices', async () => {
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: 990,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'default-variant',
					variantKey: 'default',
					kind: ProductVariantKind.DEFAULT,
					price: 990,
					stock: 0,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: []
				},
				{
					id: 'variant-s',
					variantKey: 'size=s',
					kind: ProductVariantKind.MATRIX,
					price: null,
					stock: 2,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [{ id: 'attribute-size-s' }]
				}
			]
		})

		await expect(
			service.resolveProductSellable('catalog-1', 'product-1')
		).resolves.toEqual(
			expect.objectContaining({
				mode: 'MATRIX',
				requiresVariantSelection: true,
				priceState: 'UNKNOWN',
				displayPrice: null,
				minPrice: null,
				maxPrice: null
			})
		)
	})

	it('uses product price from active price list for simple products', async () => {
		const priceLists = {
			resolveProductPriceContext: jest.fn().mockResolvedValue({
				priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
				productPrices: new Map([['product-1', '850.00']]),
				variantPrices: new Map(),
				saleUnitPrices: new Map()
			})
		}
		service = new ProductSellableService(prisma as never, priceLists as never)
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: 990,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'default-variant',
					variantKey: 'default',
					kind: ProductVariantKind.DEFAULT,
					price: 1200,
					stock: 2,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: []
				}
			]
		})

		await expect(
			service.resolveProductSellable('catalog-1', 'product-1', {
				buyerCatalogId: 'child-catalog-1'
			})
		).resolves.toEqual(
			expect.objectContaining({
				priceState: 'KNOWN',
				displayPrice: '850.00',
				usesPriceList: true,
				priceListId: 'price-list-1',
				priceListCode: 'retail',
				priceListName: 'Retail'
			})
		)
		expect(priceLists.resolveProductPriceContext).toHaveBeenCalledWith({
			buyerCatalogId: 'child-catalog-1',
			ownerCatalogId: 'catalog-1',
			productIds: ['product-1']
		})
	})

	it('ignores price-list sale unit prices when sale units are disabled', async () => {
		const priceLists = {
			resolveProductPriceContext: jest.fn().mockResolvedValue({
				priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
				productPrices: new Map([['product-1', '850.00']]),
				variantPrices: new Map(),
				saleUnitPrices: new Map([['sale-unit-box', '250.00']])
			})
		}
		const capabilities = {
			canUseCatalogSaleUnits: jest.fn().mockResolvedValue(false),
			canUseProductVariants: jest.fn().mockResolvedValue(true)
		}
		service = new ProductSellableService(
			prisma as never,
			priceLists as never,
			capabilities as never
		)
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: 990,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'default-variant',
					variantKey: 'default',
					kind: ProductVariantKind.DEFAULT,
					price: 1200,
					stock: 2,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [],
					saleUnits: [
						{
							id: 'sale-unit-box',
							price: 6000,
							baseQuantity: 12,
							isDefault: true,
							displayOrder: 0
						}
					]
				}
			]
		})

		await expect(
			service.resolveProductSellable('catalog-1', 'product-1', {
				buyerCatalogId: 'catalog-1'
			})
		).resolves.toEqual(
			expect.objectContaining({
				priceState: 'KNOWN',
				displayPrice: '850.00',
				usesPriceList: true
			})
		)
		expect(capabilities.canUseCatalogSaleUnits).toHaveBeenCalledWith('catalog-1')
	})

	it('treats products as simple when product variants are disabled', async () => {
		const capabilities = {
			canUseCatalogSaleUnits: jest.fn().mockResolvedValue(false),
			canUseProductVariants: jest.fn().mockResolvedValue(false)
		}
		service = new ProductSellableService(
			prisma as never,
			undefined,
			capabilities as never
		)
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: 990,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'default-variant',
					variantKey: 'default',
					kind: ProductVariantKind.DEFAULT,
					price: 1200,
					stock: 3,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: []
				},
				{
					id: 'variant-s',
					variantKey: 'size=s',
					kind: ProductVariantKind.MATRIX,
					price: 1000,
					stock: 2,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [{ id: 'attribute-size-s' }]
				}
			]
		})

		await expect(
			service.resolveProductSellable('catalog-1', 'product-1')
		).resolves.toEqual(
			expect.objectContaining({
				mode: 'SIMPLE',
				variantId: 'default-variant',
				requiresVariantSelection: false,
				priceState: 'KNOWN',
				displayPrice: '1200.00',
				stock: 3
			})
		)
	})

	it('ignores technical default variant availability when product variants are disabled', async () => {
		const capabilities = {
			canUseCatalogSaleUnits: jest.fn().mockResolvedValue(false),
			canUseProductVariants: jest.fn().mockResolvedValue(false)
		}
		service = new ProductSellableService(
			prisma as never,
			undefined,
			capabilities as never
		)
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: 990,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'default-variant',
					variantKey: 'default',
					kind: ProductVariantKind.DEFAULT,
					price: 990,
					stock: 0,
					status: ProductVariantStatus.OUT_OF_STOCK,
					isAvailable: false,
					attributes: []
				}
			]
		})

		await expect(
			service.resolveProductSellable('catalog-1', 'product-1', {
				enforceStock: false
			})
		).resolves.toEqual(
			expect.objectContaining({
				mode: 'SIMPLE',
				variantId: 'default-variant',
				priceState: 'KNOWN',
				displayPrice: '990.00',
				availabilityState: 'AVAILABLE',
				stock: 0
			})
		)

		await expect(
			service.resolveVariantSellable('catalog-1', 'product-1', 'default-variant', {
				enforceStock: false
			})
		).resolves.toEqual(
			expect.objectContaining({
				mode: 'SIMPLE',
				variantId: 'default-variant',
				availabilityState: 'AVAILABLE',
				stock: 0
			})
		)

		await expect(
			service.resolveVariantSellable('catalog-1', 'product-1', 'default-variant', {
				enforceStock: true
			})
		).resolves.toEqual(
			expect.objectContaining({
				availabilityState: 'OUT_OF_STOCK',
				stock: 0
			})
		)
	})

	it('ignores active price list when legacy pricing is requested', async () => {
		const priceLists = {
			resolveProductPriceContext: jest.fn().mockResolvedValue({
				priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
				productPrices: new Map([['product-1', '850.00']]),
				variantPrices: new Map(),
				saleUnitPrices: new Map()
			})
		}
		service = new ProductSellableService(prisma as never, priceLists as never)
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: 990,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'default-variant',
					variantKey: 'default',
					kind: ProductVariantKind.DEFAULT,
					price: 1200,
					stock: 2,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: []
				}
			]
		})

		await expect(
			service.resolveProductSellable('catalog-1', 'product-1', {
				buyerCatalogId: 'child-catalog-1',
				ignorePriceList: true
			})
		).resolves.toEqual(
			expect.objectContaining({
				priceState: 'KNOWN',
				displayPrice: '1200.00',
				usesPriceList: false,
				priceListId: null,
				priceListCode: null,
				priceListName: null
			})
		)
		expect(priceLists.resolveProductPriceContext).not.toHaveBeenCalled()
	})

	it('hides matrix variants without active price-list prices from summary', async () => {
		const priceLists = {
			resolveProductPriceContext: jest.fn().mockResolvedValue({
				priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
				productPrices: new Map(),
				variantPrices: new Map([['variant-m', '1500.00']]),
				saleUnitPrices: new Map()
			})
		}
		service = new ProductSellableService(prisma as never, priceLists as never)
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: null,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'variant-s',
					variantKey: 'size=s',
					kind: ProductVariantKind.MATRIX,
					price: 1000,
					stock: 2,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [{ id: 'attribute-size-s' }]
				},
				{
					id: 'variant-m',
					variantKey: 'size=m',
					kind: ProductVariantKind.MATRIX,
					price: 1800,
					stock: 4,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [{ id: 'attribute-size-m' }]
				}
			]
		})

		await expect(
			service.resolveProductSellable('catalog-1', 'product-1')
		).resolves.toEqual(
			expect.objectContaining({
				mode: 'MATRIX',
				priceState: 'KNOWN',
				displayPrice: '1500.00',
				minPrice: '1500.00',
				maxPrice: '1500.00',
				stock: 4
			})
		)
	})

	it('does not fall back to variant prices when active price list misses sale unit prices', async () => {
		const priceLists = {
			resolveProductPriceContext: jest.fn().mockResolvedValue({
				priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
				productPrices: new Map(),
				variantPrices: new Map([['variant-s', '1500.00']]),
				saleUnitPrices: new Map()
			})
		}
		service = new ProductSellableService(prisma as never, priceLists as never)
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: null,
			status: ProductStatus.ACTIVE,
			variants: [
				{
					id: 'variant-s',
					variantKey: 'size=s',
					kind: ProductVariantKind.MATRIX,
					price: 1800,
					stock: 4,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [{ id: 'attribute-size-s' }],
					saleUnits: [
						{
							id: 'sale-unit-s-piece',
							price: 900,
							baseQuantity: 1,
							isDefault: true,
							displayOrder: 0
						}
					]
				}
			]
		})

		await expect(
			service.resolveProductSellable('catalog-1', 'product-1')
		).resolves.toEqual(
			expect.objectContaining({
				priceState: 'UNKNOWN',
				displayPrice: null,
				availabilityState: 'UNAVAILABLE',
				stock: null
			})
		)
	})

	it('resolves multiple products in one query and skips missing ids', async () => {
		prisma.product.findMany.mockResolvedValue([
			{
				id: 'product-1',
				catalogId: 'catalog-1',
				price: null,
				status: ProductStatus.ACTIVE,
				variants: [
					{
						id: 'default-variant-1',
						variantKey: 'default',
						price: 1200,
						stock: 3,
						status: ProductVariantStatus.ACTIVE,
						isAvailable: true,
						attributes: []
					}
				]
			},
			{
				id: 'product-2',
				catalogId: 'catalog-1',
				price: 990,
				status: ProductStatus.ACTIVE,
				variants: []
			}
		])

		const result = await service.resolveProductsSellable('catalog-1', [
			'product-1',
			'product-1',
			'product-2',
			'missing-product'
		])

		expect(prisma.product.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: { in: ['product-1', 'product-2', 'missing-product'] },
					catalogId: 'catalog-1',
					deleteAt: null
				})
			})
		)
		expect([...result.keys()]).toEqual(['product-1', 'product-2'])
		expect(result.get('product-1')).toEqual(
			expect.objectContaining({
				priceState: 'KNOWN',
				displayPrice: '1200.00',
				defaultVariantId: 'default-variant-1'
			})
		)
		expect(result.get('product-2')).toEqual(
			expect.objectContaining({
				priceState: 'KNOWN',
				displayPrice: '990.00'
			})
		)
		expect(result.has('missing-product')).toBe(false)
	})

	it('throws when product is not found in catalog', async () => {
		prisma.product.findFirst.mockResolvedValue(null)

		await expect(
			service.resolveProductSellable('catalog-1', 'missing-product')
		).rejects.toBeInstanceOf(NotFoundException)
	})

	it('throws when selected variant does not belong to product', async () => {
		prisma.product.findFirst.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: null,
			status: ProductStatus.ACTIVE,
			variants: []
		})

		await expect(
			service.resolveVariantSellable('catalog-1', 'product-1', 'missing-variant')
		).rejects.toBeInstanceOf(NotFoundException)
	})
})

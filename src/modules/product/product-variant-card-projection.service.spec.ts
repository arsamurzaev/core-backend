import { ProductVariantKind, ProductVariantStatus } from '@generated/enums'

import { ProductVariantCardProjectionService } from './product-variant-card-projection.service'

describe('ProductVariantCardProjectionService', () => {
	it('builds variant projections from active price-list prices', async () => {
		const repo = {
			findVariantSummaries: jest.fn(),
			findVariantPickerOptions: jest.fn().mockResolvedValue([
				{
					id: 'variant-s',
					productId: 'product-1',
					sku: 'SKU-S',
					variantKey: 'size=s',
					kind: ProductVariantKind.MATRIX,
					price: 1200,
					stock: 5,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [
						{
							attribute: { displayOrder: 0 },
							enumValue: { displayName: 'S', value: 's', displayOrder: 0 }
						}
					],
					saleUnits: [
						{
							id: 'sale-unit-s',
							price: 1200,
							baseQuantity: 1,
							isDefault: true,
							displayOrder: 0
						}
					]
				},
				{
					id: 'variant-m',
					productId: 'product-1',
					sku: 'SKU-M',
					variantKey: 'size=m',
					kind: ProductVariantKind.MATRIX,
					price: 1500,
					stock: 7,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [
						{
							attribute: { displayOrder: 0 },
							enumValue: { displayName: 'M', value: 'm', displayOrder: 1 }
						}
					],
					saleUnits: [
						{
							id: 'sale-unit-m',
							price: 1500,
							baseQuantity: 1,
							isDefault: true,
							displayOrder: 0
						}
					]
				}
			])
		}
		const service = new ProductVariantCardProjectionService(repo as never)

		const result = await service.resolveForProductIds(['product-1'], {
			priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
			productPrices: new Map(),
			variantPrices: new Map(),
			saleUnitPrices: new Map([
				['sale-unit-s', '350.00'],
				['sale-unit-m', '250.00']
			])
		})

		expect(repo.findVariantSummaries).not.toHaveBeenCalled()
		expect(result.get('product-1')).toEqual({
			variantSummary: {
				minPrice: '250.00',
				maxPrice: '350.00',
				activeCount: 2,
				totalStock: 12,
				singleVariantId: null
			},
			variantPickerOptions: [
				expect.objectContaining({
					id: 'variant-s',
					price: '350.00',
					saleUnitId: 'sale-unit-s',
					saleUnitPrice: '350.00'
				}),
				expect.objectContaining({
					id: 'variant-m',
					price: '250.00',
					saleUnitId: 'sale-unit-m',
					saleUnitPrice: '250.00'
				})
			]
		})
	})

	it('does not use sale-unit prices when sale units are disabled', async () => {
		const repo = {
			findVariantSummaries: jest.fn(),
			findVariantPickerOptions: jest.fn().mockResolvedValue([
				{
					id: 'variant-s',
					productId: 'product-1',
					sku: 'SKU-S',
					variantKey: 'size=s',
					kind: ProductVariantKind.MATRIX,
					price: 1200,
					stock: 5,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [],
					saleUnits: [
						{
							id: 'sale-unit-s',
							price: 1200,
							baseQuantity: 1,
							isDefault: true,
							displayOrder: 0
						}
					]
				}
			])
		}
		const service = new ProductVariantCardProjectionService(repo as never)

		const result = await service.resolveForProductIds(
			['product-1'],
			{
				priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
				productPrices: new Map(),
				variantPrices: new Map(),
				saleUnitPrices: new Map([['sale-unit-s', '350.00']])
			},
			{ filterUnavailable: true, canUseCatalogSaleUnits: false }
		)

		expect(result.get('product-1')).toEqual({
			variantSummary: {
				minPrice: null,
				maxPrice: null,
				activeCount: 0,
				totalStock: 0,
				singleVariantId: null
			},
			variantPickerOptions: []
		})
	})

	it('omits active price-list variants without prices from summary and picker options', async () => {
		const repo = {
			findVariantSummaries: jest.fn(),
			findVariantPickerOptions: jest.fn().mockResolvedValue([
				{
					id: 'variant-xs',
					productId: 'product-1',
					sku: 'SKU-XS',
					variantKey: 'size=xs',
					kind: ProductVariantKind.MATRIX,
					price: 1000,
					stock: 5,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [
						{
							attribute: { displayOrder: 0 },
							enumValue: { displayName: 'XS', value: 'xs', displayOrder: 0 }
						}
					],
					saleUnits: []
				},
				{
					id: 'variant-s',
					productId: 'product-1',
					sku: 'SKU-S',
					variantKey: 'size=s',
					kind: ProductVariantKind.MATRIX,
					price: 1200,
					stock: 0,
					status: ProductVariantStatus.OUT_OF_STOCK,
					isAvailable: false,
					attributes: [
						{
							attribute: { displayOrder: 0 },
							enumValue: { displayName: 'S', value: 's', displayOrder: 1 }
						}
					],
					saleUnits: []
				},
				{
					id: 'variant-m',
					productId: 'product-1',
					sku: 'SKU-M',
					variantKey: 'size=m',
					kind: ProductVariantKind.MATRIX,
					price: 1500,
					stock: 3,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [
						{
							attribute: { displayOrder: 0 },
							enumValue: { displayName: 'M', value: 'm', displayOrder: 2 }
						}
					],
					saleUnits: []
				}
			])
		}
		const service = new ProductVariantCardProjectionService(repo as never)

		const result = await service.resolveForProductIds(
			['product-1'],
			{
				priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
				productPrices: new Map(),
				variantPrices: new Map([
					['variant-xs', '350.00'],
					['variant-m', '450.00']
				]),
				saleUnitPrices: new Map()
			},
			{ filterUnavailable: true, canUseCatalogSaleUnits: true }
		)

		expect(result.get('product-1')).toEqual({
			variantSummary: {
				minPrice: '350.00',
				maxPrice: '450.00',
				activeCount: 2,
				totalStock: 8,
				singleVariantId: null
			},
			variantPickerOptions: [
				expect.objectContaining({ id: 'variant-xs', price: '350.00' }),
				expect.objectContaining({ id: 'variant-m', price: '450.00' })
			]
		})
		expect(
			result
				.get('product-1')
				?.variantPickerOptions.some(option => option.id === 'variant-s')
		).toBe(false)
	})

	it('uses variant prices for legacy projections when sale units are disabled', async () => {
		const repo = {
			findVariantSummaries: jest.fn().mockResolvedValue([
				{
					productId: 'product-1',
					minPrice: '1200.00',
					maxPrice: '1500.00',
					activeCount: 2,
					totalStock: 5,
					singleVariantId: null
				}
			]),
			findVariantPickerOptions: jest.fn().mockResolvedValue([
				{
					id: 'variant-s',
					productId: 'product-1',
					sku: 'SKU-S',
					variantKey: 'size=s',
					kind: ProductVariantKind.MATRIX,
					price: 1200,
					stock: 5,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					attributes: [],
					saleUnits: [
						{
							id: 'sale-unit-s',
							price: 350,
							baseQuantity: 1,
							isDefault: true,
							displayOrder: 0
						}
					]
				}
			])
		}
		const service = new ProductVariantCardProjectionService(repo as never)

		const result = await service.resolveForProductIds(['product-1'], undefined, {
			canUseCatalogSaleUnits: false
		})

		expect(repo.findVariantSummaries).toHaveBeenCalledWith(['product-1'], {
			canUseCatalogSaleUnits: false
		})
		expect(result.get('product-1')?.variantSummary).toEqual({
			minPrice: '1200.00',
			maxPrice: '1500.00',
			activeCount: 2,
			totalStock: 5,
			singleVariantId: null
		})
		expect(result.get('product-1')?.variantPickerOptions).toEqual([
			expect.objectContaining({
				id: 'variant-s',
				price: '1200.00',
				saleUnitId: null,
				saleUnitPrice: null
			})
		])
	})
})

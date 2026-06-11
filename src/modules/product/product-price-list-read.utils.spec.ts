import { ProductVariantKind } from '@generated/enums'

import { applyPriceListContextToProduct } from './product-price-list-read.utils'

describe('product price-list read utils', () => {
	it('keeps matrix variants when active price list prices their sale units', () => {
		const result = applyPriceListContextToProduct(
			{
				id: 'product-1',
				price: null,
				variants: [
					{
						id: 'variant-xs',
						kind: ProductVariantKind.MATRIX,
						variantKey: 'size=xs',
						price: null,
						saleUnits: [
							{
								id: 'sale-unit-xs-piece',
								price: null
							}
						]
					},
					{
						id: 'variant-s',
						kind: ProductVariantKind.MATRIX,
						variantKey: 'size=s',
						price: null,
						saleUnits: [
							{
								id: 'sale-unit-s-piece',
								price: null
							}
						]
					}
				]
			},
			{
				priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
				productPrices: new Map(),
				variantPrices: new Map(),
				saleUnitPrices: new Map([
					['sale-unit-xs-piece', '350.00'],
					['sale-unit-s-piece', '360.00']
				])
			},
			{ filterUnavailable: true, canUseCatalogSaleUnits: true }
		)

		expect(result.variants).toHaveLength(2)
		expect(result.variants).toEqual([
			expect.objectContaining({
				id: 'variant-xs',
				price: '350.00',
				saleUnits: [expect.objectContaining({ price: '350.00' })]
			}),
			expect.objectContaining({
				id: 'variant-s',
				price: '360.00',
				saleUnits: [expect.objectContaining({ price: '360.00' })]
			})
		])
	})

	it('does not fall back to variant prices when priced sale units are required', () => {
		const result = applyPriceListContextToProduct(
			{
				id: 'product-1',
				price: null,
				variants: [
					{
						id: 'variant-xs',
						kind: ProductVariantKind.MATRIX,
						variantKey: 'size=xs',
						price: '1000.00',
						saleUnits: [
							{
								id: 'sale-unit-xs-piece',
								price: null
							}
						]
					},
					{
						id: 'variant-s',
						kind: ProductVariantKind.MATRIX,
						variantKey: 'size=s',
						price: '1100.00',
						saleUnits: [
							{
								id: 'sale-unit-s-piece',
								price: null
							}
						]
					}
				]
			},
			{
				priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
				productPrices: new Map(),
				variantPrices: new Map([
					['variant-xs', '1000.00'],
					['variant-s', '1100.00']
				]),
				saleUnitPrices: new Map([['sale-unit-xs-piece', '350.00']])
			},
			{ filterUnavailable: true, canUseCatalogSaleUnits: true }
		)

		expect(result.variants).toEqual([
			expect.objectContaining({
				id: 'variant-xs',
				price: '350.00'
			})
		])
	})

	it('does not expose legacy product price when active price list has no product price', () => {
		const result = applyPriceListContextToProduct(
			{
				id: 'product-1',
				price: '999.00',
				variants: []
			},
			{
				priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
				productPrices: new Map(),
				variantPrices: new Map(),
				saleUnitPrices: new Map()
			},
			{ filterUnavailable: true }
		)

		expect(result.price).toBeNull()
	})

	it('does not keep legacy prices when active price list is applied without filtering', () => {
		const result = applyPriceListContextToProduct(
			{
				id: 'product-1',
				price: '999.00',
				variants: [
					{
						id: 'variant-xs',
						kind: ProductVariantKind.MATRIX,
						variantKey: 'size=xs',
						price: '1000.00',
						saleUnits: [{ id: 'sale-unit-xs-piece', price: '350.00' }]
					}
				]
			},
			{
				priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
				productPrices: new Map(),
				variantPrices: new Map(),
				saleUnitPrices: new Map()
			},
			{ filterUnavailable: false, canUseCatalogSaleUnits: true }
		)

		expect(result.price).toBeNull()
		expect(result.variants).toEqual([
			expect.objectContaining({
				id: 'variant-xs',
				price: null,
				saleUnits: [expect.objectContaining({ price: null })]
			})
		])
	})

	it('keeps zero price as an explicit active price-list price', () => {
		const result = applyPriceListContextToProduct(
			{
				id: 'product-1',
				price: null,
				variants: [
					{
						id: 'variant-xs',
						kind: ProductVariantKind.MATRIX,
						variantKey: 'size=xs',
						price: null,
						saleUnits: [{ id: 'sale-unit-free', price: null }]
					}
				]
			},
			{
				priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
				productPrices: new Map(),
				variantPrices: new Map(),
				saleUnitPrices: new Map([['sale-unit-free', '0.00']])
			},
			{ filterUnavailable: true, canUseCatalogSaleUnits: true }
		)

		expect(result.variants).toEqual([
			expect.objectContaining({
				id: 'variant-xs',
				price: '0.00',
				saleUnits: [expect.objectContaining({ price: '0.00' })]
			})
		])
	})
})

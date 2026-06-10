import {
	applyProductCommercialFields,
	buildFallbackProductCommercialFields,
	toProductCommercialFields,
	toProductCommercialFieldsMap
} from './product-commercial-fields.mapper'

describe('product commercial fields mapper', () => {
	it('maps sellable projection to public commercial fields', () => {
		expect(
			toProductCommercialFields({
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
				stock: 4,
				usesPriceList: true,
				priceListId: 'price-list-1',
				priceListCode: 'retail',
				priceListName: 'Розница'
			})
		).toEqual({
			priceState: 'KNOWN',
			displayPrice: '1200.00',
			minPrice: '1200.00',
			maxPrice: '1200.00',
			availabilityState: 'AVAILABLE',
			stock: 4,
			defaultVariantId: 'variant-1',
			requiresVariantSelection: false,
			usesPriceList: true,
			priceListId: 'price-list-1',
			priceListCode: 'retail',
			priceListName: 'Розница'
		})
	})

	it('maps projection maps without leaking resolver-only fields', () => {
		const result = toProductCommercialFieldsMap(
			new Map([
				[
					'product-1',
					{
						catalogId: 'catalog-1',
						productId: 'product-1',
						mode: 'MATRIX',
						variantId: null,
						defaultVariantId: 'default-variant',
						requiresVariantSelection: true,
						priceState: 'RANGE',
						displayPrice: '900.00',
						minPrice: '900.00',
						maxPrice: '1500.00',
						availabilityState: 'AVAILABLE',
						stock: 8,
						usesPriceList: false,
						priceListId: null,
						priceListCode: null,
						priceListName: null
					}
				]
			])
		)

		expect(result.get('product-1')).toEqual({
			priceState: 'RANGE',
			displayPrice: '900.00',
			minPrice: '900.00',
			maxPrice: '1500.00',
			availabilityState: 'AVAILABLE',
			stock: 8,
			defaultVariantId: 'default-variant',
			requiresVariantSelection: true,
			usesPriceList: false,
			priceListId: null,
			priceListCode: null,
			priceListName: null
		})
	})

	it('applies known commercial price over legacy product price', () => {
		expect(
			applyProductCommercialFields(
				{ id: 'product-1', price: null },
				{
					priceState: 'KNOWN',
					displayPrice: '1500.00',
					minPrice: '1500.00',
					maxPrice: '1500.00',
					availabilityState: 'AVAILABLE',
					stock: 3,
					defaultVariantId: 'variant-1',
					requiresVariantSelection: false,
					usesPriceList: true,
					priceListId: 'price-list-1',
					priceListCode: 'retail',
					priceListName: 'Розница'
				}
			)
		).toEqual(
			expect.objectContaining({
				price: '1500.00',
				priceState: 'KNOWN',
				displayPrice: '1500.00',
				stock: 3
			})
		)
	})

	it('does not leak legacy price when commercial price is unknown', () => {
		expect(
			applyProductCommercialFields(
				{ id: 'product-1', price: '700.00' },
				{
					priceState: 'UNKNOWN',
					displayPrice: null,
					minPrice: null,
					maxPrice: null,
					availabilityState: 'AVAILABLE',
					stock: null,
					defaultVariantId: null,
					requiresVariantSelection: false,
					usesPriceList: true,
					priceListId: 'price-list-1',
					priceListCode: 'retail',
					priceListName: 'Розница'
				}
			)
		).toEqual(
			expect.objectContaining({
				price: null,
				priceState: 'UNKNOWN',
				displayPrice: null
			})
		)
	})

	it('builds fallback fields from nullable legacy price', () => {
		expect(buildFallbackProductCommercialFields({ price: null })).toEqual({
			priceState: 'UNKNOWN',
			displayPrice: null,
			minPrice: null,
			maxPrice: null,
			availabilityState: 'AVAILABLE',
			stock: null,
			defaultVariantId: null,
			requiresVariantSelection: false,
			usesPriceList: false,
			priceListId: null,
			priceListCode: null,
			priceListName: null
		})
		expect(buildFallbackProductCommercialFields({ price: 500 })).toEqual(
			expect.objectContaining({
				priceState: 'KNOWN',
				displayPrice: '500.00'
			})
		)
	})

	it('formats object prices with their own toString context', () => {
		const decimalLike = {
			value: '750.00',
			toString(this: { value: string }) {
				return this.value
			}
		}

		expect(buildFallbackProductCommercialFields({ price: decimalLike })).toEqual(
			expect.objectContaining({
				priceState: 'KNOWN',
				displayPrice: '750.00'
			})
		)
	})
})

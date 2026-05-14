import { ProductPricingService } from './product-pricing.service'

function attribute(key: string, value: unknown) {
	return {
		attribute: { key },
		valueDecimal: value,
		valueInteger: null,
		valueString: null,
		valueDateTime: null
	}
}

describe('ProductPricingService', () => {
	const service = new ProductPricingService()

	it('resolves variant price through the product pricing port', () => {
		const pricing = service.resolveLinePrice({
			product: {
				price: 1000,
				productAttributes: [attribute('discount', 10)]
			},
			variant: { price: 1500 },
			quantity: 2
		})

		expect(pricing.baseUnitPrice).toBe(1500)
		expect(pricing.unitPrice).toBe(1350)
		expect(pricing.lineTotal).toBe(2700)
		expect(pricing.discountPercent).toBe(10)
	})
})

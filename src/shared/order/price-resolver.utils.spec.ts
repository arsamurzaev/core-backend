import { resolveLinePricing } from './price-resolver.utils'

function attribute(key: string, value: unknown) {
	return {
		attribute: { key },
		...(value instanceof Date
			? { valueDateTime: value }
			: typeof value === 'number'
				? { valueDecimal: value }
				: { valueString: value })
	}
}

describe('resolveLinePricing', () => {
	it('applies product percent discount to variant price', () => {
		const pricing = resolveLinePricing({
			product: {
				price: 1000,
				productAttributes: [attribute('discount', 10)]
			},
			variant: { price: 1500 },
			quantity: 2,
			now: new Date('2026-05-12T09:00:00.000Z')
		})

		expect(pricing).toEqual(
			expect.objectContaining({
				baseUnitPrice: 1500,
				unitPrice: 1350,
				discountPercent: 10,
				hasDiscount: true,
				lineTotal: 2700
			})
		)
	})

	it('applies product percent discount to sale unit price', () => {
		const pricing = resolveLinePricing({
			product: {
				price: 1000,
				productAttributes: [attribute('discount', 15)]
			},
			variant: { price: 1000 },
			saleUnit: { price: 1200 },
			quantity: 1,
			now: new Date('2026-05-12T09:00:00.000Z')
		})

		expect(pricing.baseUnitPrice).toBe(1200)
		expect(pricing.unitPrice).toBe(1020)
		expect(pricing.discountPercent).toBe(15)
	})

	it('does not apply discount outside of the active window', () => {
		const pricing = resolveLinePricing({
			product: {
				price: 1000,
				productAttributes: [
					attribute('discount', 20),
					attribute('discountStartAt', '2026-06-01T00:00:00.000Z')
				]
			},
			variant: { price: 1500 },
			quantity: 1,
			now: new Date('2026-05-12T09:00:00.000Z')
		})

		expect(pricing.unitPrice).toBe(1500)
		expect(pricing.hasDiscount).toBe(false)
	})

	it('uses legacy discountedPrice only for simple product prices', () => {
		const product = {
			price: 1000,
			productAttributes: [attribute('discountedPrice', 700)]
		}

		expect(
			resolveLinePricing({
				product,
				quantity: 1,
				now: new Date('2026-05-12T09:00:00.000Z')
			}).unitPrice
		).toBe(700)
		expect(
			resolveLinePricing({
				product,
				variant: { price: 1200 },
				quantity: 1,
				now: new Date('2026-05-12T09:00:00.000Z')
			}).unitPrice
		).toBe(1200)
	})

	it('treats a price-list snapshot as the base price, not a discount', () => {
		const pricing = resolveLinePricing({
			product: {
				price: 800,
				productAttributes: []
			},
			quantity: 1,
			unitPriceSnapshot: 720,
			unitPriceSnapshotIsBasePrice: true,
			now: new Date('2026-05-12T09:00:00.000Z')
		})

		expect(pricing).toEqual(
			expect.objectContaining({
				baseUnitPrice: 720,
				unitPrice: 720,
				discountPercent: 0,
				hasDiscount: false,
				lineTotal: 720
			})
		)
	})
})

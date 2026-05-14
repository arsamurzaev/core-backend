import { CartLinePricingService } from './cart-line-pricing.service'

describe('CartLinePricingService', () => {
	let service: CartLinePricingService
	let tx: {
		productVariantSaleUnit: { findFirst: jest.Mock }
	}

	beforeEach(() => {
		service = new CartLinePricingService()
		tx = {
			productVariantSaleUnit: {
				findFirst: jest.fn()
			}
		}
	})

	it('resolves active sale unit for selected variant', async () => {
		tx.productVariantSaleUnit.findFirst.mockResolvedValue({
			id: 'sale-unit-1',
			variantId: 'variant-1',
			baseQuantity: 6,
			price: 500
		})

		await expect(
			service.resolveSaleUnit(tx as never, 'variant-1', 'sale-unit-1')
		).resolves.toEqual({
			id: 'sale-unit-1',
			variantId: 'variant-1',
			baseQuantity: 6,
			price: 500
		})
	})

	it('builds line snapshot from sale unit price and base quantity', () => {
		const snapshot = service.resolveLineSnapshot({
			variantId: 'variant-1',
			saleUnit: {
				id: 'sale-unit-1',
				variantId: 'variant-1',
				baseQuantity: 6,
				price: 500
			},
			quantity: 2,
			productSnapshot: { price: 1000, productAttributes: [] },
			variantSnapshot: { price: 700, productAttributes: [] }
		})

		expect(snapshot).toEqual({
			baseQuantity: 12,
			unitPriceSnapshot: 500
		})
	})

	it('keeps unit price snapshot empty when product and variant prices are unknown', () => {
		const snapshot = service.resolveLineSnapshot({
			variantId: null,
			saleUnit: null,
			quantity: 2,
			productSnapshot: { price: null, productAttributes: [] },
			variantSnapshot: null
		})

		expect(snapshot).toEqual({
			baseQuantity: 2,
			unitPriceSnapshot: null
		})
	})

	it('compares money values with decimal-like inputs', () => {
		expect(service.isSameMoney({ toNumber: () => 100.004 }, 100)).toBe(true)
	})
})

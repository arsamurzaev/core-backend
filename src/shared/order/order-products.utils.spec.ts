import { normalizeOrderProducts } from './order-products.utils'

describe('order-products utils', () => {
	it('normalizes external product and variant links in order snapshots', () => {
		const [item] = normalizeOrderProducts([
			{
				id: 'line-1',
				productId: 'product-1',
				variantId: 'variant-1',
				quantity: 2,
				unitPrice: '10.50',
				externalProducts: [
					{
						integrationId: 'integration-1',
						provider: 'MOYSKLAD',
						externalId: 'product-code',
						externalCode: 'MS-PRODUCT',
						lastSyncedAt: '2026-03-25T08:00:00.000Z',
						assortmentRef: {
							id: '11111111-1111-1111-1111-111111111111',
							type: 'product'
						}
					}
				],
				externalVariants: [
					{
						integrationId: 'integration-1',
						provider: 'MOYSKLAD',
						externalId: 'variant-code',
						externalCode: 'MS-VARIANT',
						lastSyncedAt: '2026-03-25T08:05:00.000Z',
						assortmentRef: {
							id: '22222222-2222-2222-2222-222222222222',
							type: 'variant'
						}
					}
				],
				product: {
					id: 'product-1',
					name: 'Product',
					slug: 'product'
				}
			}
		])

		expect(item).toEqual(
			expect.objectContaining({
				externalProducts: [
					expect.objectContaining({
						integrationId: 'integration-1',
						provider: 'MOYSKLAD',
						externalId: 'product-code',
						assortmentRef: {
							id: '11111111-1111-1111-1111-111111111111',
							type: 'product'
						}
					})
				],
				externalVariants: [
					expect.objectContaining({
						integrationId: 'integration-1',
						provider: 'MOYSKLAD',
						externalId: 'variant-code',
						assortmentRef: {
							id: '22222222-2222-2222-2222-222222222222',
							type: 'variant'
						}
					})
				]
			})
		)
	})

	it('keeps legacy snapshots compatible when external links are absent', () => {
		const [item] = normalizeOrderProducts([
			{
				id: 'line-1',
				productId: 'product-1',
				variantId: null,
				quantity: 1,
				unitPrice: 100,
				product: {
					id: 'product-1',
					name: 'Product',
					slug: 'product'
				}
			}
		])

		expect(item.externalProducts).toEqual([])
		expect(item.externalVariants).toEqual([])
	})
})

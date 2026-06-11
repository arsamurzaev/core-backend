import { CartStatus } from '@generated/client'

import { mapCartEntity } from './cart.utils'

const NOW = new Date('2026-06-09T00:00:00.000Z')

function buildCart(overrides: Record<string, unknown> = {}) {
	return {
		id: 'cart-1',
		catalogId: 'catalog-1',
		status: CartStatus.DRAFT,
		statusChangedAt: NOW,
		publicKey: null,
		checkoutAt: null,
		checkoutMethod: null,
		checkoutData: null,
		checkoutContacts: null,
		comment: null,
		assignedManagerId: null,
		managerSessionStartedAt: null,
		managerLastSeenAt: null,
		closedAt: null,
		tableSession: null,
		items: [],
		createdAt: NOW,
		updatedAt: NOW,
		...overrides
	}
}

function buildCartItem(overrides: Record<string, unknown> = {}) {
	return {
		id: 'item-1',
		productId: 'product-1',
		variantId: 'variant-1',
		saleUnitId: 'sale-unit-piece',
		modifierSignature: '',
		quantity: 2,
		baseQuantity: 2,
		unitPriceSnapshot: 200,
		priceListId: 'price-list-wholesale',
		priceListCode: 'wholesale',
		priceListName: 'Wholesale',
		guestSessionId: null,
		guestName: null,
		createdAt: NOW,
		updatedAt: NOW,
		product: {
			id: 'product-1',
			name: 'Test product',
			slug: 'test-product',
			price: null,
			productAttributes: [],
			media: []
		},
		variant: {
			id: 'variant-1',
			sku: 'SKU-1',
			variantKey: 'default',
			price: null,
			stock: null,
			status: 'ACTIVE',
			isAvailable: true,
			attributes: []
		},
		saleUnit: {
			id: 'sale-unit-piece',
			variantId: 'variant-1',
			catalogSaleUnitId: null,
			code: 'piece',
			name: 'piece',
			baseQuantity: 1,
			price: 0,
			barcode: null,
			isDefault: true,
			isActive: true,
			displayOrder: 0
		},
		modifiers: [],
		...overrides
	}
}

describe('mapCartEntity', () => {
	it('uses price-list snapshot for sale-unit cart lines with zero legacy price', () => {
		const cart = mapCartEntity(
			buildCart({ items: [buildCartItem()] }),
			undefined,
			{
				canUseProductVariants: true,
				canUseCatalogSaleUnits: true,
				canUseCatalogModifiers: true
			}
		)

		expect(cart.items[0]).toEqual(
			expect.objectContaining({
				priceListId: 'price-list-wholesale',
				unitPriceSnapshot: 200,
				unitPrice: 200,
				lineTotal: 400,
				product: expect.objectContaining({ price: 200 }),
				saleUnit: expect.objectContaining({ price: 200 })
			})
		)
		expect(cart.totals.subtotal).toBe(400)
	})

	it('does not treat a lower price-list snapshot as a discount', () => {
		const cart = mapCartEntity(
			buildCart({
				items: [
					buildCartItem({
						quantity: 1,
						baseQuantity: 1,
						unitPriceSnapshot: 720,
						product: {
							...buildCartItem().product,
							price: 800
						},
						saleUnit: {
							...buildCartItem().saleUnit,
							price: 800
						}
					})
				]
			}),
			undefined,
			{
				canUseProductVariants: true,
				canUseCatalogSaleUnits: true,
				canUseCatalogModifiers: true
			}
		)

		expect(cart.items[0]).toEqual(
			expect.objectContaining({
				baseUnitPrice: 720,
				unitPrice: 720,
				discountPercent: 0,
				hasDiscount: false,
				lineTotal: 720,
				product: expect.objectContaining({ price: 720 }),
				saleUnit: expect.objectContaining({ price: 720 })
			})
		)
		expect(cart.totals).toEqual(
			expect.objectContaining({
				baseSubtotal: 720,
				discountTotal: 0,
				hasDiscount: false,
				subtotal: 720,
				total: 720
			})
		)
	})

	it('uses price-list snapshot for variant cart lines with zero legacy price', () => {
		const cart = mapCartEntity(
			buildCart({
				items: [
					buildCartItem({
						saleUnitId: null,
						saleUnit: null,
						unitPriceSnapshot: 350,
						quantity: 1,
						baseQuantity: 1,
						variant: {
							id: 'variant-1',
							sku: 'SKU-1',
							variantKey: 'size=xl',
							price: 0,
							stock: null,
							status: 'ACTIVE',
							isAvailable: true,
							attributes: []
						}
					})
				]
			}),
			undefined,
			{
				canUseProductVariants: true,
				canUseCatalogSaleUnits: true,
				canUseCatalogModifiers: true
			}
		)

		expect(cart.items[0]).toEqual(
			expect.objectContaining({
				unitPrice: 350,
				lineTotal: 350,
				product: expect.objectContaining({ price: 350 }),
				variant: expect.objectContaining({ price: 350 })
			})
		)
	})

	it('uses price-list snapshot when an internal variant is hidden by capability', () => {
		const cart = mapCartEntity(
			buildCart({ items: [buildCartItem()] }),
			undefined,
			{
				canUseProductVariants: false,
				canUseCatalogSaleUnits: true,
				canUseCatalogModifiers: true
			}
		)

		expect(cart.items[0]).toEqual(
			expect.objectContaining({
				variantId: null,
				unitPriceSnapshot: 200,
				unitPrice: 200,
				lineTotal: 400,
				product: expect.objectContaining({ price: 200 }),
				variant: null,
				saleUnit: expect.objectContaining({ price: 200 })
			})
		)
		expect(cart.totals.subtotal).toBe(400)
	})

	it('reads price-list snapshot from decimal-like values', () => {
		const cart = mapCartEntity(
			buildCart({
				items: [
					buildCartItem({
						unitPriceSnapshot: {
							toNumber: () => Number.NaN,
							toString: () => '200.00'
						},
						quantity: 7
					})
				]
			}),
			undefined,
			{
				canUseProductVariants: false,
				canUseCatalogSaleUnits: true,
				canUseCatalogModifiers: true
			}
		)

		expect(cart.items[0]).toEqual(
			expect.objectContaining({
				unitPriceSnapshot: 200,
				unitPrice: 200,
				lineTotal: 1400,
				product: expect.objectContaining({ price: 200 }),
				saleUnit: expect.objectContaining({ price: 200 })
			})
		)
		expect(cart.totals.subtotal).toBe(1400)
	})
})

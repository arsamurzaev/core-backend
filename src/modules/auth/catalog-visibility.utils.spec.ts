import { canReadInactiveCatalogProducts } from './catalog-visibility.utils'

describe('canReadInactiveCatalogProducts', () => {
	it('returns false for anonymous viewer', () => {
		expect(canReadInactiveCatalogProducts(undefined, undefined)).toBe(false)
	})

	it('returns true for admin', () => {
		expect(
			canReadInactiveCatalogProducts(
				{ id: 'admin-1', role: 'ADMIN' },
				null
			)
		).toBe(true)
	})

	it('returns true for catalog owner', () => {
		expect(
			canReadInactiveCatalogProducts(
				{ id: 'owner-1', role: 'CATALOG' },
				'owner-1'
			)
		).toBe(true)
	})

	it('returns false for non-owner catalog user', () => {
		expect(
			canReadInactiveCatalogProducts(
				{ id: 'catalog-2', role: 'CATALOG' },
				'owner-1'
			)
		).toBe(false)
	})

	it('returns false for regular user', () => {
		expect(
			canReadInactiveCatalogProducts(
				{ id: 'user-1', role: 'USER' },
				'owner-1'
			)
		).toBe(false)
	})
})

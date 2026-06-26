import {
	CATALOG_FEATURE_INVENTORY_INTERNAL,
	CatalogFeatureEntitlementService
} from './catalog-feature-entitlement.service'

describe('CatalogFeatureEntitlementService', () => {
	it('delegates feature checks to capability reader port', async () => {
		const reader = {
			can: jest.fn().mockResolvedValue(true),
			canUseInternalInventory: jest.fn()
		}
		const assertions = {
			assertCanUseInternalInventory: jest.fn()
		}
		const service = new CatalogFeatureEntitlementService(
			reader as any,
			assertions as any
		)
		const at = new Date('2026-05-10T00:00:00.000Z')

		await expect(
			service.canUse('catalog-1', CATALOG_FEATURE_INVENTORY_INTERNAL, at)
		).resolves.toBe(true)

		expect(reader.can).toHaveBeenCalledWith(
			'catalog-1',
			CATALOG_FEATURE_INVENTORY_INTERNAL,
			at
		)
	})

	it('keeps the legacy internal inventory helpers as port delegates', async () => {
		const reader = {
			can: jest.fn(),
			canUseInternalInventory: jest.fn().mockResolvedValue(false)
		}
		const assertions = {
			assertCanUseInternalInventory: jest.fn().mockResolvedValue(undefined)
		}
		const service = new CatalogFeatureEntitlementService(
			reader as any,
			assertions as any
		)

		await expect(service.canUseInternalInventory('catalog-1')).resolves.toBe(
			false
		)
		await expect(
			service.assertCanUseInternalInventory('catalog-1')
		).resolves.toBeUndefined()

		expect(reader.canUseInternalInventory).toHaveBeenCalledWith(
			'catalog-1',
			undefined
		)
		expect(assertions.assertCanUseInternalInventory).toHaveBeenCalledWith(
			'catalog-1'
		)
	})
})

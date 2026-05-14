import { ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { RequestContext } from '@/shared/tenancy/request-context'

import { CatalogFeatureEntitlementService } from '../catalog-feature-entitlement.service'

import { CatalogFeatureEntitlementGuard } from './catalog-feature-entitlement.guard'

describe('CatalogFeatureEntitlementGuard', () => {
	let guard: CatalogFeatureEntitlementGuard
	let reflector: jest.Mocked<Reflector>
	let entitlements: jest.Mocked<CatalogFeatureEntitlementService>
	const context = {
		getHandler: jest.fn(),
		getClass: jest.fn()
	} as unknown as ExecutionContext

	beforeEach(() => {
		reflector = {
			getAllAndOverride: jest.fn()
		} as unknown as jest.Mocked<Reflector>
		entitlements = {
			canUse: jest.fn()
		} as unknown as jest.Mocked<CatalogFeatureEntitlementService>
		guard = new CatalogFeatureEntitlementGuard(reflector, entitlements)
	})

	it('allows request when no feature metadata is present', async () => {
		reflector.getAllAndOverride.mockReturnValue(undefined)

		await expect(guard.canActivate(context)).resolves.toBe(true)
		expect(entitlements.canUse).not.toHaveBeenCalled()
	})

	it('rejects request without catalog context', async () => {
		reflector.getAllAndOverride.mockReturnValue('inventory.internal')

		await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
			ForbiddenException
		)
	})

	it('rejects request when feature is not enabled', async () => {
		reflector.getAllAndOverride.mockReturnValue('inventory.internal')
		entitlements.canUse.mockResolvedValue(false)

		await expect(
			RequestContext.run(
				{ requestId: 'req-1', host: 'example.test', catalogId: 'catalog-1' },
				() => guard.canActivate(context)
			)
		).rejects.toBeInstanceOf(ForbiddenException)
	})

	it('allows request when feature is enabled', async () => {
		reflector.getAllAndOverride.mockReturnValue('inventory.internal')
		entitlements.canUse.mockResolvedValue(true)

		await expect(
			RequestContext.run(
				{ requestId: 'req-1', host: 'example.test', catalogId: 'catalog-1' },
				() => guard.canActivate(context)
			)
		).resolves.toBe(true)
		expect(entitlements.canUse).toHaveBeenCalledWith(
			'catalog-1',
			'inventory.internal'
		)
	})
})

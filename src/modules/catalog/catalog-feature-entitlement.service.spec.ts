import { ForbiddenException } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import {
	CATALOG_FEATURE_INVENTORY_INTERNAL,
	CatalogFeatureEntitlementService
} from './catalog-feature-entitlement.service'

describe('CatalogFeatureEntitlementService', () => {
	let service: CatalogFeatureEntitlementService
	let prisma: {
		catalogFeatureEntitlement: {
			findMany: jest.Mock
		}
	}

	beforeEach(() => {
		prisma = {
			catalogFeatureEntitlement: {
				findMany: jest.fn()
			}
		}
		service = new CatalogFeatureEntitlementService(
			prisma as unknown as PrismaService
		)
	})

	it('returns false when entitlement is missing', async () => {
		prisma.catalogFeatureEntitlement.findMany.mockResolvedValue([])

		await expect(service.canUseInternalInventory('catalog-1')).resolves.toBe(
			false
		)
	})

	it('returns false when entitlement is disabled', async () => {
		prisma.catalogFeatureEntitlement.findMany.mockResolvedValue([
			{
				feature: CATALOG_FEATURE_INVENTORY_INTERNAL,
				enabled: false,
				expiresAt: null
			}
		])

		await expect(service.canUseInternalInventory('catalog-1')).resolves.toBe(
			false
		)
	})

	it('returns false when entitlement is expired', async () => {
		prisma.catalogFeatureEntitlement.findMany.mockResolvedValue([
			{
				feature: CATALOG_FEATURE_INVENTORY_INTERNAL,
				enabled: true,
				expiresAt: new Date('2026-05-01T00:00:00.000Z')
			}
		])

		await expect(
			service.canUseInternalInventory(
				'catalog-1',
				new Date('2026-05-10T00:00:00.000Z')
			)
		).resolves.toBe(false)
	})

	it('returns true when entitlement is enabled and not expired', async () => {
		prisma.catalogFeatureEntitlement.findMany.mockResolvedValue([
			{
				feature: CATALOG_FEATURE_INVENTORY_INTERNAL,
				enabled: true,
				expiresAt: new Date('2026-06-01T00:00:00.000Z')
			}
		])

		await expect(
			service.canUseInternalInventory(
				'catalog-1',
				new Date('2026-05-10T00:00:00.000Z')
			)
		).resolves.toBe(true)
		expect(prisma.catalogFeatureEntitlement.findMany).toHaveBeenCalledWith({
			where: {
				catalogId: 'catalog-1',
				feature: {
					in: expect.arrayContaining([CATALOG_FEATURE_INVENTORY_INTERNAL])
				}
			},
			select: {
				feature: true,
				enabled: true,
				expiresAt: true
			}
		})
	})

	it('throws forbidden when internal inventory entitlement is unavailable', async () => {
		prisma.catalogFeatureEntitlement.findMany.mockResolvedValue([])

		await expect(
			service.assertCanUseInternalInventory('catalog-1')
		).rejects.toBeInstanceOf(ForbiddenException)
	})
})

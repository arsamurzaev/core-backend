import { ForbiddenException } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import {
	CAPABILITY_INTEGRATION_IIKO,
	CAPABILITY_PRODUCT_TYPES,
	CAPABILITY_PRODUCT_VARIANTS
} from './capability.constants'
import { CapabilityService } from './capability.service'

describe('CapabilityService', () => {
	let prisma: {
		catalogFeatureEntitlement: {
			findMany: jest.Mock
		}
	}
	let service: CapabilityService

	beforeEach(() => {
		prisma = {
			catalogFeatureEntitlement: {
				findMany: jest.fn().mockResolvedValue([])
			}
		}
		service = new CapabilityService(prisma as unknown as PrismaService)
	})

	it('returns raw and effective flags', async () => {
		prisma.catalogFeatureEntitlement.findMany.mockResolvedValue([
			{
				feature: CAPABILITY_PRODUCT_TYPES,
				enabled: true,
				expiresAt: null
			}
		])

		const result = await service.getCatalogCapabilities('catalog-1')

		expect(result.raw[CAPABILITY_PRODUCT_TYPES]).toBe(true)
		expect(result.effective[CAPABILITY_PRODUCT_TYPES]).toBe(true)
		expect(result.flags.canUseProductTypes).toBe(true)
		expect(result.definitions.length).toBeGreaterThan(0)
	})

	it('disables variants effectively when product types are disabled', async () => {
		prisma.catalogFeatureEntitlement.findMany.mockResolvedValue([
			{
				feature: CAPABILITY_PRODUCT_VARIANTS,
				enabled: true,
				expiresAt: null
			}
		])

		const result = await service.getCatalogCapabilities('catalog-1')

		expect(result.raw[CAPABILITY_PRODUCT_VARIANTS]).toBe(true)
		expect(result.effective[CAPABILITY_PRODUCT_VARIANTS]).toBe(false)
		expect(result.flags.canUseProductVariants).toBe(false)
		expect(
			result.items.find(item => item.key === CAPABILITY_PRODUCT_VARIANTS)
				?.disabledReason
		).toContain('Requires')
	})

	it('asserts against effective capabilities', async () => {
		prisma.catalogFeatureEntitlement.findMany.mockResolvedValue([
			{
				feature: CAPABILITY_PRODUCT_VARIANTS,
				enabled: true,
				expiresAt: null
			}
		])

		await expect(
			service.assertCanUseProductVariants('catalog-1')
		).rejects.toThrow(ForbiddenException)
	})

	it('treats entitlement expiry dates as inclusive calendar dates', async () => {
		prisma.catalogFeatureEntitlement.findMany.mockResolvedValue([
			{
				feature: CAPABILITY_PRODUCT_TYPES,
				enabled: true,
				expiresAt: new Date(2026, 4, 28)
			}
		])

		await expect(
			service.canUseProductTypes('catalog-1', new Date(2026, 4, 28, 23))
		).resolves.toBe(true)
		await expect(
			service.canUseProductTypes('catalog-1', new Date(2026, 4, 29))
		).resolves.toBe(false)
	})

	it('requires product structure for iiko integration capability', async () => {
		prisma.catalogFeatureEntitlement.findMany.mockResolvedValue([
			{
				feature: CAPABILITY_INTEGRATION_IIKO,
				enabled: true,
				expiresAt: null
			}
		])

		const result = await service.getCatalogCapabilities('catalog-1')

		expect(result.raw[CAPABILITY_INTEGRATION_IIKO]).toBe(true)
		expect(result.effective[CAPABILITY_INTEGRATION_IIKO]).toBe(false)
		expect(result.flags.canUseIikoIntegration).toBe(false)
	})
})

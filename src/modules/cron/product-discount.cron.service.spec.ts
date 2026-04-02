import { ProductDiscountCronService } from './product-discount.cron.service'

describe('ProductDiscountCronService', () => {
	it('delegates discount expiration to product service', async () => {
		const products = {
			expireScheduledDiscounts: jest.fn().mockResolvedValue({
				updatedProducts: 2,
				affectedCatalogs: 1
			})
		}
		const observability = {
			recordCronRun: jest.fn()
		}
		const service = new ProductDiscountCronService(
			products as any,
			observability as any
		)

		await service.expireScheduledDiscounts()

		expect(products.expireScheduledDiscounts).toHaveBeenCalledTimes(1)
		expect(observability.recordCronRun).toHaveBeenCalledWith(
			'product-discount-expiry',
			'success',
			expect.any(Number)
		)
	})

	it('swallows scheduler errors after logging them', async () => {
		const products = {
			expireScheduledDiscounts: jest
				.fn()
				.mockRejectedValue(new Error('scheduler failed'))
		}
		const observability = {
			recordCronRun: jest.fn()
		}
		const service = new ProductDiscountCronService(
			products as any,
			observability as any
		)
		const loggerError = jest
			.spyOn((service as any).logger, 'error')
			.mockImplementation(() => undefined)

		await expect(service.expireScheduledDiscounts()).resolves.toBeUndefined()

		expect(products.expireScheduledDiscounts).toHaveBeenCalledTimes(1)
		expect(observability.recordCronRun).toHaveBeenCalledWith(
			'product-discount-expiry',
			'error',
			expect.any(Number)
		)
		loggerError.mockRestore()
	})
})

import { InventoryReservationCronService } from './inventory-reservation.cron.service'

describe('InventoryReservationCronService', () => {
	it('releases expired reservations and records success metrics', async () => {
		const inventory = {
			releaseExpiredReservations: jest.fn().mockResolvedValue({
				releasedReservations: 2,
				affectedVariants: 1
			})
		}
		const observability = { recordCronRun: jest.fn() }
		const service = new InventoryReservationCronService(
			inventory as any,
			observability as any
		)

		await service.releaseExpiredReservations()

		expect(inventory.releaseExpiredReservations).toHaveBeenCalledTimes(1)
		expect(observability.recordCronRun).toHaveBeenCalledWith(
			'inventory-reservation-expiry',
			'success',
			expect.any(Number)
		)
	})

	it('records an error metric without throwing', async () => {
		const inventory = {
			releaseExpiredReservations: jest.fn().mockRejectedValue(new Error('boom'))
		}
		const observability = { recordCronRun: jest.fn() }
		const service = new InventoryReservationCronService(
			inventory as any,
			observability as any
		)

		await expect(service.releaseExpiredReservations()).resolves.toBeUndefined()

		expect(observability.recordCronRun).toHaveBeenCalledWith(
			'inventory-reservation-expiry',
			'error',
			expect.any(Number)
		)
	})
})

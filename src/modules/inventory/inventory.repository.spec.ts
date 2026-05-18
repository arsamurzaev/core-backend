import {
	INVENTORY_MOVEMENT_SOURCE,
	INVENTORY_MOVEMENT_TYPE,
	INVENTORY_RESERVATION_STATUS
} from './inventory.constants'
import { InventoryRepository } from './inventory.repository'

function createTx() {
	return {
		inventoryWarehouseCatalog: {
			findMany: jest.fn()
		},
		productVariant: {
			findFirst: jest.fn(),
			update: jest.fn()
		},
		inventoryReservation: {
			findMany: jest.fn(),
			findUnique: jest.fn(),
			updateMany: jest.fn(),
			update: jest.fn(),
			create: jest.fn()
		},
		inventoryStockBalance: {
			findUnique: jest.fn(),
			updateMany: jest.fn(),
			aggregate: jest.fn()
		},
		inventoryMovement: {
			findUnique: jest.fn(),
			create: jest.fn()
		}
	}
}

describe('InventoryRepository', () => {
	let repository: InventoryRepository

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-05-11T00:00:00.000Z'))
		repository = new InventoryRepository({} as any)
	})

	afterEach(() => {
		jest.useRealTimers()
	})

	it('lists warehouse reservations only after checking catalog warehouse access', async () => {
		const prisma = {
			inventoryWarehouseCatalog: {
				findFirst: jest.fn().mockResolvedValue({ warehouseId: 'warehouse-1' })
			},
			inventoryReservation: {
				findMany: jest.fn().mockResolvedValue([{ id: 'reservation-1' }])
			}
		}
		const scopedRepository = new InventoryRepository(prisma as any)

		const result = await scopedRepository.findWarehouseReservations(
			'catalog-1',
			'warehouse-1',
			25
		)

		expect(result).toEqual([{ id: 'reservation-1' }])
		expect(prisma.inventoryWarehouseCatalog.findFirst).toHaveBeenCalledWith({
			where: {
				catalogId: 'catalog-1',
				warehouseId: 'warehouse-1',
				warehouse: { deleteAt: null }
			},
			select: { warehouseId: true }
		})
		expect(prisma.inventoryReservation.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					warehouseId: 'warehouse-1',
					warehouse: {
						deleteAt: null,
						catalogs: { some: { catalogId: 'catalog-1' } }
					}
				}),
				take: 25
			})
		)
	})

	it('consumes active reservations from their own warehouse when the default warehouse changed', async () => {
		const tx = createTx()
		tx.inventoryMovement.findUnique.mockResolvedValue(null)
		tx.productVariant.findFirst.mockResolvedValue({ id: 'variant-1' })
		tx.inventoryReservation.findMany.mockResolvedValue([
			{
				id: 'reservation-1',
				warehouseId: 'old-warehouse',
				quantity: 2
			}
		])
		tx.inventoryStockBalance.findUnique
			.mockResolvedValueOnce({
				quantityOnHand: 10,
				quantityReserved: 2,
				quantityAvailable: 8
			})
			.mockResolvedValueOnce({ quantityOnHand: 10 })
		tx.inventoryStockBalance.updateMany.mockResolvedValue({ count: 1 })
		tx.inventoryStockBalance.aggregate.mockResolvedValue({
			_sum: { quantityAvailable: 8 }
		})

		const result = await repository.consumeCompletedOrderStock(tx as any, {
			catalogId: 'catalog-1',
			cartId: 'cart-1',
			orderId: 'order-1',
			actorUserId: 'manager-1',
			lines: [
				{
					cartItemId: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-1',
					quantity: 2
				}
			]
		})

		expect(result).toEqual({
			ok: true,
			warehouseId: 'old-warehouse',
			consumedLines: 1,
			affectedVariantIds: ['variant-1'],
			stockChanges: [
				expect.objectContaining({
					variantId: 'variant-1',
					previousStock: null,
					nextStock: 8,
					changed: true
				})
			]
		})
		expect(tx.inventoryWarehouseCatalog.findMany).not.toHaveBeenCalled()
		expect(tx.inventoryReservation.update).toHaveBeenCalledWith({
			where: { id: 'reservation-1' },
			data: {
				status: INVENTORY_RESERVATION_STATUS.CONSUMED,
				orderId: 'order-1',
				consumedAt: new Date('2026-05-11T00:00:00.000Z')
			}
		})
		expect(tx.inventoryStockBalance.updateMany).toHaveBeenCalledWith({
			where: {
				warehouseId: 'old-warehouse',
				variantId: 'variant-1',
				quantityOnHand: { gte: 2 },
				quantityReserved: { gte: 2 },
				quantityAvailable: { gte: 0 }
			},
			data: {
				quantityOnHand: { decrement: 2 },
				quantityReserved: { decrement: 2 },
				quantityAvailable: { decrement: 0 },
				lastMovementAt: new Date('2026-05-11T00:00:00.000Z')
			}
		})
		expect(tx.inventoryMovement.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				warehouseId: 'old-warehouse',
				variantId: 'variant-1',
				type: INVENTORY_MOVEMENT_TYPE.SALE,
				source: INVENTORY_MOVEMENT_SOURCE.ORDER,
				quantityDelta: -2,
				reservationId: 'reservation-1',
				idempotencyKey: 'inventory:sale:order-1:cart-item-1'
			})
		})
	})

	it('uses the sales warehouse only for the unreserved direct quantity', async () => {
		const tx = createTx()
		tx.inventoryMovement.findUnique.mockResolvedValue(null)
		tx.productVariant.findFirst.mockResolvedValue({ id: 'variant-1' })
		tx.inventoryReservation.findMany.mockResolvedValue([
			{
				id: 'reservation-1',
				warehouseId: 'old-warehouse',
				quantity: 1
			}
		])
		tx.inventoryWarehouseCatalog.findMany.mockResolvedValue([
			{ warehouseId: 'new-warehouse', isDefault: true }
		])
		tx.inventoryStockBalance.findUnique
			.mockResolvedValueOnce({
				quantityOnHand: 10,
				quantityReserved: 1,
				quantityAvailable: 9
			})
			.mockResolvedValueOnce({
				quantityOnHand: 5,
				quantityReserved: 0,
				quantityAvailable: 5
			})
			.mockResolvedValueOnce({ quantityOnHand: 10 })
			.mockResolvedValueOnce({ quantityOnHand: 5 })
		tx.inventoryStockBalance.updateMany.mockResolvedValue({ count: 1 })
		tx.inventoryReservation.create.mockResolvedValue({ id: 'direct-reservation' })
		tx.inventoryStockBalance.aggregate.mockResolvedValue({
			_sum: { quantityAvailable: 11 }
		})

		const result = await repository.consumeCompletedOrderStock(tx as any, {
			catalogId: 'catalog-1',
			cartId: 'cart-1',
			orderId: 'order-1',
			actorUserId: 'manager-1',
			lines: [
				{
					cartItemId: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-1',
					quantity: 3
				}
			]
		})

		expect(result).toEqual({
			ok: true,
			warehouseId: 'old-warehouse',
			consumedLines: 1,
			affectedVariantIds: ['variant-1'],
			stockChanges: [
				expect.objectContaining({
					variantId: 'variant-1',
					previousStock: null,
					nextStock: 11,
					changed: true
				})
			]
		})
		expect(tx.inventoryWarehouseCatalog.findMany).toHaveBeenCalledTimes(1)
		expect(tx.inventoryReservation.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				warehouseId: 'new-warehouse',
				quantity: 2,
				status: INVENTORY_RESERVATION_STATUS.CONSUMED,
				idempotencyKey: 'inventory:sale:order-1:cart-item-1:direct:new-warehouse'
			}),
			select: { id: true }
		})
		expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(2)
		expect(tx.inventoryMovement.create).toHaveBeenNthCalledWith(2, {
			data: expect.objectContaining({
				warehouseId: 'new-warehouse',
				quantityDelta: -2,
				reservationId: 'direct-reservation',
				idempotencyKey: 'inventory:sale:order-1:cart-item-1:direct:new-warehouse'
			})
		})
	})

	it('does not write a reservation when reserve stock is insufficient', async () => {
		const tx = createTx()
		tx.inventoryWarehouseCatalog.findMany.mockResolvedValue([
			{ warehouseId: 'warehouse-1', isDefault: true }
		])
		tx.inventoryReservation.findMany.mockResolvedValue([])
		tx.productVariant.findFirst.mockResolvedValue({ id: 'variant-1' })
		tx.inventoryReservation.findUnique.mockResolvedValue(null)
		tx.inventoryStockBalance.updateMany.mockResolvedValue({ count: 0 })

		const result = await repository.reserveCartStock(tx as any, {
			catalogId: 'catalog-1',
			cartId: 'cart-1',
			expiresAt: new Date('2026-05-11T00:30:00.000Z'),
			actorUserId: null,
			lines: [
				{
					cartItemId: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-1',
					quantity: 10
				}
			]
		})

		expect(result).toEqual({
			ok: false,
			reason: 'INSUFFICIENT_STOCK',
			variantId: 'variant-1'
		})
		expect(tx.inventoryReservation.create).not.toHaveBeenCalled()
		expect(tx.inventoryMovement.create).not.toHaveBeenCalled()
		expect(tx.productVariant.update).not.toHaveBeenCalled()
	})

	it('does not release stock when an active reservation claim is lost', async () => {
		const tx = createTx()
		tx.inventoryReservation.findMany.mockResolvedValue([
			{
				id: 'reservation-1',
				warehouseId: 'warehouse-1',
				variantId: 'variant-1',
				quantity: 2,
				cartId: 'cart-1',
				cartItemId: 'cart-item-1',
				orderId: null,
				idempotencyKey: 'reservation-key'
			}
		])
		tx.inventoryReservation.updateMany.mockResolvedValue({ count: 0 })

		const result = await repository.releaseCartReservations(tx as any, {
			cartId: 'cart-1',
			reason: 'Cart expired',
			actorUserId: null,
			now: new Date('2026-05-11T00:00:00.000Z')
		})

		expect(result).toEqual({
			releasedReservations: 0,
			affectedVariants: 0,
			affectedVariantIds: [],
			affectedCatalogIds: [],
			stockChanges: []
		})
		expect(tx.inventoryStockBalance.findUnique).not.toHaveBeenCalled()
		expect(tx.inventoryMovement.create).not.toHaveBeenCalled()
		expect(tx.productVariant.update).not.toHaveBeenCalled()
	})
})

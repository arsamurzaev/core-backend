import { Test, TestingModule } from '@nestjs/testing'

import { CAPABILITY_INVENTORY_INTERNAL } from '@/modules/capability/capability.constants'
import { CAPABILITY_KEY } from '@/modules/capability/decorators/require-capability.decorator'
import { overrideControllerAuthGuards } from '@/shared/testing/controller-guards.testing'

import { InventoryController } from './inventory.controller'
import { InventoryService } from './inventory.service'

describe('InventoryController', () => {
	let controller: InventoryController
	let service: jest.Mocked<InventoryService>

	beforeEach(async () => {
		const module: TestingModule = await overrideControllerAuthGuards(
			Test.createTestingModule({
				controllers: [InventoryController],
				providers: [
					{
						provide: InventoryService,
						useValue: {
							getWarehouses: jest.fn(),
							getWarehouseById: jest.fn(),
							createWarehouse: jest.fn(),
							updateWarehouse: jest.fn(),
							removeWarehouse: jest.fn(),
							getWarehouseBalances: jest.fn(),
							getWarehouseMovements: jest.fn(),
							getWarehouseReservations: jest.fn(),
							adjustWarehouseStock: jest.fn()
						}
					}
				]
			})
		).compile()

		controller = module.get(InventoryController)
		service = module.get(InventoryService)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})

	it('requires internal inventory feature', () => {
		expect(Reflect.getMetadata(CAPABILITY_KEY, InventoryController)).toBe(
			CAPABILITY_INVENTORY_INTERNAL
		)
	})

	it('delegates warehouse list to service', async () => {
		service.getWarehouses.mockResolvedValue([])

		const result = await controller.getWarehouses()

		expect(service.getWarehouses).toHaveBeenCalledWith()
		expect(result).toEqual([])
	})

	it('delegates warehouse creation to service', async () => {
		service.createWarehouse.mockResolvedValue({ id: 'warehouse-1' } as any)
		const dto = { name: 'Main Warehouse', isDefault: true }

		const result = await controller.createWarehouse(dto)

		expect(service.createWarehouse).toHaveBeenCalledWith(dto)
		expect(result).toEqual({ id: 'warehouse-1' })
	})

	it('delegates warehouse update to service', async () => {
		service.updateWarehouse.mockResolvedValue({ id: 'warehouse-1' } as any)
		const dto = { name: 'Updated' }

		const result = await controller.updateWarehouse('warehouse-1', dto)

		expect(service.updateWarehouse).toHaveBeenCalledWith('warehouse-1', dto)
		expect(result).toEqual({ id: 'warehouse-1' })
	})

	it('delegates balances list to service', async () => {
		service.getWarehouseBalances.mockResolvedValue([])

		const result = await controller.getWarehouseBalances('warehouse-1')

		expect(service.getWarehouseBalances).toHaveBeenCalledWith('warehouse-1')
		expect(result).toEqual([])
	})

	it('delegates movement journal to service', async () => {
		service.getWarehouseMovements.mockResolvedValue([])

		const result = await controller.getWarehouseMovements('warehouse-1', '10')

		expect(service.getWarehouseMovements).toHaveBeenCalledWith(
			'warehouse-1',
			'10'
		)
		expect(result).toEqual([])
	})

	it('delegates reservation list to service', async () => {
		service.getWarehouseReservations.mockResolvedValue([])

		const result = await controller.getWarehouseReservations('warehouse-1', '10')

		expect(service.getWarehouseReservations).toHaveBeenCalledWith(
			'warehouse-1',
			'10'
		)
		expect(result).toEqual([])
	})

	it('delegates stock adjustment to service', async () => {
		service.adjustWarehouseStock.mockResolvedValue({ variantStock: 5 } as any)
		const dto = { variantId: 'variant-1', quantityDelta: 5 }
		const req = {
			user: { id: 'user-1' }
		} as any

		const result = await controller.adjustWarehouseStock('warehouse-1', dto, req)

		expect(service.adjustWarehouseStock).toHaveBeenCalledWith(
			'warehouse-1',
			dto,
			req
		)
		expect(result).toEqual({ variantStock: 5 })
	})

	it('delegates warehouse removal to service', async () => {
		service.removeWarehouse.mockResolvedValue({ ok: true })

		const result = await controller.removeWarehouse('warehouse-1')

		expect(service.removeWarehouse).toHaveBeenCalledWith('warehouse-1')
		expect(result).toEqual({ ok: true })
	})
})

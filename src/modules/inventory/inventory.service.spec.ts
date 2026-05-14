import {
	BadRequestException,
	ForbiddenException,
	NotFoundException
} from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { AuditService } from '@/modules/audit/audit.service'
import { CapabilityService } from '@/modules/capability/capability.service'
import { ObservabilityService } from '@/modules/observability/observability.service'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { RequestContext } from '@/shared/tenancy/request-context'

import { INVENTORY_WAREHOUSE_STATUS } from './inventory.constants'
import { InventoryRepository } from './inventory.repository'
import { InventoryService } from './inventory.service'

const CATALOG_ID = 'catalog-1'
const OWNER_USER_ID = 'owner-1'
const WAREHOUSE_ID = 'warehouse-1'

const runWithCatalog = <T>(fn: () => T): T =>
	RequestContext.run(
		{
			requestId: 'req-1',
			host: 'example.test',
			catalogId: CATALOG_ID,
			ownerUserId: OWNER_USER_ID
		},
		fn
	)

const warehouseRecord = {
	id: WAREHOUSE_ID,
	name: 'Main Warehouse',
	code: 'main-warehouse',
	status: INVENTORY_WAREHOUSE_STATUS.ACTIVE,
	address: null,
	isDefault: true,
	deleteAt: null,
	createdAt: new Date('2026-01-01T00:00:00.000Z'),
	updatedAt: new Date('2026-01-01T00:00:00.000Z')
}

describe('InventoryService', () => {
	let service: InventoryService
	let repo: jest.Mocked<InventoryRepository>
	let entitlements: jest.Mocked<CapabilityService>
	let audit: jest.Mocked<AuditService>
	let observability: jest.Mocked<ObservabilityService>
	let cache: jest.Mocked<CacheService>

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				InventoryService,
				{
					provide: InventoryRepository,
					useValue: {
						findCatalogInventorySettings: jest.fn(),
						findWarehouses: jest.fn(),
						findWarehouseById: jest.fn(),
						createWarehouse: jest.fn(),
						updateWarehouse: jest.fn(),
						softDeleteWarehouse: jest.fn(),
						existsWarehouseCode: jest.fn(),
						findWarehouseBalances: jest.fn(),
						findWarehouseMovements: jest.fn(),
						findWarehouseReservations: jest.fn(),
						adjustStock: jest.fn(),
						resyncWarehouseVariantStocks: jest.fn(),
						reserveCartStock: jest.fn(),
						releaseCartReservations: jest.fn(),
						consumeCompletedOrderStock: jest.fn(),
						releaseExpiredReservations: jest.fn()
					}
				},
				{
					provide: CapabilityService,
					useValue: {
						assertCanUseInternalInventory: jest.fn()
					}
				},
				{
					provide: AuditService,
					useValue: {
						record: jest.fn()
					}
				},
				{
					provide: ObservabilityService,
					useValue: {
						recordInventoryMovement: jest.fn()
					}
				},
				{
					provide: CacheService,
					useValue: {
						bumpVersion: jest.fn()
					}
				}
			]
		}).compile()

		service = module.get(InventoryService)
		repo = module.get(InventoryRepository)
		entitlements = module.get(CapabilityService)
		audit = module.get(AuditService)
		observability = module.get(ObservabilityService)
		cache = module.get(CacheService)

		entitlements.assertCanUseInternalInventory.mockResolvedValue(undefined)
		repo.findCatalogInventorySettings.mockResolvedValue({
			inventoryMode: 'INTERNAL'
		} as any)
		repo.existsWarehouseCode.mockResolvedValue(false)
		repo.findWarehouses.mockResolvedValue([warehouseRecord] as any)
		repo.findWarehouseById.mockResolvedValue(warehouseRecord as any)
		repo.createWarehouse.mockResolvedValue(warehouseRecord as any)
		repo.updateWarehouse.mockResolvedValue(warehouseRecord as any)
		repo.softDeleteWarehouse.mockResolvedValue(warehouseRecord as any)
		repo.resyncWarehouseVariantStocks.mockResolvedValue([])
		repo.findWarehouseBalances.mockResolvedValue([])
		repo.findWarehouseMovements.mockResolvedValue([])
		repo.findWarehouseReservations.mockResolvedValue([])
		repo.adjustStock.mockResolvedValue({
			ok: true,
			balance: { id: 'balance-1' },
			movement: {
				id: 'movement-1',
				type: 'RECEIPT',
				source: 'MANUAL',
				quantityAfter: 5
			},
			variantStock: 5
		} as any)
		repo.reserveCartStock.mockResolvedValue({
			ok: true,
			warehouseId: WAREHOUSE_ID,
			reservedLines: 1,
			releasedReservations: 0,
			affectedVariantIds: ['variant-1']
		} as any)
		repo.releaseCartReservations.mockResolvedValue({
			releasedReservations: 1,
			affectedVariants: 1,
			affectedVariantIds: ['variant-1'],
			affectedCatalogIds: [CATALOG_ID]
		})
		repo.consumeCompletedOrderStock.mockResolvedValue({
			ok: true,
			warehouseId: WAREHOUSE_ID,
			consumedLines: 1,
			affectedVariantIds: ['variant-1']
		} as any)
		repo.releaseExpiredReservations.mockResolvedValue({
			releasedReservations: 1,
			affectedVariants: 1,
			affectedVariantIds: ['variant-1'],
			affectedCatalogIds: [CATALOG_ID]
		})
	})

	it('creates a warehouse only for an entitled INTERNAL catalog', async () => {
		const result = await runWithCatalog(() =>
			service.createWarehouse({
				name: ' Main Warehouse ',
				isDefault: true
			})
		)

		expect(entitlements.assertCanUseInternalInventory).toHaveBeenCalledWith(
			CATALOG_ID
		)
		expect(repo.findCatalogInventorySettings).toHaveBeenCalledWith(CATALOG_ID)
		expect(repo.existsWarehouseCode).toHaveBeenCalledWith(
			CATALOG_ID,
			'main-warehouse'
		)
		expect(repo.createWarehouse).toHaveBeenCalledWith(
			CATALOG_ID,
			OWNER_USER_ID,
			{
				name: 'Main Warehouse',
				code: 'main-warehouse',
				status: INVENTORY_WAREHOUSE_STATUS.ACTIVE,
				address: null
			},
			true
		)
		expect(result.id).toBe(WAREHOUSE_ID)
	})

	it('does not reach repository writes when entitlement is missing', async () => {
		entitlements.assertCanUseInternalInventory.mockRejectedValue(
			new ForbiddenException('Internal inventory is not enabled for this catalog')
		)

		await expect(
			runWithCatalog(() => service.createWarehouse({ name: 'Main Warehouse' }))
		).rejects.toBeInstanceOf(ForbiddenException)

		expect(repo.findCatalogInventorySettings).not.toHaveBeenCalled()
		expect(repo.createWarehouse).not.toHaveBeenCalled()
	})

	it('does not create a warehouse when catalog mode is not INTERNAL', async () => {
		repo.findCatalogInventorySettings.mockResolvedValue({
			inventoryMode: 'EXTERNAL'
		} as any)

		await expect(
			runWithCatalog(() => service.createWarehouse({ name: 'Main Warehouse' }))
		).rejects.toBeInstanceOf(ForbiddenException)

		expect(repo.createWarehouse).not.toHaveBeenCalled()
	})

	it('rejects empty warehouse updates', async () => {
		await expect(
			runWithCatalog(() => service.updateWarehouse(WAREHOUSE_ID, {}))
		).rejects.toBeInstanceOf(BadRequestException)

		expect(repo.updateWarehouse).not.toHaveBeenCalled()
	})

	it('rejects disabled default warehouse', async () => {
		await expect(
			runWithCatalog(() =>
				service.updateWarehouse(WAREHOUSE_ID, {
					status: INVENTORY_WAREHOUSE_STATUS.DISABLED,
					isDefault: true
				})
			)
		).rejects.toBeInstanceOf(BadRequestException)

		expect(repo.updateWarehouse).not.toHaveBeenCalled()
	})

	it('throws not found for scoped update misses', async () => {
		repo.updateWarehouse.mockResolvedValue(null)

		await expect(
			runWithCatalog(() =>
				service.updateWarehouse(WAREHOUSE_ID, {
					name: 'Updated'
				})
			)
		).rejects.toBeInstanceOf(NotFoundException)
	})

	it('soft deletes a scoped warehouse', async () => {
		const result = await runWithCatalog(() =>
			service.removeWarehouse(WAREHOUSE_ID)
		)

		expect(repo.softDeleteWarehouse).toHaveBeenCalledWith(
			CATALOG_ID,
			WAREHOUSE_ID
		)
		expect(result).toEqual({ ok: true })
	})

	it('creates stock adjustment with movement and variant stock read-model', async () => {
		const result = await runWithCatalog(() =>
			service.adjustWarehouseStock(
				WAREHOUSE_ID,
				{
					variantId: 'variant-1',
					quantityDelta: 5,
					reason: 'Manual receipt'
				},
				'user-1'
			)
		)

		expect(repo.adjustStock).toHaveBeenCalledWith(
			CATALOG_ID,
			WAREHOUSE_ID,
			'variant-1',
			5,
			'Manual receipt',
			'user-1'
		)
		expect(result).toEqual({
			ok: true,
			balance: { id: 'balance-1' },
			movement: {
				id: 'movement-1',
				type: 'RECEIPT',
				source: 'MANUAL',
				quantityAfter: 5
			},
			variantStock: 5
		})
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'inventory.manual_movement.create',
				targetId: 'movement-1',
				targetCatalogId: CATALOG_ID,
				metadata: expect.objectContaining({
					warehouseId: WAREHOUSE_ID,
					variantId: 'variant-1',
					quantityDelta: 5,
					quantityAfter: 5
				})
			})
		)
		expect(observability.recordInventoryMovement).toHaveBeenCalledWith(
			'RECEIPT',
			'MANUAL',
			'success',
			1
		)
	})

	it('lists warehouse reservations with normalized limit', async () => {
		await expect(
			runWithCatalog(() => service.getWarehouseReservations(WAREHOUSE_ID, '500'))
		).resolves.toEqual([])

		expect(repo.findWarehouseReservations).toHaveBeenCalledWith(
			CATALOG_ID,
			WAREHOUSE_ID,
			100
		)
	})

	it.each([0, '0', 'abc', 1.5, '1.5'])(
		'rejects invalid warehouse history limit %p',
		async limit => {
			await expect(
				runWithCatalog(() =>
					service.getWarehouseMovements(WAREHOUSE_ID, limit as any)
				)
			).rejects.toBeInstanceOf(BadRequestException)

			expect(repo.findWarehouseMovements).not.toHaveBeenCalled()
		}
	)

	it('throws not found when reservation warehouse is missing', async () => {
		repo.findWarehouseReservations.mockResolvedValue(null)

		await expect(
			runWithCatalog(() => service.getWarehouseReservations(WAREHOUSE_ID))
		).rejects.toBeInstanceOf(NotFoundException)
	})

	it('rejects stock adjustment when write-off would make available stock negative', async () => {
		repo.adjustStock.mockResolvedValue({
			ok: false,
			reason: 'INSUFFICIENT_STOCK'
		})

		await expect(
			runWithCatalog(() =>
				service.adjustWarehouseStock(
					WAREHOUSE_ID,
					{
						variantId: 'variant-1',
						quantityDelta: -10
					},
					'user-1'
				)
			)
		).rejects.toBeInstanceOf(BadRequestException)
		expect(audit.record).not.toHaveBeenCalled()
	})

	it('delegates cart stock reservation with a generated expiration date', async () => {
		const tx = {} as any

		await expect(
			service.reserveCartStockTx(tx, {
				catalogId: CATALOG_ID,
				cartId: 'cart-1',
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
		).resolves.toEqual([CATALOG_ID])

		expect(entitlements.assertCanUseInternalInventory).toHaveBeenCalledWith(
			CATALOG_ID
		)
		expect(repo.reserveCartStock).toHaveBeenCalledWith(
			tx,
			expect.objectContaining({
				catalogId: CATALOG_ID,
				cartId: 'cart-1',
				actorUserId: 'manager-1',
				expiresAt: expect.any(Date),
				lines: [
					{
						cartItemId: 'cart-item-1',
						productId: 'product-1',
						variantId: 'variant-1',
						quantity: 2
					}
				]
			})
		)
		expect(observability.recordInventoryMovement).toHaveBeenCalledWith(
			'RESERVE',
			'CART',
			'success',
			1
		)
	})

	it('maps cart reservation stock failures to business exceptions', async () => {
		repo.reserveCartStock.mockResolvedValue({
			ok: false,
			reason: 'INSUFFICIENT_STOCK',
			variantId: 'variant-1'
		} as any)

		await expect(
			service.reserveCartStockTx({} as any, {
				catalogId: CATALOG_ID,
				cartId: 'cart-1',
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
		).rejects.toBeInstanceOf(BadRequestException)
	})

	it('blocks cart stock reservation when internal inventory entitlement expired', async () => {
		entitlements.assertCanUseInternalInventory.mockRejectedValue(
			new ForbiddenException('Internal inventory is not enabled for this catalog')
		)

		await expect(
			service.reserveCartStockTx({} as any, {
				catalogId: CATALOG_ID,
				cartId: 'cart-1',
				actorUserId: null,
				lines: [
					{
						cartItemId: 'cart-item-1',
						productId: 'product-1',
						variantId: 'variant-1',
						quantity: 1
					}
				]
			})
		).rejects.toBeInstanceOf(ForbiddenException)

		expect(repo.reserveCartStock).not.toHaveBeenCalled()
	})

	it('records sale movement metric when consuming completed order stock', async () => {
		const tx = {} as any

		await expect(
			service.consumeCompletedOrderStockTx(tx, {
				catalogId: CATALOG_ID,
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
		).resolves.toEqual([CATALOG_ID])

		expect(entitlements.assertCanUseInternalInventory).toHaveBeenCalledWith(
			CATALOG_ID
		)
		expect(repo.consumeCompletedOrderStock).toHaveBeenCalledWith(tx, {
			catalogId: CATALOG_ID,
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
		expect(observability.recordInventoryMovement).toHaveBeenCalledWith(
			'SALE',
			'ORDER',
			'success',
			1
		)
	})

	it('blocks completed order stock consumption when internal inventory entitlement expired', async () => {
		entitlements.assertCanUseInternalInventory.mockRejectedValue(
			new ForbiddenException('Internal inventory is not enabled for this catalog')
		)

		await expect(
			service.consumeCompletedOrderStockTx({} as any, {
				catalogId: CATALOG_ID,
				cartId: 'cart-1',
				orderId: 'order-1',
				actorUserId: null,
				lines: [
					{
						cartItemId: 'cart-item-1',
						productId: 'product-1',
						variantId: 'variant-1',
						quantity: 1
					}
				]
			})
		).rejects.toBeInstanceOf(ForbiddenException)

		expect(repo.consumeCompletedOrderStock).not.toHaveBeenCalled()
	})

	it('releases cart reservations through repository', async () => {
		const tx = {} as any
		const now = new Date('2026-05-11T00:00:00.000Z')

		await expect(
			service.releaseCartReservationsTx(tx, {
				catalogId: CATALOG_ID,
				cartId: 'cart-1',
				reason: 'Cart expired',
				actorUserId: null,
				now
			})
		).resolves.toEqual({
			releasedReservations: 1,
			affectedVariants: 1,
			affectedVariantIds: ['variant-1'],
			affectedCatalogIds: [CATALOG_ID]
		})
		expect(repo.releaseCartReservations).toHaveBeenCalledWith(tx, {
			catalogId: CATALOG_ID,
			cartId: 'cart-1',
			reason: 'Cart expired',
			actorUserId: null,
			now
		})
		expect(observability.recordInventoryMovement).toHaveBeenCalledWith(
			'RELEASE',
			'CART',
			'success',
			1
		)
	})

	it('delegates expired reservation release with an explicit clock', async () => {
		const now = new Date('2026-05-11T00:00:00.000Z')

		await expect(service.releaseExpiredReservations(now)).resolves.toEqual({
			releasedReservations: 1,
			affectedVariants: 1,
			affectedVariantIds: ['variant-1'],
			affectedCatalogIds: [CATALOG_ID]
		})
		expect(repo.releaseExpiredReservations).toHaveBeenCalledWith(now)
		expect(observability.recordInventoryMovement).toHaveBeenCalledWith(
			'RELEASE',
			'SYSTEM',
			'success',
			1
		)
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			PRODUCTS_CACHE_VERSION,
			CATALOG_ID
		)
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			CATEGORY_PRODUCTS_CACHE_VERSION,
			CATALOG_ID
		)
	})
})

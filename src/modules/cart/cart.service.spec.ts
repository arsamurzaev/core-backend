import { CartStatus, OrderStatus, Role } from '@generated/client'
import { Test, TestingModule } from '@nestjs/testing'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { CartService } from './cart.service'

function createCartEntity(overrides: Record<string, unknown> = {}) {
	return {
		id: 'cart-1',
		catalogId: 'catalog-1',
		token: 'token-1',
		status: CartStatus.SHARED,
		statusChangedAt: new Date('2026-03-25T09:00:00.000Z'),
		publicKey: 'public-1',
		checkoutKey: 'checkout-1',
		checkoutAt: null,
		assignedManagerId: null,
		managerSessionStartedAt: null,
		managerLastSeenAt: null,
		closedAt: null,
		createdAt: new Date('2026-03-25T09:00:00.000Z'),
		updatedAt: new Date('2026-03-25T09:00:00.000Z'),
		items: [],
		...overrides
	}
}

function createCompletedOrderEntity(overrides: Record<string, unknown> = {}) {
	return {
		id: 'order-1',
		status: OrderStatus.COMPLETED,
		catalogId: 'catalog-1',
		totalAmount: 3998,
		createdAt: new Date('2026-03-25T09:10:00.000Z'),
		products: [
			{
				id: 'cart-item-1',
				productId: 'product-1',
				variantId: null,
				quantity: 2,
				unitPrice: 1999,
				lineTotal: 3998,
				product: {
					id: 'product-1',
					name: 'Product 1',
					slug: 'product-1'
				}
			}
		],
		...overrides
	}
}

describe('CartService', () => {
	let service: CartService
	let prisma: {
		cart: {
			findFirst: jest.Mock
			findMany: jest.Mock
			create: jest.Mock
			update: jest.Mock
			updateMany: jest.Mock
		}
		cartItem: {
			findFirst: jest.Mock
			update: jest.Mock
			create: jest.Mock
		}
		order: {
			create: jest.Mock
		}
		catalog: {
			findFirst: jest.Mock
		}
		product: {
			findFirst: jest.Mock
		}
		productVariant: {
			findFirst: jest.Mock
		}
		$transaction: jest.Mock
	}

	beforeEach(async () => {
		prisma = {
			cart: {
				findFirst: jest.fn(),
				findMany: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn()
			},
			cartItem: {
				findFirst: jest.fn(),
				update: jest.fn(),
				create: jest.fn()
			},
			order: {
				create: jest.fn()
			},
			catalog: {
				findFirst: jest.fn()
			},
			product: {
				findFirst: jest.fn()
			},
			productVariant: {
				findFirst: jest.fn()
			},
			$transaction: jest.fn(async callback => callback(prisma))
		}

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CartService,
				{
					provide: PrismaService,
					useValue: prisma
				}
			]
		}).compile()

		service = module.get<CartService>(CartService)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	it('moves cart to IN_PROGRESS when manager starts processing', async () => {
		const activeCart = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			managerSessionStartedAt: new Date('2026-03-25T09:01:00.000Z'),
			managerLastSeenAt: new Date('2026-03-25T09:01:00.000Z')
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(createCartEntity())
			.mockResolvedValueOnce(activeCart)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			userId: 'manager-1'
		})
		prisma.cart.update.mockResolvedValue(undefined)

		const result = await service.beginManagerSession('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		expect(prisma.cart.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'cart-1' },
				data: expect.objectContaining({
					status: CartStatus.IN_PROGRESS,
					assignedManagerId: 'manager-1'
				})
			})
		)
		expect(result.status).toBe(CartStatus.IN_PROGRESS)
		expect(result.assignedManagerId).toBe('manager-1')
	})

	it('emits only cart.status_changed when manager status changes', async () => {
		const activeCart = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			managerSessionStartedAt: new Date('2026-03-25T09:01:00.000Z'),
			managerLastSeenAt: new Date('2026-03-25T09:01:00.000Z')
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(createCartEntity())
			.mockResolvedValueOnce(activeCart)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			userId: 'manager-1'
		})
		prisma.cart.update.mockResolvedValue(undefined)

		const broadcastSpy = jest.spyOn(service as never, 'broadcastCart' as never)

		await service.beginManagerSession('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		expect(broadcastSpy).toHaveBeenCalledTimes(1)
		expect(broadcastSpy).toHaveBeenCalledWith(
			'cart-1',
			'cart.status_changed',
			expect.any(Object)
		)
	})

	it('moves cart to PAUSED when manager releases it', async () => {
		const currentCart = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			managerSessionStartedAt: new Date('2026-03-25T09:01:00.000Z'),
			managerLastSeenAt: new Date('2026-03-25T09:02:00.000Z')
		})
		const waitingCart = createCartEntity({
			status: CartStatus.PAUSED,
			assignedManagerId: 'manager-1',
			managerSessionStartedAt: new Date('2026-03-25T09:01:00.000Z'),
			managerLastSeenAt: new Date('2026-03-25T09:03:00.000Z')
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(waitingCart)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			userId: 'manager-1'
		})
		prisma.cart.update.mockResolvedValue(undefined)

		const result = await service.releaseManagerSession('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		expect(prisma.cart.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: CartStatus.PAUSED
				})
			})
		)
		expect(result.status).toBe(CartStatus.PAUSED)
	})

	it('expires inactive IN_PROGRESS carts to PAUSED', async () => {
		const waitingCart = createCartEntity({
			status: CartStatus.PAUSED,
			assignedManagerId: 'manager-1',
			managerSessionStartedAt: new Date('2026-03-25T09:01:00.000Z'),
			managerLastSeenAt: new Date('2026-03-25T09:02:00.000Z')
		})

		prisma.cart.findMany
			.mockResolvedValueOnce([{ id: 'cart-1' }])
			.mockResolvedValueOnce([waitingCart])
		prisma.cart.updateMany.mockResolvedValue({ count: 1 })

		await service['expireInactiveManagerSessions']()

		expect(prisma.cart.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: CartStatus.PAUSED
				})
			})
		)
	})

	it('creates a new current cart when the previous one is paused', async () => {
		const newCart = createCartEntity({
			id: 'cart-2',
			token: 'token-2',
			status: CartStatus.DRAFT,
			publicKey: null,
			checkoutKey: null
		})

		prisma.cart.findFirst.mockResolvedValueOnce(null)
		prisma.cart.create.mockResolvedValueOnce(newCart)

		const result = await service.getOrCreateCurrentCart('catalog-1', 'token-1')

		expect(prisma.cart.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					token: 'token-1',
					status: { in: ['DRAFT', 'SHARED', 'IN_PROGRESS'] }
				})
			})
		)
		expect(prisma.cart.create).toHaveBeenCalled()
		expect(result.cart.id).toBe('cart-2')
	})

	it('converts a shared cart into a completed order', async () => {
		const cartWithItems = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: null,
					quantity: 2,
					createdAt: new Date('2026-03-25T09:00:00.000Z'),
					updatedAt: new Date('2026-03-25T09:00:00.000Z'),
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: 1999
					}
				}
			]
		})
		const convertedCart = createCartEntity({
			status: CartStatus.CONVERTED,
			publicKey: null,
			checkoutKey: null,
			assignedManagerId: 'manager-1',
			closedAt: new Date('2026-03-25T09:10:00.000Z'),
			items: cartWithItems.items
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(cartWithItems)
			.mockResolvedValueOnce(cartWithItems)
			.mockResolvedValueOnce(convertedCart)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			userId: 'manager-1'
		})
		prisma.cart.update.mockResolvedValue(undefined)
		prisma.order.create.mockResolvedValue(createCompletedOrderEntity())

		const result = await service.completeManagerOrder('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		expect(prisma.order.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: OrderStatus.COMPLETED,
					catalogId: 'catalog-1'
				})
			})
		)
		expect(prisma.cart.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: CartStatus.CONVERTED,
					publicKey: null,
					checkoutKey: null
				})
			})
		)
		expect(result.order.id).toBe('order-1')
		expect(result.order.status).toBe(OrderStatus.COMPLETED)
	})
})

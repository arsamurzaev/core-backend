import {
	CartCheckoutMethod,
	CartStatus,
	CartTableSessionStatus,
	ContactType,
	IntegrationProvider,
	OrderStatus,
	ProductVariantStatus,
	Role
} from '@generated/client'
import type { MessageEvent } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { CAPABILITY_READER_PORT } from '@/modules/capability/contracts'
import { ORDER_EXPORT_PORT } from '@/modules/integration/contracts'
import { INVENTORY_RESERVATION_PORT } from '@/modules/inventory/contracts'
import {
	PRODUCT_MAINTENANCE_PORT,
	PRODUCT_SELLABLE_READER_PORT
} from '@/modules/product/contracts'
import { MediaUrlService } from '@/shared/media/media-url.service'

import { CartCurrentService } from './cart-current.service'
import { CartInventoryReservationService } from './cart-inventory-reservation.service'
import { CartLifecycleService } from './cart-lifecycle.service'
import { CartLinePricingService } from './cart-line-pricing.service'
import { CartLineService } from './cart-line.service'
import { CartLookupService } from './cart-lookup.service'
import { CartManagerSessionService } from './cart-manager-session.service'
import { CartOrderExportService } from './cart-order-export.service'
import { CartOrderSnapshotService } from './cart-order-snapshot.service'
import { CartShareService } from './cart-share.service'
import { CartSseService } from './cart-sse.service'
import { CartVariantSelectionService } from './cart-variant-selection.service'
import { CartService } from './cart.service'
import { OrderCheckoutService } from './order-checkout.service'

const INVENTORY_MODE_NONE = 'NONE'
const INVENTORY_MODE_EXTERNAL = 'EXTERNAL'
const INVENTORY_MODE_INTERNAL = 'INTERNAL'

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
		checkoutMethod: null,
		checkoutData: null,
		checkoutContacts: null,
		comment: null,
		catalog: { parentId: null },
		tableSession: null,
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

function createCartTableSession(overrides: Record<string, unknown> = {}) {
	return {
		id: 'table-session-1',
		cartId: 'cart-1',
		status: CartTableSessionStatus.OPEN,
		publicCode: 'table-code-1',
		tableExternalId: 'iiko-table-1',
		tableNumber: '1',
		tableName: 'Table 1',
		sectionExternalId: 'section-1',
		sectionName: 'Main hall',
		guestsCount: null,
		externalOrderId: null,
		submittedOrderId: null,
		submittedAt: null,
		closedAt: null,
		createdAt: new Date('2026-03-25T09:00:00.000Z'),
		updatedAt: new Date('2026-03-25T09:00:00.000Z'),
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
		checkoutMethod: null,
		checkoutData: null,
		checkoutContacts: null,
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

function createVariant(overrides: Record<string, unknown> = {}) {
	return {
		id: 'variant-1',
		sku: 'PRODUCT-DEFAULT',
		variantKey: 'default',
		price: 1999,
		stock: 5,
		status: ProductVariantStatus.ACTIVE,
		isAvailable: true,
		attributes: [],
		...overrides
	}
}

function createCartItem(overrides: Record<string, unknown> = {}) {
	return {
		id: 'cart-item-1',
		productId: 'product-1',
		variantId: null,
		quantity: 1,
		createdAt: new Date('2026-03-25T09:00:00.000Z'),
		updatedAt: new Date('2026-03-25T09:00:00.000Z'),
		product: {
			id: 'product-1',
			name: 'Product 1',
			slug: 'product-1',
			price: 1999,
			media: []
		},
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
		cartTableSession: {
			findFirst: jest.Mock
			findMany: jest.Mock
			create: jest.Mock
			update: jest.Mock
			updateMany: jest.Mock
		}
		cartItem: {
			findFirst: jest.Mock
			findMany: jest.Mock
			count: jest.Mock
			update: jest.Mock
			updateMany: jest.Mock
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
			findMany: jest.Mock
		}
		productVariantSaleUnit: {
			findFirst: jest.Mock
		}
		integrationProductLink: {
			findMany: jest.Mock
		}
		integrationVariantLink: {
			findMany: jest.Mock
		}
		integrationExternalItem: {
			findFirst: jest.Mock
			findMany: jest.Mock
		}
		integrationOrderExport: {
			findFirst: jest.Mock
		}
		$queryRaw: jest.Mock
		$transaction: jest.Mock
	}
	let redis: {
		duplicate: jest.Mock
		expire: jest.Mock
		publish: jest.Mock
		xadd: jest.Mock
		xrange: jest.Mock
	}
	let orderExportQueue: {
		enqueueCompletedOrder: jest.Mock
		waitForCompletedOrderExport: jest.Mock
	}
	let inventory: {
		consumeCompletedOrderStockTx: jest.Mock
		reserveCartStockTx: jest.Mock
		releaseCartReservationsTx: jest.Mock
		invalidateProductCachesForCatalogs: jest.Mock
	}
	let capabilities: {
		getCurrentFeatures: jest.Mock
		canUseProductVariants: jest.Mock
		canUseCatalogSaleUnits: jest.Mock
	}
	let sellableReader: {
		resolveProductSellable: jest.Mock
		resolveVariantSellable: jest.Mock
	}
	let productMaintenance: {
		repairMissingDefaultVariantForProduct: jest.Mock
	}

	beforeEach(async () => {
		prisma = {
			cart: {
				findFirst: jest.fn(),
				findMany: jest.fn(),
				create: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn().mockResolvedValue({ count: 1 })
			},
			cartTableSession: {
				findFirst: jest.fn(),
				findMany: jest.fn().mockResolvedValue([]),
				create: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn().mockResolvedValue({ count: 1 })
			},
			cartItem: {
				findFirst: jest.fn(),
				findMany: jest.fn().mockResolvedValue([]),
				count: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
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
				findFirst: jest.fn(),
				findMany: jest.fn().mockResolvedValue([])
			},
			productVariantSaleUnit: {
				findFirst: jest.fn().mockResolvedValue(null)
			},
			integrationProductLink: {
				findMany: jest.fn().mockResolvedValue([])
			},
			integrationVariantLink: {
				findMany: jest.fn().mockResolvedValue([])
			},
			integrationExternalItem: {
				findFirst: jest.fn().mockResolvedValue(null),
				findMany: jest.fn().mockResolvedValue([])
			},
			integrationOrderExport: {
				findFirst: jest.fn().mockResolvedValue(null)
			},
			$queryRaw: jest.fn().mockResolvedValue([{ id: 'cart-1' }]),
			$transaction: jest.fn(async callback => callback(prisma))
		}
		redis = {
			duplicate: jest.fn(() => ({
				on: jest.fn().mockReturnThis(),
				quit: jest.fn().mockResolvedValue('OK'),
				removeAllListeners: jest.fn().mockReturnThis(),
				subscribe: jest.fn().mockResolvedValue(1)
			})),
			expire: jest.fn().mockResolvedValue(1),
			publish: jest.fn().mockResolvedValue(1),
			xadd: jest.fn().mockResolvedValue('1700000000000-0'),
			xrange: jest.fn().mockResolvedValue([])
		}
		orderExportQueue = {
			enqueueCompletedOrder: jest.fn().mockResolvedValue({
				ok: true,
				queued: false,
				reason: 'order_export_disabled'
			}),
			waitForCompletedOrderExport: jest.fn().mockResolvedValue({
				ok: true,
				status: 'SUCCEEDED'
			})
		}
		inventory = {
			consumeCompletedOrderStockTx: jest.fn().mockResolvedValue([]),
			reserveCartStockTx: jest.fn().mockResolvedValue([]),
			releaseCartReservationsTx: jest.fn().mockResolvedValue({
				releasedReservations: 0,
				affectedVariants: 0,
				affectedVariantIds: [],
				affectedCatalogIds: []
			}),
			invalidateProductCachesForCatalogs: jest.fn().mockResolvedValue(undefined)
		}
		capabilities = {
			getCurrentFeatures: jest.fn().mockResolvedValue({
				canUseProductTypes: true,
				canUseProductVariants: true,
				canUseCatalogSaleUnits: true,
				canUseInternalInventory: false,
				canUseMoySkladIntegration: true
			}),
			canUseProductVariants: jest.fn().mockResolvedValue(true),
			canUseCatalogSaleUnits: jest.fn().mockResolvedValue(true)
		}
		sellableReader = {
			resolveProductSellable: jest.fn().mockResolvedValue({
				mode: 'SIMPLE',
				variantId: null,
				priceState: 'UNKNOWN',
				displayPrice: null,
				requiresVariantSelection: false,
				availabilityState: 'AVAILABLE',
				stock: null
			}),
			resolveVariantSellable: jest.fn(
				async (_catalogId: string, _productId: string, variantId: string) => ({
					mode: 'SIMPLE',
					variantId,
					priceState: 'UNKNOWN',
					displayPrice: null,
					requiresVariantSelection: false,
					availabilityState: 'AVAILABLE',
					stock: null
				})
			)
		}
		productMaintenance = {
			repairMissingDefaultVariantForProduct: jest.fn()
		}

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CartService,
				CartInventoryReservationService,
				CartCurrentService,
				CartLinePricingService,
				CartLineService,
				CartLookupService,
				CartLifecycleService,
				CartManagerSessionService,
				CartOrderExportService,
				CartOrderSnapshotService,
				CartShareService,
				CartSseService,
				CartVariantSelectionService,
				OrderCheckoutService,
				{
					provide: PrismaService,
					useValue: prisma
				},
				{
					provide: MediaUrlService,
					useValue: {
						mapMedia: jest.fn(media => media)
					}
				},
				{
					provide: RedisService,
					useValue: redis
				},
				{
					provide: ORDER_EXPORT_PORT,
					useValue: orderExportQueue
				},
				{
					provide: INVENTORY_RESERVATION_PORT,
					useValue: inventory
				},
				{
					provide: CAPABILITY_READER_PORT,
					useValue: capabilities
				},
				{
					provide: PRODUCT_MAINTENANCE_PORT,
					useValue: productMaintenance
				},
				{
					provide: PRODUCT_SELLABLE_READER_PORT,
					useValue: sellableReader
				}
			]
		}).compile()

		service = module.get<CartService>(CartService)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	it('maps variant labels in current, shared, and public cart responses', async () => {
		const variant = createVariant({
			id: 'variant-label',
			sku: 'PRODUCT-XL-WHITE',
			variantKey: 'size=xl;color=white',
			price: 2199,
			attributes: [
				{
					attribute: {
						id: 'attribute-color',
						key: 'color',
						displayName: 'Color',
						displayOrder: 2
					},
					enumValue: {
						id: 'enum-white',
						value: 'white',
						displayName: null,
						displayOrder: 1
					}
				},
				{
					attribute: {
						id: 'attribute-size',
						key: 'size',
						displayName: 'Size',
						displayOrder: 1
					},
					enumValue: {
						id: 'enum-xl',
						value: 'xl',
						displayName: 'XL',
						displayOrder: 1
					}
				}
			]
		})
		const item = createCartItem({
			variantId: 'variant-label',
			variant,
			quantity: 2,
			product: {
				id: 'product-1',
				name: 'Product 1',
				slug: 'product-1',
				price: 1999,
				media: []
			}
		})
		const currentCart = createCartEntity({ items: [item] })
		const draftCart = createCartEntity({
			status: CartStatus.DRAFT,
			publicKey: null,
			checkoutKey: null,
			items: [item]
		})
		const sharedCart = createCartEntity({
			status: CartStatus.SHARED,
			publicKey: 'public-1',
			items: [item]
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(draftCart)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(sharedCart)
			.mockResolvedValueOnce(sharedCart)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			type: { code: 'wholesale' },
			settings: { checkout: { enabledMethods: [] } },
			contacts: []
		})
		prisma.cart.update.mockResolvedValue(undefined)

		const current = await service.getCurrentCartOrThrow('catalog-1', 'token-1')
		const shared = await service.shareCurrentCart('catalog-1', 'token-1', {})
		const publicCart = await service.getPublicCart('public-1')

		for (const cart of [current.cart, shared.cart, publicCart]) {
			expect(cart.items[0].variant?.label).toBe('Size: XL, Color: white')
			expect(cart.items[0].product.price).toBe(2199)
			expect(cart.items[0].lineTotal).toBe(4398)
		}
	})

	it('collapses duplicate cart lines in mapped responses', async () => {
		const currentCart = createCartEntity({
			items: [
				createCartItem({
					id: 'cart-item-1',
					quantity: 2,
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: 100,
						media: []
					}
				}),
				createCartItem({
					id: 'cart-item-2',
					quantity: 3,
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: 100,
						media: []
					}
				})
			]
		})

		prisma.cart.findFirst.mockResolvedValueOnce(currentCart)

		const result = await service.getCurrentCartOrThrow('catalog-1', 'token-1')

		expect(result.cart.items).toHaveLength(1)
		expect(result.cart.items[0]).toEqual(
			expect.objectContaining({
				id: 'cart-item-1',
				productId: 'product-1',
				quantity: 5,
				lineTotal: 500
			})
		)
		expect(result.cart.totals.itemsCount).toBe(5)
		expect(result.cart.totals.subtotal).toBe(500)
	})

	it('hides variant cart data and variant price when product variants are disabled', async () => {
		capabilities.getCurrentFeatures.mockResolvedValue({
			canUseProductTypes: false,
			canUseProductVariants: false,
			canUseCatalogSaleUnits: false,
			canUseInternalInventory: false,
			canUseMoySkladIntegration: false
		})
		const variant = createVariant({
			id: 'variant-hidden',
			price: 2499
		})
		const currentCart = createCartEntity({
			items: [
				createCartItem({
					id: 'cart-item-variant-hidden-1',
					variantId: 'variant-hidden',
					saleUnitId: 'sale-unit-hidden-1',
					variant,
					saleUnit: {
						id: 'sale-unit-hidden-1',
						variantId: 'variant-hidden',
						code: 'pack',
						name: 'Pack',
						baseQuantity: 12,
						price: 2199,
						isDefault: false,
						isActive: true,
						displayOrder: 0
					},
					unitPriceSnapshot: 2499,
					quantity: 1,
					baseQuantity: 12,
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: null,
						media: []
					}
				}),
				createCartItem({
					id: 'cart-item-variant-hidden-2',
					variantId: 'variant-hidden-2',
					saleUnitId: 'sale-unit-hidden-2',
					variant: createVariant({
						id: 'variant-hidden-2',
						price: 2599
					}),
					saleUnit: {
						id: 'sale-unit-hidden-2',
						variantId: 'variant-hidden-2',
						code: 'box',
						name: 'Box',
						baseQuantity: 24,
						price: 2399,
						isDefault: false,
						isActive: true,
						displayOrder: 0
					},
					unitPriceSnapshot: 2599,
					quantity: 2,
					baseQuantity: 48,
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: null,
						media: []
					}
				})
			]
		})

		prisma.cart.findFirst.mockResolvedValueOnce(currentCart)

		const result = await service.getCurrentCartOrThrow('catalog-1', 'token-1')

		expect(result.cart.items).toHaveLength(1)
		expect(result.cart.items[0]).toEqual(
			expect.objectContaining({
				variantId: null,
				saleUnitId: null,
				quantity: 3,
				baseQuantity: 3,
				variant: null,
				saleUnit: null,
				unitPrice: 0,
				lineTotal: 0
			})
		)
		expect(result.cart.items[0].product.price).toBeNull()
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

	it('reserves internal inventory stock when manager starts processing', async () => {
		const sharedCart = createCartEntity({
			status: CartStatus.SHARED,
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_INTERNAL }
			},
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-1',
					quantity: 1,
					createdAt: new Date('2026-03-25T09:00:00.000Z'),
					updatedAt: new Date('2026-03-25T09:00:00.000Z'),
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: 1999,
						media: []
					}
				}
			]
		})
		const activeCart = createCartEntity({
			...sharedCart,
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1'
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(sharedCart)
			.mockResolvedValueOnce(activeCart)
			.mockResolvedValueOnce(activeCart)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			userId: 'manager-1'
		})
		prisma.cart.update.mockResolvedValue(undefined)

		await service.beginManagerSession('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		expect(inventory.reserveCartStockTx).toHaveBeenCalledWith(
			prisma,
			expect.objectContaining({
				catalogId: 'catalog-1',
				cartId: 'cart-1',
				actorUserId: 'manager-1',
				lines: [
					{
						cartItemId: 'cart-item-1',
						productId: 'product-1',
						variantId: 'variant-1',
						quantity: 1
					}
				]
			})
		)
	})

	it('shares delivery checkout with client address snapshot', async () => {
		const draftCart = createCartEntity({
			status: CartStatus.DRAFT,
			publicKey: null,
			checkoutKey: null
		})
		const sharedCart = createCartEntity({
			status: CartStatus.SHARED,
			publicKey: 'public-1',
			checkoutMethod: CartCheckoutMethod.DELIVERY,
			checkoutData: { address: 'Client street, 2' },
			checkoutContacts: { PHONE: '+79990000000' }
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(draftCart)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(sharedCart)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			type: { code: 'wholesale' },
			settings: {
				address: 'Catalog street, 1',
				checkout: { enabledMethods: [CartCheckoutMethod.DELIVERY] }
			},
			contacts: [
				{ type: ContactType.PHONE, value: '+79990000000' },
				{ type: ContactType.MAP, value: 'https://yandex.ru/maps/-/test' }
			]
		})
		prisma.cart.update.mockResolvedValue(undefined)

		const result = await service.shareCurrentCart('catalog-1', 'token-1', {
			checkoutData: { address: 'Client street, 2' },
			checkoutMethod: CartCheckoutMethod.DELIVERY
		})

		expect(prisma.cart.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'cart-1' },
				data: expect.objectContaining({
					checkoutMethod: CartCheckoutMethod.DELIVERY,
					checkoutData: { address: 'Client street, 2' },
					checkoutContacts: { PHONE: '+79990000000' }
				})
			})
		)
		expect(result.cart.checkoutData).toEqual({ address: 'Client street, 2' })
	})

	it('shares pickup checkout with catalog address and map snapshot', async () => {
		const draftCart = createCartEntity({
			status: CartStatus.DRAFT,
			publicKey: null,
			checkoutKey: null
		})
		const sharedCart = createCartEntity({
			status: CartStatus.SHARED,
			publicKey: 'public-1',
			checkoutMethod: CartCheckoutMethod.PICKUP,
			checkoutData: {
				address: 'Catalog street, 1',
				mapUrl: 'https://yandex.ru/maps/-/test'
			}
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(draftCart)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(sharedCart)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			type: { code: 'clothes' },
			settings: {
				address: 'Catalog street, 1',
				checkout: { enabledMethods: [CartCheckoutMethod.PICKUP] }
			},
			contacts: [{ type: ContactType.MAP, value: 'https://yandex.ru/maps/-/test' }]
		})
		prisma.cart.update.mockResolvedValue(undefined)

		await service.shareCurrentCart('catalog-1', 'token-1', {
			checkoutMethod: CartCheckoutMethod.PICKUP
		})

		expect(prisma.cart.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					checkoutData: {
						address: 'Catalog street, 1',
						mapUrl: 'https://yandex.ru/maps/-/test'
					}
				})
			})
		)
	})

	it('shares checkout without method when catalog methods are disabled', async () => {
		const draftCart = createCartEntity({
			status: CartStatus.DRAFT,
			publicKey: null,
			checkoutKey: null
		})
		const sharedCart = createCartEntity({
			status: CartStatus.SHARED,
			publicKey: 'public-1',
			checkoutMethod: null,
			checkoutData: {},
			checkoutContacts: { PHONE: '+79990000000' }
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(draftCart)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(sharedCart)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			type: { code: 'wholesale' },
			settings: {
				address: 'Catalog street, 1',
				checkout: { enabledMethods: [] }
			},
			contacts: [{ type: ContactType.PHONE, value: '+79990000000' }]
		})
		prisma.cart.update.mockResolvedValue(undefined)

		await service.shareCurrentCart('catalog-1', 'token-1', {})

		expect(prisma.cart.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'cart-1' },
				data: expect.objectContaining({
					checkoutMethod: null,
					checkoutData: {},
					checkoutContacts: { PHONE: '+79990000000' }
				})
			})
		)
	})

	it('reserves internal inventory stock when sharing a cart', async () => {
		const variant = {
			id: 'variant-1',
			sku: 'PRODUCT-DEFAULT',
			variantKey: 'default',
			price: 1999,
			stock: 3,
			status: ProductVariantStatus.ACTIVE,
			isAvailable: true,
			attributes: []
		}
		const draftCart = createCartEntity({
			status: CartStatus.DRAFT,
			publicKey: null,
			checkoutKey: null,
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_INTERNAL }
			},
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-1',
					variant,
					quantity: 2,
					createdAt: new Date('2026-03-25T09:00:00.000Z'),
					updatedAt: new Date('2026-03-25T09:00:00.000Z'),
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: 1999,
						media: []
					}
				}
			]
		})
		const sharedCart = createCartEntity({
			...draftCart,
			status: CartStatus.SHARED,
			publicKey: 'public-1'
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(draftCart)
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce(sharedCart)
			.mockResolvedValueOnce(sharedCart)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			type: { code: 'wholesale' },
			settings: { checkout: { enabledMethods: [] } },
			contacts: []
		})
		prisma.cart.update.mockResolvedValue(undefined)

		await service.shareCurrentCart('catalog-1', 'token-1', {})

		expect(inventory.reserveCartStockTx).toHaveBeenCalledWith(
			prisma,
			expect.objectContaining({
				catalogId: 'catalog-1',
				cartId: 'cart-1',
				actorUserId: null,
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

	it('resets an open hall table session for a catalog manager', async () => {
		const openSession = createCartTableSession()
		const currentCart = createCartEntity({
			tableSession: openSession
		})
		const closedAt = new Date('2026-03-25T09:30:00.000Z')
		const resetCart = createCartEntity({
			status: CartStatus.CANCELLED,
			closedAt,
			tableSession: createCartTableSession({
				status: CartTableSessionStatus.CANCELLED,
				closedAt
			})
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(resetCart)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			userId: 'manager-1'
		})

		const broadcastSpy = jest.spyOn(service as never, 'broadcastCart' as never)

		const result = await service.resetHallTableSession('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		expect(prisma.cartTableSession.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: 'table-session-1',
					status: {
						in: [
							CartTableSessionStatus.OPEN,
							CartTableSessionStatus.PENDING_CONFIRMATION
						]
					}
				}),
				data: expect.objectContaining({
					status: CartTableSessionStatus.CANCELLED,
					activeKey: null,
					closedAt: expect.any(Date)
				})
			})
		)
		expect(prisma.cart.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ id: 'cart-1' }),
				data: expect.objectContaining({
					status: CartStatus.CANCELLED,
					closedAt: expect.any(Date),
					assignedManagerId: null,
					publicKey: null,
					checkoutKey: null
				})
			})
		)
		expect(inventory.releaseCartReservationsTx).toHaveBeenCalledWith(
			prisma,
			expect.objectContaining({
				catalogId: 'catalog-1',
				cartId: 'cart-1',
				reason: 'Hall table session reset',
				actorUserId: 'manager-1'
			})
		)
		expect(broadcastSpy).toHaveBeenCalledWith(
			'cart-1',
			'cart.status_changed',
			expect.any(Object)
		)
		expect(result.status).toBe(CartStatus.CANCELLED)
		expect(result.tableSession?.status).toBe(CartTableSessionStatus.CANCELLED)
	})

	it('detaches a hall table cart as soon as a manager confirms it', async () => {
		const openSession = createCartTableSession()
		const cartItem = createCartItem({ quantity: 2 })
		const currentCart = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			tableSession: openSession,
			items: [cartItem]
		})
		const submittedAt = new Date('2026-03-25T09:11:00.000Z')
		const submittedCart = createCartEntity({
			status: CartStatus.CONVERTED,
			publicKey: null,
			checkoutKey: null,
			assignedManagerId: 'manager-1',
			closedAt: new Date('2026-03-25T09:10:00.000Z'),
			tableSession: createCartTableSession({
				status: CartTableSessionStatus.SUBMITTED,
				submittedOrderId: 'order-1',
				submittedAt
			}),
			items: [cartItem]
		})
		const exportedCart = createCartEntity({
			...submittedCart,
			tableSession: createCartTableSession({
				status: CartTableSessionStatus.SUBMITTED,
				submittedOrderId: 'order-1',
				submittedAt,
				externalOrderId: 'iiko-order-1'
			})
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(submittedCart)
			.mockResolvedValueOnce(exportedCart)
		prisma.catalog.findFirst
			.mockResolvedValueOnce({
				id: 'catalog-1',
				userId: 'manager-1'
			})
			.mockResolvedValueOnce({
				type: { code: 'restaurant' },
				settings: {
					address: 'Hall street, 1',
					checkout: { enabledMethods: [CartCheckoutMethod.PICKUP] }
				},
				contacts: []
			})
		prisma.order.create.mockResolvedValue(createCompletedOrderEntity())
		prisma.integrationOrderExport.findFirst.mockResolvedValueOnce({
			externalId: 'iiko-order-1',
			response: { correlationId: 'corr-1' }
		})
		prisma.integrationExternalItem.findFirst.mockResolvedValueOnce({
			id: 'table-item-1',
			integrationId: 'integration-1',
			externalId: 'iiko-table-1',
			externalParentId: 'section-1',
			name: 'Table 1',
			code: '1',
			publicCode: 'table-code-1',
			rawMeta: {
				restaurantSectionId: 'section-1',
				tableName: 'Table 1',
				tableNumber: '1'
			}
		})

		const broadcastSpy = jest.spyOn(service as never, 'broadcastCart' as never)

		const result = await service.confirmHallTableOrder('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		expect(prisma.cart.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: 'cart-1',
					status: { in: expect.any(Array) }
				}),
				data: expect.objectContaining({
					status: CartStatus.CONVERTED,
					publicKey: null,
					checkoutKey: null
				})
			})
		)
		expect(prisma.cartTableSession.update).toHaveBeenNthCalledWith(1, {
			where: { id: 'table-session-1' },
			data: expect.objectContaining({
				status: CartTableSessionStatus.SUBMITTED,
				submittedOrderId: 'order-1',
				submittedAt: expect.any(Date),
				activeKey: null
			})
		})
		expect(
			prisma.cartTableSession.update.mock.invocationCallOrder[0]
		).toBeLessThan(
			orderExportQueue.waitForCompletedOrderExport.mock.invocationCallOrder[0]
		)
		expect(prisma.cartTableSession.update).toHaveBeenNthCalledWith(2, {
			where: { id: 'table-session-1' },
			data: expect.objectContaining({
				status: CartTableSessionStatus.SUBMITTED,
				submittedOrderId: 'order-1',
				submittedAt: expect.any(Date),
				activeKey: null,
				externalOrderId: 'iiko-order-1',
				externalCorrelationId: 'corr-1'
			})
		})
		expect(broadcastSpy).toHaveBeenCalledWith(
			'cart-1',
			'cart.status_changed',
			expect.objectContaining({
				publicKey: null,
				status: CartStatus.CONVERTED,
				tableSession: expect.objectContaining({
					status: CartTableSessionStatus.SUBMITTED
				})
			})
		)
		expect(result.order.id).toBe('order-1')
	})

	it('closes a hall table session through generic manager completion', async () => {
		const openSession = createCartTableSession()
		const cartItem = createCartItem({ quantity: 2 })
		const currentCart = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			tableSession: openSession,
			items: [cartItem]
		})
		const submittedCart = createCartEntity({
			status: CartStatus.CONVERTED,
			publicKey: null,
			checkoutKey: null,
			assignedManagerId: 'manager-1',
			closedAt: new Date('2026-03-25T09:10:00.000Z'),
			tableSession: createCartTableSession({
				status: CartTableSessionStatus.SUBMITTED,
				submittedOrderId: 'order-1',
				submittedAt: new Date('2026-03-25T09:11:00.000Z')
			}),
			items: [cartItem]
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(submittedCart)
			.mockResolvedValueOnce(submittedCart)
		prisma.catalog.findFirst
			.mockResolvedValueOnce({
				id: 'catalog-1',
				userId: 'manager-1'
			})
			.mockResolvedValueOnce({
				type: { code: 'restaurant' },
				settings: {
					address: 'Hall street, 1',
					checkout: { enabledMethods: [CartCheckoutMethod.PICKUP] }
				},
				contacts: []
			})
		prisma.order.create.mockResolvedValue(createCompletedOrderEntity())
		prisma.integrationExternalItem.findFirst.mockResolvedValueOnce({
			id: 'table-item-1',
			integrationId: 'integration-1',
			externalId: 'iiko-table-1',
			externalParentId: 'section-1',
			name: 'Table 1',
			code: '1',
			publicCode: 'table-code-1',
			rawMeta: {
				restaurantSectionId: 'section-1',
				tableName: 'Table 1',
				tableNumber: '1'
			}
		})

		const result = await service.completeManagerOrder('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		expect(prisma.cartTableSession.update).toHaveBeenCalledWith({
			where: { id: 'table-session-1' },
			data: expect.objectContaining({
				status: CartTableSessionStatus.SUBMITTED,
				submittedOrderId: 'order-1',
				activeKey: null
			})
		})
		expect(orderExportQueue.waitForCompletedOrderExport).toHaveBeenCalledWith(
			'catalog-1',
			'order-1',
			expect.any(Object)
		)
		expect(result.order.id).toBe('order-1')
	})

	it('marks a public hall table cart as waiting for waiter confirmation', async () => {
		const openCart = createCartEntity({
			tableSession: createCartTableSession(),
			items: [createCartItem({ quantity: 2 })]
		})
		const pendingCart = createCartEntity({
			tableSession: createCartTableSession({
				status: CartTableSessionStatus.PENDING_CONFIRMATION
			}),
			items: openCart.items
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(openCart)
			.mockResolvedValueOnce(pendingCart)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			type: { code: 'restaurant' },
			settings: {
				address: 'Hall street, 1',
				checkout: { enabledMethods: [CartCheckoutMethod.PICKUP] }
			},
			contacts: []
		})
		prisma.integrationExternalItem.findFirst.mockResolvedValueOnce({
			id: 'table-item-1',
			integrationId: 'integration-1',
			externalId: 'iiko-table-1',
			externalParentId: 'section-1',
			name: 'Table 1',
			code: '1',
			publicCode: 'table-code-1',
			rawMeta: {
				restaurantSectionId: 'section-1',
				tableName: 'Table 1',
				tableNumber: '1'
			}
		})
		prisma.cart.update.mockResolvedValue(undefined)
		prisma.cartTableSession.update.mockResolvedValue(undefined)

		const result = await service.submitPublicHallOrder('public-1', {})

		expect(prisma.cartTableSession.update).toHaveBeenCalledWith({
			where: { id: 'table-session-1' },
			data: {
				status: CartTableSessionStatus.PENDING_CONFIRMATION
			}
		})
		expect(prisma.order.create).not.toHaveBeenCalled()
		expect(orderExportQueue.enqueueCompletedOrder).not.toHaveBeenCalled()
		expect(result.cart.tableSession?.status).toBe(
			CartTableSessionStatus.PENDING_CONFIRMATION
		)
	})

	it('rejects public item changes after a hall table session is closed', async () => {
		const closedCart = createCartEntity({
			tableSession: createCartTableSession({
				status: CartTableSessionStatus.CLOSED,
				closedAt: new Date('2026-03-25T09:30:00.000Z')
			})
		})

		prisma.cart.findFirst.mockResolvedValueOnce(closedCart)

		await expect(
			service.upsertPublicItem('public-1', {
				productId: 'product-1',
				quantity: 1
			})
		).rejects.toThrow('hall table session is not open')
		expect(prisma.cartItem.create).not.toHaveBeenCalled()
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

	it('releases reservations when abandoned shared carts expire', async () => {
		prisma.cart.findMany.mockResolvedValueOnce([
			{ id: 'cart-1', catalogId: 'catalog-1' }
		])
		prisma.cart.updateMany.mockResolvedValue({ count: 1 })

		await service['expireAbandonedDraftCarts']()

		expect(prisma.cart.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: CartStatus.EXPIRED
				})
			})
		)
		expect(inventory.releaseCartReservationsTx).toHaveBeenCalledWith(
			prisma,
			expect.objectContaining({
				catalogId: 'catalog-1',
				cartId: 'cart-1',
				reason: 'Cart expired',
				actorUserId: null
			})
		)
	})

	it('expires stale open hall table sessions and releases reservations', async () => {
		const expiredCart = createCartEntity({
			status: CartStatus.EXPIRED,
			closedAt: new Date('2026-03-25T15:30:00.000Z'),
			tableSession: createCartTableSession({
				status: CartTableSessionStatus.EXPIRED,
				closedAt: new Date('2026-03-25T15:30:00.000Z')
			})
		})

		prisma.cartTableSession.findMany.mockResolvedValueOnce([
			{
				id: 'table-session-1',
				cartId: 'cart-1',
				catalogId: 'catalog-1'
			}
		])
		prisma.cart.findMany.mockResolvedValueOnce([expiredCart])

		const broadcastSpy = jest.spyOn(service as never, 'broadcastCart' as never)

		await service['expireStaleHallTableSessions']()

		expect(prisma.cartTableSession.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: { in: ['table-session-1'] },
					status: {
						in: [
							CartTableSessionStatus.OPEN,
							CartTableSessionStatus.PENDING_CONFIRMATION
						]
					}
				}),
				data: expect.objectContaining({
					status: CartTableSessionStatus.EXPIRED,
					activeKey: null,
					closedAt: expect.any(Date)
				})
			})
		)
		expect(prisma.cart.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: { in: ['cart-1'] }
				}),
				data: expect.objectContaining({
					status: CartStatus.EXPIRED,
					closedAt: expect.any(Date),
					publicKey: null,
					checkoutKey: null
				})
			})
		)
		expect(inventory.releaseCartReservationsTx).toHaveBeenCalledWith(
			prisma,
			expect.objectContaining({
				catalogId: 'catalog-1',
				cartId: 'cart-1',
				reason: 'Hall table session expired',
				actorUserId: null
			})
		)
		expect(broadcastSpy).toHaveBeenCalledWith(
			'cart-1',
			'cart.status_changed',
			expect.any(Object)
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
					status: {
						in: [
							CartStatus.DRAFT,
							CartStatus.SHARED,
							CartStatus.IN_PROGRESS,
							CartStatus.PAUSED
						]
					}
				})
			})
		)
		expect(prisma.cart.create).toHaveBeenCalled()
		expect(result.cart.id).toBe('cart-2')
	})

	it('soft deletes a current shared cart and removes its public key', async () => {
		const currentCart = createCartEntity({
			status: CartStatus.SHARED,
			publicKey: 'public-1',
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: null,
					quantity: 1,
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

		prisma.cart.findFirst.mockResolvedValueOnce(currentCart)

		const result = await service.deleteCurrentCart('catalog-1', 'token-1')

		expect(prisma.cartItem.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					cartId: 'cart-1',
					deleteAt: null
				}),
				data: expect.objectContaining({
					deleteAt: expect.any(Date)
				})
			})
		)
		expect(prisma.cart.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'cart-1' },
				data: expect.objectContaining({
					deleteAt: expect.any(Date),
					token: null,
					userId: null,
					publicKey: null,
					checkoutKey: null
				})
			})
		)
		expect(inventory.releaseCartReservationsTx).toHaveBeenCalledWith(
			prisma,
			expect.objectContaining({
				catalogId: 'catalog-1',
				cartId: 'cart-1',
				reason: 'Cart deleted by customer',
				actorUserId: null
			})
		)
		expect(result.mode).toBe('deleted')
	})

	it('detaches a current cart that is already assigned to a manager', async () => {
		const currentCart = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1'
		})

		prisma.cart.findFirst.mockResolvedValueOnce(currentCart)

		const result = await service.deleteCurrentCart('catalog-1', 'token-1')

		expect(prisma.cart.update).toHaveBeenCalledWith({
			where: { id: 'cart-1' },
			data: {
				token: null,
				userId: null
			}
		})
		expect(prisma.cartItem.updateMany).not.toHaveBeenCalled()
		expect(result.mode).toBe('detached')
	})

	it('syncs internal inventory reservations when a public item is removed', async () => {
		const currentCart = createCartEntity({
			status: CartStatus.SHARED,
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_INTERNAL }
			},
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-1',
					quantity: 1,
					createdAt: new Date('2026-03-25T09:00:00.000Z'),
					updatedAt: new Date('2026-03-25T09:00:00.000Z'),
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: 1999,
						media: []
					}
				}
			]
		})
		const context = {
			id: 'cart-1',
			catalogId: 'catalog-1',
			status: CartStatus.SHARED,
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_INTERNAL }
			}
		}
		const emptyCart = createCartEntity({
			status: CartStatus.SHARED,
			catalog: currentCart.catalog,
			items: []
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(context)
			.mockResolvedValueOnce(emptyCart)
			.mockResolvedValueOnce(emptyCart)
		prisma.cartItem.findFirst.mockResolvedValueOnce({ id: 'cart-item-1' })
		prisma.cartItem.update.mockResolvedValueOnce({ id: 'cart-item-1' })
		prisma.cart.update.mockResolvedValueOnce(undefined)

		await service.removePublicItem('public-1', 'cart-item-1')

		expect(inventory.reserveCartStockTx).toHaveBeenCalledWith(
			prisma,
			expect.objectContaining({
				cartId: 'cart-1',
				lines: []
			})
		)
	})

	it('allows adding parent catalog products to a child catalog cart', async () => {
		const currentCart = createCartEntity({
			catalogId: 'child-catalog',
			status: CartStatus.DRAFT,
			catalog: { parentId: 'parent-catalog' }
		})
		const updatedCart = createCartEntity({
			catalogId: 'child-catalog',
			status: CartStatus.DRAFT,
			catalog: { parentId: 'parent-catalog' },
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: null,
					quantity: 1,
					createdAt: new Date('2026-03-25T09:00:00.000Z'),
					updatedAt: new Date('2026-03-25T09:00:00.000Z'),
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: 1999,
						media: []
					}
				}
			]
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(updatedCart)
		prisma.product.findFirst.mockResolvedValueOnce({
			id: 'product-1',
			catalogId: 'parent-catalog'
		})
		prisma.cartItem.findFirst.mockResolvedValueOnce(null)
		prisma.cartItem.count.mockResolvedValueOnce(0)
		prisma.cartItem.create.mockResolvedValueOnce({ id: 'cart-item-1' })
		prisma.cart.update.mockResolvedValueOnce(undefined)

		const result = await service.upsertCurrentItem('child-catalog', 'token-1', {
			productId: 'product-1',
			quantity: 1
		})

		expect(prisma.product.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					catalogId: { in: ['child-catalog', 'parent-catalog'] },
					id: 'product-1'
				})
			})
		)
		expect(sellableReader.resolveProductSellable).toHaveBeenCalledWith(
			'parent-catalog',
			'product-1',
			{ quantity: 1, enforceStock: false }
		)
		expect(prisma.cartItem.create).toHaveBeenCalled()
		expect(result.cart.items).toHaveLength(1)
	})

	it('merges duplicate active cart lines during upsert', async () => {
		const currentCart = createCartEntity({ status: CartStatus.DRAFT })
		const primaryLine = {
			id: 'cart-item-1',
			createdAt: new Date('2026-03-25T09:00:00.000Z'),
			deleteAt: null,
			quantity: 2,
			saleUnitId: null,
			baseQuantity: 2,
			unitPriceSnapshot: 100
		}
		const duplicateLine = {
			...primaryLine,
			id: 'cart-item-2',
			createdAt: new Date('2026-03-25T09:01:00.000Z'),
			quantity: 3,
			baseQuantity: 3
		}
		const updatedCart = createCartEntity({
			status: CartStatus.DRAFT,
			items: [
				createCartItem({
					id: 'cart-item-1',
					quantity: 6,
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: 100,
						media: []
					}
				})
			]
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(updatedCart)
		prisma.product.findFirst.mockResolvedValueOnce({
			id: 'product-1',
			price: 100,
			productAttributes: []
		})
		prisma.cartItem.findFirst.mockResolvedValueOnce(primaryLine)
		prisma.cartItem.findMany.mockResolvedValueOnce([primaryLine, duplicateLine])
		prisma.cartItem.update.mockResolvedValueOnce({ id: 'cart-item-1' })
		prisma.cartItem.updateMany.mockResolvedValueOnce({ count: 1 })
		prisma.cart.update.mockResolvedValueOnce(undefined)

		const result = await service.upsertCurrentItem('catalog-1', 'token-1', {
			productId: 'product-1',
			quantity: 6
		})

		expect(prisma.cartItem.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'cart-item-1' },
				data: expect.objectContaining({
					quantity: 6,
					deleteAt: null
				})
			})
		)
		expect(prisma.cartItem.updateMany).toHaveBeenCalledWith({
			where: { id: { in: ['cart-item-2'] } },
			data: { deleteAt: expect.any(Date) }
		})
		expect(result.cart.items).toHaveLength(1)
		expect(result.cart.items[0].quantity).toBe(6)
	})

	it('removes duplicate active cart lines together', async () => {
		const currentCart = createCartEntity({
			status: CartStatus.SHARED,
			items: [
				createCartItem({ id: 'cart-item-1', quantity: 2 }),
				createCartItem({ id: 'cart-item-2', quantity: 3 })
			]
		})
		const context = {
			id: 'cart-1',
			catalogId: 'catalog-1',
			status: CartStatus.SHARED,
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_NONE }
			}
		}
		const updatedCart = createCartEntity({
			status: CartStatus.SHARED,
			items: []
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(context)
			.mockResolvedValueOnce(updatedCart)
		prisma.cartItem.findFirst.mockResolvedValueOnce({
			id: 'cart-item-1',
			productId: 'product-1',
			variantId: null,
			saleUnitId: null
		})
		prisma.cartItem.updateMany.mockResolvedValueOnce({ count: 2 })
		prisma.cart.update.mockResolvedValueOnce(undefined)

		const result = await service.removePublicItem('public-1', 'cart-item-1')

		expect(prisma.cartItem.updateMany).toHaveBeenCalledWith({
			where: {
				cartId: 'cart-1',
				productId: 'product-1',
				variantId: null,
				saleUnitId: null,
				deleteAt: null
			},
			data: { deleteAt: expect.any(Date) }
		})
		expect(result.items).toHaveLength(0)
	})

	it('adds simple default variant without requiring a picker', async () => {
		const currentCart = createCartEntity({ status: CartStatus.DRAFT })
		const singleVariant = createVariant({
			id: 'variant-single',
			sku: 'PRODUCT-ONLY',
			variantKey: 'default'
		})
		const updatedCart = createCartEntity({
			status: CartStatus.DRAFT,
			items: [
				createCartItem({
					variantId: 'variant-single',
					variant: singleVariant,
					quantity: 1
				})
			]
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(updatedCart)
		prisma.product.findFirst.mockResolvedValueOnce({ id: 'product-1' })
		sellableReader.resolveProductSellable.mockResolvedValueOnce({
			mode: 'SIMPLE',
			variantId: 'variant-single',
			priceState: 'KNOWN',
			displayPrice: '1999.00',
			requiresVariantSelection: false,
			availabilityState: 'AVAILABLE',
			stock: 5
		})
		prisma.productVariant.findFirst.mockResolvedValueOnce({
			id: 'variant-single'
		})
		prisma.cartItem.findFirst.mockResolvedValueOnce(null)
		prisma.cartItem.count.mockResolvedValueOnce(0)
		prisma.cartItem.create.mockResolvedValueOnce({ id: 'cart-item-1' })
		prisma.cart.update.mockResolvedValueOnce(undefined)

		const result = await service.upsertCurrentItem('catalog-1', 'token-1', {
			productId: 'product-1',
			quantity: 1
		})

		expect(prisma.productVariant.findMany).not.toHaveBeenCalled()
		expect(
			productMaintenance.repairMissingDefaultVariantForProduct
		).toHaveBeenCalledWith('catalog-1', 'product-1', { tx: prisma })
		expect(
			productMaintenance.repairMissingDefaultVariantForProduct.mock
				.invocationCallOrder[0]
		).toBeLessThan(
			sellableReader.resolveProductSellable.mock.invocationCallOrder[0]
		)
		expect(sellableReader.resolveProductSellable).toHaveBeenCalledWith(
			'catalog-1',
			'product-1',
			{ quantity: 1, enforceStock: false }
		)
		expect(prisma.cartItem.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					cartId: 'cart-1',
					productId: 'product-1',
					variantId: 'variant-single',
					saleUnitId: null,
					guestSessionId: null
				}
			})
		)
		expect(prisma.cartItem.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					productId: 'product-1',
					variantId: 'variant-single'
				})
			})
		)
		expect(result.cart.items[0].variantId).toBe('variant-single')
		expect(result.cart.items[0].variant?.id).toBe('variant-single')
	})

	it('adds a simple cart line without variant price when product variants are disabled for catalog', async () => {
		capabilities.canUseProductVariants.mockResolvedValueOnce(false)
		capabilities.getCurrentFeatures.mockResolvedValue({
			canUseProductTypes: false,
			canUseProductVariants: false,
			canUseCatalogSaleUnits: false,
			canUseInternalInventory: false,
			canUseMoySkladIntegration: false
		})
		const currentCart = createCartEntity({ status: CartStatus.DRAFT })
		const updatedCart = createCartEntity({
			status: CartStatus.DRAFT,
			items: [
				createCartItem({
					variantId: null,
					variant: null,
					quantity: 1,
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: null,
						media: []
					}
				})
			]
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(updatedCart)
		prisma.product.findFirst.mockResolvedValueOnce({
			id: 'product-1',
			price: null,
			productAttributes: []
		})
		prisma.cartItem.findFirst.mockResolvedValueOnce(null)
		prisma.cartItem.count.mockResolvedValueOnce(0)
		prisma.cartItem.create.mockResolvedValueOnce({ id: 'cart-item-1' })
		prisma.cart.update.mockResolvedValueOnce(undefined)

		const result = await service.upsertCurrentItem('catalog-1', 'token-1', {
			productId: 'product-1',
			quantity: 1
		})

		expect(capabilities.canUseProductVariants).toHaveBeenCalledWith('catalog-1')
		expect(prisma.productVariant.findMany).not.toHaveBeenCalled()
		expect(prisma.productVariant.findFirst).not.toHaveBeenCalled()
		expect(prisma.cartItem.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					productId: 'product-1',
					variantId: null,
					unitPriceSnapshot: null
				})
			})
		)
		expect(result.cart.items[0].variantId).toBeNull()
		expect(result.cart.items[0].variant).toBeNull()
		expect(result.cart.items[0].product.price).toBeNull()
	})

	it('keeps requiring variant selection when product variants are enabled', async () => {
		const currentCart = createCartEntity({ status: CartStatus.DRAFT })

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
		prisma.product.findFirst.mockResolvedValueOnce({ id: 'product-1' })
		sellableReader.resolveProductSellable.mockResolvedValueOnce({
			mode: 'MATRIX',
			variantId: null,
			priceState: 'RANGE',
			displayPrice: '1000.00',
			requiresVariantSelection: true,
			availabilityState: 'AVAILABLE',
			stock: 10
		})

		await expect(
			service.upsertCurrentItem('catalog-1', 'token-1', {
				productId: 'product-1',
				quantity: 1
			})
		).rejects.toThrow('Выберите вариацию товара')
		expect(capabilities.canUseProductVariants).toHaveBeenCalledWith('catalog-1')
		expect(prisma.productVariant.findMany).not.toHaveBeenCalled()
		expect(prisma.cartItem.create).not.toHaveBeenCalled()
	})

	it('does not inspect hidden variants when product variants are disabled', async () => {
		capabilities.canUseProductVariants.mockResolvedValueOnce(false)
		const currentCart = createCartEntity({
			status: CartStatus.DRAFT,
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_EXTERNAL }
			}
		})
		const updatedCart = createCartEntity({
			status: CartStatus.DRAFT,
			catalog: currentCart.catalog,
			items: [
				createCartItem({
					variantId: null,
					variant: null,
					quantity: 1,
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: null,
						media: []
					}
				})
			]
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(updatedCart)
		prisma.product.findFirst.mockResolvedValueOnce({
			id: 'product-1',
			price: null,
			productAttributes: []
		})
		prisma.cartItem.findFirst.mockResolvedValueOnce(null)
		prisma.cartItem.count.mockResolvedValueOnce(0)
		prisma.cartItem.create.mockResolvedValueOnce({ id: 'cart-item-1' })
		prisma.cart.update.mockResolvedValueOnce(undefined)

		const result = await service.upsertCurrentItem('catalog-1', 'token-1', {
			productId: 'product-1',
			quantity: 1
		})

		expect(prisma.productVariant.findMany).not.toHaveBeenCalled()
		expect(prisma.cartItem.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					variantId: null,
					unitPriceSnapshot: null
				})
			})
		)
		expect(result.cart.items[0].product.price).toBeNull()
	})

	it('uses selected sale unit when product variants are disabled', async () => {
		capabilities.canUseProductVariants.mockResolvedValueOnce(false)
		capabilities.getCurrentFeatures.mockResolvedValue({
			canUseProductTypes: false,
			canUseProductVariants: false,
			canUseCatalogSaleUnits: true,
			canUseInternalInventory: false,
			canUseMoySkladIntegration: false
		})
		const currentCart = createCartEntity({ status: CartStatus.DRAFT })
		const updatedCart = createCartEntity({
			status: CartStatus.DRAFT,
			items: [
				createCartItem({
					variantId: 'variant-1',
					saleUnitId: 'sale-unit-hidden',
					variant: createVariant({ id: 'variant-1', price: 1000 }),
					saleUnit: {
						id: 'sale-unit-hidden',
						variantId: 'variant-1',
						code: 'box',
						name: 'Box',
						baseQuantity: 12,
						price: 500,
						isDefault: true,
						isActive: true,
						displayOrder: 0
					},
					quantity: 1,
					baseQuantity: 12,
					unitPriceSnapshot: 500,
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: 1000,
						media: []
					}
				})
			]
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(updatedCart)
		prisma.product.findFirst.mockResolvedValueOnce({
			id: 'product-1',
			price: 1000,
			productAttributes: []
		})
		prisma.productVariantSaleUnit.findFirst
			.mockResolvedValueOnce({ variantId: 'variant-1' })
			.mockResolvedValueOnce({
				id: 'sale-unit-hidden',
				variantId: 'variant-1',
				baseQuantity: 12,
				price: 500
			})
		prisma.productVariant.findFirst.mockResolvedValueOnce({
			id: 'variant-1',
			price: 1000
		})
		prisma.cartItem.findFirst.mockResolvedValueOnce(null)
		prisma.cartItem.count.mockResolvedValueOnce(0)
		prisma.cartItem.create.mockResolvedValueOnce({ id: 'cart-item-1' })
		prisma.cart.update.mockResolvedValueOnce(undefined)

		const result = await service.upsertCurrentItem('catalog-1', 'token-1', {
			productId: 'product-1',
			saleUnitId: 'sale-unit-hidden',
			quantity: 1
		})

		expect(prisma.cartItem.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					variantId: 'variant-1',
					saleUnitId: 'sale-unit-hidden',
					baseQuantity: 12,
					unitPriceSnapshot: 500
				})
			})
		)
		expect(result.cart.items[0].variantId).toBeNull()
		expect(result.cart.items[0].saleUnitId).toBe('sale-unit-hidden')
		expect(result.cart.items[0].saleUnit).toEqual(
			expect.objectContaining({
				name: 'Box',
				baseQuantity: 12,
				price: 500
			})
		)
		expect(sellableReader.resolveVariantSellable).toHaveBeenCalledWith(
			'catalog-1',
			'product-1',
			'variant-1',
			{ quantity: 12, enforceStock: false }
		)
	})

	it('stores discounted variant price snapshot when adding an item', async () => {
		const currentCart = createCartEntity({ status: CartStatus.DRAFT })
		const variant = createVariant({
			id: 'variant-1',
			price: 1500
		})
		const updatedCart = createCartEntity({
			status: CartStatus.DRAFT,
			items: [
				createCartItem({
					variantId: 'variant-1',
					variant,
					quantity: 1,
					unitPriceSnapshot: 1350
				})
			]
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(updatedCart)
		prisma.product.findFirst.mockResolvedValueOnce({
			id: 'product-1',
			price: 1000,
			productAttributes: [
				{
					valueDecimal: 10,
					attribute: { key: 'discount' }
				}
			]
		})
		prisma.productVariant.findFirst
			.mockResolvedValueOnce({ id: 'variant-1', price: 1500 })
			.mockResolvedValueOnce({
				stock: 5,
				isAvailable: true,
				status: ProductVariantStatus.ACTIVE
			})
		prisma.cartItem.findFirst.mockResolvedValueOnce(null)
		prisma.cartItem.count.mockResolvedValueOnce(0)
		prisma.cartItem.create.mockResolvedValueOnce({ id: 'cart-item-1' })
		prisma.cart.update.mockResolvedValueOnce(undefined)

		await service.upsertCurrentItem('catalog-1', 'token-1', {
			productId: 'product-1',
			variantId: 'variant-1',
			quantity: 1
		})

		expect(prisma.cartItem.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					variantId: 'variant-1',
					unitPriceSnapshot: 1350
				})
			})
		)
	})

	it('keeps different variants of the same product as separate cart items', async () => {
		const currentCart = createCartEntity({ status: CartStatus.DRAFT })
		const smallVariant = createVariant({
			id: 'variant-small',
			sku: 'PRODUCT-S',
			variantKey: 'size=s'
		})
		const mediumVariant = createVariant({
			id: 'variant-medium',
			sku: 'PRODUCT-M',
			variantKey: 'size=m',
			price: 2099
		})
		const updatedCart = createCartEntity({
			status: CartStatus.DRAFT,
			items: [
				createCartItem({
					id: 'cart-item-small',
					variantId: 'variant-small',
					variant: smallVariant,
					quantity: 1
				}),
				createCartItem({
					id: 'cart-item-medium',
					variantId: 'variant-medium',
					variant: mediumVariant,
					quantity: 1
				})
			]
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(updatedCart)
		prisma.product.findFirst.mockResolvedValueOnce({ id: 'product-1' })
		prisma.productVariant.findFirst
			.mockResolvedValueOnce({ id: 'variant-medium' })
			.mockResolvedValueOnce({
				stock: 5,
				isAvailable: true,
				status: ProductVariantStatus.ACTIVE
			})
		prisma.cartItem.findFirst.mockResolvedValueOnce(null)
		prisma.cartItem.count.mockResolvedValueOnce(1)
		prisma.cartItem.create.mockResolvedValueOnce({ id: 'cart-item-medium' })
		prisma.cart.update.mockResolvedValueOnce(undefined)

		const result = await service.upsertCurrentItem('catalog-1', 'token-1', {
			productId: 'product-1',
			variantId: 'variant-medium',
			quantity: 1
		})

		expect(prisma.cartItem.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					cartId: 'cart-1',
					productId: 'product-1',
					variantId: 'variant-medium',
					saleUnitId: null,
					guestSessionId: null
				}
			})
		)
		expect(prisma.cartItem.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					productId: 'product-1',
					variantId: 'variant-medium'
				})
			})
		)
		expect(prisma.cartItem.update).not.toHaveBeenCalled()
		expect(result.cart.items.map(item => item.variantId)).toEqual([
			'variant-small',
			'variant-medium'
		])
	})

	it('blocks disabled variants even when stock is not enforced', async () => {
		const currentCart = createCartEntity({
			status: CartStatus.DRAFT,
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_NONE }
			}
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
		prisma.product.findFirst.mockResolvedValueOnce({ id: 'product-1' })
		prisma.productVariant.findFirst
			.mockResolvedValueOnce({ id: 'variant-disabled' })
			.mockResolvedValueOnce({
				stock: 10,
				isAvailable: true,
				status: ProductVariantStatus.DISABLED
			})
		sellableReader.resolveVariantSellable.mockResolvedValueOnce({
			variantId: 'variant-disabled',
			availabilityState: 'UNAVAILABLE',
			stock: 10
		})

		await expect(
			service.upsertCurrentItem('catalog-1', 'token-1', {
				productId: 'product-1',
				variantId: 'variant-disabled',
				quantity: 1
			})
		).rejects.toThrow()
		expect(prisma.cartItem.create).not.toHaveBeenCalled()
	})

	it('allows out-of-stock variants when catalog inventory mode is NONE', async () => {
		const currentCart = createCartEntity({
			status: CartStatus.DRAFT,
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_NONE }
			}
		})
		const variant = {
			id: 'variant-1',
			sku: 'PRODUCT-DEFAULT',
			variantKey: 'default',
			price: 1999,
			stock: 0,
			status: ProductVariantStatus.OUT_OF_STOCK,
			isAvailable: false,
			attributes: []
		}
		const updatedCart = createCartEntity({
			status: CartStatus.DRAFT,
			catalog: currentCart.catalog,
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-1',
					variant,
					quantity: 1,
					createdAt: new Date('2026-03-25T09:00:00.000Z'),
					updatedAt: new Date('2026-03-25T09:00:00.000Z'),
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: 1999,
						media: []
					}
				}
			]
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(updatedCart)
		prisma.product.findFirst.mockResolvedValueOnce({ id: 'product-1' })
		prisma.productVariant.findFirst
			.mockResolvedValueOnce({ id: 'variant-1' })
			.mockResolvedValueOnce({
				stock: 0,
				isAvailable: false,
				status: ProductVariantStatus.OUT_OF_STOCK
			})
		prisma.cartItem.findFirst.mockResolvedValueOnce(null)
		prisma.cartItem.count.mockResolvedValueOnce(0)
		prisma.cartItem.create.mockResolvedValueOnce({ id: 'cart-item-1' })
		prisma.cart.update.mockResolvedValueOnce(undefined)

		const result = await service.upsertCurrentItem('catalog-1', 'token-1', {
			productId: 'product-1',
			variantId: 'variant-1',
			quantity: 1
		})

		expect(prisma.cartItem.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ variantId: 'variant-1' })
			})
		)
		expect(result.cart.items[0].variant?.id).toBe('variant-1')
		expect(result.cart.items[0].variant?.label).toBe('default')
	})

	it('blocks out-of-stock variants when catalog inventory mode is EXTERNAL', async () => {
		const currentCart = createCartEntity({
			status: CartStatus.DRAFT,
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_EXTERNAL }
			}
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
		prisma.product.findFirst.mockResolvedValueOnce({ id: 'product-1' })
		prisma.productVariant.findFirst
			.mockResolvedValueOnce({ id: 'variant-1' })
			.mockResolvedValueOnce({
				stock: 0,
				isAvailable: false,
				status: ProductVariantStatus.OUT_OF_STOCK
			})
		sellableReader.resolveVariantSellable.mockResolvedValueOnce({
			variantId: 'variant-1',
			availabilityState: 'OUT_OF_STOCK',
			stock: 0
		})

		await expect(
			service.upsertCurrentItem('catalog-1', 'token-1', {
				productId: 'product-1',
				variantId: 'variant-1',
				quantity: 1
			})
		).rejects.toThrow('Недостаточно товара')
		expect(prisma.cartItem.create).not.toHaveBeenCalled()
	})

	it('blocks out-of-stock product lines without visible variant id', async () => {
		const currentCart = createCartEntity({
			status: CartStatus.DRAFT,
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_EXTERNAL }
			}
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
		prisma.product.findFirst.mockResolvedValueOnce({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: 1000,
			productAttributes: []
		})
		sellableReader.resolveProductSellable
			.mockResolvedValueOnce({
				mode: 'SIMPLE',
				variantId: null,
				priceState: 'KNOWN',
				displayPrice: '1000.00',
				requiresVariantSelection: false,
				availabilityState: 'OUT_OF_STOCK',
				stock: 0
			})
			.mockResolvedValueOnce({
				mode: 'SIMPLE',
				variantId: null,
				priceState: 'KNOWN',
				displayPrice: '1000.00',
				requiresVariantSelection: false,
				availabilityState: 'OUT_OF_STOCK',
				stock: 0
			})

		await expect(
			service.upsertCurrentItem('catalog-1', 'token-1', {
				productId: 'product-1',
				quantity: 1
			})
		).rejects.toThrow('Недостаточно товара')
		expect(prisma.productVariant.findFirst).not.toHaveBeenCalled()
		expect(prisma.cartItem.create).not.toHaveBeenCalled()
	})

	it('checks sale unit stock using base quantity during cart upsert', async () => {
		const currentCart = createCartEntity({
			status: CartStatus.DRAFT,
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_EXTERNAL }
			}
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
		prisma.product.findFirst.mockResolvedValueOnce({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: 1000,
			productAttributes: []
		})
		prisma.productVariantSaleUnit.findFirst
			.mockResolvedValueOnce({ variantId: 'variant-1' })
			.mockResolvedValueOnce({
				id: 'sale-unit-1',
				variantId: 'variant-1',
				baseQuantity: 12,
				price: 1000
			})
		prisma.productVariant.findFirst.mockResolvedValueOnce({
			id: 'variant-1',
			price: 1000
		})
		sellableReader.resolveVariantSellable.mockResolvedValueOnce({
			variantId: 'variant-1',
			availabilityState: 'OUT_OF_STOCK',
			stock: 5
		})

		await expect(
			service.upsertCurrentItem('catalog-1', 'token-1', {
				productId: 'product-1',
				saleUnitId: 'sale-unit-1',
				quantity: 1
			})
		).rejects.toThrow('Недостаточно товара')
		expect(sellableReader.resolveVariantSellable).toHaveBeenCalledWith(
			'catalog-1',
			'product-1',
			'variant-1',
			{ quantity: 12, enforceStock: true }
		)
		expect(prisma.cartItem.create).not.toHaveBeenCalled()
	})

	it('converts a shared cart into a completed order', async () => {
		const cartWithItems = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			checkoutMethod: CartCheckoutMethod.DELIVERY,
			checkoutData: { address: 'Main street, 1' },
			checkoutContacts: { TELEGRAM: '@delivery' },
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
		prisma.order.create.mockResolvedValue(createCompletedOrderEntity())

		const result = await service.completeManagerOrder('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		expect(prisma.order.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					status: OrderStatus.COMPLETED,
					catalogId: 'catalog-1',
					isDelivery: true,
					address: 'Main street, 1',
					checkoutMethod: CartCheckoutMethod.DELIVERY,
					checkoutData: { address: 'Main street, 1' },
					checkoutContacts: { TELEGRAM: '@delivery' }
				})
			})
		)
		expect(prisma.cart.updateMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: 'cart-1',
					status: { in: expect.any(Array) }
				}),
				data: expect.objectContaining({
					status: CartStatus.CONVERTED,
					publicKey: null,
					checkoutKey: null
				})
			})
		)
		expect(result.order.id).toBe('order-1')
		expect(result.order.status).toBe(OrderStatus.COMPLETED)
		expect(orderExportQueue.enqueueCompletedOrder).toHaveBeenCalledWith(
			'catalog-1',
			'order-1'
		)
		expect(inventory.consumeCompletedOrderStockTx).not.toHaveBeenCalled()
	})

	it('applies manager checkout data before converting a preorder cart', async () => {
		const preorderCheckoutData = {
			customerName: 'Ivan',
			hallTableId: 'table-11',
			hallTableName: 'Стол 11',
			hallTableNumber: '11',
			iikoTableId: 'table-11',
			phone: '+7 (988) 111-22-33',
			personsCount: 2,
			tableNumber: '11',
			visitDate: '2026-06-01',
			visitTime: '19:30'
		}
		const cartWithItems = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: null,
					quantity: 1,
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
		const updatedCart = createCartEntity({
			...cartWithItems,
			checkoutMethod: CartCheckoutMethod.PREORDER,
			checkoutData: {
				...preorderCheckoutData,
				guestsCount: 2,
				scheduledAt: '2026-06-01T19:30:00.000'
			},
			checkoutContacts: { PHONE: '+7 (999) 000-00-00' }
		})
		const convertedCart = createCartEntity({
			...updatedCart,
			status: CartStatus.CONVERTED,
			publicKey: null,
			checkoutKey: null,
			closedAt: new Date('2026-03-25T09:10:00.000Z')
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(cartWithItems)
			.mockResolvedValueOnce(updatedCart)
			.mockResolvedValueOnce(convertedCart)
		prisma.catalog.findFirst
			.mockResolvedValueOnce({
				id: 'catalog-1',
				userId: 'manager-1'
			})
			.mockResolvedValueOnce({
				type: { code: 'restaurant' },
				settings: {
					address: 'Cafe address',
					checkout: {
						enabledMethods: [
							CartCheckoutMethod.DELIVERY,
							CartCheckoutMethod.PICKUP,
							CartCheckoutMethod.PREORDER
						],
						preorder: {
							minLeadTimeMinutes: 0,
							maxAdvanceDays: 365
						}
					}
				},
				contacts: [
					{
						type: ContactType.PHONE,
						value: '+7 (999) 000-00-00'
					}
				]
			})
		prisma.order.create.mockResolvedValue(
			createCompletedOrderEntity({
				checkoutMethod: CartCheckoutMethod.PREORDER,
				checkoutData: updatedCart.checkoutData,
				checkoutContacts: updatedCart.checkoutContacts
			})
		)

		await service.completeManagerOrder(
			'public-1',
			{
				id: 'manager-1',
				role: Role.CATALOG
			},
			{
				checkoutMethod: CartCheckoutMethod.PREORDER,
				checkoutData: preorderCheckoutData
			}
		)

		expect(prisma.cart.update).toHaveBeenCalledWith({
			where: { id: 'cart-1' },
			data: expect.objectContaining({
				checkoutMethod: CartCheckoutMethod.PREORDER,
				checkoutData: expect.objectContaining({
					customerName: 'Ivan',
					hallTableId: 'table-11',
					hallTableName: 'Стол 11',
					hallTableNumber: '11',
					iikoTableId: 'table-11',
					phone: '+7 (988) 111-22-33',
					personsCount: 2,
					tableNumber: '11',
					visitDate: '2026-06-01',
					visitTime: '19:30'
				}),
				checkoutContacts: { PHONE: '+7 (999) 000-00-00' }
			})
		})
		expect(prisma.order.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					checkoutMethod: CartCheckoutMethod.PREORDER,
					checkoutData: updatedCart.checkoutData,
					checkoutContacts: updatedCart.checkoutContacts
				})
			})
		)
	})

	it('stores discounted final price and base price in order snapshot', async () => {
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
						price: 1000,
						productAttributes: [
							{
								valueDecimal: 10,
								attribute: { key: 'discount' }
							}
						]
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
		prisma.order.create.mockResolvedValue(
			createCompletedOrderEntity({
				totalAmount: 1800,
				products: [
					{
						id: 'cart-item-1',
						productId: 'product-1',
						variantId: null,
						quantity: 2,
						baseUnitPrice: 1000,
						unitPrice: 900,
						unitPriceSnapshot: 900,
						discountPercent: 10,
						hasDiscount: true,
						lineTotal: 1800,
						product: {
							id: 'product-1',
							name: 'Product 1',
							slug: 'product-1'
						}
					}
				]
			})
		)

		await service.completeManagerOrder('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		const createArgs = prisma.order.create.mock.calls[0][0]
		expect(createArgs.data.products[0]).toEqual(
			expect.objectContaining({
				baseUnitPrice: 1000,
				unitPrice: 900,
				unitPriceSnapshot: 900,
				discountPercent: 10,
				hasDiscount: true,
				lineTotal: 1800
			})
		)
		expect(createArgs.data.totalAmount).toBe(1800)
	})

	it('uses the selected variant price when converting a cart into an order', async () => {
		const variant = {
			id: 'variant-1',
			sku: 'PRODUCT-XL',
			variantKey: 'size=xl',
			price: 2499,
			stock: 5,
			status: ProductVariantStatus.ACTIVE,
			isAvailable: true,
			attributes: [
				{
					attribute: {
						id: 'attribute-size',
						key: 'size',
						displayName: 'Size',
						displayOrder: 1
					},
					enumValue: {
						id: 'enum-xl',
						value: 'xl',
						displayName: 'XL',
						displayOrder: 1
					}
				}
			]
		}
		const cartWithItems = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_INTERNAL }
			},
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-1',
					variant,
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
		prisma.productVariant.findFirst.mockResolvedValueOnce({
			stock: 5,
			isAvailable: true,
			status: ProductVariantStatus.ACTIVE
		})
		prisma.cart.update.mockResolvedValue(undefined)
		prisma.order.create.mockResolvedValue(
			createCompletedOrderEntity({
				totalAmount: 4998,
				products: [
					{
						id: 'cart-item-1',
						productId: 'product-1',
						variantId: 'variant-1',
						variant,
						quantity: 2,
						unitPrice: 2499,
						lineTotal: 4998,
						product: {
							id: 'product-1',
							name: 'Product 1',
							slug: 'product-1'
						}
					}
				]
			})
		)

		const result = await service.completeManagerOrder('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		const createArgs = prisma.order.create.mock.calls[0][0]
		expect(createArgs.data.products[0]).toEqual(
			expect.objectContaining({
				variantId: 'variant-1',
				unitPrice: 2499,
				lineTotal: 4998,
				variant: expect.objectContaining({
					id: 'variant-1',
					sku: 'PRODUCT-XL',
					variantKey: 'size=xl'
				})
			})
		)
		expect(createArgs.data.totalAmount).toBe(4998)
		expect(result.order.items[0]).toEqual(
			expect.objectContaining({
				variantId: 'variant-1',
				unitPrice: 2499,
				variant: expect.objectContaining({ sku: 'PRODUCT-XL' })
			})
		)
		expect(orderExportQueue.enqueueCompletedOrder).toHaveBeenCalledWith(
			'catalog-1',
			'order-1'
		)
	})

	it('stores integration product and variant refs in the order snapshot', async () => {
		const variant = {
			id: 'variant-1',
			sku: 'PRODUCT-XL',
			variantKey: 'size=xl',
			price: 2499,
			stock: 5,
			status: ProductVariantStatus.ACTIVE,
			isAvailable: true,
			attributes: []
		}
		const cartWithItems = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_INTERNAL }
			},
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-1',
					variant,
					quantity: 1,
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
		prisma.productVariant.findFirst.mockResolvedValueOnce({
			stock: 5,
			isAvailable: true,
			status: ProductVariantStatus.ACTIVE
		})
		prisma.integrationProductLink.findMany.mockResolvedValueOnce([
			{
				productId: 'product-1',
				integrationId: 'integration-1',
				externalId: 'product-code',
				externalCode: 'MS-PRODUCT',
				lastSyncedAt: new Date('2026-03-25T08:00:00.000Z'),
				rawMeta: {
					id: '11111111-1111-1111-1111-111111111111',
					type: 'product'
				},
				integration: { provider: IntegrationProvider.MOYSKLAD }
			}
		])
		prisma.integrationVariantLink.findMany.mockResolvedValueOnce([
			{
				variantId: 'variant-1',
				integrationId: 'integration-1',
				externalId: 'variant-code',
				externalCode: 'MS-VARIANT',
				lastSyncedAt: new Date('2026-03-25T08:05:00.000Z'),
				rawMeta: {
					id: '22222222-2222-2222-2222-222222222222',
					type: 'variant'
				},
				integration: { provider: IntegrationProvider.MOYSKLAD }
			}
		])
		prisma.cart.update.mockResolvedValue(undefined)
		prisma.order.create.mockResolvedValue(
			createCompletedOrderEntity({
				totalAmount: 2499,
				products: [
					{
						id: 'cart-item-1',
						productId: 'product-1',
						variantId: 'variant-1',
						variant,
						quantity: 1,
						unitPrice: 2499,
						lineTotal: 2499,
						product: {
							id: 'product-1',
							name: 'Product 1',
							slug: 'product-1'
						}
					}
				]
			})
		)

		await service.completeManagerOrder('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		const createArgs = prisma.order.create.mock.calls[0][0]
		expect(createArgs.data.products[0]).toEqual(
			expect.objectContaining({
				externalProducts: [
					expect.objectContaining({
						integrationId: 'integration-1',
						provider: IntegrationProvider.MOYSKLAD,
						externalId: 'product-code',
						externalCode: 'MS-PRODUCT',
						lastSyncedAt: '2026-03-25T08:00:00.000Z',
						assortmentRef: {
							id: '11111111-1111-1111-1111-111111111111',
							type: 'product'
						}
					})
				],
				externalVariants: [
					expect.objectContaining({
						integrationId: 'integration-1',
						provider: IntegrationProvider.MOYSKLAD,
						externalId: 'variant-code',
						externalCode: 'MS-VARIANT',
						lastSyncedAt: '2026-03-25T08:05:00.000Z',
						assortmentRef: {
							id: '22222222-2222-2222-2222-222222222222',
							type: 'variant'
						}
					})
				]
			})
		)
	})

	it('keeps hidden default variant identity in order snapshot when variants are disabled', async () => {
		capabilities.getCurrentFeatures.mockResolvedValueOnce({
			canUseProductTypes: false,
			canUseProductVariants: false,
			canUseCatalogSaleUnits: false,
			canUseInternalInventory: false,
			canUseMoySkladIntegration: true
		})
		const variant = {
			id: 'variant-hidden',
			sku: 'PRODUCT-DEFAULT',
			variantKey: 'default',
			price: 2499,
			stock: 5,
			status: ProductVariantStatus.ACTIVE,
			isAvailable: true,
			attributes: []
		}
		const cartWithItems = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-hidden',
					variant,
					quantity: 1,
					unitPriceSnapshot: 2499,
					createdAt: new Date('2026-03-25T09:00:00.000Z'),
					updatedAt: new Date('2026-03-25T09:00:00.000Z'),
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: null
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
		prisma.productVariant.findFirst.mockResolvedValueOnce({
			stock: 5,
			isAvailable: true,
			status: ProductVariantStatus.ACTIVE
		})
		prisma.integrationVariantLink.findMany.mockResolvedValueOnce([
			{
				variantId: 'variant-hidden',
				integrationId: 'integration-1',
				externalId: 'variant-code',
				externalCode: 'MS-VARIANT',
				lastSyncedAt: new Date('2026-03-25T08:05:00.000Z'),
				rawMeta: {
					id: '22222222-2222-2222-2222-222222222222',
					type: 'variant'
				},
				integration: { provider: IntegrationProvider.MOYSKLAD }
			}
		])
		prisma.cart.update.mockResolvedValue(undefined)
		prisma.order.create.mockResolvedValue(
			createCompletedOrderEntity({
				totalAmount: 2499,
				products: [
					{
						id: 'cart-item-1',
						productId: 'product-1',
						variantId: 'variant-hidden',
						quantity: 1,
						unitPrice: 2499,
						lineTotal: 2499,
						product: {
							id: 'product-1',
							name: 'Product 1',
							slug: 'product-1'
						}
					}
				]
			})
		)

		await service.completeManagerOrder('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		expect(sellableReader.resolveVariantSellable).toHaveBeenCalledWith(
			'catalog-1',
			'product-1',
			'variant-hidden',
			{ quantity: 1, enforceStock: false }
		)
		const createArgs = prisma.order.create.mock.calls[0][0]
		expect(createArgs.data.products[0]).toEqual(
			expect.objectContaining({
				variantId: 'variant-hidden',
				variantHidden: true,
				variant: null,
				unitPrice: 2499,
				unitPriceSnapshot: 2499,
				lineTotal: 2499,
				externalVariants: [
					expect.objectContaining({
						integrationId: 'integration-1',
						provider: IntegrationProvider.MOYSKLAD,
						externalId: 'variant-code'
					})
				]
			})
		)
	})

	it('consumes internal inventory stock when manager completes an order', async () => {
		const variant = {
			id: 'variant-1',
			sku: 'PRODUCT-XL',
			variantKey: 'size=xl',
			price: 2499,
			stock: 5,
			status: ProductVariantStatus.ACTIVE,
			isAvailable: true,
			attributes: []
		}
		const cartWithItems = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_INTERNAL }
			},
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-1',
					variant,
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
			catalog: cartWithItems.catalog,
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
		prisma.productVariant.findFirst.mockResolvedValueOnce({
			stock: 5,
			isAvailable: true,
			status: ProductVariantStatus.ACTIVE
		})
		prisma.cart.update.mockResolvedValue(undefined)
		prisma.order.create.mockResolvedValue(
			createCompletedOrderEntity({
				products: [
					{
						id: 'cart-item-1',
						productId: 'product-1',
						variantId: 'variant-1',
						quantity: 2,
						unitPrice: 2499,
						lineTotal: 4998,
						variant,
						product: {
							id: 'product-1',
							name: 'Product 1',
							slug: 'product-1'
						}
					}
				]
			})
		)

		await service.completeManagerOrder('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		expect(inventory.consumeCompletedOrderStockTx).toHaveBeenCalledWith(
			prisma,
			expect.objectContaining({
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
		)
	})

	it('rejects internal inventory order items without variantId', async () => {
		const cartWithItems = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_INTERNAL }
			},
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: null,
					quantity: 1,
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
		prisma.cart.findFirst
			.mockResolvedValueOnce(cartWithItems)
			.mockResolvedValueOnce(cartWithItems)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			userId: 'manager-1'
		})

		await expect(
			service.completeManagerOrder('public-1', {
				id: 'manager-1',
				role: Role.CATALOG
			})
		).rejects.toThrow('Internal inventory order items must have variantId')

		expect(prisma.order.create).not.toHaveBeenCalled()
		expect(inventory.consumeCompletedOrderStockTx).not.toHaveBeenCalled()
		expect(orderExportQueue.enqueueCompletedOrder).not.toHaveBeenCalled()
	})

	it('does not convert cart or queue export when internal inventory consumption fails', async () => {
		const variant = {
			id: 'variant-1',
			sku: 'PRODUCT-XL',
			variantKey: 'size=xl',
			price: 2499,
			stock: 5,
			status: ProductVariantStatus.ACTIVE,
			isAvailable: true,
			attributes: []
		}
		const cartWithItems = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_INTERNAL }
			},
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-1',
					variant,
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
		prisma.cart.findFirst
			.mockResolvedValueOnce(cartWithItems)
			.mockResolvedValueOnce(cartWithItems)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			userId: 'manager-1'
		})
		prisma.productVariant.findFirst.mockResolvedValueOnce({
			stock: 5,
			isAvailable: true,
			status: ProductVariantStatus.ACTIVE
		})
		prisma.order.create.mockResolvedValue(createCompletedOrderEntity())
		inventory.consumeCompletedOrderStockTx.mockRejectedValue(
			new Error('inventory failed')
		)

		await expect(
			service.completeManagerOrder('public-1', {
				id: 'manager-1',
				role: Role.CATALOG
			})
		).rejects.toThrow('inventory failed')

		expect(prisma.cart.update).not.toHaveBeenCalled()
		expect(orderExportQueue.enqueueCompletedOrder).not.toHaveBeenCalled()
	})

	it('replays missed SSE events before sending a fresh snapshot', async () => {
		const initialCart = createCartEntity()
		const replayedCart = createCartEntity({
			updatedAt: new Date('2026-03-25T09:01:00.000Z'),
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: null,
					quantity: 1,
					createdAt: new Date('2026-03-25T09:01:00.000Z'),
					updatedAt: new Date('2026-03-25T09:01:00.000Z'),
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: 1999
					}
				}
			]
		})
		const freshSnapshot = createCartEntity({
			updatedAt: new Date('2026-03-25T09:02:00.000Z'),
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: null,
					quantity: 2,
					createdAt: new Date('2026-03-25T09:01:00.000Z'),
					updatedAt: new Date('2026-03-25T09:02:00.000Z'),
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: 1999
					}
				}
			]
		})

		prisma.cart.findFirst
			.mockResolvedValueOnce(initialCart)
			.mockResolvedValueOnce(freshSnapshot)
		redis.xrange.mockResolvedValueOnce([
			[
				'1700000000000-0',
				[
					'type',
					'cart.updated',
					'payload',
					JSON.stringify(service['mapCart'](replayedCart))
				]
			]
		])

		const stream = await service.connectPublicSse('public-1', '1699999999999-0')

		const events = await new Promise<MessageEvent[]>(resolve => {
			const received: MessageEvent[] = []
			const subscription = stream.subscribe(event => {
				received.push(event)
				if (event.type === 'cart.snapshot') {
					subscription.unsubscribe()
					resolve(received)
				}
			})
		})

		expect(redis.xrange).toHaveBeenCalledWith(
			'cart:sse:stream:cart-1',
			'(1699999999999-0',
			'+',
			'COUNT',
			expect.any(String)
		)
		expect(events.map(event => event.type)).toEqual([
			'connected',
			'cart.updated',
			'cart.snapshot'
		])
		expect(events[1]).toMatchObject({
			id: '1700000000000-0',
			type: 'cart.updated'
		})
		expect(
			(events[2].data as { items: Array<{ quantity: number }> }).items[0].quantity
		).toBe(2)
	})
})

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
import { CatalogInventoryMode } from '@generated/enums'
import type { MessageEvent } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { CAPABILITY_READER_PORT } from '@/modules/capability/contracts'
import { CatalogPriceListResolverService } from '@/modules/catalog-price-list/public'
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
import { CartModifierSelectionService } from './cart-modifier-selection.service'
import { CartOrderExportService } from './cart-order-export.service'
import { CartOrderSnapshotService } from './cart-order-snapshot.service'
import { CartShareService } from './cart-share.service'
import { CartSseService } from './cart-sse.service'
import { CartVariantSelectionService } from './cart-variant-selection.service'
import { CartService } from './cart.service'
import { OrderCheckoutService } from './order-checkout.service'

const INVENTORY_MODE_NONE = CatalogInventoryMode.NONE
const INVENTORY_MODE_EXTERNAL = CatalogInventoryMode.EXTERNAL
const INVENTORY_MODE_INTERNAL = CatalogInventoryMode.INTERNAL

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
		catalog: {
			parentId: null,
			settings: { inventoryMode: INVENTORY_MODE_NONE }
		},
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

function issueHallTableGuestToken(
	service: CartService,
	overrides: Partial<{
		catalogId: string
		cartId: string
		sessionId: string
		tableExternalId: string
		publicCode: string
		guestSessionId: string
	}> = {}
) {
	const issuer = service as unknown as {
		issueHallTableGuestToken(params: {
			catalogId: string
			cartId: string
			sessionId: string
			tableExternalId: string
			publicCode: string
			guestSessionId: string
		}): string
	}

	return issuer.issueHallTableGuestToken({
		catalogId: 'catalog-1',
		cartId: 'cart-1',
		sessionId: 'table-session-1',
		tableExternalId: 'iiko-table-1',
		publicCode: 'table-code-1',
		guestSessionId: 'guest-1',
		...overrides
	})
}

describe('CartService', () => {
	const previousCartGuestTokenSecret = process.env.CART_GUEST_TOKEN_SECRET
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
		cartItemModifier: {
			deleteMany: jest.Mock
			createMany: jest.Mock
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
	let priceLists: {
		resolveLinePrice: jest.Mock
	}

	beforeAll(() => {
		process.env.CART_GUEST_TOKEN_SECRET = 'cart-service-spec-secret'
	})

	afterAll(() => {
		if (previousCartGuestTokenSecret === undefined) {
			delete process.env.CART_GUEST_TOKEN_SECRET
			return
		}
		process.env.CART_GUEST_TOKEN_SECRET = previousCartGuestTokenSecret
	})

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
			cartItemModifier: {
				deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
				createMany: jest.fn().mockResolvedValue({ count: 0 })
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
		priceLists = {
			resolveLinePrice: jest.fn().mockResolvedValue({
				priceList: null,
				price: null,
				target: null,
				targetId: null
			})
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
				CartModifierSelectionService,
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
				},
				{
					provide: CatalogPriceListResolverService,
					useValue: priceLists
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

	it('does not trust a hall table guestSessionId without a valid guest token', async () => {
		const session = createCartTableSession()
		const cart = createCartEntity({ tableSession: session })

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
		prisma.cartTableSession.findFirst.mockResolvedValueOnce(session)
		prisma.cart.findFirst.mockResolvedValueOnce(cart)

		const result = await service.joinHallTableSession(
			'catalog-1',
			'table-code-1',
			{
				guestName: 'Guest 1',
				guestSessionId: 'guest-victim'
			}
		)

		expect(result.guestSessionId).not.toBe('guest-victim')
		expect(result.guestSessionId).toMatch(/^guest-/)
		expect(result.guestToken).toEqual(expect.any(String))
	})

	it('keeps a hall table guestSessionId when the guest token is valid', async () => {
		const session = createCartTableSession()
		const cart = createCartEntity({ tableSession: session })
		const guestToken = issueHallTableGuestToken(service, {
			guestSessionId: 'guest-1'
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
		prisma.cartTableSession.findFirst.mockResolvedValueOnce(session)
		prisma.cart.findFirst.mockResolvedValueOnce(cart)

		const result = await service.joinHallTableSession(
			'catalog-1',
			'table-code-1',
			{
				guestName: 'Guest 1',
				guestSessionId: 'guest-1',
				guestToken
			}
		)

		expect(result.guestSessionId).toBe('guest-1')
		expect(result.guestToken).toEqual(expect.any(String))
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

		const result = await service.submitPublicHallOrder(
			'public-1',
			{},
			issueHallTableGuestToken(service)
		)

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
		).rejects.toThrow('Сессия стола не открыта')
		expect(prisma.cartItem.create).not.toHaveBeenCalled()
	})

	it('requires a guest token for public hall table item changes', async () => {
		const openCart = createCartEntity({
			tableSession: createCartTableSession()
		})

		prisma.cart.findFirst.mockResolvedValueOnce(openCart)

		await expect(
			service.upsertPublicItem('public-1', {
				productId: 'product-1',
				quantity: 1
			})
		).rejects.toThrow('Заголовок x-cart-guest-token обязателен')
		expect(prisma.cartItem.create).not.toHaveBeenCalled()
	})

	it('uses the guest token owner for public hall table item upserts', async () => {
		const openCart = createCartEntity({
			tableSession: createCartTableSession()
		})
		const upsertItem = jest
			.spyOn(
				service as unknown as {
					upsertItem(cartId: string, input: unknown): Promise<unknown>
				},
				'upsertItem'
			)
			.mockResolvedValueOnce({
				cart: openCart,
				changed: false,
				inventoryCacheCatalogIds: [],
				inventoryDomainEvents: []
			})

		prisma.cart.findFirst.mockResolvedValueOnce(openCart)

		await service.upsertPublicItem(
			'public-1',
			{
				productId: 'product-1',
				quantity: 1,
				guestSessionId: 'guest-victim'
			},
			issueHallTableGuestToken(service, { guestSessionId: 'guest-owner' })
		)

		expect(upsertItem).toHaveBeenCalledWith(
			'cart-1',
			expect.objectContaining({ guestSessionId: 'guest-owner' })
		)
	})

	it('rejects removing another guest public hall table item', async () => {
		const openCart = createCartEntity({
			tableSession: createCartTableSession(),
			items: [
				createCartItem({
					id: 'cart-item-guest-1',
					guestSessionId: 'guest-1'
				})
			]
		})
		const context = {
			id: 'cart-1',
			catalogId: 'catalog-1',
			status: CartStatus.SHARED,
			tableSession: { status: CartTableSessionStatus.OPEN },
			catalog: {
				parentId: null,
				settings: { inventoryMode: INVENTORY_MODE_NONE }
			}
		}

		prisma.cart.findFirst
			.mockResolvedValueOnce(openCart)
			.mockResolvedValueOnce(context)
		prisma.cartItem.findFirst.mockResolvedValueOnce({
			id: 'cart-item-guest-1',
			productId: 'product-1',
			variantId: null,
			saleUnitId: null,
			guestSessionId: 'guest-1'
		})

		await expect(
			service.removePublicItem(
				'public-1',
				'cart-item-guest-1',
				issueHallTableGuestToken(service, { guestSessionId: 'guest-2' })
			)
		).rejects.toThrow('Эту позицию')
		expect(prisma.cartItem.updateMany).not.toHaveBeenCalled()
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
			{ quantity: 1, enforceStock: false, buyerCatalogId: 'child-catalog' }
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
			{ quantity: 1, enforceStock: false, buyerCatalogId: 'catalog-1' }
		)
		expect(prisma.cartItem.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					cartId: 'cart-1',
					productId: 'product-1',
					variantId: 'variant-single',
					saleUnitId: null,
					guestSessionId: null,
					modifierSignature: ''
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

	it('removes a cart line with modifiers without revalidating product modifiers', async () => {
		const currentCart = createCartEntity({
			status: CartStatus.DRAFT,
			items: [
				createCartItem({
					id: 'cart-item-cheese',
					modifierSignature: 'modifier-group-1:modifier-option-1x2',
					modifiers: [
						{
							id: 'cart-item-modifier-1',
							productModifierGroupId: 'modifier-group-1',
							productModifierOptionId: 'modifier-option-1',
							catalogModifierGroupId: null,
							catalogModifierOptionId: null,
							groupCode: 'add',
							groupName: 'Добавки',
							optionCode: 'cheese',
							optionName: 'Сыр',
							quantity: 2,
							unitPriceSnapshot: 100
						}
					]
				})
			]
		})
		const updatedCart = createCartEntity({
			status: CartStatus.DRAFT,
			items: []
		})
		const existingItem = {
			id: 'cart-item-cheese',
			createdAt: new Date('2026-03-25T09:00:00.000Z'),
			deleteAt: null,
			quantity: 1,
			saleUnitId: null,
			modifierSignature: 'modifier-group-1:modifier-option-1x2',
			baseQuantity: 1,
			unitPriceSnapshot: 1999,
			guestSessionId: null,
			guestName: null
		}

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(updatedCart)
		prisma.cartItem.findFirst.mockResolvedValueOnce(existingItem)
		prisma.cartItem.findMany.mockResolvedValueOnce([existingItem])
		prisma.cartItem.updateMany.mockResolvedValueOnce({ count: 1 })
		prisma.cart.update.mockResolvedValueOnce(undefined)

		const result = await service.upsertCurrentItem('catalog-1', 'token-1', {
			productId: 'product-1',
			quantity: 0,
			modifiers: [
				{
					productModifierGroupId: 'modifier-group-1',
					productModifierOptionId: 'modifier-option-1',
					quantity: 2
				}
			]
		})

		expect(prisma.product.findFirst).not.toHaveBeenCalled()
		expect(prisma.productVariant.findFirst).not.toHaveBeenCalled()
		expect(prisma.cartItem.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					cartId: 'cart-1',
					productId: 'product-1',
					variantId: null,
					saleUnitId: null,
					guestSessionId: null,
					modifierSignature: 'modifier-group-1:modifier-option-1x2'
				}
			})
		)
		expect(prisma.cartItem.updateMany).toHaveBeenCalledWith({
			where: { id: { in: ['cart-item-cheese'] } },
			data: { deleteAt: expect.any(Date) }
		})
		expect(result.cart.items).toEqual([])
	})

	it('removes a sale unit cart line when variants are hidden from the client', async () => {
		const currentCart = createCartEntity({
			status: CartStatus.DRAFT,
			items: [
				createCartItem({
					id: 'cart-item-box',
					variantId: 'variant-1',
					saleUnitId: 'sale-unit-hidden'
				})
			]
		})
		const updatedCart = createCartEntity({
			status: CartStatus.DRAFT,
			items: []
		})
		const existingItem = {
			id: 'cart-item-box',
			createdAt: new Date('2026-03-25T09:00:00.000Z'),
			deleteAt: null,
			quantity: 1,
			saleUnitId: 'sale-unit-hidden',
			modifierSignature: '',
			baseQuantity: 12,
			unitPriceSnapshot: 500,
			priceListId: null,
			priceListCode: null,
			priceListName: null,
			guestSessionId: null,
			guestName: null
		}

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(updatedCart)
		prisma.cartItem.findFirst.mockResolvedValueOnce(null)
		prisma.cartItem.findMany.mockResolvedValueOnce([existingItem])
		prisma.cartItem.updateMany.mockResolvedValueOnce({ count: 1 })
		prisma.cart.update.mockResolvedValueOnce(undefined)

		const result = await service.upsertCurrentItem('catalog-1', 'token-1', {
			productId: 'product-1',
			saleUnitId: 'sale-unit-hidden',
			quantity: 0
		})

		expect(prisma.product.findFirst).not.toHaveBeenCalled()
		expect(prisma.productVariant.findFirst).not.toHaveBeenCalled()
		expect(prisma.cartItem.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					cartId: 'cart-1',
					productId: 'product-1',
					variantId: null,
					saleUnitId: 'sale-unit-hidden',
					guestSessionId: null,
					modifierSignature: ''
				}
			})
		)
		expect(prisma.cartItem.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					cartId: 'cart-1',
					productId: 'product-1',
					saleUnitId: 'sale-unit-hidden',
					guestSessionId: null,
					modifierSignature: ''
				}
			})
		)
		expect(prisma.cartItem.updateMany).toHaveBeenCalledWith({
			where: { id: { in: ['cart-item-box'] } },
			data: { deleteAt: expect.any(Date) }
		})
		expect(result.cart.items).toEqual([])
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
			{ quantity: 12, enforceStock: false, buyerCatalogId: 'catalog-1' }
		)
	})

	it('stores selected sale unit price-list snapshot and maps cart totals from it', async () => {
		const currentCart = createCartEntity({ status: CartStatus.DRAFT })
		const updatedCart = createCartEntity({
			status: CartStatus.DRAFT,
			items: [
				createCartItem({
					variantId: 'variant-1',
					saleUnitId: 'sale-unit-1',
					priceListId: 'price-list-1',
					priceListCode: 'wholesale',
					priceListName: 'Опт',
					variant: createVariant({ id: 'variant-1', price: 0 }),
					saleUnit: {
						id: 'sale-unit-1',
						variantId: 'variant-1',
						catalogSaleUnitId: null,
						code: 'piece',
						name: 'шт',
						baseQuantity: 1,
						price: 0,
						barcode: null,
						isDefault: true,
						isActive: true,
						displayOrder: 0
					},
					quantity: 2,
					baseQuantity: 2,
					unitPriceSnapshot: 200,
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1',
						price: null,
						productAttributes: [],
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
			catalogId: 'catalog-1',
			price: null,
			productAttributes: []
		})
		prisma.productVariantSaleUnit.findFirst
			.mockResolvedValueOnce({ variantId: 'variant-1' })
			.mockResolvedValueOnce({
				id: 'sale-unit-1',
				variantId: 'variant-1',
				baseQuantity: 1,
				price: 0
			})
		prisma.productVariant.findFirst.mockResolvedValueOnce({
			id: 'variant-1',
			price: 0
		})
		sellableReader.resolveVariantSellable.mockResolvedValueOnce({
			catalogId: 'catalog-1',
			productId: 'product-1',
			mode: 'SIMPLE',
			variantId: 'variant-1',
			defaultVariantId: 'variant-1',
			requiresVariantSelection: false,
			priceState: 'KNOWN',
			displayPrice: '200.00',
			minPrice: '200.00',
			maxPrice: '200.00',
			availabilityState: 'AVAILABLE',
			stock: null,
			usesPriceList: true,
			priceListId: 'price-list-1',
			priceListCode: 'wholesale',
			priceListName: 'Опт'
		})
		priceLists.resolveLinePrice.mockResolvedValueOnce({
			priceList: {
				id: 'price-list-1',
				code: 'wholesale',
				name: 'Опт'
			},
			price: '200.00',
			target: 'SALE_UNIT',
			targetId: 'sale-unit-1'
		})
		prisma.cartItem.findFirst.mockResolvedValueOnce(null)
		prisma.cartItem.count.mockResolvedValueOnce(0)
		prisma.cartItem.create.mockResolvedValueOnce({ id: 'cart-item-1' })
		prisma.cart.update.mockResolvedValueOnce(undefined)

		const result = await service.upsertCurrentItem('catalog-1', 'token-1', {
			productId: 'product-1',
			saleUnitId: 'sale-unit-1',
			quantity: 2
		})

		expect(priceLists.resolveLinePrice).toHaveBeenCalledWith(
			expect.objectContaining({
				buyerCatalogId: 'catalog-1',
				ownerCatalogId: 'catalog-1',
				productId: 'product-1',
				variantId: 'variant-1',
				saleUnitId: 'sale-unit-1',
				mode: 'SIMPLE'
			})
		)
		expect(prisma.cartItem.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					saleUnitId: 'sale-unit-1',
					unitPriceSnapshot: 200,
					priceListId: 'price-list-1',
					priceListCode: 'wholesale',
					priceListName: 'Опт'
				})
			})
		)
		expect(result.cart.items[0]).toEqual(
			expect.objectContaining({
				unitPriceSnapshot: 200,
				unitPrice: 200,
				lineTotal: 400,
				product: expect.objectContaining({ price: 200 }),
				saleUnit: expect.objectContaining({ price: 200 })
			})
		)
		expect(result.cart.totals.subtotal).toBe(400)
	})

	it('requires explicit sale unit selection when sale units are enabled', async () => {
		capabilities.canUseProductVariants.mockResolvedValueOnce(false)
		capabilities.getCurrentFeatures.mockResolvedValue({
			canUseProductTypes: false,
			canUseProductVariants: false,
			canUseCatalogSaleUnits: true,
			canUseCatalogModifiers: false,
			canUseInternalInventory: false,
			canUseMoySkladIntegration: false
		})
		const currentCart = createCartEntity({ status: CartStatus.DRAFT })

		prisma.cart.findFirst
			.mockResolvedValueOnce(currentCart)
			.mockResolvedValueOnce(currentCart)
		prisma.product.findFirst.mockResolvedValueOnce({
			id: 'product-1',
			catalogId: 'catalog-1',
			price: 1000,
			productAttributes: []
		})
		sellableReader.resolveProductSellable.mockResolvedValueOnce({
			mode: 'SIMPLE',
			variantId: 'variant-1',
			priceState: 'FIXED',
			displayPrice: '1000.00',
			requiresVariantSelection: false,
			availabilityState: 'AVAILABLE',
			stock: 10
		})
		prisma.productVariant.findFirst.mockResolvedValueOnce({
			id: 'variant-1',
			price: 1000
		})
		prisma.productVariantSaleUnit.findFirst.mockResolvedValueOnce({
			id: 'sale-unit-default',
			variantId: 'variant-1',
			baseQuantity: 12,
			price: 500
		})

		await expect(
			service.upsertCurrentItem('catalog-1', 'token-1', {
				productId: 'product-1',
				quantity: 1
			})
		).rejects.toThrow('Выберите единицу продажи')

		expect(prisma.cartItem.create).not.toHaveBeenCalled()
		expect(prisma.cartItem.update).not.toHaveBeenCalled()
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
					guestSessionId: null,
					modifierSignature: ''
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
			{ quantity: 12, enforceStock: false, buyerCatalogId: 'catalog-1' }
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

	it('keeps cart item modifiers in order snapshot during checkout', async () => {
		const cartWithItems = createCartEntity({
			status: CartStatus.IN_PROGRESS,
			assignedManagerId: 'manager-1',
			items: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: null,
					saleUnitId: null,
					quantity: 2,
					createdAt: new Date('2026-03-25T09:00:00.000Z'),
					updatedAt: new Date('2026-03-25T09:00:00.000Z'),
					product: {
						id: 'product-1',
						catalogId: 'catalog-1',
						name: 'Product 1',
						slug: 'product-1',
						price: 100,
						productAttributes: []
					},
					modifiers: [
						{
							id: 'modifier-1',
							productModifierGroupId: 'product-group-1',
							productModifierOptionId: 'product-option-1',
							catalogModifierGroupId: 'catalog-group-1',
							catalogModifierOptionId: 'catalog-option-1',
							groupCode: 'toppings',
							groupName: 'Toppings',
							optionCode: 'cheese',
							optionName: 'Cheese',
							quantity: 2,
							unitPriceSnapshot: 15
						}
					]
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

		sellableReader.resolveProductSellable.mockResolvedValueOnce({
			mode: 'SIMPLE',
			variantId: null,
			priceState: 'KNOWN',
			displayPrice: '100.00',
			requiresVariantSelection: false,
			availabilityState: 'AVAILABLE',
			stock: null
		})
		prisma.cart.findFirst
			.mockResolvedValueOnce(cartWithItems)
			.mockResolvedValueOnce(cartWithItems)
			.mockResolvedValueOnce(convertedCart)
		prisma.catalog.findFirst.mockResolvedValue({
			id: 'catalog-1',
			userId: 'manager-1'
		})
		prisma.order.create.mockResolvedValue(
			createCompletedOrderEntity({ totalAmount: 260 })
		)

		await service.completeManagerOrder('public-1', {
			id: 'manager-1',
			role: Role.CATALOG
		})

		const checkoutCartCall = prisma.cart.findFirst.mock.calls.find(
			([args]) => args?.select?.comment && !args.select.token
		)
		expect(checkoutCartCall?.[0].select.items.select.modifiers).toBeDefined()
		const createArgs = prisma.order.create.mock.calls[0][0]
		expect(createArgs.data.products[0]).toEqual(
			expect.objectContaining({
				modifiers: [
					expect.objectContaining({
						id: 'modifier-1',
						optionName: 'Cheese',
						quantity: 2,
						unitPrice: 15
					})
				],
				unitPrice: 130,
				lineTotal: 260
			})
		)
		expect(createArgs.data.totalAmount).toBe(260)
	})

	it('applies manager checkout data before converting a preorder cart', async () => {
		const visitDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
			.toISOString()
			.slice(0, 10)
		const preorderCheckoutData = {
			customerName: 'Ivan',
			hallTableId: 'table-11',
			hallTableName: 'Стол 11',
			hallTableNumber: '11',
			iikoTableId: 'table-11',
			phone: '+7 (988) 111-22-33',
			personsCount: 2,
			tableNumber: '11',
			visitDate,
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
				scheduledAt: `${visitDate}T19:30:00.000`
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
					visitDate,
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
			{ quantity: 1, enforceStock: false, buyerCatalogId: 'catalog-1' }
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

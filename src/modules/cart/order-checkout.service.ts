import {
	CartCheckoutMethod,
	CartStatus,
	OrderStatus,
	Prisma
} from '@generated/client'
import type { CatalogInventoryMode } from '@generated/enums'
import {
	BadRequestException,
	Inject,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
	CAPABILITY_READER_PORT,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'

import { CartInventoryReservationService } from './cart-inventory-reservation.service'
import { CartOrderExportService } from './cart-order-export.service'
import {
	CartOrderSnapshotService,
	completedOrderSelect
} from './cart-order-snapshot.service'
import { CartVariantSelectionService } from './cart-variant-selection.service'
import { resolveCartItemBaseQuantity } from './cart.utils'

const CURRENT_CART_VISIBLE_STATUSES = [
	CartStatus.DRAFT,
	CartStatus.SHARED,
	CartStatus.IN_PROGRESS,
	CartStatus.PAUSED
] as const

const TERMINAL_CART_STATUSES = new Set<CartStatus>([
	CartStatus.CONVERTED,
	CartStatus.CANCELLED,
	CartStatus.EXPIRED
])

const INVENTORY_MODE_NONE: CatalogInventoryMode = 'NONE'
const INVENTORY_MODE_INTERNAL: CatalogInventoryMode = 'INTERNAL'

const checkoutCartSelect = {
	id: true,
	catalogId: true,
	status: true,
	comment: true,
	checkoutMethod: true,
	checkoutData: true,
	checkoutContacts: true,
	catalog: {
		select: {
			settings: { select: { inventoryMode: true } }
		}
	},
	items: {
		where: { deleteAt: null },
		select: {
			id: true,
			productId: true,
			variantId: true,
			saleUnitId: true,
			quantity: true,
			baseQuantity: true,
			unitPriceSnapshot: true,
			product: {
				select: {
					id: true,
					name: true,
					slug: true,
					price: true,
					productAttributes: {
						where: { deleteAt: null },
						select: {
							valueDecimal: true,
							valueInteger: true,
							valueString: true,
							valueDateTime: true,
							attribute: { select: { key: true } }
						}
					}
				}
			},
			variant: {
				select: {
					id: true,
					sku: true,
					variantKey: true,
					price: true,
					stock: true,
					status: true,
					isAvailable: true,
					attributes: {
						where: { deleteAt: null },
						select: {
							attribute: {
								select: {
									id: true,
									key: true,
									displayName: true,
									displayOrder: true
								}
							},
							enumValue: {
								select: {
									id: true,
									value: true,
									displayName: true,
									displayOrder: true
								}
							}
						}
					}
				}
			},
			saleUnit: {
				select: {
					id: true,
					variantId: true,
					catalogSaleUnitId: true,
					code: true,
					name: true,
					baseQuantity: true,
					price: true,
					barcode: true,
					isDefault: true,
					isActive: true,
					displayOrder: true
				}
			}
		},
		orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
	}
} satisfies Prisma.CartSelect

type CheckoutCartEntity = Prisma.CartGetPayload<{
	select: typeof checkoutCartSelect
}>

export type OrderCheckoutResult = {
	cartId: string
	order: ReturnType<CartOrderSnapshotService['mapCompletedOrder']>
}

@Injectable()
export class OrderCheckoutService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly inventoryReservation: CartInventoryReservationService,
		private readonly orderExport: CartOrderExportService,
		private readonly orderSnapshot: CartOrderSnapshotService,
		private readonly variantSelection: CartVariantSelectionService,
		@Inject(CAPABILITY_READER_PORT)
		private readonly capabilities: CapabilityReaderPort
	) {}

	async complete(
		cartId: string,
		actorUserId: string
	): Promise<OrderCheckoutResult> {
		const now = new Date()
		const result = await this.prisma.$transaction(async tx => {
			const cart = await this.findCheckoutCartOrThrow(cartId, tx)
			this.ensureCartIsOpen(cart.status)

			if (!cart.items.length) {
				throw new BadRequestException('Нельзя оформить пустую корзину')
			}

			const claim = await tx.cart.updateMany({
				where: {
					id: cart.id,
					status: { in: [...CURRENT_CART_VISIBLE_STATUSES] },
					deleteAt: null
				},
				data: {
					status: CartStatus.CONVERTED,
					statusChangedAt: now,
					assignedManagerId: actorUserId,
					managerLastSeenAt: now,
					closedAt: now,
					publicKey: null,
					checkoutKey: null
				}
			})
			if (claim.count !== 1) {
				throw new BadRequestException('Корзина уже завершена')
			}

			const inventoryMode = this.resolveInventoryMode(cart)
			const features = await this.capabilities.getCurrentFeatures(cart.catalogId)
			if (features.canUseProductVariants) {
				await this.ensureCheckoutVariantsPurchasable(tx, cart, inventoryMode)
			}

			const snapshotItems = await this.orderSnapshot.buildSnapshotItems(
				tx,
				cart.catalogId,
				cart.items,
				{
					canUseProductVariants: features.canUseProductVariants,
					canUseCatalogSaleUnits: features.canUseCatalogSaleUnits
				}
			)
			if (
				inventoryMode === INVENTORY_MODE_INTERNAL &&
				snapshotItems.some(item => !item.variantId)
			) {
				throw new BadRequestException(
					'Internal inventory order items must have variantId'
				)
			}

			const order = await tx.order.create({
				data: {
					status: OrderStatus.COMPLETED,
					catalogId: cart.catalogId,
					comment: cart.comment,
					isDelivery: cart.checkoutMethod === CartCheckoutMethod.DELIVERY,
					address: this.orderSnapshot.resolveDeliveryAddress(cart),
					checkoutMethod: cart.checkoutMethod,
					checkoutData: (cart.checkoutData ?? undefined) as
						| Prisma.InputJsonValue
						| undefined,
					checkoutContacts: (cart.checkoutContacts ?? undefined) as
						| Prisma.InputJsonValue
						| undefined,
					paymentProof: [],
					products: snapshotItems,
					totalAmount: this.resolveTotalAmount(snapshotItems)
				},
				select: completedOrderSelect
			})

			let inventoryCacheCatalogIds: string[] = []
			if (inventoryMode === INVENTORY_MODE_INTERNAL) {
				inventoryCacheCatalogIds =
					await this.inventoryReservation.consumeCompletedOrderStockTx(tx, {
						catalogId: cart.catalogId,
						cartId: cart.id,
						orderId: order.id,
						lines: snapshotItems.map(item => ({
							cartItemId: item.id,
							productId: item.productId,
							variantId: item.variantId,
							quantity: item.baseQuantity
						})),
						actorUserId
					})
			}

			return {
				cartId: cart.id,
				order,
				inventoryCacheCatalogIds
			}
		})

		await this.inventoryReservation.invalidateProductCaches(
			result.inventoryCacheCatalogIds
		)
		await this.orderExport.enqueueCompletedOrderSafely(
			result.order.catalogId,
			result.order.id
		)

		return {
			cartId: result.cartId,
			order: this.orderSnapshot.mapCompletedOrder(result.order)
		}
	}

	private async findCheckoutCartOrThrow(
		cartId: string,
		tx: Prisma.TransactionClient
	): Promise<CheckoutCartEntity> {
		const cart = await tx.cart.findFirst({
			where: { id: cartId, deleteAt: null },
			select: checkoutCartSelect
		})

		if (!cart) throw new NotFoundException('Корзина не найдена')

		return cart
	}

	private async ensureCheckoutVariantsPurchasable(
		tx: Prisma.TransactionClient,
		cart: CheckoutCartEntity,
		inventoryMode: CatalogInventoryMode
	): Promise<void> {
		const purchasableInventoryMode =
			inventoryMode === INVENTORY_MODE_INTERNAL
				? INVENTORY_MODE_NONE
				: inventoryMode

		for (const item of cart.items) {
			if (!item.variantId) continue

			await this.variantSelection.ensureVariantPurchasable(
				tx,
				item.variantId,
				resolveCartItemBaseQuantity(item),
				item.productId,
				purchasableInventoryMode
			)
		}
	}

	private resolveInventoryMode(cart: CheckoutCartEntity): CatalogInventoryMode {
		return cart.catalog.settings?.inventoryMode ?? INVENTORY_MODE_NONE
	}

	private resolveTotalAmount(
		items: Array<{ lineTotal: number | Prisma.Decimal }>
	): number {
		const totalAmountCents = items.reduce(
			(sum, item) => sum + Math.round(Number(item.lineTotal) * 100),
			0
		)
		return totalAmountCents / 100
	}

	private ensureCartIsOpen(status: CartStatus) {
		if (TERMINAL_CART_STATUSES.has(status)) {
			throw new BadRequestException('Корзина уже закрыта')
		}
	}
}

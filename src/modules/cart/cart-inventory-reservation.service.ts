import { CartStatus, type Prisma } from '@generated/client'
import type { CatalogInventoryMode } from '@generated/enums'
import { Inject, Injectable } from '@nestjs/common'

import {
	INVENTORY_RESERVATION_PORT,
	type InventoryReservationPort
} from '@/modules/inventory/contracts'

import { resolveCartItemBaseQuantity } from './cart.utils'

const INVENTORY_MODE_NONE: CatalogInventoryMode = 'NONE'
const INVENTORY_MODE_INTERNAL: CatalogInventoryMode = 'INTERNAL'

export type InventoryReservationEffect = {
	reserved: boolean
	inventoryCacheCatalogIds: string[]
}

type CartInventoryReservationCart = {
	id: string
	catalogId: string
	status: CartStatus
	catalog: {
		settings?: { inventoryMode?: CatalogInventoryMode | null } | null
	}
	items: Array<{
		id: string
		productId: string
		variantId: string | null
		quantity: number
		baseQuantity?: number | null
		saleUnit?: { baseQuantity: unknown } | null
	}>
}

@Injectable()
export class CartInventoryReservationService {
	constructor(
		@Inject(INVENTORY_RESERVATION_PORT)
		private readonly inventory: InventoryReservationPort
	) {}

	async reserveCartStockIfNeededTx(
		tx: Prisma.TransactionClient,
		cart: CartInventoryReservationCart,
		actorUserId: string | null
	): Promise<InventoryReservationEffect> {
		const inventoryMode =
			cart.catalog.settings?.inventoryMode ?? INVENTORY_MODE_NONE
		if (!this.shouldReserveCartStock(cart.status, inventoryMode)) {
			return { reserved: false, inventoryCacheCatalogIds: [] }
		}

		const inventoryCacheCatalogIds = await this.inventory.reserveCartStockTx(tx, {
			catalogId: cart.catalogId,
			cartId: cart.id,
			lines: cart.items.map(item => ({
				cartItemId: item.id,
				productId: item.productId,
				variantId: item.variantId,
				quantity: resolveCartItemBaseQuantity(item)
			})),
			actorUserId
		})

		return { reserved: true, inventoryCacheCatalogIds }
	}

	consumeCompletedOrderStockTx(
		tx: Prisma.TransactionClient,
		params: Parameters<
			InventoryReservationPort['consumeCompletedOrderStockTx']
		>[1]
	): Promise<string[]> {
		return this.inventory.consumeCompletedOrderStockTx(tx, params)
	}

	releaseCartReservationsTx(
		tx: Prisma.TransactionClient,
		params: Parameters<InventoryReservationPort['releaseCartReservationsTx']>[1]
	) {
		return this.inventory.releaseCartReservationsTx(tx, params)
	}

	invalidateProductCaches(
		catalogIds: string[] | undefined | Iterable<string | null | undefined>
	): Promise<void> {
		return this.inventory.invalidateProductCachesForCatalogs(catalogIds ?? [])
	}

	shouldReserveCartStock(
		status: CartStatus,
		inventoryMode: CatalogInventoryMode
	): boolean {
		return (
			inventoryMode === INVENTORY_MODE_INTERNAL &&
			(status === CartStatus.SHARED ||
				status === CartStatus.IN_PROGRESS ||
				status === CartStatus.PAUSED)
		)
	}
}

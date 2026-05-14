import type { Prisma } from '@generated/client'

import type {
	ExpireInventoryReservationsResult,
	InventoryCartReservationLine,
	InventoryCompletedOrderLine
} from './inventory.repository'

export const INVENTORY_RESERVATION_PORT = Symbol('INVENTORY_RESERVATION_PORT')
export const INVENTORY_STOCK_READER_PORT = Symbol('INVENTORY_STOCK_READER_PORT')
export const INVENTORY_MOVEMENT_PORT = Symbol('INVENTORY_MOVEMENT_PORT')
export const INVENTORY_MODE_PORT = Symbol('INVENTORY_MODE_PORT')

export interface InventoryReservationPort {
	consumeCompletedOrderStockTx(
		tx: Prisma.TransactionClient,
		params: {
			catalogId: string
			cartId: string
			orderId: string
			lines: InventoryCompletedOrderLine[]
			actorUserId: string | null
		}
	): Promise<string[]>

	reserveCartStockTx(
		tx: Prisma.TransactionClient,
		params: {
			catalogId: string
			cartId: string
			lines: InventoryCartReservationLine[]
			actorUserId: string | null
		}
	): Promise<string[]>

	releaseCartReservationsTx(
		tx: Prisma.TransactionClient,
		params: {
			catalogId?: string
			cartId: string
			reason: string
			actorUserId: string | null
			now?: Date
		}
	): Promise<ExpireInventoryReservationsResult>

	invalidateProductCachesForCatalogs(
		catalogIds: Iterable<string | null | undefined>
	): Promise<void>
}

export interface InventoryStockReaderPort {
	getAvailableStock?(
		productId: string,
		variantId?: string | null
	): Promise<number>
}

export interface InventoryMovementPort {
	recordMovement?(input: unknown): Promise<void>
}

export interface InventoryModePort {
	getInventoryMode?(catalogId: string): Promise<string>
}

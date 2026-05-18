import type { Prisma } from '@generated/client'

import type { DomainEvent } from '@/shared/domain-events/domain-events.contract'

import type {
	ExpireInventoryReservationsResult,
	InventoryCartReservationLine,
	InventoryCompletedOrderLine
} from './inventory.repository'

export const INVENTORY_RESERVATION_PORT = Symbol('INVENTORY_RESERVATION_PORT')
export const INVENTORY_STOCK_READER_PORT = Symbol('INVENTORY_STOCK_READER_PORT')
export const INVENTORY_MOVEMENT_PORT = Symbol('INVENTORY_MOVEMENT_PORT')
export const INVENTORY_MODE_PORT = Symbol('INVENTORY_MODE_PORT')
export const INVENTORY_EXTERNAL_STOCK_PORT = Symbol(
	'INVENTORY_EXTERNAL_STOCK_PORT'
)

export type InventoryTransactionEffects = {
	affectedCatalogIds: string[]
	domainEvents: DomainEvent[]
}

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
	): Promise<InventoryTransactionEffects>

	reserveCartStockTx(
		tx: Prisma.TransactionClient,
		params: {
			catalogId: string
			cartId: string
			lines: InventoryCartReservationLine[]
			actorUserId: string | null
		}
	): Promise<InventoryTransactionEffects>

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

	releaseExpiredReservations(
		now?: Date
	): Promise<ExpireInventoryReservationsResult>

	invalidateProductCachesForCatalogs(
		catalogIds: Iterable<string | null | undefined>,
		domainEvents?: DomainEvent[]
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

export type InventoryExternalStockApplySource = 'FULL_SYNC' | 'WEBHOOK'

export type InventoryExternalStockProgressReporter = {
	report(input: {
		phase: 'SYNCING_STOCK'
		message: string
		processed?: number
		total?: number | null
		force?: boolean
	}): Promise<void>
}

export type InventoryExternalStockApplyParams = {
	catalogId: string
	integrationId: string
	stockMap: Map<string, number>
	source: InventoryExternalStockApplySource
	canSyncVariants: boolean
	progress: InventoryExternalStockProgressReporter
}

export type InventoryExternalStockSkippedReasons = {
	missingStock: number
	productHasVariantLinks: number
	variantsCapabilityDisabled: number
	stockRowWithoutLocalLink: number
	capabilityDisabled: number
	internalInventory: number
	missingMapping: number
	snapshotIncomplete: number
	priceUnknown: number
	stockNotTracked: number
}

export type InventoryExternalStockDiagnostics = {
	source: InventoryExternalStockApplySource
	stockRows: number
	matchedStockRows: number
	unmatchedStockRows: number
	productLinks: number
	variantLinks: number
	ignoredVariantLinks: number
	appliedProductLinks: number
	appliedVariantLinks: number
	skippedReasons: InventoryExternalStockSkippedReasons
}

export type InventoryExternalStockApplyResult = {
	total: number
	updated: number
	updatedProducts: number
	updatedVariants: number
	skipped: number
	diagnostics: InventoryExternalStockDiagnostics
}

export interface InventoryExternalStockPort {
	applyExternalStockMap(
		params: InventoryExternalStockApplyParams
	): Promise<InventoryExternalStockApplyResult>
}

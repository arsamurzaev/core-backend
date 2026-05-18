import type { Prisma } from '@generated/client'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import type { DomainEvent } from '@/shared/domain-events/domain-events.contract'

import {
	INVENTORY_MOVEMENT_SOURCE,
	INVENTORY_MOVEMENT_TYPE,
	INVENTORY_RESERVATION_STATUS,
	INVENTORY_WAREHOUSE_STATUS,
	type InventoryWarehouseStatusValue
} from './inventory.constants'

const inventoryWarehouseSelect = {
	id: true,
	name: true,
	code: true,
	status: true,
	address: true,
	deleteAt: true,
	createdAt: true,
	updatedAt: true
} satisfies Prisma.InventoryWarehouseSelect

const inventoryWarehouseCatalogSelect = {
	isDefault: true,
	warehouse: {
		select: inventoryWarehouseSelect
	}
} satisfies Prisma.InventoryWarehouseCatalogSelect

const inventoryStockBalanceSelect = {
	id: true,
	warehouseId: true,
	variantId: true,
	quantityOnHand: true,
	quantityReserved: true,
	quantityAvailable: true,
	createdAt: true,
	updatedAt: true,
	variant: {
		select: {
			id: true,
			sku: true,
			variantKey: true,
			product: {
				select: {
					id: true,
					name: true,
					sku: true,
					slug: true
				}
			}
		}
	}
} satisfies Prisma.InventoryStockBalanceSelect

const inventoryMovementSelect = {
	id: true,
	warehouseId: true,
	variantId: true,
	type: true,
	source: true,
	quantityDelta: true,
	quantityAfter: true,
	reason: true,
	occurredAt: true,
	createdAt: true
} satisfies Prisma.InventoryMovementSelect

const inventoryReservationSelect = {
	id: true,
	warehouseId: true,
	variantId: true,
	quantity: true,
	status: true,
	cartId: true,
	cartItemId: true,
	orderId: true,
	expiresAt: true,
	consumedAt: true,
	releasedAt: true,
	createdAt: true,
	updatedAt: true,
	variant: inventoryStockBalanceSelect.variant
} satisfies Prisma.InventoryReservationSelect

type InventoryWarehouseCatalogRecord =
	Prisma.InventoryWarehouseCatalogGetPayload<{
		select: typeof inventoryWarehouseCatalogSelect
	}>

export type InventoryWarehouseRecord = Prisma.InventoryWarehouseGetPayload<{
	select: typeof inventoryWarehouseSelect
}> & {
	isDefault: boolean
}

export type InventoryStockBalanceRecord =
	Prisma.InventoryStockBalanceGetPayload<{
		select: typeof inventoryStockBalanceSelect
	}>

export type InventoryMovementRecord = Prisma.InventoryMovementGetPayload<{
	select: typeof inventoryMovementSelect
}>

export type InventoryReservationRecord = Prisma.InventoryReservationGetPayload<{
	select: typeof inventoryReservationSelect
}>

export type InventoryWarehouseWriteData = {
	name?: string
	code?: string
	status?: InventoryWarehouseStatusValue
	address?: string | null
}

export type InventoryVariantStockChange = {
	catalogId?: string | null
	variantId: string
	productId: string | null
	previousStock: number | null
	nextStock: number
	changed: boolean
}

export type InventoryStockAdjustmentResult =
	| {
			ok: true
			balance: InventoryStockBalanceRecord
			movement: InventoryMovementRecord
			variantStock: number
			stockChange: InventoryVariantStockChange
	  }
	| {
			ok: false
			reason:
				| 'WAREHOUSE_NOT_FOUND'
				| 'WAREHOUSE_DISABLED'
				| 'VARIANT_NOT_FOUND'
				| 'INSUFFICIENT_STOCK'
	  }

export type InventoryCompletedOrderLine = {
	cartItemId: string
	productId: string
	variantId: string | null
	quantity: number
}

export type InventoryCartReservationLine = InventoryCompletedOrderLine

export type InventoryCompletedOrderStockResult =
	| {
			ok: true
			warehouseId: string | null
			consumedLines: number
			affectedVariantIds: string[]
			stockChanges: InventoryVariantStockChange[]
	  }
	| {
			ok: false
			reason:
				| 'WAREHOUSE_NOT_FOUND'
				| 'WAREHOUSE_AMBIGUOUS'
				| 'VARIANT_NOT_FOUND'
				| 'INSUFFICIENT_STOCK'
			variantId?: string | null
	  }

export type InventoryCartReservationsResult =
	| {
			ok: true
			warehouseId: string | null
			reservedLines: number
			releasedReservations: number
			affectedVariantIds: string[]
			stockChanges: InventoryVariantStockChange[]
	  }
	| {
			ok: false
			reason:
				| 'WAREHOUSE_NOT_FOUND'
				| 'WAREHOUSE_AMBIGUOUS'
				| 'VARIANT_NOT_FOUND'
				| 'MISSING_VARIANT'
				| 'INSUFFICIENT_STOCK'
			variantId?: string | null
	  }

export type ExpireInventoryReservationsResult = {
	releasedReservations: number
	affectedVariants: number
	affectedVariantIds: string[]
	affectedCatalogIds: string[]
	stockChanges: InventoryVariantStockChange[]
	domainEvents?: DomainEvent[]
}

type InventoryReservationForRelease = {
	id: string
	warehouseId: string
	variantId: string
	quantity: number
	cartId: string | null
	cartItemId: string | null
	orderId: string | null
	idempotencyKey: string | null
}

type InventoryReservationWithCatalog = InventoryReservationForRelease & {
	variant: {
		product: {
			catalogId: string
		}
	}
}

type InventoryReservationForLine = InventoryReservationForRelease & {
	status: string
}

type InventoryReservationForConsumption = {
	id: string
	warehouseId: string
	quantity: number
}

type InventoryReservationStatusValue =
	(typeof INVENTORY_RESERVATION_STATUS)[keyof typeof INVENTORY_RESERVATION_STATUS]
type InventoryMovementSourceValue =
	(typeof INVENTORY_MOVEMENT_SOURCE)[keyof typeof INVENTORY_MOVEMENT_SOURCE]

@Injectable()
export class InventoryRepository {
	constructor(private readonly prisma: PrismaService) {}

	findCatalogInventorySettings(catalogId: string) {
		return this.prisma.catalogSettings.findUnique({
			where: { catalogId },
			select: { inventoryMode: true }
		})
	}

	async findWarehouses(catalogId: string): Promise<InventoryWarehouseRecord[]> {
		const rows = await this.prisma.inventoryWarehouseCatalog.findMany({
			where: {
				catalogId,
				warehouse: { deleteAt: null }
			},
			select: inventoryWarehouseCatalogSelect
		})

		return rows.map(row => this.mapWarehouseCatalog(row)).sort(sortWarehouses)
	}

	async findWarehouseById(
		catalogId: string,
		id: string
	): Promise<InventoryWarehouseRecord | null> {
		const row = await this.prisma.inventoryWarehouseCatalog.findUnique({
			where: {
				warehouseId_catalogId: {
					warehouseId: id,
					catalogId
				}
			},
			select: inventoryWarehouseCatalogSelect
		})

		if (!row || row.warehouse.deleteAt) return null

		return this.mapWarehouseCatalog(row)
	}

	async createWarehouse(
		catalogId: string,
		ownerUserId: string | null,
		data: Required<Pick<InventoryWarehouseWriteData, 'name' | 'code'>> &
			InventoryWarehouseWriteData,
		isDefault: boolean
	): Promise<InventoryWarehouseRecord> {
		return this.prisma.$transaction(async tx => {
			if (isDefault) {
				await tx.inventoryWarehouseCatalog.updateMany({
					where: { catalogId },
					data: { isDefault: false }
				})
			}

			const warehouse = await tx.inventoryWarehouse.create({
				data: {
					name: data.name,
					code: data.code,
					status: data.status ?? INVENTORY_WAREHOUSE_STATUS.ACTIVE,
					address: data.address ?? null,
					...(ownerUserId ? { ownerUser: { connect: { id: ownerUserId } } } : {}),
					catalogs: {
						create: {
							isDefault,
							catalog: { connect: { id: catalogId } }
						}
					}
				},
				select: inventoryWarehouseSelect
			})

			return { ...warehouse, isDefault }
		})
	}

	async updateWarehouse(
		catalogId: string,
		id: string,
		data: InventoryWarehouseWriteData,
		isDefault?: boolean
	): Promise<InventoryWarehouseRecord | null> {
		return this.prisma.$transaction(async tx => {
			const row = await tx.inventoryWarehouseCatalog.findUnique({
				where: {
					warehouseId_catalogId: {
						warehouseId: id,
						catalogId
					}
				},
				select: {
					isDefault: true,
					warehouse: {
						select: { id: true, deleteAt: true }
					}
				}
			})

			if (!row || row.warehouse.deleteAt) return null

			if (isDefault) {
				await tx.inventoryWarehouseCatalog.updateMany({
					where: { catalogId },
					data: { isDefault: false }
				})
			}

			await tx.inventoryWarehouse.update({
				where: { id },
				data
			})

			const nextIsDefault =
				data.status === INVENTORY_WAREHOUSE_STATUS.DISABLED ? false : isDefault
			if (nextIsDefault !== undefined) {
				await tx.inventoryWarehouseCatalog.update({
					where: {
						warehouseId_catalogId: {
							warehouseId: id,
							catalogId
						}
					},
					data: { isDefault: nextIsDefault }
				})
			}

			return this.findWarehouseByIdInTransaction(tx, catalogId, id)
		})
	}

	async softDeleteWarehouse(
		catalogId: string,
		id: string
	): Promise<InventoryWarehouseRecord | null> {
		return this.prisma.$transaction(async tx => {
			const row = await tx.inventoryWarehouseCatalog.findUnique({
				where: {
					warehouseId_catalogId: {
						warehouseId: id,
						catalogId
					}
				},
				select: {
					warehouse: {
						select: { id: true, deleteAt: true }
					}
				}
			})

			if (!row || row.warehouse.deleteAt) return null

			await tx.inventoryWarehouseCatalog.update({
				where: {
					warehouseId_catalogId: {
						warehouseId: id,
						catalogId
					}
				},
				data: { isDefault: false }
			})
			const warehouse = await tx.inventoryWarehouse.update({
				where: { id },
				data: {
					deleteAt: new Date(),
					status: INVENTORY_WAREHOUSE_STATUS.DISABLED
				},
				select: inventoryWarehouseSelect
			})

			return { ...warehouse, isDefault: false }
		})
	}

	async resyncWarehouseVariantStocks(
		catalogId: string,
		warehouseId: string
	): Promise<string[]> {
		return this.prisma.$transaction(async tx => {
			const row = await tx.inventoryWarehouseCatalog.findUnique({
				where: {
					warehouseId_catalogId: {
						warehouseId,
						catalogId
					}
				},
				select: { warehouseId: true }
			})
			if (!row) return []

			const balances = await tx.inventoryStockBalance.findMany({
				where: {
					warehouseId,
					variant: {
						product: {
							catalogId
						}
					}
				},
				distinct: ['variantId'],
				select: { variantId: true }
			})
			const variantIds = balances.map(balance => balance.variantId)
			for (const variantId of variantIds) {
				await this.syncVariantStockReadModel(tx, variantId)
			}
			return variantIds
		})
	}

	async existsWarehouseCode(
		catalogId: string,
		code: string,
		excludeWarehouseId?: string
	): Promise<boolean> {
		const row = await this.prisma.inventoryWarehouseCatalog.findFirst({
			where: {
				catalogId,
				warehouse: {
					code,
					deleteAt: null,
					...(excludeWarehouseId ? { id: { not: excludeWarehouseId } } : {})
				}
			},
			select: { warehouseId: true }
		})

		return Boolean(row)
	}

	async findWarehouseBalances(
		catalogId: string,
		warehouseId: string
	): Promise<InventoryStockBalanceRecord[] | null> {
		const warehouse = await this.findWarehouseAccess(catalogId, warehouseId)
		if (!warehouse) return null

		return this.prisma.inventoryStockBalance.findMany({
			where: {
				warehouseId,
				variant: {
					deleteAt: null,
					product: {
						catalogId,
						deleteAt: null
					}
				}
			},
			select: inventoryStockBalanceSelect,
			orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }]
		})
	}

	async findWarehouseMovements(
		catalogId: string,
		warehouseId: string,
		limit: number
	): Promise<InventoryMovementRecord[] | null> {
		const warehouse = await this.findWarehouseAccess(catalogId, warehouseId)
		if (!warehouse) return null

		return this.prisma.inventoryMovement.findMany({
			where: {
				warehouseId,
				warehouse: {
					deleteAt: null,
					catalogs: { some: { catalogId } }
				}
			},
			select: inventoryMovementSelect,
			orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
			take: limit
		})
	}

	async findWarehouseReservations(
		catalogId: string,
		warehouseId: string,
		limit: number
	): Promise<InventoryReservationRecord[] | null> {
		const warehouse = await this.findWarehouseAccess(catalogId, warehouseId)
		if (!warehouse) return null

		return this.prisma.inventoryReservation.findMany({
			where: {
				warehouseId,
				warehouse: {
					deleteAt: null,
					catalogs: { some: { catalogId } }
				},
				variant: {
					deleteAt: null,
					product: {
						catalogId,
						deleteAt: null
					}
				}
			},
			select: inventoryReservationSelect,
			orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
			take: limit
		})
	}

	async adjustStock(
		catalogId: string,
		warehouseId: string,
		variantId: string,
		quantityDelta: number,
		reason: string | null,
		actorUserId: string | null
	): Promise<InventoryStockAdjustmentResult> {
		return this.prisma.$transaction(async tx => {
			const warehouse = await tx.inventoryWarehouseCatalog.findUnique({
				where: {
					warehouseId_catalogId: {
						warehouseId,
						catalogId
					}
				},
				select: {
					warehouse: {
						select: {
							id: true,
							status: true,
							deleteAt: true
						}
					}
				}
			})

			if (!warehouse || warehouse.warehouse.deleteAt) {
				return { ok: false, reason: 'WAREHOUSE_NOT_FOUND' }
			}
			if (warehouse.warehouse.status !== INVENTORY_WAREHOUSE_STATUS.ACTIVE) {
				return { ok: false, reason: 'WAREHOUSE_DISABLED' }
			}

			const variant = await tx.productVariant.findFirst({
				where: {
					id: variantId,
					deleteAt: null,
					product: {
						catalogId,
						deleteAt: null
					}
				},
				select: { id: true }
			})
			if (!variant) return { ok: false, reason: 'VARIANT_NOT_FOUND' }

			const current = await tx.inventoryStockBalance.findUnique({
				where: {
					warehouseId_variantId: {
						warehouseId,
						variantId
					}
				},
				select: {
					quantityOnHand: true,
					quantityReserved: true
				}
			})
			const quantityOnHand = current?.quantityOnHand ?? 0
			const quantityReserved = current?.quantityReserved ?? 0
			const nextOnHand = quantityOnHand + quantityDelta
			if (nextOnHand < quantityReserved) {
				return { ok: false, reason: 'INSUFFICIENT_STOCK' }
			}

			const nextAvailable = nextOnHand - quantityReserved
			const balance = await tx.inventoryStockBalance.upsert({
				where: {
					warehouseId_variantId: {
						warehouseId,
						variantId
					}
				},
				create: {
					warehouseId,
					variantId,
					quantityOnHand: nextOnHand,
					quantityReserved,
					quantityAvailable: nextAvailable,
					lastMovementAt: new Date()
				},
				update: {
					quantityOnHand: nextOnHand,
					quantityAvailable: nextAvailable,
					lastMovementAt: new Date()
				},
				select: inventoryStockBalanceSelect
			})

			const movement = await tx.inventoryMovement.create({
				data: {
					warehouseId,
					variantId,
					type:
						quantityDelta > 0
							? INVENTORY_MOVEMENT_TYPE.RECEIPT
							: INVENTORY_MOVEMENT_TYPE.WRITE_OFF,
					source: INVENTORY_MOVEMENT_SOURCE.MANUAL,
					quantityDelta,
					quantityAfter: nextOnHand,
					reason,
					actorUserId: actorUserId ?? undefined
				},
				select: inventoryMovementSelect
			})

			const stockChange = await this.syncVariantStockReadModel(tx, variantId)

			return {
				ok: true,
				balance,
				movement,
				variantStock: stockChange.nextStock,
				stockChange
			}
		})
	}

	async consumeCompletedOrderStock(
		tx: Prisma.TransactionClient,
		params: {
			catalogId: string
			cartId: string
			orderId: string
			lines: InventoryCompletedOrderLine[]
			actorUserId: string | null
		}
	): Promise<InventoryCompletedOrderStockResult> {
		const lines = params.lines.filter(line => line.variantId && line.quantity > 0)
		if (!lines.length) {
			return {
				ok: true,
				warehouseId: null,
				consumedLines: 0,
				affectedVariantIds: [],
				stockChanges: []
			}
		}

		let warehouseId: string | null = null
		const affectedVariantIds = new Set<string>()
		const stockChanges: InventoryVariantStockChange[] = []
		for (const line of lines) {
			const result = await this.consumeCompletedOrderLine(tx, {
				...params,
				line: line as InventoryCompletedOrderLine & { variantId: string }
			})
			if ('reason' in result) {
				return {
					ok: false,
					reason: result.reason,
					variantId: result.variantId
				}
			}
			warehouseId ??= result.warehouseId
			affectedVariantIds.add(line.variantId)
			if (result.stockChange?.changed) {
				stockChanges.push(result.stockChange)
			}
		}

		return {
			ok: true,
			warehouseId,
			consumedLines: lines.length,
			affectedVariantIds: [...affectedVariantIds],
			stockChanges: compactStockChanges(stockChanges)
		}
	}

	async reserveCartStock(
		tx: Prisma.TransactionClient,
		params: {
			catalogId: string
			cartId: string
			lines: InventoryCartReservationLine[]
			expiresAt: Date
			actorUserId: string | null
		}
	): Promise<InventoryCartReservationsResult> {
		const lines = params.lines.filter(line => line.quantity > 0)
		if (!lines.length) {
			const released = await this.releaseCartReservations(tx, {
				catalogId: params.catalogId,
				cartId: params.cartId,
				reason: 'Cart reservation refreshed',
				actorUserId: params.actorUserId
			})
			return {
				ok: true,
				warehouseId: null,
				reservedLines: 0,
				releasedReservations: released.releasedReservations,
				affectedVariantIds: released.affectedVariantIds,
				stockChanges: released.stockChanges
			}
		}

		const warehouse = await this.findSalesWarehouse(tx, params.catalogId)
		if ('reason' in warehouse) {
			return { ok: false, reason: warehouse.reason }
		}

		let releasedReservations = 0
		const affectedVariantIds = new Set<string>()
		const stockChanges: InventoryVariantStockChange[] = []
		const desiredKeys = new Set<string>()
		for (const line of lines) {
			if (!line.variantId) {
				return { ok: false, reason: 'MISSING_VARIANT', variantId: null }
			}
			desiredKeys.add(
				this.buildCartReservationIdempotencyKey(
					params.cartId,
					line.cartItemId,
					line.variantId
				)
			)
		}

		const activeReservations = await tx.inventoryReservation.findMany({
			where: {
				cartId: params.cartId,
				status: INVENTORY_RESERVATION_STATUS.ACTIVE
			},
			select: {
				id: true,
				warehouseId: true,
				variantId: true,
				quantity: true,
				cartId: true,
				cartItemId: true,
				orderId: true,
				idempotencyKey: true
			},
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
		})

		for (const reservation of activeReservations) {
			if (
				reservation.idempotencyKey &&
				desiredKeys.has(reservation.idempotencyKey)
			) {
				continue
			}

			const released = await this.releaseActiveReservation(tx, reservation, {
				now: new Date(),
				status: INVENTORY_RESERVATION_STATUS.RELEASED,
				source: INVENTORY_MOVEMENT_SOURCE.CART,
				reason: 'Cart reservation refreshed',
				actorUserId: params.actorUserId
			})
			if (released) {
				releasedReservations++
				affectedVariantIds.add(reservation.variantId)
				if (released.changed) stockChanges.push(released)
			}
		}

		let reservedLines = 0
		for (const line of lines) {
			const result = await this.reserveCartLine(tx, {
				...params,
				warehouseId: warehouse.warehouseId,
				line: line as InventoryCartReservationLine & { variantId: string }
			})
			if ('reason' in result) {
				return {
					ok: false,
					reason: result.reason,
					variantId: result.variantId
				}
			}
			if (result.stockChanged) {
				affectedVariantIds.add(line.variantId)
			}
			stockChanges.push(...result.stockChanges)
			reservedLines++
		}

		return {
			ok: true,
			warehouseId: warehouse.warehouseId,
			reservedLines,
			releasedReservations,
			affectedVariantIds: [...affectedVariantIds],
			stockChanges: compactStockChanges(stockChanges)
		}
	}

	async releaseCartReservations(
		tx: Prisma.TransactionClient,
		params: {
			catalogId?: string
			cartId: string
			reason: string
			actorUserId: string | null
			now?: Date
		}
	): Promise<ExpireInventoryReservationsResult> {
		const now = params.now ?? new Date()
		const reservations = await tx.inventoryReservation.findMany({
			where: {
				cartId: params.cartId,
				status: INVENTORY_RESERVATION_STATUS.ACTIVE
			},
			select: {
				id: true,
				warehouseId: true,
				variantId: true,
				quantity: true,
				cartId: true,
				cartItemId: true,
				orderId: true,
				idempotencyKey: true
			},
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
		})

		const affectedVariantIds = new Set<string>()
		const stockChanges: InventoryVariantStockChange[] = []
		let releasedReservations = 0

		for (const reservation of reservations) {
			const released = await this.releaseActiveReservation(tx, reservation, {
				now,
				status: INVENTORY_RESERVATION_STATUS.RELEASED,
				source: INVENTORY_MOVEMENT_SOURCE.CART,
				reason: params.reason,
				actorUserId: params.actorUserId
			})
			if (released) {
				releasedReservations++
				affectedVariantIds.add(reservation.variantId)
				if (released.changed) stockChanges.push(released)
			}
		}

		return {
			releasedReservations,
			affectedVariants: affectedVariantIds.size,
			affectedVariantIds: [...affectedVariantIds],
			affectedCatalogIds:
				affectedVariantIds.size > 0 && params.catalogId ? [params.catalogId] : [],
			stockChanges: compactStockChanges(stockChanges).map(change => ({
				...change,
				catalogId: params.catalogId ?? change.catalogId ?? null
			}))
		}
	}

	async releaseExpiredReservations(
		now = new Date(),
		limit = 100
	): Promise<ExpireInventoryReservationsResult> {
		const reservations = (await this.prisma.inventoryReservation.findMany({
			where: {
				status: INVENTORY_RESERVATION_STATUS.ACTIVE,
				expiresAt: { lte: now }
			},
			select: {
				id: true,
				warehouseId: true,
				variantId: true,
				quantity: true,
				cartId: true,
				cartItemId: true,
				orderId: true,
				idempotencyKey: true,
				variant: {
					select: {
						product: {
							select: { catalogId: true }
						}
					}
				}
			},
			orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
			take: limit
		})) as InventoryReservationWithCatalog[]

		const affectedVariantIds = new Set<string>()
		const affectedCatalogIds = new Set<string>()
		const stockChanges: InventoryVariantStockChange[] = []
		let releasedReservations = 0

		for (const reservation of reservations) {
			const released = await this.prisma.$transaction(async tx =>
				this.releaseExpiredReservation(tx, reservation, now)
			)
			if (released) {
				releasedReservations++
				affectedVariantIds.add(reservation.variantId)
				affectedCatalogIds.add(reservation.variant.product.catalogId)
				if (released.changed) {
					stockChanges.push({
						...released,
						catalogId: reservation.variant.product.catalogId
					})
				}
			}
		}

		return {
			releasedReservations,
			affectedVariants: affectedVariantIds.size,
			affectedVariantIds: [...affectedVariantIds],
			affectedCatalogIds: [...affectedCatalogIds],
			stockChanges: compactStockChanges(stockChanges)
		}
	}

	private async findWarehouseByIdInTransaction(
		tx: Prisma.TransactionClient,
		catalogId: string,
		id: string
	): Promise<InventoryWarehouseRecord | null> {
		const row = await tx.inventoryWarehouseCatalog.findUnique({
			where: {
				warehouseId_catalogId: {
					warehouseId: id,
					catalogId
				}
			},
			select: inventoryWarehouseCatalogSelect
		})

		if (!row || row.warehouse.deleteAt) return null
		return this.mapWarehouseCatalog(row)
	}

	private async findWarehouseAccess(catalogId: string, warehouseId: string) {
		return this.prisma.inventoryWarehouseCatalog.findFirst({
			where: {
				catalogId,
				warehouseId,
				warehouse: { deleteAt: null }
			},
			select: { warehouseId: true }
		})
	}

	private async findSalesWarehouse(
		tx: Prisma.TransactionClient,
		catalogId: string
	): Promise<
		| { ok: true; warehouseId: string }
		| { ok: false; reason: 'WAREHOUSE_NOT_FOUND' | 'WAREHOUSE_AMBIGUOUS' }
	> {
		const rows = await tx.inventoryWarehouseCatalog.findMany({
			where: {
				catalogId,
				warehouse: {
					deleteAt: null,
					status: INVENTORY_WAREHOUSE_STATUS.ACTIVE
				}
			},
			select: {
				warehouseId: true,
				isDefault: true
			},
			orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
		})

		if (!rows.length) return { ok: false, reason: 'WAREHOUSE_NOT_FOUND' }

		const defaultWarehouse = rows.find(row => row.isDefault)
		if (defaultWarehouse) {
			return { ok: true, warehouseId: defaultWarehouse.warehouseId }
		}
		if (rows.length === 1) return { ok: true, warehouseId: rows[0].warehouseId }

		return { ok: false, reason: 'WAREHOUSE_AMBIGUOUS' }
	}

	private async reserveCartLine(
		tx: Prisma.TransactionClient,
		params: {
			catalogId: string
			cartId: string
			warehouseId: string
			line: InventoryCartReservationLine & { variantId: string }
			expiresAt: Date
			actorUserId: string | null
		}
	): Promise<
		| {
				ok: true
				stockChanged: boolean
				stockChanges: InventoryVariantStockChange[]
		  }
		| {
				ok: false
				reason: 'VARIANT_NOT_FOUND' | 'INSUFFICIENT_STOCK'
				variantId: string
		  }
	> {
		const now = new Date()
		let stockChanged = false
		const stockChanges: InventoryVariantStockChange[] = []
		const variant = await tx.productVariant.findFirst({
			where: {
				id: params.line.variantId,
				deleteAt: null,
				product: {
					catalogId: params.catalogId,
					deleteAt: null
				}
			},
			select: { id: true }
		})
		if (!variant) {
			return {
				ok: false,
				reason: 'VARIANT_NOT_FOUND',
				variantId: params.line.variantId
			}
		}

		const idempotencyKey = this.buildCartReservationIdempotencyKey(
			params.cartId,
			params.line.cartItemId,
			params.line.variantId
		)
		const existing = await tx.inventoryReservation.findUnique({
			where: { idempotencyKey },
			select: {
				id: true,
				warehouseId: true,
				variantId: true,
				quantity: true,
				status: true,
				cartId: true,
				cartItemId: true,
				orderId: true,
				idempotencyKey: true
			}
		})

		let activeExisting: InventoryReservationForLine | null =
			existing?.status === INVENTORY_RESERVATION_STATUS.ACTIVE ? existing : null

		if (activeExisting && activeExisting.warehouseId !== params.warehouseId) {
			const releasedChange = await this.releaseActiveReservation(
				tx,
				activeExisting,
				{
					now,
					status: INVENTORY_RESERVATION_STATUS.RELEASED,
					source: INVENTORY_MOVEMENT_SOURCE.CART,
					reason: 'Cart reservation warehouse changed',
					actorUserId: params.actorUserId
				}
			)
			if (releasedChange) {
				stockChanged = true
				if (releasedChange.changed) stockChanges.push(releasedChange)
			}
			activeExisting = null
		}

		const currentQuantity = activeExisting?.quantity ?? 0
		const desiredQuantity = params.line.quantity
		const delta = desiredQuantity - currentQuantity

		if (delta > 0) {
			const reserved = await tx.inventoryStockBalance.updateMany({
				where: {
					warehouseId: params.warehouseId,
					variantId: params.line.variantId,
					quantityAvailable: { gte: delta }
				},
				data: {
					quantityReserved: { increment: delta },
					quantityAvailable: { decrement: delta },
					lastMovementAt: now
				}
			})
			if (reserved.count !== 1) {
				return {
					ok: false,
					reason: 'INSUFFICIENT_STOCK',
					variantId: params.line.variantId
				}
			}
			stockChanged = true
		}

		if (delta < 0) {
			await this.releaseReservedQuantity(tx, {
				warehouseId: params.warehouseId,
				variantId: params.line.variantId,
				quantity: Math.abs(delta),
				now
			})
			stockChanged = true
		}

		const reservationData = {
			warehouseId: params.warehouseId,
			variantId: params.line.variantId,
			quantity: desiredQuantity,
			status: INVENTORY_RESERVATION_STATUS.ACTIVE,
			cartId: params.cartId,
			cartItemId: params.line.cartItemId,
			orderId: null,
			expiresAt: params.expiresAt,
			consumedAt: null,
			releasedAt: null
		}

		const reservation = existing
			? await tx.inventoryReservation.update({
					where: { id: existing.id },
					data: reservationData,
					select: { id: true }
				})
			: await tx.inventoryReservation.create({
					data: {
						...reservationData,
						idempotencyKey
					},
					select: { id: true }
				})

		const balance = await tx.inventoryStockBalance.findUnique({
			where: {
				warehouseId_variantId: {
					warehouseId: params.warehouseId,
					variantId: params.line.variantId
				}
			},
			select: { quantityOnHand: true }
		})

		if (delta !== 0) {
			await tx.inventoryMovement.create({
				data: {
					warehouseId: params.warehouseId,
					variantId: params.line.variantId,
					type:
						delta > 0
							? INVENTORY_MOVEMENT_TYPE.RESERVE
							: INVENTORY_MOVEMENT_TYPE.RELEASE,
					source: INVENTORY_MOVEMENT_SOURCE.CART,
					quantityDelta: 0,
					quantityAfter: balance?.quantityOnHand ?? null,
					reservationId: reservation.id,
					cartId: params.cartId,
					actorUserId: params.actorUserId ?? undefined,
					reason: delta > 0 ? 'Cart stock reserved' : 'Cart reservation reduced'
				}
			})
		}

		if (stockChanged) {
			const change = await this.syncVariantStockReadModel(
				tx,
				params.line.variantId
			)
			if (change.changed) stockChanges.push(change)
		}
		return {
			ok: true,
			stockChanged,
			stockChanges: compactStockChanges(stockChanges)
		}
	}

	private async consumeCompletedOrderLine(
		tx: Prisma.TransactionClient,
		params: {
			catalogId: string
			cartId: string
			orderId: string
			line: InventoryCompletedOrderLine & { variantId: string }
			actorUserId: string | null
		}
	): Promise<
		| {
				ok: true
				warehouseId: string | null
				stockChange: InventoryVariantStockChange | null
		  }
		| {
				ok: false
				reason:
					| 'WAREHOUSE_NOT_FOUND'
					| 'WAREHOUSE_AMBIGUOUS'
					| 'VARIANT_NOT_FOUND'
					| 'INSUFFICIENT_STOCK'
				variantId: string
		  }
	> {
		const idempotencyKey = this.buildSaleIdempotencyKey(
			params.orderId,
			params.line.cartItemId
		)
		const existingMovement = await tx.inventoryMovement.findUnique({
			where: { idempotencyKey },
			select: { id: true }
		})
		if (existingMovement) {
			return { ok: true, warehouseId: null, stockChange: null }
		}

		const variant = await tx.productVariant.findFirst({
			where: {
				id: params.line.variantId,
				deleteAt: null,
				product: {
					catalogId: params.catalogId,
					deleteAt: null
				}
			},
			select: { id: true }
		})
		if (!variant) {
			return {
				ok: false,
				reason: 'VARIANT_NOT_FOUND',
				variantId: params.line.variantId
			}
		}

		const activeReservations = await tx.inventoryReservation.findMany({
			where: {
				variantId: params.line.variantId,
				cartId: params.cartId,
				cartItemId: params.line.cartItemId,
				status: INVENTORY_RESERVATION_STATUS.ACTIVE
			},
			select: {
				id: true,
				warehouseId: true,
				quantity: true
			},
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
		})

		const reservedConsumptions: Array<{
			reservation: InventoryReservationForConsumption
			quantity: number
		}> = []
		const reservedByWarehouse = new Map<
			string,
			{ quantity: number; reservationId: string | null }
		>()
		let remainingQuantity = params.line.quantity
		for (const reservation of activeReservations) {
			if (remainingQuantity <= 0) break

			const quantity = Math.min(remainingQuantity, reservation.quantity)
			if (quantity <= 0) continue

			reservedConsumptions.push({ reservation, quantity })
			const group = reservedByWarehouse.get(reservation.warehouseId) ?? {
				quantity: 0,
				reservationId: null
			}
			group.quantity += quantity
			group.reservationId ??= reservation.id
			reservedByWarehouse.set(reservation.warehouseId, group)
			remainingQuantity -= quantity
		}

		let directWarehouseId: string | null = null
		if (remainingQuantity > 0) {
			const warehouse = await this.findSalesWarehouse(tx, params.catalogId)
			if ('reason' in warehouse) {
				return {
					ok: false,
					reason: warehouse.reason,
					variantId: params.line.variantId
				}
			}
			directWarehouseId = warehouse.warehouseId
		}

		for (const [warehouseId, group] of reservedByWarehouse) {
			const canConsume = await this.canConsumeStockBalance(tx, {
				warehouseId,
				variantId: params.line.variantId,
				totalQuantity: group.quantity,
				reservedQuantity: group.quantity,
				directQuantity: 0
			})
			if (!canConsume) {
				return {
					ok: false,
					reason: 'INSUFFICIENT_STOCK',
					variantId: params.line.variantId
				}
			}
		}

		if (remainingQuantity > 0 && directWarehouseId) {
			const canConsume = await this.canConsumeStockBalance(tx, {
				warehouseId: directWarehouseId,
				variantId: params.line.variantId,
				totalQuantity: remainingQuantity,
				reservedQuantity: 0,
				directQuantity: remainingQuantity
			})
			if (!canConsume) {
				return {
					ok: false,
					reason: 'INSUFFICIENT_STOCK',
					variantId: params.line.variantId
				}
			}
		}

		const now = new Date()
		const consumedReservationIds = new Map<string, string>()
		for (const item of reservedConsumptions) {
			const reservation = item.reservation
			if (item.quantity >= reservation.quantity) {
				await tx.inventoryReservation.update({
					where: { id: reservation.id },
					data: {
						status: INVENTORY_RESERVATION_STATUS.CONSUMED,
						orderId: params.orderId,
						consumedAt: now
					}
				})
				consumedReservationIds.set(reservation.id, reservation.id)
				continue
			}

			await tx.inventoryReservation.update({
				where: { id: reservation.id },
				data: { quantity: reservation.quantity - item.quantity }
			})
			const consumed = await tx.inventoryReservation.create({
				data: {
					warehouseId: reservation.warehouseId,
					variantId: params.line.variantId,
					quantity: item.quantity,
					status: INVENTORY_RESERVATION_STATUS.CONSUMED,
					cartId: params.cartId,
					cartItemId: params.line.cartItemId,
					orderId: params.orderId,
					expiresAt: now,
					consumedAt: now,
					idempotencyKey: `${idempotencyKey}:reserved-part:${reservation.id}`
				},
				select: { id: true }
			})
			consumedReservationIds.set(reservation.id, consumed.id)
		}

		let movementIndex = 0
		let firstWarehouseId: string | null = null
		for (const [warehouseId, group] of reservedByWarehouse) {
			const consumed = await this.consumeStockBalance(tx, {
				warehouseId,
				variantId: params.line.variantId,
				totalQuantity: group.quantity,
				reservedQuantity: group.quantity,
				directQuantity: 0,
				now
			})
			if (!consumed.ok) {
				return {
					ok: false,
					reason: 'INSUFFICIENT_STOCK',
					variantId: params.line.variantId
				}
			}

			const movementIdempotencyKey =
				movementIndex === 0
					? idempotencyKey
					: `${idempotencyKey}:reserved:${warehouseId}`
			await this.createSaleMovement(tx, {
				warehouseId,
				variantId: params.line.variantId,
				quantity: group.quantity,
				quantityAfter: consumed.quantityAfter,
				reservationId: group.reservationId
					? (consumedReservationIds.get(group.reservationId) ?? group.reservationId)
					: null,
				orderId: params.orderId,
				cartId: params.cartId,
				actorUserId: params.actorUserId,
				idempotencyKey: movementIdempotencyKey
			})
			firstWarehouseId ??= warehouseId
			movementIndex++
		}

		if (remainingQuantity > 0 && directWarehouseId) {
			const directReservation = await tx.inventoryReservation.create({
				data: {
					warehouseId: directWarehouseId,
					variantId: params.line.variantId,
					quantity: remainingQuantity,
					status: INVENTORY_RESERVATION_STATUS.CONSUMED,
					cartId: params.cartId,
					cartItemId: params.line.cartItemId,
					orderId: params.orderId,
					expiresAt: now,
					consumedAt: now,
					idempotencyKey: `${idempotencyKey}:direct:${directWarehouseId}`
				},
				select: { id: true }
			})
			const consumed = await this.consumeStockBalance(tx, {
				warehouseId: directWarehouseId,
				variantId: params.line.variantId,
				totalQuantity: remainingQuantity,
				reservedQuantity: 0,
				directQuantity: remainingQuantity,
				now
			})
			if (!consumed.ok) {
				return {
					ok: false,
					reason: 'INSUFFICIENT_STOCK',
					variantId: params.line.variantId
				}
			}

			await this.createSaleMovement(tx, {
				warehouseId: directWarehouseId,
				variantId: params.line.variantId,
				quantity: remainingQuantity,
				quantityAfter: consumed.quantityAfter,
				reservationId: directReservation.id,
				orderId: params.orderId,
				cartId: params.cartId,
				actorUserId: params.actorUserId,
				idempotencyKey:
					movementIndex === 0
						? idempotencyKey
						: `${idempotencyKey}:direct:${directWarehouseId}`
			})
			firstWarehouseId ??= directWarehouseId
		}

		const stockChange = await this.syncVariantStockReadModel(
			tx,
			params.line.variantId
		)

		return { ok: true, warehouseId: firstWarehouseId, stockChange }
	}

	private async canConsumeStockBalance(
		tx: Prisma.TransactionClient,
		params: {
			warehouseId: string
			variantId: string
			totalQuantity: number
			reservedQuantity: number
			directQuantity: number
		}
	): Promise<boolean> {
		const balance = await tx.inventoryStockBalance.findUnique({
			where: {
				warehouseId_variantId: {
					warehouseId: params.warehouseId,
					variantId: params.variantId
				}
			},
			select: {
				quantityOnHand: true,
				quantityReserved: true,
				quantityAvailable: true
			}
		})

		return Boolean(
			balance &&
			balance.quantityOnHand >= params.totalQuantity &&
			balance.quantityReserved >= params.reservedQuantity &&
			balance.quantityAvailable >= params.directQuantity
		)
	}

	private async consumeStockBalance(
		tx: Prisma.TransactionClient,
		params: {
			warehouseId: string
			variantId: string
			totalQuantity: number
			reservedQuantity: number
			directQuantity: number
			now: Date
		}
	): Promise<{ ok: true; quantityAfter: number } | { ok: false }> {
		const balance = await tx.inventoryStockBalance.findUnique({
			where: {
				warehouseId_variantId: {
					warehouseId: params.warehouseId,
					variantId: params.variantId
				}
			},
			select: { quantityOnHand: true }
		})
		if (!balance) return { ok: false }

		const updated = await tx.inventoryStockBalance.updateMany({
			where: {
				warehouseId: params.warehouseId,
				variantId: params.variantId,
				quantityOnHand: { gte: params.totalQuantity },
				quantityReserved: { gte: params.reservedQuantity },
				quantityAvailable: { gte: params.directQuantity }
			},
			data: {
				quantityOnHand: { decrement: params.totalQuantity },
				quantityReserved: { decrement: params.reservedQuantity },
				quantityAvailable: { decrement: params.directQuantity },
				lastMovementAt: params.now
			}
		})
		if (updated.count !== 1) return { ok: false }

		return {
			ok: true,
			quantityAfter: balance.quantityOnHand - params.totalQuantity
		}
	}

	private async createSaleMovement(
		tx: Prisma.TransactionClient,
		params: {
			warehouseId: string
			variantId: string
			quantity: number
			quantityAfter: number
			reservationId: string | null
			orderId: string
			cartId: string
			actorUserId: string | null
			idempotencyKey: string
		}
	): Promise<void> {
		await tx.inventoryMovement.create({
			data: {
				warehouseId: params.warehouseId,
				variantId: params.variantId,
				type: INVENTORY_MOVEMENT_TYPE.SALE,
				source: INVENTORY_MOVEMENT_SOURCE.ORDER,
				quantityDelta: -params.quantity,
				quantityAfter: params.quantityAfter,
				reservationId: params.reservationId,
				orderId: params.orderId,
				cartId: params.cartId,
				actorUserId: params.actorUserId ?? undefined,
				reason: 'Completed cart order',
				idempotencyKey: params.idempotencyKey
			}
		})
	}

	private async releaseActiveReservation(
		tx: Prisma.TransactionClient,
		reservation: InventoryReservationForRelease,
		params: {
			now: Date
			status: InventoryReservationStatusValue
			source: InventoryMovementSourceValue
			reason: string
			actorUserId: string | null
			movementIdempotencyKey?: string
		}
	): Promise<InventoryVariantStockChange | null> {
		const claimed = await tx.inventoryReservation.updateMany({
			where: {
				id: reservation.id,
				status: INVENTORY_RESERVATION_STATUS.ACTIVE
			},
			data: {
				status: params.status,
				releasedAt: params.now
			}
		})
		if (claimed.count !== 1) return null

		const balance = await this.releaseReservedQuantity(tx, {
			warehouseId: reservation.warehouseId,
			variantId: reservation.variantId,
			quantity: reservation.quantity,
			now: params.now
		})

		if (params.movementIdempotencyKey) {
			const existingMovement = await tx.inventoryMovement.findUnique({
				where: { idempotencyKey: params.movementIdempotencyKey },
				select: { id: true }
			})
			if (existingMovement) {
				return this.syncVariantStockReadModel(tx, reservation.variantId)
			}
		}

		await tx.inventoryMovement.create({
			data: {
				warehouseId: reservation.warehouseId,
				variantId: reservation.variantId,
				type: INVENTORY_MOVEMENT_TYPE.RELEASE,
				source: params.source,
				quantityDelta: 0,
				quantityAfter: balance?.quantityOnHand ?? null,
				reservationId: reservation.id,
				cartId: reservation.cartId,
				orderId: reservation.orderId,
				actorUserId: params.actorUserId ?? undefined,
				reason: params.reason,
				idempotencyKey: params.movementIdempotencyKey
			}
		})
		return this.syncVariantStockReadModel(tx, reservation.variantId)
	}

	private async releaseReservedQuantity(
		tx: Prisma.TransactionClient,
		params: {
			warehouseId: string
			variantId: string
			quantity: number
			now: Date
		}
	): Promise<{ quantityOnHand: number } | null> {
		const balance = await tx.inventoryStockBalance.findUnique({
			where: {
				warehouseId_variantId: {
					warehouseId: params.warehouseId,
					variantId: params.variantId
				}
			},
			select: {
				quantityOnHand: true,
				quantityReserved: true
			}
		})
		if (!balance) return null

		const released = await tx.inventoryStockBalance.updateMany({
			where: {
				warehouseId: params.warehouseId,
				variantId: params.variantId,
				quantityReserved: { gte: params.quantity }
			},
			data: {
				quantityReserved: { decrement: params.quantity },
				quantityAvailable: { increment: params.quantity },
				lastMovementAt: params.now
			}
		})
		if (released.count !== 1) return null

		return { quantityOnHand: balance.quantityOnHand }
	}

	private async releaseExpiredReservation(
		tx: Prisma.TransactionClient,
		reservation: InventoryReservationForRelease,
		now: Date
	): Promise<InventoryVariantStockChange | null> {
		return this.releaseActiveReservation(tx, reservation, {
			now,
			status: INVENTORY_RESERVATION_STATUS.EXPIRED,
			source: INVENTORY_MOVEMENT_SOURCE.SYSTEM,
			reason: 'Expired reservation released',
			actorUserId: null,
			movementIdempotencyKey: `inventory:release-expired:${reservation.id}`
		})
	}

	private buildSaleIdempotencyKey(orderId: string, cartItemId: string): string {
		return `inventory:sale:${orderId}:${cartItemId}`
	}

	private buildCartReservationIdempotencyKey(
		cartId: string,
		cartItemId: string,
		variantId: string
	): string {
		return `inventory:cart-reservation:${cartId}:${cartItemId}:${variantId}`
	}

	private async syncVariantStockReadModel(
		tx: Prisma.TransactionClient,
		variantId: string
	): Promise<InventoryVariantStockChange> {
		const variant = await tx.productVariant.findFirst({
			where: { id: variantId },
			select: { productId: true, stock: true }
		})
		const aggregate = await tx.inventoryStockBalance.aggregate({
			where: {
				variantId,
				warehouse: {
					deleteAt: null,
					status: INVENTORY_WAREHOUSE_STATUS.ACTIVE
				}
			},
			_sum: {
				quantityAvailable: true
			}
		})
		const variantStock = Math.max(0, aggregate._sum.quantityAvailable ?? 0)
		await tx.productVariant.update({
			where: { id: variantId },
			data: { stock: variantStock }
		})

		const previousStock = variant?.stock ?? null
		return {
			variantId,
			productId: variant?.productId ?? null,
			previousStock,
			nextStock: variantStock,
			changed: previousStock !== variantStock
		}
	}

	private mapWarehouseCatalog(
		row: InventoryWarehouseCatalogRecord
	): InventoryWarehouseRecord {
		return {
			...row.warehouse,
			isDefault: row.isDefault
		}
	}
}

function sortWarehouses(
	left: InventoryWarehouseRecord,
	right: InventoryWarehouseRecord
): number {
	if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1
	return left.name.localeCompare(right.name)
}

function compactStockChanges(
	changes: InventoryVariantStockChange[]
): InventoryVariantStockChange[] {
	const byVariant = new Map<string, InventoryVariantStockChange>()
	for (const change of changes) {
		if (!change.changed) continue
		const existing = byVariant.get(change.variantId)
		if (!existing) {
			byVariant.set(change.variantId, change)
			continue
		}
		byVariant.set(change.variantId, {
			...change,
			previousStock: existing.previousStock,
			changed: existing.previousStock !== change.nextStock
		})
	}

	return [...byVariant.values()].filter(change => change.changed)
}

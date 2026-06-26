import type { Prisma } from '@generated/client'
import { Role } from '@generated/enums'
import {
	BadRequestException,
	ForbiddenException,
	Inject,
	Injectable,
	NotFoundException,
	Optional
} from '@nestjs/common'
import slugify from 'slugify'

import {
	AUDIT_RECORDER_PORT,
	type AuditRecorderPort
} from '@/modules/audit/contracts'
import {
	CAPABILITY_ASSERT_PORT,
	type CapabilityAssertPort
} from '@/modules/capability/contracts'
import { CAPABILITY_INVENTORY_INTERNAL } from '@/modules/capability/public'
import {
	OBSERVABILITY_RECORDER_PORT,
	type ObservabilityRecorderPort
} from '@/modules/observability/contracts'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { createDomainEvent } from '@/shared/domain-events/domain-event.utils'
import {
	DOMAIN_EVENT_DISPATCHER,
	DOMAIN_EVENT_OUTBOX,
	type DomainEvent,
	type DomainEventDispatcher,
	type DomainEventOutboxWriter,
	type DomainEventSource
} from '@/shared/domain-events/domain-events.contract'
import { mustCatalogId } from '@/shared/tenancy/ctx'
import { RequestContext } from '@/shared/tenancy/request-context'

import type { AuthRequest, SessionUser } from '../auth/types/auth-request'

import type {
	ExpireInventoryReservationsResult,
	InventoryCartReservationLine,
	InventoryCompletedOrderLine,
	InventoryReservationPort,
	InventoryTransactionEffects,
	InventoryVariantStockChange
} from './contracts'
import { CreateInventoryStockAdjustmentDtoReq } from './dto/requests/create-inventory-stock-adjustment.dto.req'
import { CreateInventoryWarehouseDtoReq } from './dto/requests/create-inventory-warehouse.dto.req'
import { UpdateInventoryWarehouseDtoReq } from './dto/requests/update-inventory-warehouse.dto.req'
import {
	CATALOG_INVENTORY_MODE_INTERNAL,
	INVENTORY_MOVEMENT_SOURCE,
	INVENTORY_MOVEMENT_TYPE,
	INVENTORY_WAREHOUSE_STATUS,
	type InventoryWarehouseStatusValue
} from './inventory.constants'
import {
	InventoryRepository,
	type InventoryWarehouseRecord,
	type InventoryWarehouseWriteData
} from './inventory.repository'

const WAREHOUSE_CODE_FALLBACK = 'warehouse'
const WAREHOUSE_CODE_MAX_ATTEMPTS = 50
const CART_RESERVATION_TTL_MS =
	Number(process.env.INVENTORY_CART_RESERVATION_TTL_MS ?? 30 * 60 * 1000) ||
	30 * 60 * 1000

@Injectable()
export class InventoryService implements InventoryReservationPort {
	constructor(
		private readonly repo: InventoryRepository,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly featureEntitlements: CapabilityAssertPort,
		@Inject(AUDIT_RECORDER_PORT)
		private readonly audit: AuditRecorderPort,
		@Inject(OBSERVABILITY_RECORDER_PORT)
		private readonly observability: ObservabilityRecorderPort,
		private readonly cache: CacheService,
		@Optional()
		@Inject(DOMAIN_EVENT_DISPATCHER)
		private readonly events?: DomainEventDispatcher,
		@Optional()
		@Inject(DOMAIN_EVENT_OUTBOX)
		private readonly outbox?: DomainEventOutboxWriter
	) {}

	async getWarehouses() {
		const catalogId = mustCatalogId()
		await this.assertInternalInventoryCatalog(catalogId)
		return this.repo.findWarehouses(catalogId)
	}

	async getWarehouseById(id: string) {
		const catalogId = mustCatalogId()
		await this.assertInternalInventoryCatalog(catalogId)
		return this.requireWarehouse(await this.repo.findWarehouseById(catalogId, id))
	}

	async createWarehouse(dto: CreateInventoryWarehouseDtoReq) {
		const catalogId = mustCatalogId()
		const ownerUserId = RequestContext.mustGet().ownerUserId ?? null
		await this.assertInternalInventoryCatalog(catalogId)

		const name = this.normalizeRequiredText(dto.name, 'name')
		const code = dto.code
			? await this.normalizeProvidedCode(catalogId, dto.code)
			: await this.generateAvailableCode(catalogId, name)
		const status = this.normalizeStatus(dto.status)
		const isDefault = Boolean(dto.isDefault)

		this.assertDefaultWarehouseCanBeActive(status, isDefault)

		return this.repo.createWarehouse(
			catalogId,
			ownerUserId,
			{
				name,
				code,
				status,
				address: this.normalizeOptionalText(dto.address)
			},
			isDefault
		)
	}

	async updateWarehouse(id: string, dto: UpdateInventoryWarehouseDtoReq) {
		const catalogId = mustCatalogId()
		await this.assertInternalInventoryCatalog(catalogId)

		const data: InventoryWarehouseWriteData = {}
		if (dto.name !== undefined) {
			data.name = this.normalizeRequiredText(dto.name, 'name')
		}
		if (dto.code !== undefined) {
			data.code = await this.normalizeProvidedCode(catalogId, dto.code, id)
		}
		if (dto.status !== undefined) {
			data.status = this.normalizeStatus(dto.status)
		}
		if (dto.address !== undefined) {
			data.address = this.normalizeOptionalText(dto.address)
		}

		const hasWarehouseUpdate = Object.keys(data).length > 0
		if (!hasWarehouseUpdate && dto.isDefault === undefined) {
			throw new BadRequestException('No inventory warehouse fields to update')
		}

		this.assertDefaultWarehouseCanBeActive(data.status, dto.isDefault)

		const warehouse = this.requireWarehouse(
			await this.repo.updateWarehouse(catalogId, id, data, dto.isDefault)
		)
		if (dto.status !== undefined) {
			const affectedVariantIds = await this.repo.resyncWarehouseVariantStocks(
				catalogId,
				id
			)
			if (affectedVariantIds.length) {
				await this.invalidateProductCachesForCatalogs([catalogId])
			}
		}
		return warehouse
	}

	async removeWarehouse(id: string) {
		const catalogId = mustCatalogId()
		await this.assertInternalInventoryCatalog(catalogId)
		this.requireWarehouse(await this.repo.softDeleteWarehouse(catalogId, id))
		const affectedVariantIds = await this.repo.resyncWarehouseVariantStocks(
			catalogId,
			id
		)
		if (affectedVariantIds.length) {
			await this.invalidateProductCachesForCatalogs([catalogId])
		}
		return { ok: true }
	}

	async getWarehouseBalances(warehouseId: string) {
		const catalogId = mustCatalogId()
		await this.assertInternalInventoryCatalog(catalogId)
		const balances = await this.repo.findWarehouseBalances(catalogId, warehouseId)
		if (!balances) throw new NotFoundException('Inventory warehouse not found')
		return balances
	}

	async getWarehouseMovements(warehouseId: string, limit?: number | string) {
		const catalogId = mustCatalogId()
		await this.assertInternalInventoryCatalog(catalogId)
		const movements = await this.repo.findWarehouseMovements(
			catalogId,
			warehouseId,
			this.normalizeLimit(limit)
		)
		if (!movements) throw new NotFoundException('Inventory warehouse not found')
		return movements
	}

	async getWarehouseReservations(warehouseId: string, limit?: number | string) {
		const catalogId = mustCatalogId()
		await this.assertInternalInventoryCatalog(catalogId)
		const reservations = await this.repo.findWarehouseReservations(
			catalogId,
			warehouseId,
			this.normalizeLimit(limit)
		)
		if (!reservations)
			throw new NotFoundException('Inventory warehouse not found')
		return reservations
	}

	async adjustWarehouseStock(
		warehouseId: string,
		dto: CreateInventoryStockAdjustmentDtoReq,
		actorOrReq: string | AuthRequest | SessionUser | null
	) {
		const catalogId = mustCatalogId()
		await this.assertInternalInventoryCatalog(catalogId)
		const actorUserId = this.resolveActorUserId(actorOrReq)

		const result = await this.repo.adjustStock(
			catalogId,
			warehouseId,
			dto.variantId,
			dto.quantityDelta,
			this.normalizeOptionalText(dto.reason),
			actorUserId
		)

		if (result.ok) {
			this.recordInventoryMovement(result.movement.type, result.movement.source)
			await this.auditManualMovement(
				catalogId,
				warehouseId,
				dto,
				result,
				actorOrReq
			)
			const eventPublished = await this.publishManualStockChangedEvent(
				catalogId,
				result,
				this.normalizeOptionalText(dto.reason)
			)
			if (!eventPublished) {
				await this.invalidateProductCachesForCatalogs([catalogId])
			}
			return result
		}

		if (!('reason' in result)) return result

		if (result.reason === 'WAREHOUSE_NOT_FOUND') {
			throw new NotFoundException('Inventory warehouse not found')
		}
		if (result.reason === 'VARIANT_NOT_FOUND') {
			throw new NotFoundException('Product variant not found')
		}
		if (result.reason === 'WAREHOUSE_DISABLED') {
			throw new BadRequestException('Inventory warehouse is disabled')
		}
		throw new BadRequestException('Insufficient stock for write-off')
	}

	async consumeCompletedOrderStockTx(
		tx: Prisma.TransactionClient,
		params: {
			catalogId: string
			cartId: string
			orderId: string
			lines: InventoryCompletedOrderLine[]
			actorUserId: string | null
		}
	): Promise<InventoryTransactionEffects> {
		await this.assertInternalInventoryCatalog(params.catalogId)

		const result = await this.repo.consumeCompletedOrderStock(tx, params)
		if (result.ok) {
			this.recordInventoryMovement(
				INVENTORY_MOVEMENT_TYPE.SALE,
				INVENTORY_MOVEMENT_SOURCE.ORDER,
				result.consumedLines
			)
			const affectedCatalogIds = result.affectedVariantIds.length
				? [params.catalogId]
				: []
			const domainEvents = this.buildStockChangedEvents({
				catalogId: params.catalogId,
				changes: result.stockChanges,
				source: 'order',
				reason: 'completed_order_stock_consume'
			})
			await this.appendDomainEventsTx(tx, domainEvents)
			return {
				affectedCatalogIds,
				domainEvents
			}
		}

		if (!('reason' in result)) return emptyInventoryTransactionEffects()

		if (result.reason === 'WAREHOUSE_NOT_FOUND') {
			throw new BadRequestException(
				'Internal inventory warehouse is required to complete this order'
			)
		}
		if (result.reason === 'WAREHOUSE_AMBIGUOUS') {
			throw new BadRequestException(
				'Default internal inventory warehouse is required to complete this order'
			)
		}
		if (result.reason === 'VARIANT_NOT_FOUND') {
			throw new NotFoundException('Product variant not found')
		}
		throw new BadRequestException('Insufficient stock for completed order')
	}

	async reserveCartStockTx(
		tx: Prisma.TransactionClient,
		params: {
			catalogId: string
			cartId: string
			lines: InventoryCartReservationLine[]
			actorUserId: string | null
		}
	): Promise<InventoryTransactionEffects> {
		await this.assertInternalInventoryCatalog(params.catalogId)

		const expiresAt = new Date(Date.now() + CART_RESERVATION_TTL_MS)
		const result = await this.repo.reserveCartStock(tx, {
			...params,
			expiresAt
		})
		if (result.ok) {
			this.recordInventoryMovement(
				INVENTORY_MOVEMENT_TYPE.RESERVE,
				INVENTORY_MOVEMENT_SOURCE.CART,
				result.reservedLines
			)
			this.recordInventoryMovement(
				INVENTORY_MOVEMENT_TYPE.RELEASE,
				INVENTORY_MOVEMENT_SOURCE.CART,
				result.releasedReservations
			)
			const affectedCatalogIds = result.affectedVariantIds.length
				? [params.catalogId]
				: []
			const domainEvents = this.buildStockChangedEvents({
				catalogId: params.catalogId,
				changes: result.stockChanges,
				source: 'cart',
				reason: 'cart_reservation'
			})
			await this.appendDomainEventsTx(tx, domainEvents)
			return {
				affectedCatalogIds,
				domainEvents
			}
		}

		if (!('reason' in result)) return emptyInventoryTransactionEffects()

		if (result.reason === 'WAREHOUSE_NOT_FOUND') {
			throw new BadRequestException(
				'Internal inventory warehouse is required to reserve this cart'
			)
		}
		if (result.reason === 'WAREHOUSE_AMBIGUOUS') {
			throw new BadRequestException(
				'Default internal inventory warehouse is required to reserve this cart'
			)
		}
		if (result.reason === 'VARIANT_NOT_FOUND') {
			throw new NotFoundException('Product variant not found')
		}
		if (result.reason === 'MISSING_VARIANT') {
			throw new BadRequestException(
				'Internal inventory cart items must have variantId'
			)
		}
		throw new BadRequestException('Insufficient stock to reserve this cart')
	}

	async releaseCartReservationsTx(
		tx: Prisma.TransactionClient,
		params: {
			catalogId?: string
			cartId: string
			reason: string
			actorUserId: string | null
			now?: Date
		}
	): Promise<ExpireInventoryReservationsResult> {
		const result = await this.repo.releaseCartReservations(tx, params)
		this.recordInventoryMovement(
			INVENTORY_MOVEMENT_TYPE.RELEASE,
			INVENTORY_MOVEMENT_SOURCE.CART,
			result.releasedReservations
		)
		const domainEvents = params.catalogId
			? this.buildStockChangedEvents({
					catalogId: params.catalogId,
					changes: result.stockChanges,
					source: 'cart',
					reason: 'cart_reservation_release'
				})
			: []
		await this.appendDomainEventsTx(tx, domainEvents)
		return {
			...result,
			domainEvents
		}
	}

	async releaseExpiredReservations(
		now = new Date()
	): Promise<ExpireInventoryReservationsResult> {
		const result = await this.repo.releaseExpiredReservations(now)
		this.recordInventoryMovement(
			INVENTORY_MOVEMENT_TYPE.RELEASE,
			INVENTORY_MOVEMENT_SOURCE.SYSTEM,
			result.releasedReservations
		)
		const domainEvents = this.buildStockChangedEventsByCatalog({
			changes: result.stockChanges,
			source: 'system',
			reason: 'expired_reservation_release'
		})
		await this.invalidateProductCachesForCatalogs(
			result.affectedCatalogIds,
			domainEvents
		)
		return result
	}

	async invalidateProductCachesForCatalogs(
		catalogIds: Iterable<string | null | undefined>,
		domainEvents: DomainEvent[] = []
	): Promise<void> {
		if (domainEvents.length && this.events) {
			await this.events.dispatchMany(domainEvents)
			return
		}

		const uniqueCatalogIds = [...new Set([...catalogIds].filter(Boolean))]
		if (!uniqueCatalogIds.length) return

		await Promise.all(
			uniqueCatalogIds.flatMap(catalogId => [
				this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId),
				this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId)
			])
		)
	}

	private async publishManualStockChangedEvent(
		catalogId: string,
		result: Extract<
			Awaited<ReturnType<InventoryRepository['adjustStock']>>,
			{ ok: true }
		>,
		reason: string | null
	): Promise<boolean> {
		if (!this.events || !result.stockChange.changed) return false

		await this.events.dispatch(
			createDomainEvent({
				type: 'variant.stock_changed',
				catalogId,
				productId: result.stockChange.productId,
				variantId: result.stockChange.variantId,
				previousStock: result.stockChange.previousStock,
				nextStock: result.stockChange.nextStock,
				source: 'manual',
				reason
			})
		)

		return true
	}

	private buildStockChangedEvents(params: {
		catalogId: string
		changes: InventoryVariantStockChange[]
		source: DomainEventSource
		reason: string
	}): DomainEvent[] {
		return compactInventoryStockChanges(params.changes ?? []).map(change =>
			createDomainEvent({
				type: 'variant.stock_changed',
				catalogId: params.catalogId,
				productId: change.productId,
				variantId: change.variantId,
				previousStock: change.previousStock,
				nextStock: change.nextStock,
				source: params.source,
				reason: params.reason
			})
		)
	}

	private buildStockChangedEventsByCatalog(params: {
		changes: InventoryVariantStockChange[]
		source: DomainEventSource
		reason: string
	}): DomainEvent[] {
		return compactInventoryStockChanges(params.changes ?? []).flatMap(change => {
			if (!change.catalogId) return []
			return [
				createDomainEvent({
					type: 'variant.stock_changed',
					catalogId: change.catalogId,
					productId: change.productId,
					variantId: change.variantId,
					previousStock: change.previousStock,
					nextStock: change.nextStock,
					source: params.source,
					reason: params.reason
				})
			]
		})
	}

	private appendDomainEventsTx(
		tx: Prisma.TransactionClient,
		domainEvents: DomainEvent[]
	): Promise<void> {
		if (!domainEvents.length || !this.outbox) return Promise.resolve()
		return this.outbox.appendTx(tx, domainEvents)
	}

	private recordInventoryMovement(type: string, source: string, count = 1) {
		this.observability.recordInventoryMovement(type, source, 'success', count)
	}

	private async assertInternalInventoryCatalog(
		catalogId: string
	): Promise<void> {
		await this.featureEntitlements.assertCanUseInternalInventory(catalogId)

		const settings = await this.repo.findCatalogInventorySettings(catalogId)
		const inventoryMode = settings?.inventoryMode ?? 'NONE'
		if (inventoryMode !== CATALOG_INVENTORY_MODE_INTERNAL) {
			throw new ForbiddenException(
				`${CAPABILITY_INVENTORY_INTERNAL} requires INTERNAL inventory mode`
			)
		}
	}

	private requireWarehouse<T extends InventoryWarehouseRecord>(
		warehouse: T | null
	): T {
		if (!warehouse) throw new NotFoundException('Inventory warehouse not found')
		return warehouse
	}

	private normalizeRequiredText(value: string, field: string): string {
		const normalized = typeof value === 'string' ? value.trim() : ''
		if (!normalized) {
			throw new BadRequestException(`${field} is required`)
		}
		return normalized
	}

	private normalizeOptionalText(
		value: string | null | undefined
	): string | null {
		if (value === null || value === undefined) return null
		const normalized = value.trim()
		return normalized || null
	}

	private normalizeStatus(
		status: string | undefined
	): InventoryWarehouseStatusValue {
		if (status === INVENTORY_WAREHOUSE_STATUS.DISABLED) {
			return INVENTORY_WAREHOUSE_STATUS.DISABLED
		}
		return INVENTORY_WAREHOUSE_STATUS.ACTIVE
	}

	private normalizeLimit(limit: number | string | undefined): number {
		if (limit === undefined || limit === null || limit === '') return 50

		const normalized = typeof limit === 'string' ? Number(limit.trim()) : limit
		if (!Number.isInteger(normalized) || normalized < 1) {
			throw new BadRequestException('limit must be a positive integer')
		}
		return Math.min(normalized, 100)
	}

	private assertDefaultWarehouseCanBeActive(
		status: InventoryWarehouseStatusValue | undefined,
		isDefault: boolean | undefined
	): void {
		if (status === INVENTORY_WAREHOUSE_STATUS.DISABLED && isDefault) {
			throw new BadRequestException('Disabled warehouse cannot be default')
		}
	}

	private async auditManualMovement(
		catalogId: string,
		warehouseId: string,
		dto: CreateInventoryStockAdjustmentDtoReq,
		result: Extract<
			Awaited<ReturnType<InventoryRepository['adjustStock']>>,
			{ ok: true }
		>,
		actorOrReq: string | AuthRequest | SessionUser | null
	): Promise<void> {
		const quantityAfter =
			typeof result.movement.quantityAfter === 'number'
				? result.movement.quantityAfter
				: null
		const quantityBefore =
			quantityAfter === null ? null : quantityAfter - dto.quantityDelta

		await this.audit.record({
			action: 'inventory.manual_movement.create',
			category: 'inventory',
			actor: this.resolveAuditActor(actorOrReq),
			request: this.resolveAuditRequest(actorOrReq),
			targetType: 'INVENTORY_MOVEMENT',
			targetId: result.movement.id,
			targetCatalogId: catalogId,
			reason: this.normalizeOptionalText(dto.reason),
			message: 'Manual inventory movement created',
			metadata: {
				warehouseId,
				variantId: dto.variantId,
				movementId: result.movement.id,
				movementType: result.movement.type ?? null,
				source: result.movement.source ?? null,
				quantityDelta: dto.quantityDelta,
				quantityAfter,
				variantStock: result.variantStock
			},
			changes: [
				{
					field: 'quantityOnHand',
					oldValue: quantityBefore,
					newValue: quantityAfter
				}
			],
			targets: [
				{
					targetType: 'INVENTORY_WAREHOUSE',
					targetId: warehouseId,
					catalogId
				},
				{
					targetType: 'PRODUCT_VARIANT',
					targetId: dto.variantId,
					catalogId
				}
			]
		})
	}

	private resolveActorUserId(
		actorOrReq: string | AuthRequest | SessionUser | null
	): string | null {
		if (!actorOrReq) return null
		if (typeof actorOrReq === 'string') return actorOrReq
		if ('headers' in actorOrReq) return actorOrReq.user?.id ?? null
		return actorOrReq.id
	}

	private resolveAuditActor(
		actorOrReq: string | AuthRequest | SessionUser | null
	): SessionUser | null {
		if (!actorOrReq) return null
		if (typeof actorOrReq === 'string') {
			return { id: actorOrReq, role: Role.CATALOG }
		}
		if ('headers' in actorOrReq) return actorOrReq.user ?? null
		return actorOrReq
	}

	private resolveAuditRequest(
		actorOrReq: string | AuthRequest | SessionUser | null
	): AuthRequest | null {
		if (!actorOrReq || typeof actorOrReq === 'string') return null
		return 'headers' in actorOrReq ? actorOrReq : null
	}

	private async normalizeProvidedCode(
		catalogId: string,
		code: string,
		excludeWarehouseId?: string
	): Promise<string> {
		const normalized = this.normalizeCode(code)
		await this.assertCodeAvailable(catalogId, normalized, excludeWarehouseId)
		return normalized
	}

	private async generateAvailableCode(
		catalogId: string,
		name: string
	): Promise<string> {
		const baseCode = this.normalizeCode(name, WAREHOUSE_CODE_FALLBACK)
		for (let attempt = 0; attempt < WAREHOUSE_CODE_MAX_ATTEMPTS; attempt++) {
			const code = attempt === 0 ? baseCode : `${baseCode}-${attempt + 1}`
			if (!(await this.repo.existsWarehouseCode(catalogId, code))) return code
		}

		throw new BadRequestException('Could not generate a unique warehouse code')
	}

	private normalizeCode(
		value: string,
		fallback = WAREHOUSE_CODE_FALLBACK
	): string {
		const normalized = slugify(value, {
			lower: true,
			strict: true,
			trim: true
		})
			.replace(/-+/g, '-')
			.slice(0, 100)

		return normalized || fallback
	}

	private async assertCodeAvailable(
		catalogId: string,
		code: string,
		excludeWarehouseId?: string
	): Promise<void> {
		const exists = await this.repo.existsWarehouseCode(
			catalogId,
			code,
			excludeWarehouseId
		)
		if (exists) {
			throw new BadRequestException(
				'Inventory warehouse code is already used in this catalog'
			)
		}
	}
}

function emptyInventoryTransactionEffects(): InventoryTransactionEffects {
	return { affectedCatalogIds: [], domainEvents: [] }
}

function compactInventoryStockChanges(
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

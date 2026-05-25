import { CartStatus, Prisma } from '@generated/client'
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
import {
	PRODUCT_MAINTENANCE_PORT,
	PRODUCT_SELLABLE_READER_PORT,
	type ProductMaintenancePort,
	type ProductSellableProjection,
	type ProductSellableReader
} from '@/modules/product/contracts'
import type { DomainEvent } from '@/shared/domain-events/domain-events.contract'

import { CartInventoryReservationService } from './cart-inventory-reservation.service'
import {
	CartLinePricingService,
	type CartProductSnapshotSource,
	type CartResolvedLineSnapshot,
	type CartVariantSnapshotSource
} from './cart-line-pricing.service'
import { CartVariantSelectionService } from './cart-variant-selection.service'
import {
	MAX_CART_ITEMS,
	MAX_ITEM_QUANTITY,
	normalizeCartItemInput,
	resolveCartItemBaseQuantity,
	type NormalizedCartItemInput,
	type UpsertCartItemInput
} from './cart.utils'

const INVENTORY_MODE_NONE: CatalogInventoryMode = 'NONE'

const TERMINAL_CART_STATUSES = new Set<CartStatus>([
	CartStatus.CONVERTED,
	CartStatus.CANCELLED,
	CartStatus.EXPIRED
])

const cartReservationSelect = {
	id: true,
	catalogId: true,
	status: true,
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
			quantity: true,
			baseQuantity: true,
			saleUnit: { select: { baseQuantity: true } }
		}
	}
} satisfies Prisma.CartSelect

type CartReservationEntity = Prisma.CartGetPayload<{
	select: typeof cartReservationSelect
}>

type CartContext = {
	id: string
	catalogId: string
	parentCatalogId: string | null
	inventoryMode: CatalogInventoryMode
	status: CartStatus
}

type ExistingCartItem = {
	id: string
	createdAt: Date
	deleteAt: Date | null
	quantity: number
	saleUnitId: string | null
	baseQuantity: number | null
	unitPriceSnapshot: Prisma.Decimal | null
}

const existingCartItemSelect = {
	id: true,
	createdAt: true,
	deleteAt: true,
	quantity: true,
	saleUnitId: true,
	baseQuantity: true,
	unitPriceSnapshot: true
} satisfies Prisma.CartItemSelect

function sortCartLineMatches(items: ExistingCartItem[]) {
	return [...items].sort((left, right) => {
		const activeOrder =
			Number(Boolean(left.deleteAt)) - Number(Boolean(right.deleteAt))
		if (activeOrder !== 0) return activeOrder

		const leftCreatedAt =
			left.createdAt instanceof Date ? left.createdAt.getTime() : 0
		const rightCreatedAt =
			right.createdAt instanceof Date ? right.createdAt.getTime() : 0
		const createdOrder = leftCreatedAt - rightCreatedAt
		if (createdOrder !== 0) return createdOrder

		return left.id.localeCompare(right.id)
	})
}

function getActiveCartLineQuantity(items: ExistingCartItem[]) {
	return items.reduce(
		(sum, item) =>
			item.deleteAt
				? sum
				: sum + (Number.isFinite(item.quantity) ? item.quantity : 0),
		0
	)
}

type ResolvedCartItemInput = NormalizedCartItemInput & CartResolvedLineSnapshot

export type CartLineMutationResult = {
	cartId: string
	changed: boolean
	inventoryCacheCatalogIds?: string[]
	inventoryDomainEvents?: DomainEvent[]
}

@Injectable()
export class CartLineService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly inventoryReservation: CartInventoryReservationService,
		private readonly linePricing: CartLinePricingService,
		private readonly variantSelection: CartVariantSelectionService,
		@Inject(CAPABILITY_READER_PORT)
		private readonly capabilities: CapabilityReaderPort,
		@Inject(PRODUCT_MAINTENANCE_PORT)
		private readonly productMaintenance: ProductMaintenancePort,
		@Inject(PRODUCT_SELLABLE_READER_PORT)
		private readonly sellableReader: ProductSellableReader
	) {}

	async upsertItem(
		cartId: string,
		input: UpsertCartItemInput
	): Promise<CartLineMutationResult> {
		const normalizedInput = normalizeCartItemInput(input)
		const result = await this.prisma.$transaction(
			tx => this.upsertItemInTransaction(cartId, normalizedInput, tx),
			{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
		)

		await this.inventoryReservation.invalidateProductCaches(
			result.inventoryCacheCatalogIds,
			result.inventoryDomainEvents
		)
		return result
	}

	async removeItem(
		cartId: string,
		itemId: string
	): Promise<CartLineMutationResult> {
		const normalizedItemId = itemId.trim()
		if (!normalizedItemId) {
			throw new BadRequestException('Параметр itemId обязателен')
		}

		const result = await this.prisma.$transaction(
			async tx => {
				const cart = await this.findCartContextOrThrow(cartId, tx)
				this.ensureCartIsOpen(cart.status)

				const item = await tx.cartItem.findFirst({
					where: {
						id: normalizedItemId,
						cartId,
						deleteAt: null
					},
					select: {
						id: true,
						productId: true,
						variantId: true,
						saleUnitId: true
					}
				})

				if (!item) {
					throw new NotFoundException('Позиция корзины не найдена')
				}

				await tx.cartItem.updateMany({
					where: {
						cartId,
						productId: item.productId,
						variantId: item.variantId,
						saleUnitId: item.saleUnitId,
						deleteAt: null
					},
					data: { deleteAt: new Date() }
				})

				await this.touchCart(tx, cart.id)

				if (
					!this.inventoryReservation.shouldReserveCartStock(
						cart.status,
						cart.inventoryMode
					)
				) {
					return {
						cartId: cart.id,
						changed: true,
						inventoryCacheCatalogIds: [],
						inventoryDomainEvents: []
					}
				}

				const reservationCart = await this.findReservationCartOrThrow(cart.id, tx)
				const reserveEffect =
					await this.inventoryReservation.reserveCartStockIfNeededTx(
						tx,
						reservationCart,
						null
					)

				return {
					cartId: cart.id,
					changed: true,
					inventoryCacheCatalogIds: reserveEffect.inventoryCacheCatalogIds,
					inventoryDomainEvents: reserveEffect.inventoryDomainEvents
				}
			},
			{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
		)

		await this.inventoryReservation.invalidateProductCaches(
			result.inventoryCacheCatalogIds,
			result.inventoryDomainEvents
		)
		return result
	}

	private async upsertItemInTransaction(
		cartId: string,
		input: NormalizedCartItemInput,
		tx: Prisma.TransactionClient
	): Promise<CartLineMutationResult> {
		const cart = await this.findCartContextOrThrow(cartId, tx)
		this.ensureCartIsOpen(cart.status)

		const productSnapshot = await this.ensureProductInCatalog(
			tx,
			cart,
			input.productId
		)
		if (input.quantity > 0) {
			await this.productMaintenance.repairMissingDefaultVariantForProduct(
				productSnapshot.catalogId ?? cart.catalogId,
				input.productId,
				{ tx }
			)
		}
		const usesReservationFlow = this.inventoryReservation.shouldReserveCartStock(
			cart.status,
			cart.inventoryMode
		)
		const features = await this.capabilities.getCurrentFeatures(cart.catalogId)
		const canExposeSaleUnits = features.canUseCatalogSaleUnits
		const featureAwareInput = canExposeSaleUnits
			? input
			: { ...input, saleUnitId: null }
		const variantId = await this.variantSelection.resolveCartVariantId(
			tx,
			productSnapshot.catalogId ?? cart.catalogId,
			featureAwareInput,
			usesReservationFlow ? INVENTORY_MODE_NONE : cart.inventoryMode
		)
		const variantSnapshot = await this.ensureVariantMatchesProduct(
			tx,
			input.productId,
			variantId
		)
		const saleUnit = await this.linePricing.resolveSaleUnit(
			tx,
			variantId,
			variantId && canExposeSaleUnits ? featureAwareInput.saleUnitId : null,
			{ useDefaultWhenMissing: Boolean(variantId && canExposeSaleUnits) }
		)
		const commercialQuantity = resolveCartItemBaseQuantity({
			quantity: input.quantity,
			saleUnit
		})
		const commercialProjection = await this.resolveCommercialProjection(
			productSnapshot.catalogId ?? cart.catalogId,
			input.productId,
			variantId,
			commercialQuantity,
			usesReservationFlow ? INVENTORY_MODE_NONE : cart.inventoryMode
		)
		const resolvedInput: ResolvedCartItemInput = {
			...input,
			variantId,
			saleUnitId: saleUnit?.id ?? null,
			...this.linePricing.resolveLineSnapshot({
				variantId,
				saleUnit,
				quantity: input.quantity,
				productSnapshot,
				variantSnapshot,
				commercialProjection
			})
		}

		const existingItems = await this.findExistingItems(
			tx,
			cart.id,
			resolvedInput.productId,
			resolvedInput.variantId,
			resolvedInput.saleUnitId
		)
		const activeExistingQuantity = getActiveCartLineQuantity(existingItems)

		if (resolvedInput.quantity > 0) {
			const isReducingCorruptedQuantity =
				activeExistingQuantity > MAX_ITEM_QUANTITY &&
				resolvedInput.quantity <= activeExistingQuantity

			if (
				resolvedInput.quantity > MAX_ITEM_QUANTITY &&
				!isReducingCorruptedQuantity
			) {
				throw new BadRequestException(
					`Максимальное количество единиц одного товара: ${MAX_ITEM_QUANTITY}`
				)
			}

			this.ensureCommercialProjectionPurchasable(
				commercialProjection,
				usesReservationFlow ? INVENTORY_MODE_NONE : cart.inventoryMode
			)
		}

		const hasActiveExistingItem = existingItems.some(item => !item.deleteAt)
		if (resolvedInput.quantity > 0 && !hasActiveExistingItem) {
			const activeCount = await tx.cartItem.count({
				where: { cartId: cart.id, deleteAt: null }
			})
			if (activeCount >= MAX_CART_ITEMS) {
				throw new BadRequestException(
					`Максимальное количество позиций в корзине: ${MAX_CART_ITEMS}`
				)
			}
		}

		const changed = await this.applyCartItemChange(
			tx,
			cart.id,
			existingItems,
			resolvedInput
		)

		if (!changed) {
			return { cartId: cart.id, changed: false }
		}

		await this.touchCart(tx, cart.id)

		if (!usesReservationFlow) {
			return {
				cartId: cart.id,
				changed: true,
				inventoryCacheCatalogIds: [],
				inventoryDomainEvents: []
			}
		}

		const reservationCart = await this.findReservationCartOrThrow(cart.id, tx)
		const reserveEffect =
			await this.inventoryReservation.reserveCartStockIfNeededTx(
				tx,
				reservationCart,
				null
			)

		return {
			cartId: cart.id,
			changed: true,
			inventoryCacheCatalogIds: reserveEffect.inventoryCacheCatalogIds,
			inventoryDomainEvents: reserveEffect.inventoryDomainEvents
		}
	}

	private async findCartContextOrThrow(
		cartId: string,
		tx: Prisma.TransactionClient
	): Promise<CartContext> {
		await this.lockCartForMutation(cartId, tx)

		const cart = await tx.cart.findFirst({
			where: { id: cartId, deleteAt: null },
			select: {
				id: true,
				catalogId: true,
				status: true,
				catalog: {
					select: {
						parentId: true,
						settings: { select: { inventoryMode: true } }
					}
				}
			}
		})

		if (!cart) throw new NotFoundException('Корзина не найдена')

		return {
			id: cart.id,
			catalogId: cart.catalogId,
			parentCatalogId: cart.catalog.parentId ?? null,
			inventoryMode: cart.catalog.settings?.inventoryMode ?? INVENTORY_MODE_NONE,
			status: cart.status
		}
	}

	private async lockCartForMutation(
		cartId: string,
		tx: Prisma.TransactionClient
	): Promise<void> {
		const rows = await tx.$queryRaw<Array<{ id: string }>>(
			Prisma.sql`SELECT id FROM carts WHERE id = ${cartId} AND delete_at IS NULL FOR UPDATE`
		)

		if (!rows.length) {
			throw new NotFoundException('Корзина не найдена')
		}
	}

	private async findReservationCartOrThrow(
		cartId: string,
		tx: Prisma.TransactionClient
	): Promise<CartReservationEntity> {
		const cart = await tx.cart.findFirst({
			where: { id: cartId, deleteAt: null },
			select: cartReservationSelect
		})

		if (!cart) throw new NotFoundException('Корзина не найдена')

		return cart
	}

	private async ensureProductInCatalog(
		tx: Prisma.TransactionClient,
		cart: CartContext,
		productId: string
	): Promise<CartProductSnapshotSource> {
		const allowedCatalogIds = [cart.catalogId, cart.parentCatalogId].filter(
			(id): id is string => Boolean(id)
		)
		const product = await tx.product.findFirst({
			where: {
				id: productId,
				catalogId: { in: allowedCatalogIds },
				deleteAt: null
			},
			select: {
				id: true,
				catalogId: true,
				price: true,
				productAttributes: {
					where: { deleteAt: null },
					select: {
						valueDecimal: true,
						valueInteger: true,
						valueString: true,
						valueDateTime: true,
						attribute: {
							select: {
								key: true
							}
						}
					}
				}
			}
		})

		if (!product) {
			throw new BadRequestException('Товар не найден в текущем каталоге')
		}

		return {
			catalogId: product.catalogId,
			price: product.price,
			productAttributes: product.productAttributes
		}
	}

	private async resolveCommercialProjection(
		catalogId: string,
		productId: string,
		variantId: string | null,
		quantity: number,
		inventoryMode: CatalogInventoryMode
	): Promise<ProductSellableProjection | null> {
		if (quantity <= 0) return null

		const options = {
			quantity,
			enforceStock: inventoryMode !== INVENTORY_MODE_NONE
		}

		if (variantId) {
			return this.sellableReader.resolveVariantSellable(
				catalogId,
				productId,
				variantId,
				options
			)
		}

		const projection = await this.sellableReader.resolveProductSellable(
			catalogId,
			productId,
			options
		)

		return projection.requiresVariantSelection ? null : projection
	}

	private async ensureVariantMatchesProduct(
		tx: Prisma.TransactionClient,
		productId: string,
		variantId: string | null
	): Promise<CartVariantSnapshotSource> {
		if (!variantId) return null

		const variant = await tx.productVariant.findFirst({
			where: {
				id: variantId,
				productId,
				deleteAt: null
			},
			select: { id: true, price: true }
		})

		if (!variant) {
			throw new BadRequestException('Вариация не найдена для выбранного товара')
		}

		return { price: variant.price }
	}

	private ensureCommercialProjectionPurchasable(
		projection: ProductSellableProjection | null,
		inventoryMode: CatalogInventoryMode
	): void {
		if (!projection) {
			throw new BadRequestException('Вариация товара недоступна')
		}

		if (projection.availabilityState === 'AVAILABLE') return

		if (projection.availabilityState === 'OUT_OF_STOCK') {
			throw new BadRequestException(
				`Недостаточно товара на складе. Доступно: ${projection.stock ?? 0}`
			)
		}

		if (projection.availabilityState === 'UNAVAILABLE') {
			throw new BadRequestException('Вариация товара недоступна')
		}

		if (inventoryMode !== INVENTORY_MODE_NONE) {
			throw new BadRequestException('Вариация товара недоступна')
		}
	}

	private async findExistingItems(
		tx: Prisma.TransactionClient,
		cartId: string,
		productId: string,
		variantId: string | null,
		saleUnitId: string | null
	): Promise<ExistingCartItem[]> {
		const exact = await tx.cartItem.findFirst({
			where: {
				cartId,
				productId,
				variantId,
				saleUnitId
			},
			select: existingCartItemSelect
		})
		if (exact) {
			const duplicateMatches = await tx.cartItem.findMany({
				where: {
					cartId,
					productId,
					variantId,
					saleUnitId
				},
				select: existingCartItemSelect
			})
			return sortCartLineMatches(
				duplicateMatches.length ? duplicateMatches : [exact]
			)
		}

		if (!variantId && !saleUnitId) {
			const sameProduct = await tx.cartItem.findFirst({
				where: {
					cartId,
					productId,
					deleteAt: null
				},
				select: existingCartItemSelect,
				orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
			})
			if (sameProduct) return sortCartLineMatches([sameProduct])
		}

		if (!saleUnitId) return []

		const legacyDefaultSaleUnit = await tx.cartItem.findFirst({
			where: {
				cartId,
				productId,
				variantId,
				saleUnitId: null
			},
			select: existingCartItemSelect
		})
		return legacyDefaultSaleUnit
			? sortCartLineMatches([legacyDefaultSaleUnit])
			: []
	}

	private async applyCartItemChange(
		tx: Prisma.TransactionClient,
		cartId: string,
		existingItems: ExistingCartItem[],
		input: ResolvedCartItemInput
	): Promise<boolean> {
		const activeItems = existingItems.filter(item => !item.deleteAt)
		const primary = activeItems[0] ?? existingItems[0] ?? null
		const duplicateActiveIds = activeItems
			.filter(item => item.id !== primary?.id)
			.map(item => item.id)

		if (input.quantity === 0) {
			const activeIds = activeItems.map(item => item.id)
			if (activeIds.length) {
				await tx.cartItem.updateMany({
					where: { id: { in: activeIds } },
					data: { deleteAt: new Date() }
				})
				return true
			}
			return false
		}

		if (primary) {
			const shouldUpdatePrimary =
				Boolean(primary.deleteAt) ||
				primary.quantity !== input.quantity ||
				primary.saleUnitId !== input.saleUnitId ||
				primary.baseQuantity !== input.baseQuantity ||
				!this.linePricing.isSameMoney(
					primary.unitPriceSnapshot,
					input.unitPriceSnapshot
				)

			if (shouldUpdatePrimary) {
				await tx.cartItem.update({
					where: { id: primary.id },
					data: {
						quantity: input.quantity,
						baseQuantity: input.baseQuantity,
						unitPriceSnapshot: input.unitPriceSnapshot,
						saleUnitId: input.saleUnitId,
						deleteAt: null
					}
				})
			}

			if (duplicateActiveIds.length) {
				await tx.cartItem.updateMany({
					where: { id: { in: duplicateActiveIds } },
					data: { deleteAt: new Date() }
				})
			}

			return shouldUpdatePrimary || duplicateActiveIds.length > 0
		}

		await tx.cartItem.create({
			data: {
				cartId,
				productId: input.productId,
				variantId: input.variantId,
				saleUnitId: input.saleUnitId,
				quantity: input.quantity,
				baseQuantity: input.baseQuantity,
				unitPriceSnapshot: input.unitPriceSnapshot
			}
		})

		return true
	}

	private ensureCartIsOpen(status: CartStatus) {
		if (TERMINAL_CART_STATUSES.has(status)) {
			throw new BadRequestException('Корзина уже закрыта')
		}
	}

	private async touchCart(tx: Prisma.TransactionClient, cartId: string) {
		await tx.cart.update({
			where: { id: cartId },
			data: { updatedAt: new Date() }
		})
	}
}

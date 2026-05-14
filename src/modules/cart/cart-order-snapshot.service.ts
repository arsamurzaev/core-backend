import { CartCheckoutMethod, type Prisma } from '@generated/client'
import { Injectable } from '@nestjs/common'

import {
	normalizeOrderProducts,
	type OrderExternalLinkSnapshot
} from '@/shared/order/order-products.utils'

import {
	type CartEntityMapOptions,
	mapCartSaleUnit,
	mapCartVariant,
	resolveCartItemBaseQuantity,
	resolveCartItemPricing
} from './cart.utils'

export const completedOrderSelect = {
	id: true,
	status: true,
	catalogId: true,
	totalAmount: true,
	createdAt: true,
	products: true,
	checkoutMethod: true,
	checkoutData: true,
	checkoutContacts: true
}

export type CompletedOrderEntity = Prisma.OrderGetPayload<{
	select: typeof completedOrderSelect
}>

type OrderExternalLinkRecord = {
	integrationId: string
	externalId: string
	externalCode: string | null
	lastSyncedAt: Date | null
	rawMeta: Prisma.JsonValue | null
	integration: {
		provider: string
	}
}

type OrderProductExternalLinkRecord = OrderExternalLinkRecord & {
	productId: string
}

type OrderVariantExternalLinkRecord = OrderExternalLinkRecord & {
	variantId: string
}

type OrderExternalLinkMaps = {
	productsByProductId: Map<string, OrderExternalLinkSnapshot[]>
	variantsByVariantId: Map<string, OrderExternalLinkSnapshot[]>
}

type SnapshotCartItem = {
	id: string
	productId: string
	variantId: string | null
	saleUnitId?: string | null
	variant?: Parameters<typeof mapCartVariant>[0]
	saleUnit?: Parameters<typeof mapCartSaleUnit>[0]
	quantity: number
	baseQuantity?: number | null
	unitPriceSnapshot?: unknown
	product: {
		id: string
		name: string
		slug: string
		price: unknown
		productAttributes?: Parameters<
			typeof resolveCartItemPricing
		>[0]['product']['productAttributes']
	}
}

type DeliveryAddressCart = {
	checkoutMethod: CartCheckoutMethod | null
	checkoutData: unknown
}

@Injectable()
export class CartOrderSnapshotService {
	async buildSnapshotItems(
		tx: Prisma.TransactionClient,
		catalogId: string,
		items: SnapshotCartItem[],
		options: CartEntityMapOptions = {}
	) {
		const canUseProductVariants = options.canUseProductVariants ?? true
		const canUseCatalogSaleUnits = options.canUseCatalogSaleUnits ?? true
		const canExposeSaleUnits = canUseProductVariants && canUseCatalogSaleUnits
		const snapshotSources = items.map(item => {
			const variant = canUseProductVariants ? (item.variant ?? null) : null
			const saleUnit = canExposeSaleUnits ? (item.saleUnit ?? null) : null
			const shouldUseSnapshot =
				(canUseProductVariants || !item.variantId) &&
				(canExposeSaleUnits || !(item.saleUnitId ?? null))

			return {
				...item,
				variantId: canUseProductVariants ? item.variantId : null,
				saleUnitId: canExposeSaleUnits ? (item.saleUnitId ?? null) : null,
				variant,
				saleUnit,
				unitPriceSnapshot: shouldUseSnapshot ? item.unitPriceSnapshot : null
			}
		})
		const externalLinks = await this.loadOrderExternalLinks(
			tx,
			catalogId,
			snapshotSources
		)

		return snapshotSources.map(item => {
			const pricing = resolveCartItemPricing(item)
			return {
				id: item.id,
				productId: item.productId,
				variantId: item.variantId,
				saleUnitId: item.saleUnitId ?? null,
				variant: mapCartVariant(item.variant),
				saleUnit: mapCartSaleUnit(item.saleUnit),
				externalProducts:
					externalLinks.productsByProductId.get(item.productId) ?? [],
				externalVariants: item.variantId
					? (externalLinks.variantsByVariantId.get(item.variantId) ?? [])
					: [],
				quantity: item.quantity,
				baseQuantity: resolveCartItemBaseQuantity(item),
				baseUnitPrice: pricing.baseUnitPrice,
				unitPrice: pricing.unitPrice,
				unitPriceSnapshot: pricing.unitPrice,
				discountPercent: pricing.discountPercent,
				hasDiscount: pricing.hasDiscount,
				lineTotal: pricing.lineTotal,
				product: {
					id: item.product.id,
					name: item.product.name,
					slug: item.product.slug
				}
			}
		})
	}

	resolveDeliveryAddress(cart: DeliveryAddressCart): string | null {
		if (cart.checkoutMethod !== CartCheckoutMethod.DELIVERY) return null
		const data = cart.checkoutData
		if (typeof data !== 'object' || data === null || Array.isArray(data)) {
			return null
		}

		const address = (data as Record<string, unknown>).address
		return typeof address === 'string' && address.trim() ? address.trim() : null
	}

	mapCompletedOrder(order: CompletedOrderEntity) {
		return {
			id: order.id,
			status: order.status,
			catalogId: order.catalogId,
			totalAmount: Number(order.totalAmount),
			checkoutMethod: order.checkoutMethod,
			checkoutData: order.checkoutData,
			checkoutContacts: order.checkoutContacts,
			items: normalizeOrderProducts(order.products).map(item => ({
				id: item.id,
				productId: item.productId ?? '',
				variantId: item.variantId,
				saleUnitId: item.saleUnitId,
				quantity: item.quantity,
				baseQuantity: item.baseQuantity,
				unitPrice: item.unitPrice,
				variant: item.variant,
				saleUnit: item.saleUnit
			})),
			createdAt: order.createdAt
		}
	}

	private async loadOrderExternalLinks(
		tx: Prisma.TransactionClient,
		catalogId: string,
		items: Pick<SnapshotCartItem, 'productId' | 'variantId'>[]
	): Promise<OrderExternalLinkMaps> {
		const productIds = uniqueStrings(items.map(item => item.productId))
		const variantIds = uniqueStrings(items.map(item => item.variantId))

		const [productLinks, variantLinks] = await Promise.all([
			productIds.length
				? tx.integrationProductLink.findMany({
						where: {
							productId: { in: productIds },
							integration: {
								catalogId,
								isActive: true,
								deleteAt: null
							}
						},
						select: {
							productId: true,
							integrationId: true,
							externalId: true,
							externalCode: true,
							lastSyncedAt: true,
							rawMeta: true,
							integration: {
								select: {
									provider: true
								}
							}
						},
						orderBy: { createdAt: 'asc' }
					})
				: Promise.resolve<OrderProductExternalLinkRecord[]>([]),
			variantIds.length
				? tx.integrationVariantLink.findMany({
						where: {
							variantId: { in: variantIds },
							integration: {
								catalogId,
								isActive: true,
								deleteAt: null
							}
						},
						select: {
							variantId: true,
							integrationId: true,
							externalId: true,
							externalCode: true,
							lastSyncedAt: true,
							rawMeta: true,
							integration: {
								select: {
									provider: true
								}
							}
						},
						orderBy: { createdAt: 'asc' }
					})
				: Promise.resolve<OrderVariantExternalLinkRecord[]>([])
		])

		const productsByProductId = new Map<string, OrderExternalLinkSnapshot[]>()
		for (const link of productLinks) {
			appendOrderExternalLink(
				productsByProductId,
				link.productId,
				this.mapOrderExternalLink(link)
			)
		}

		const variantsByVariantId = new Map<string, OrderExternalLinkSnapshot[]>()
		for (const link of variantLinks) {
			appendOrderExternalLink(
				variantsByVariantId,
				link.variantId,
				this.mapOrderExternalLink(link)
			)
		}

		return {
			productsByProductId,
			variantsByVariantId
		}
	}

	private mapOrderExternalLink(
		link: OrderExternalLinkRecord
	): OrderExternalLinkSnapshot {
		const rawMeta = isRecord(link.rawMeta) ? link.rawMeta : null
		const rawId = readNonEmptyString(rawMeta?.id)
		const rawType = readNonEmptyString(rawMeta?.type)

		return {
			integrationId: link.integrationId,
			provider: link.integration.provider,
			externalId: link.externalId,
			externalCode: link.externalCode,
			lastSyncedAt: link.lastSyncedAt?.toISOString() ?? null,
			assortmentRef:
				rawId || rawType
					? {
							id: rawId,
							type: rawType
						}
					: null
		}
	}
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
	return Array.from(new Set(values.filter(isNonEmptyString)))
}

function appendOrderExternalLink(
	map: Map<string, OrderExternalLinkSnapshot[]>,
	key: string,
	link: OrderExternalLinkSnapshot
) {
	const current = map.get(key)
	if (current) {
		current.push(link)
		return
	}

	map.set(key, [link])
}

function isNonEmptyString(value: string | null | undefined): value is string {
	return typeof value === 'string' && value.trim().length > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNonEmptyString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized || null
}

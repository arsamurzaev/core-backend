import { CartCheckoutMethod, type Prisma } from '@generated/client'
import {
	BadRequestException,
	Inject,
	Injectable,
	Optional
} from '@nestjs/common'

import {
	type CatalogPriceListLinePrice,
	CatalogPriceListResolverService
} from '@/modules/catalog-price-list/public'
import {
	PRODUCT_SELLABLE_READER_PORT,
	type ProductSellableProjection,
	type ProductSellableReader
} from '@/modules/product/contracts'
import {
	normalizeOrderProducts,
	type OrderExternalLinkSnapshot
} from '@/shared/order/order-products.utils'

import {
	type CartEntityMapOptions,
	mapCartModifier,
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
	priceListId?: string | null
	priceListCode?: string | null
	priceListName?: string | null
	guestSessionId?: string | null
	guestName?: string | null
	variant?: Parameters<typeof mapCartVariant>[0]
	saleUnit?: Parameters<typeof mapCartSaleUnit>[0]
	modifiers?: Parameters<typeof mapCartModifier>[0][]
	quantity: number
	baseQuantity?: number | null
	unitPriceSnapshot?: unknown
	product: {
		id: string
		catalogId?: string | null
		name: string
		slug: string
		price: unknown
		productAttributes?: Parameters<
			typeof resolveCartItemPricing
		>[0]['product']['productAttributes']
	}
}

type CartOrderSnapshotOptions = CartEntityMapOptions & {
	enforceStock?: boolean
}

type DeliveryAddressCart = {
	checkoutMethod: CartCheckoutMethod | null
	checkoutData: unknown
}

type SnapshotSource = SnapshotCartItem & {
	variantId: string | null
	saleUnitId: string | null
	variant: Parameters<typeof mapCartVariant>[0]
	saleUnit: Parameters<typeof mapCartSaleUnit>[0]
	variantHidden: boolean
	saleUnitHidden: boolean
	unitPriceSnapshot: unknown
	priceListId: string | null
	priceListCode: string | null
	priceListName: string | null
	commercialProjection: ProductSellableProjection
}

@Injectable()
export class CartOrderSnapshotService {
	constructor(
		@Inject(PRODUCT_SELLABLE_READER_PORT)
		private readonly sellableReader: ProductSellableReader,
		@Optional()
		private readonly priceLists?: CatalogPriceListResolverService
	) {}

	async buildSnapshotItems(
		tx: Prisma.TransactionClient,
		catalogId: string,
		items: SnapshotCartItem[],
		options: CartOrderSnapshotOptions = {}
	) {
		const canUseProductVariants = options.canUseProductVariants ?? true
		const canUseCatalogSaleUnits = options.canUseCatalogSaleUnits ?? true
		const canUseCatalogModifiers = options.canUseCatalogModifiers ?? true
		const canExposeSaleUnits = canUseCatalogSaleUnits
		const canExposeModifiers = canUseCatalogModifiers
		const snapshotSources = await Promise.all(
			items.map(async item => {
				const commercialProjection = await this.resolveCommercialProjection(
					catalogId,
					item,
					options
				)
				const variantId = item.variantId ?? commercialProjection.variantId
				const saleUnit = canExposeSaleUnits ? (item.saleUnit ?? null) : null
				const saleUnitId = canExposeSaleUnits ? (item.saleUnitId ?? null) : null
				const modifiers = canExposeModifiers ? (item.modifiers ?? []) : []
				const variantHidden = Boolean(variantId && !canUseProductVariants)
				const saleUnitHidden = Boolean((item.saleUnitId ?? null) && !saleUnitId)
				const priceListLine = await this.resolvePriceListLine(
					tx,
					catalogId,
					item.product.catalogId ?? catalogId,
					item.productId,
					variantId,
					saleUnitId,
					commercialProjection
				)
				const product =
					priceListLine.target === 'PRODUCT'
						? { ...item.product, price: priceListLine.price }
						: item.product
				const variant =
					priceListLine.target === 'VARIANT' && item.variant
						? { ...item.variant, price: priceListLine.price }
						: (item.variant ?? null)
				const pricedSaleUnit =
					priceListLine.target === 'SALE_UNIT' && saleUnit
						? { ...saleUnit, price: priceListLine.price }
						: saleUnit

				return {
					...item,
					product,
					variantId,
					saleUnitId,
					variant,
					saleUnit: pricedSaleUnit,
					modifiers,
					variantHidden,
					saleUnitHidden,
					unitPriceSnapshot: null,
					priceListId: priceListLine.priceListId,
					priceListCode: priceListLine.priceListCode,
					priceListName: priceListLine.priceListName,
					commercialProjection
				}
			})
		)
		const externalLinks = await this.loadOrderExternalLinks(
			tx,
			catalogId,
			snapshotSources
		)

		return snapshotSources.map(item => {
			const pricingSource = this.buildPricingSource(item)
			const pricing = resolveCartItemPricing(pricingSource)
			return {
				id: item.id,
				productId: item.productId,
				variantId: item.variantId,
				saleUnitId: item.saleUnitId ?? null,
				priceListId: item.priceListId,
				priceListCode: item.priceListCode,
				priceListName: item.priceListName,
				variantHidden: item.variantHidden,
				saleUnitHidden: item.saleUnitHidden,
				variant: item.variantHidden ? null : mapCartVariant(item.variant),
				saleUnit: item.saleUnitHidden ? null : mapCartSaleUnit(item.saleUnit),
				modifiers: item.modifiers.map(mapCartModifier),
				guestSessionId: item.guestSessionId ?? null,
				guestName: item.guestName ?? null,
				externalProducts:
					externalLinks.productsByProductId.get(item.productId) ?? [],
				externalVariants: item.variantId
					? (externalLinks.variantsByVariantId.get(item.variantId) ?? [])
					: [],
				quantity: item.quantity,
				baseQuantity: this.resolveSnapshotBaseQuantity(item),
				priceState: item.saleUnit ? 'KNOWN' : item.commercialProjection.priceState,
				displayPrice: item.saleUnit
					? normalizeMoneyString(item.saleUnit.price)
					: item.commercialProjection.displayPrice,
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
				priceListId: item.priceListId,
				priceListCode: item.priceListCode,
				priceListName: item.priceListName,
				guestSessionId: item.guestSessionId,
				guestName: item.guestName,
				quantity: item.quantity,
				baseQuantity: item.baseQuantity,
				priceState: item.priceState,
				displayPrice: item.displayPrice,
				unitPrice: item.unitPrice,
				variant: item.variant,
				saleUnit: item.saleUnit,
				modifiers: item.modifiers
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

	private async resolveCommercialProjection(
		catalogId: string,
		item: SnapshotCartItem,
		options: CartOrderSnapshotOptions
	): Promise<ProductSellableProjection> {
		const productCatalogId = item.product.catalogId ?? catalogId
		const canUseCatalogSaleUnits = options.canUseCatalogSaleUnits ?? true
		const quantity = resolveCartItemBaseQuantity({
			quantity: item.quantity,
			baseQuantity: canUseCatalogSaleUnits ? item.baseQuantity : null,
			saleUnit: canUseCatalogSaleUnits ? (item.saleUnit ?? null) : null
		})
		const resolveOptions = {
			quantity,
			enforceStock: options.enforceStock ?? false,
			buyerCatalogId: catalogId
		}
		const projection = item.variantId
			? await this.sellableReader.resolveVariantSellable(
					productCatalogId,
					item.productId,
					item.variantId,
					resolveOptions
				)
			: await this.sellableReader.resolveProductSellable(
					productCatalogId,
					item.productId,
					resolveOptions
				)

		if (projection.usesPriceList && projection.priceState === 'UNKNOWN') {
			throw new BadRequestException('Цена недоступна для выбранного прайс-листа')
		}
		this.ensureProjectionCanBeOrdered(projection)
		return projection
	}

	private async resolvePriceListLine(
		tx: Prisma.TransactionClient,
		buyerCatalogId: string,
		productCatalogId: string,
		productId: string,
		variantId: string | null,
		saleUnitId: string | null,
		commercialProjection: ProductSellableProjection
	): Promise<{
		priceListId: string | null
		priceListCode: string | null
		priceListName: string | null
		price: string | null
		target: CatalogPriceListLinePrice['target']
	}> {
		if (!commercialProjection.usesPriceList) {
			return {
				priceListId: null,
				priceListCode: null,
				priceListName: null,
				price: null,
				target: null
			}
		}
		if (!this.priceLists) {
			throw new BadRequestException('Цена недоступна для выбранного прайс-листа')
		}

		const line = await this.priceLists.resolveLinePrice({
			buyerCatalogId,
			ownerCatalogId: productCatalogId,
			productId,
			variantId,
			saleUnitId,
			mode: commercialProjection.mode,
			tx
		})
		if (!line.priceList) {
			return {
				priceListId: null,
				priceListCode: null,
				priceListName: null,
				price: null,
				target: null
			}
		}
		if (line.price === null) {
			throw new BadRequestException('Цена недоступна для выбранного прайс-листа')
		}

		return {
			priceListId: line.priceList.id,
			priceListCode: line.priceList.code,
			priceListName: line.priceList.name,
			price: line.price,
			target: line.target
		}
	}

	private resolveSnapshotBaseQuantity(item: SnapshotSource): number {
		return resolveCartItemBaseQuantity({
			quantity: item.quantity,
			baseQuantity: item.saleUnit ? item.baseQuantity : null,
			saleUnit: item.saleUnit
		})
	}

	private ensureProjectionCanBeOrdered(projection: ProductSellableProjection) {
		if (projection.requiresVariantSelection) {
			throw new BadRequestException('Выберите вариацию товара')
		}

		if (projection.availabilityState === 'AVAILABLE') return

		if (projection.availabilityState === 'OUT_OF_STOCK') {
			throw new BadRequestException(
				`Недостаточно товара на складе. Доступно: ${projection.stock ?? 0}`
			)
		}

		throw new BadRequestException('Товар недоступен для заказа')
	}

	private buildPricingSource(item: SnapshotSource) {
		const commercialPrice = this.resolveCommercialPrice(item.commercialProjection)
		const hasVariantPricingSource = Boolean(item.variantId && item.variant)
		const product = hasVariantPricingSource
			? item.product
			: withPrice(item.product, commercialPrice)
		const variant = hasVariantPricingSource
			? withPrice(item.variant, commercialPrice)
			: item.variant

		return {
			...item,
			product,
			variant,
			modifiers: item.modifiers,
			unitPriceSnapshot: null
		}
	}

	private resolveCommercialPrice(
		projection: ProductSellableProjection
	): string | null {
		if (projection.priceState === 'UNKNOWN') return null
		return projection.displayPrice
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

function withPrice<T extends { price: unknown } | null | undefined>(
	source: T,
	price: string | null
): T {
	if (!source || price === null) return source
	return { ...source, price }
}

function normalizeMoneyString(value: unknown): string | null {
	const parsed = readFiniteNumber(value)
	return parsed === null ? null : parsed.toFixed(2)
}

function readFiniteNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed : null
	}
	if (typeof value === 'bigint') return Number(value)
	if (typeof value === 'object' && value !== null) {
		const candidate = value as {
			toNumber?: () => unknown
			toString?: () => string
		}
		if (typeof candidate.toNumber === 'function') {
			try {
				const parsed = candidate.toNumber()
				if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed
			} catch {
				// Fall back to a custom toString implementation below.
			}
		}
		if (
			typeof candidate.toString === 'function' &&
			candidate.toString !== Object.prototype.toString
		) {
			const parsed = Number(candidate.toString())
			return Number.isFinite(parsed) ? parsed : null
		}
	}
	return null
}

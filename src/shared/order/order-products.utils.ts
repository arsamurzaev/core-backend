export type OrderProductSnapshot = {
	id: string
	productId: string | null
	variantId: string | null
	saleUnitId: string | null
	variant: OrderProductVariantSnapshot | null
	saleUnit: OrderProductSaleUnitSnapshot | null
	externalProducts: OrderExternalLinkSnapshot[]
	externalVariants: OrderExternalLinkSnapshot[]
	quantity: number
	baseQuantity: number
	baseUnitPrice: number
	unitPrice: number
	unitPriceSnapshot: number
	discountPercent: number
	hasDiscount: boolean
	lineTotal: number
	product: {
		id: string | null
		name: string | null
		slug: string | null
	} | null
}

export type OrderProductSaleUnitSnapshot = {
	id: string | null
	variantId: string | null
	catalogSaleUnitId: string | null
	code: string | null
	name: string | null
	baseQuantity: number | null
	price: number | null
	barcode: string | null
	isDefault: boolean | null
}

export type OrderExternalLinkSnapshot = {
	integrationId: string | null
	provider: string | null
	externalId: string | null
	externalCode: string | null
	lastSyncedAt: string | null
	assortmentRef: {
		id: string | null
		type: string | null
	} | null
}

export type OrderProductVariantSnapshot = {
	id: string | null
	sku: string | null
	variantKey: string | null
	price: number | null
	stock: number | null
	status: string | null
	isAvailable: boolean | null
	attributes: {
		attribute: {
			id: string | null
			key: string | null
			displayName: string | null
		} | null
		enumValue: {
			id: string | null
			value: string | null
			displayName: string | null
		} | null
	}[]
}

export function normalizeOrderProducts(value: unknown): OrderProductSnapshot[] {
	if (!Array.isArray(value)) return []

	return value.flatMap((item, index) => {
		if (!isRecord(item)) return []

		const product = isRecord(item.product) ? item.product : null
		const quantity = normalizeQuantity(item.quantity)
		const unitPrice =
			normalizeMoney(item.unitPriceSnapshot) || normalizeMoney(item.unitPrice)
		const baseUnitPrice =
			normalizeMoney(item.baseUnitPrice) ||
			readNestedMoney(item.saleUnit, 'price') ||
			readNestedMoney(item.variant, 'price') ||
			unitPrice
		const baseQuantity =
			readNumber(item.baseQuantity) ??
			normalizeBaseQuantity(quantity, item.saleUnit)
		const lineTotal =
			readNumber(item.lineTotal) ?? normalizeMoney(unitPrice * quantity)
		const discountPercent = normalizeDiscountPercent(
			item.discountPercent,
			baseUnitPrice,
			unitPrice
		)

		return [
			{
				id: readString(item.id) ?? `snapshot-${index + 1}`,
				productId: readString(item.productId),
				variantId: readString(item.variantId),
				saleUnitId: readString(item.saleUnitId),
				variant: normalizeVariant(item.variant),
				saleUnit: normalizeSaleUnit(item.saleUnit),
				externalProducts: normalizeExternalLinks(item.externalProducts),
				externalVariants: normalizeExternalLinks(item.externalVariants),
				quantity,
				baseQuantity,
				baseUnitPrice,
				unitPrice,
				unitPriceSnapshot: unitPrice,
				discountPercent,
				hasDiscount:
					typeof item.hasDiscount === 'boolean'
						? item.hasDiscount
						: discountPercent > 0,
				lineTotal,
				product: product
					? {
							id: readString(product.id) ?? readString(item.productId),
							name: readString(product.name),
							slug: readString(product.slug)
						}
					: null
			}
		]
	})
}

function normalizeSaleUnit(
	value: unknown
): OrderProductSaleUnitSnapshot | null {
	if (!isRecord(value)) return null

	return {
		id: readString(value.id),
		variantId: readString(value.variantId),
		catalogSaleUnitId: readString(value.catalogSaleUnitId),
		code: readString(value.code),
		name: readString(value.name),
		baseQuantity: readNumber(value.baseQuantity),
		price: readNumber(value.price),
		barcode: readString(value.barcode),
		isDefault: typeof value.isDefault === 'boolean' ? value.isDefault : null
	}
}

function normalizeVariant(value: unknown): OrderProductVariantSnapshot | null {
	if (!isRecord(value)) return null

	const attributes = Array.isArray(value.attributes)
		? value.attributes.flatMap(attribute => {
				if (!isRecord(attribute)) return []

				return [
					{
						attribute: normalizeVariantAttributeRef(attribute.attribute),
						enumValue: normalizeVariantEnumValue(attribute.enumValue)
					}
				]
			})
		: []

	return {
		id: readString(value.id),
		sku: readString(value.sku),
		variantKey: readString(value.variantKey),
		price: readNumber(value.price),
		stock: readNumber(value.stock),
		status: readString(value.status),
		isAvailable:
			typeof value.isAvailable === 'boolean' ? value.isAvailable : null,
		attributes
	}
}

function normalizeExternalLinks(value: unknown): OrderExternalLinkSnapshot[] {
	if (!Array.isArray(value)) return []

	return value.flatMap(item => {
		if (!isRecord(item)) return []
		const assortmentRef = normalizeAssortmentRef(item.assortmentRef)

		return [
			{
				integrationId: readString(item.integrationId),
				provider: readString(item.provider),
				externalId: readString(item.externalId),
				externalCode: readString(item.externalCode),
				lastSyncedAt: readString(item.lastSyncedAt),
				assortmentRef
			}
		]
	})
}

function normalizeAssortmentRef(value: unknown) {
	if (!isRecord(value)) return null
	return {
		id: readString(value.id),
		type: readString(value.type)
	}
}

function normalizeVariantAttributeRef(value: unknown) {
	if (!isRecord(value)) return null
	return {
		id: readString(value.id),
		key: readString(value.key),
		displayName: readString(value.displayName)
	}
}

function normalizeVariantEnumValue(value: unknown) {
	if (!isRecord(value)) return null
	return {
		id: readString(value.id),
		value: readString(value.value),
		displayName: readString(value.displayName)
	}
}

export function countOrderProductLines(value: unknown): number {
	return normalizeOrderProducts(value).length
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length ? normalized : null
}

function readNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string') {
		const normalized = value.trim()
		if (!normalized) return null
		const parsed = Number(normalized)
		return Number.isFinite(parsed) ? parsed : null
	}
	return null
}

function normalizeQuantity(value: unknown): number {
	const parsed = readNumber(value)
	if (parsed === null) return 1
	return Math.max(1, Math.trunc(parsed))
}

function normalizeBaseQuantity(quantity: number, saleUnit: unknown): number {
	const multiplier = isRecord(saleUnit)
		? readNumber(saleUnit.baseQuantity)
		: null
	return Math.max(
		1,
		Math.ceil(quantity * (multiplier && multiplier > 0 ? multiplier : 1))
	)
}

function normalizeMoney(value: unknown): number {
	const parsed = readNumber(value)
	if (parsed === null) return 0
	return Number(parsed.toFixed(2))
}

function readNestedMoney(value: unknown, key: string): number {
	if (!isRecord(value)) return 0
	return normalizeMoney(value[key])
}

function normalizeDiscountPercent(
	value: unknown,
	baseUnitPrice: number,
	unitPrice: number
): number {
	const explicit = readNumber(value)
	if (explicit !== null) {
		return Math.min(100, Math.max(0, Math.round(explicit)))
	}
	if (baseUnitPrice <= 0 || unitPrice >= baseUnitPrice) return 0
	return Math.round(((baseUnitPrice - unitPrice) / baseUnitPrice) * 100)
}

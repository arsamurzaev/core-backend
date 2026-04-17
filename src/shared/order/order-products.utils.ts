export type OrderProductSnapshot = {
	id: string
	productId: string | null
	variantId: string | null
	quantity: number
	unitPrice: number
	lineTotal: number
	product: {
		id: string | null
		name: string | null
		slug: string | null
	} | null
}

export function normalizeOrderProducts(value: unknown): OrderProductSnapshot[] {
	if (!Array.isArray(value)) return []

	return value.flatMap((item, index) => {
		if (!isRecord(item)) return []

		const product = isRecord(item.product) ? item.product : null
		const quantity = normalizeQuantity(item.quantity)
		const unitPrice = normalizeMoney(item.unitPrice)
		const lineTotal =
			readNumber(item.lineTotal) ?? normalizeMoney(unitPrice * quantity)

		return [
			{
				id: readString(item.id) ?? `snapshot-${index + 1}`,
				productId: readString(item.productId),
				variantId: readString(item.variantId),
				quantity,
				unitPrice,
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

function normalizeMoney(value: unknown): number {
	const parsed = readNumber(value)
	if (parsed === null) return 0
	return Number(parsed.toFixed(2))
}

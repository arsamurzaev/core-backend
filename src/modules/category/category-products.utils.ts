import { BadRequestException } from '@nestjs/common'

export const CATEGORY_PRODUCTS_DEFAULT_LIMIT = 24
export const CATEGORY_PRODUCTS_MAX_LIMIT = 50

export type CategoryProductInput = { productId: string; position?: number }

export type CategoryProductCursor = {
	position: number
	productId: string
}

export type CategoryProductsPageItem<TProduct> = {
	productId: string
	position: number
	product: TProduct
}

export type CategoryProductsPage<TProduct> = {
	items: CategoryProductsPageItem<TProduct>[]
	nextCursor: string | null
}

export function normalizeCategoryName(value: string): string {
	return value.trim()
}

export function normalizeCategoryProducts(
	products?: CategoryProductInput[]
): CategoryProductInput[] {
	if (!products) return []

	const normalized = products.map((product, index) => {
		const productId = product.productId?.trim()
		if (!productId) {
			throw new BadRequestException('productId обязателен')
		}

		if (
			product.position !== undefined &&
			(!Number.isInteger(product.position) || product.position < 0)
		) {
			throw new BadRequestException(
				`position должен быть целым числом >= 0 (products[${index}])`
			)
		}

		const position =
			Number.isInteger(product.position) && product.position >= 0
				? product.position
				: undefined

		return { productId, position }
	})

	const unique = new Set(normalized.map(product => product.productId))
	if (unique.size !== normalized.length) {
		throw new BadRequestException('Дублирующиеся productId')
	}

	return normalized
}

export function resolveCategoryProductPositions(
	products: CategoryProductInput[],
	existingPositionById?: ReadonlyMap<string, number>
): [string, number][] {
	const result = new Map<string, number>()
	let maxPosition = -1

	for (const product of products) {
		if (product.position === undefined) continue
		result.set(product.productId, product.position)
		maxPosition = Math.max(maxPosition, product.position)
	}

	if (existingPositionById) {
		for (const product of products) {
			if (result.has(product.productId)) continue
			const existingPosition = existingPositionById.get(product.productId)
			if (existingPosition === undefined) continue
			result.set(product.productId, existingPosition)
			maxPosition = Math.max(maxPosition, existingPosition)
		}
	}

	for (const product of products) {
		if (result.has(product.productId)) continue
		maxPosition += 1
		result.set(product.productId, maxPosition)
	}

	return Array.from(result.entries())
}

export function normalizeCategoryProductsLimit(
	value?: number | string
): number {
	const raw = typeof value === 'string' ? Number(value.trim()) : value
	if (!Number.isFinite(raw)) return CATEGORY_PRODUCTS_DEFAULT_LIMIT

	const normalized = Math.floor(raw)
	if (normalized <= 0) return CATEGORY_PRODUCTS_DEFAULT_LIMIT

	return Math.min(normalized, CATEGORY_PRODUCTS_MAX_LIMIT)
}

export function encodeCategoryProductsCursor(
	value: CategoryProductCursor
): string {
	return Buffer.from(JSON.stringify(value)).toString('base64')
}

export function decodeCategoryProductsCursor(
	value?: string
): CategoryProductCursor | null {
	if (!value) return null

	try {
		const decoded = Buffer.from(value, 'base64').toString('utf8')
		const parsed = JSON.parse(decoded) as {
			position?: unknown
			productId?: unknown
		}
		const position =
			typeof parsed.position === 'number' && Number.isFinite(parsed.position)
				? Math.floor(parsed.position)
				: null
		const productId =
			typeof parsed.productId === 'string' ? parsed.productId.trim() : ''

		if (position === null || !productId) return null
		return { position, productId }
	} catch {
		return null
	}
}

export function buildCategoryProductsPage<TProductIn, TProductOut>(
	items: CategoryProductsPageItem<TProductIn>[],
	limit: number,
	mapProduct: (product: TProductIn) => TProductOut
): CategoryProductsPage<TProductOut> {
	const hasMore = items.length > limit
	const pageItems = hasMore ? items.slice(0, limit) : items
	const lastItem = pageItems[pageItems.length - 1]

	return {
		items: pageItems.map(({ product, ...item }) => ({
			...item,
			product: mapProduct(product)
		})),
		nextCursor:
			hasMore && lastItem
				? encodeCategoryProductsCursor({
						position: lastItem.position,
						productId: lastItem.productId
					})
				: null
	}
}

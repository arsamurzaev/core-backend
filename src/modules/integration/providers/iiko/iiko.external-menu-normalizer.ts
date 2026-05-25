import type {
	IikoExternalMenuCategory,
	IikoExternalMenuItem,
	IikoExternalMenuItemSize,
	IikoExternalMenuPrice,
	IikoExternalMenuResponse,
	IikoSyncCategory,
	IikoSyncMenu,
	IikoSyncProduct,
	IikoSyncSizePrice
} from './iiko.types'

const DEFAULT_SIZE_EXTERNAL_ID = 'default'

export type IikoExternalMenuPreview = {
	ok: true
	source: 'external_menu'
	revision: number | null
	externalMenuId: string | null
	externalMenuName: string | null
	stats: {
		categories: number
		items: number
		visibleItems: number
		hiddenItems: number
		itemsWithoutPrice: number
		itemsWithModifiers: number
		combos: number
		variants: number
	}
	diff?: {
		newItems: number
		matchedItems: number
		changedItems: number
		priceChanges: number
		nameChanges: number
		unchangedItems: number
		missingLinkedItems: number
	}
	categories: Array<{
		id: string
		name: string
		isHidden: boolean
		items: number
	}>
	items: Array<{
		id: string
		name: string
		categoryId: string | null
		type: string | null
		orderItemType: string | null
		isHidden: boolean
		hasPrice: boolean
		price: number | null
		variants: number
		hasModifiers: boolean
		willImport: boolean
		skipReasons: string[]
		diffStatus?: string | null
		localProductId?: string | null
		localName?: string | null
		localPrice?: number | null
	}>
}

export function normalizeIikoExternalMenu(params: {
	menu: IikoExternalMenuResponse
	organizationId: string
	externalMenuId?: string | null
	externalMenuName?: string | null
}): IikoSyncMenu {
	const categories = resolveExternalCategories(params.menu)
	const syncCategories: IikoSyncCategory[] = []
	const products: IikoSyncProduct[] = []

	for (const category of categories) {
		const categoryId = normalizeOptionalString(category.id)
		const categoryName = normalizeOptionalString(category.name)
		if (!categoryId || !categoryName) continue

		const isCategoryHidden = category.isHidden === true
		syncCategories.push({
			id: categoryId,
			name: categoryName,
			description: normalizeOptionalString(category.description),
			isHidden: isCategoryHidden,
			imageLinks: normalizeImageLinks([
				category.buttonImageUrl,
				category.headerImageUrl
			]),
			rawMeta: {
				source: 'external_menu',
				iikoGroupId: category.iikoGroupId ?? null,
				isHidden: category.isHidden ?? null
			}
		})

		for (const item of category.items ?? []) {
			const product = normalizeExternalItem({
				item,
				categoryId,
				isCategoryHidden,
				organizationId: params.organizationId
			})
			if (product) products.push(product)
		}
	}

	return {
		source: 'external_menu',
		externalMenuId:
			normalizeOptionalString(params.externalMenuId) ??
			normalizeOptionalString(params.menu.id),
		externalMenuName:
			normalizeOptionalString(params.externalMenuName) ??
			normalizeOptionalString(params.menu.name),
		groups: syncCategories,
		products,
		sizes: [],
		revision: normalizeRevision(params.menu.revision),
		formatVersion: normalizeRevision(params.menu.formatVersion),
		rawMeta: {
			id: params.menu.id ?? null,
			name: params.menu.name ?? null,
			formatVersion: params.menu.formatVersion ?? null,
			comboCategories: params.menu.comboCategories ?? []
		}
	}
}

export function buildIikoExternalMenuPreview(
	menu: IikoSyncMenu
): IikoExternalMenuPreview {
	const categoryItemCounts = new Map<string, number>()
	for (const product of menu.products) {
		if (!product.groupId) continue
		categoryItemCounts.set(
			product.groupId,
			(categoryItemCounts.get(product.groupId) ?? 0) + 1
		)
	}

	const previewItems = menu.products.map(product => {
		const hasPrice = hasSellablePrice(product)
		const hasModifiers = hasProductModifiers(product)
		const type = product.type ?? null
		const orderItemType = product.orderItemType ?? null
		const isHidden = product.isHidden === true
		const variants = (product.sizePrices ?? []).filter(
			size =>
				size.price?.isIncludedInMenu !== false &&
				normalizePrice(size.price?.currentPrice) !== null
		).length
		const skipReasons = resolvePreviewSkipReasons({
			hasPrice,
			isHidden,
			orderItemType,
			type
		})
		return {
			id: product.id,
			name: product.name,
			categoryId: product.groupId ?? null,
			type,
			orderItemType,
			isHidden,
			hasPrice,
			price: resolvePreviewBasePrice(product),
			variants,
			hasModifiers,
			willImport: skipReasons.length === 0,
			skipReasons
		}
	})

	const visibleItems = previewItems.filter(item => item.willImport).length

	return {
		ok: true,
		source: 'external_menu',
		revision: menu.revision ?? null,
		externalMenuId: menu.externalMenuId ?? null,
		externalMenuName: menu.externalMenuName ?? null,
		stats: {
			categories: menu.groups.length,
			items: menu.products.length,
			visibleItems,
			hiddenItems: previewItems.filter(item => item.isHidden).length,
			itemsWithoutPrice: previewItems.filter(item => !item.hasPrice).length,
			itemsWithModifiers: previewItems.filter(item => item.hasModifiers).length,
			combos: previewItems.filter(item => item.type === 'combo').length,
			variants: previewItems.reduce((sum, item) => sum + item.variants, 0)
		},
		categories: menu.groups.map(category => ({
			id: category.id,
			name: category.name,
			isHidden: category.isHidden === true,
			items: categoryItemCounts.get(category.id) ?? 0
		})),
		items: previewItems
	}
}

function resolvePreviewSkipReasons(params: {
	hasPrice: boolean
	isHidden: boolean
	orderItemType: string | null
	type: string | null
}): string[] {
	const reasons: string[] = []
	const type = params.type?.toLowerCase() ?? null

	if (params.isHidden) {
		reasons.push('hidden')
	}
	if (!params.hasPrice) {
		reasons.push('no_price')
	}
	if (type === 'combo') {
		reasons.push('combo')
	} else if (type === 'modifier') {
		reasons.push('modifier')
	} else if (type !== 'dish' && type !== 'good' && type !== 'product') {
		reasons.push('unsupported_type')
	}
	if (params.orderItemType && params.orderItemType !== 'Product') {
		reasons.push('unsupported_order_item_type')
	}

	return reasons
}

function resolveExternalCategories(
	menu: IikoExternalMenuResponse
): IikoExternalMenuCategory[] {
	if (Array.isArray(menu.itemGroups)) return menu.itemGroups
	if (Array.isArray(menu.itemCategories)) return menu.itemCategories
	return []
}

function normalizeExternalItem(params: {
	item: IikoExternalMenuItem
	categoryId: string
	isCategoryHidden: boolean
	organizationId: string
}): IikoSyncProduct | null {
	const id =
		normalizeOptionalString(params.item.id) ??
		normalizeOptionalString(params.item.itemId)
	const name = normalizeOptionalString(params.item.name)
	if (!id || !name) return null

	const itemSizes = Array.isArray(params.item.itemSizes)
		? params.item.itemSizes
		: []
	const sizePrices = itemSizes.map((size, index) =>
		normalizeExternalSizePrice({
			size,
			index,
			organizationId: params.organizationId
		})
	)
	const imageLinks = normalizeImageLinks([
		params.item.buttonImageUrl,
		...sizePrices.flatMap(size => size.imageLinks ?? [])
	])
	const itemModifierGroups = itemSizes.flatMap(size =>
		Array.isArray(size.itemModifierGroups) ? size.itemModifierGroups : []
	)
	const type = normalizeExternalItemType(params.item.type)

	return {
		id,
		code: normalizeOptionalString(params.item.sku),
		name,
		description: normalizeOptionalString(params.item.description),
		type,
		orderItemType: normalizeOptionalString(params.item.orderItemType),
		groupId: params.categoryId,
		productCategoryId: normalizeOptionalString(params.item.productCategoryId),
		measureUnit:
			normalizeOptionalString(params.item.measureUnit) ??
			normalizeOptionalString(params.item.measureUnitType),
		sizePrices,
		imageLinks,
		groupModifiers: itemModifierGroups,
		isHidden: params.isCategoryHidden || params.item.isHidden === true,
		rawMeta: {
			source: 'external_menu',
			raw: params.item,
			modifierSchemaId: params.item.modifierSchemaId ?? null,
			modifierSchemaName: params.item.modifierSchemaName ?? null
		}
	}
}

function normalizeExternalSizePrice(params: {
	size: IikoExternalMenuItemSize
	index: number
	organizationId: string
}): IikoSyncSizePrice {
	const rawSizeId =
		normalizeOptionalString(params.size.id) ??
		normalizeOptionalString(params.size.sizeId)
	const sizeId =
		rawSizeId ||
		(params.index === 0
			? DEFAULT_SIZE_EXTERNAL_ID
			: `${DEFAULT_SIZE_EXTERNAL_ID}-${params.index + 1}`)
	const price = resolveExternalPrice(params.size.prices, params.organizationId)

	return {
		sizeId,
		sizeName: normalizeOptionalString(params.size.sizeName) ?? 'Default',
		sku: normalizeOptionalString(params.size.sku),
		isDefault:
			params.size.isDefault === true || sizeId === DEFAULT_SIZE_EXTERNAL_ID,
		imageLinks: normalizeImageLinks([params.size.buttonImageUrl]),
		price: {
			currentPrice: price,
			isIncludedInMenu: params.size.isHidden === true ? false : price !== null
		},
		rawMeta: params.size
	}
}

function resolveExternalPrice(
	prices: IikoExternalMenuPrice[] | null | undefined,
	organizationId: string
): number | null {
	if (!Array.isArray(prices)) return null
	const byOrganization = prices.find(price =>
		Array.isArray(price.organizations)
			? price.organizations.includes(organizationId)
			: false
	)
	const fallback = prices.find(
		price => !Array.isArray(price.organizations) || price.organizations.length === 0
	)
	const value = byOrganization?.price ?? fallback?.price ?? null
	return normalizePrice(value)
}

function normalizeExternalItemType(value: unknown): string | null {
	const normalized = normalizeOptionalString(value)?.toLowerCase() ?? null
	if (normalized === 'dish' || normalized === 'combo') return normalized
	return normalized
}

function hasSellablePrice(product: IikoSyncProduct): boolean {
	return (product.sizePrices ?? []).some(size => {
		if (size.price?.isIncludedInMenu === false) return false
		return normalizePrice(size.price?.currentPrice) !== null
	})
}

function resolvePreviewBasePrice(product: IikoSyncProduct): number | null {
	const options = (product.sizePrices ?? [])
		.filter(size => size.price?.isIncludedInMenu !== false)
		.map(size => ({
			isDefault: size.isDefault === true || size.sizeId === DEFAULT_SIZE_EXTERNAL_ID,
			price: normalizePrice(size.price?.currentPrice)
		}))
		.filter(option => option.price !== null)
	if (!options.length) return null
	const selected =
		options.find(option => option.isDefault) ??
		[...options].sort((left, right) => (left.price ?? 0) - (right.price ?? 0))[0]
	return selected?.price ?? null
}

function hasProductModifiers(product: IikoSyncProduct): boolean {
	return Boolean(
		(product.modifiers?.length ?? 0) > 0 ||
			(product.groupModifiers?.length ?? 0) > 0
	)
}

function normalizeImageLinks(values: unknown[]): string[] {
	return [...new Set(values.flatMap(value => normalizeOptionalString(value) ?? []))]
}

function normalizeOptionalString(value: unknown): string | null {
	const normalized =
		typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''
	const trimmed = normalized.trim()
	return trimmed || null
}

function normalizePrice(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null
	const numberValue = Number(value)
	return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null
}

function normalizeRevision(value: unknown): number | null {
	const numberValue = Number(value)
	return Number.isInteger(numberValue) ? numberValue : null
}

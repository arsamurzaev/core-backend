export const CATALOG_CURRENT_CACHE_TTL_SEC =
	Number(
		process.env.CATALOG_CURRENT_CACHE_TTL_SEC ??
			process.env.CATALOG_PRODUCTS_CACHE_TTL_SEC ??
			0
	) || 0

export const CATALOG_CACHE_VERSION = 'catalog'
export const CATALOG_TYPE_CACHE_VERSION = 'catalog-type'
export const PRODUCTS_CACHE_VERSION = 'products-v2'
export const CATEGORY_PRODUCTS_CACHE_VERSION = 'category-products-v2'

export const CATEGORY_PRODUCTS_FIRST_PAGE_CACHE_TTL_SEC =
	Number(
		process.env.CATEGORY_PRODUCTS_FIRST_PAGE_CACHE_TTL_SEC ??
			process.env.CATALOG_PRODUCTS_CACHE_TTL_SEC ??
			0
	) || 0

export const CATEGORY_PRODUCTS_NEXT_PAGE_CACHE_TTL_SEC =
	Number(
		process.env.CATEGORY_PRODUCTS_NEXT_PAGE_CACHE_TTL_SEC ??
			process.env.CATALOG_PRODUCTS_CACHE_TTL_SEC ??
			0
	) || 0

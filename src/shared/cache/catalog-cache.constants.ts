export const CATALOG_CURRENT_CACHE_TTL_SEC =
	Number(
		process.env.CATALOG_CURRENT_CACHE_TTL_SEC ??
			process.env.CATALOG_PRODUCTS_CACHE_TTL_SEC ??
			0
	) || 0

export const CATALOG_CACHE_VERSION = 'catalog'
export const CATALOG_TYPE_CACHE_VERSION = 'catalog-type'

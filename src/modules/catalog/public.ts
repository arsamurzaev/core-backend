export * from './contracts'
export { CatalogModule } from './catalog.module'
export {
	applyCatalogSlugSuffix,
	CATALOG_SLUG_FALLBACK,
	ensureCatalogSlugAllowed,
	normalizeCatalogSlug,
	slugifyCatalogValue
} from './catalog.utils'

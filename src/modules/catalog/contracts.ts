export const CATALOG_DOMAIN_MAINTENANCE_PORT = Symbol(
	'CATALOG_DOMAIN_MAINTENANCE_PORT'
)

export interface CatalogDomainMaintenancePort {
	checkPendingDomains(limit?: number): Promise<number>
}

export {
	type CatalogCheckoutData,
	normalizeCartCheckoutData,
	resolveCatalogCheckoutConfig,
	resolveCheckoutContactsSnapshot
} from './catalog-checkout'

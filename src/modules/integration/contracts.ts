import type { IntegrationProvider } from '@generated/enums'

import type {
	IntegrationProviderAdapter,
	IntegrationProviderConnectionResult,
	IntegrationProviderProduct,
	IntegrationProviderRawMeta,
	IntegrationProviderStockRow,
	IntegrationProviderVariant
} from './provider-adapter.contract'

export const ORDER_EXPORT_PORT = Symbol('ORDER_EXPORT_PORT')
export const CATALOG_SYNC_PORT = Symbol('CATALOG_SYNC_PORT')
export const STOCK_SYNC_PORT = Symbol('STOCK_SYNC_PORT')
export const INTEGRATION_PROVIDER_REGISTRY = Symbol(
	'INTEGRATION_PROVIDER_REGISTRY'
)

export type OrderExportQueueResult = {
	ok: true
	queued: boolean
	exportId?: string
	jobId?: string
	reason?: string
}

export interface OrderExportPort {
	enqueueCompletedOrder(
		catalogId: string,
		orderId: string
	): Promise<OrderExportQueueResult>
}

export interface CatalogSyncPort {
	queueCatalogSync(catalogId: string, trigger?: string): Promise<unknown>
}

export interface StockSyncPort {
	queueStockSync(catalogId: string, trigger?: string): Promise<unknown>
}

export interface IntegrationProviderRegistry {
	get(provider: IntegrationProvider): IntegrationProviderAdapter
	list(): readonly IntegrationProviderAdapter[]
}

export type {
	IntegrationProviderAdapter,
	IntegrationProviderConnectionResult,
	IntegrationProviderProduct,
	IntegrationProviderRawMeta,
	IntegrationProviderStockRow,
	IntegrationProviderVariant
}

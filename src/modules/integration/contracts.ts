import type { IntegrationProvider } from '@generated/enums'

import type { PreviewIikoImportDtoReq } from './dto/requests/preview-iiko-import.dto.req'
import type { TestIikoConnectionDtoReq } from './dto/requests/test-iiko-connection.dto.req'
import type { TestMoySkladConnectionDtoReq } from './dto/requests/test-moysklad-connection.dto.req'
import type { UpdateIikoIntegrationDtoReq } from './dto/requests/update-iiko-integration.dto.req'
import type { UpdateMoySkladIntegrationDtoReq } from './dto/requests/update-moysklad-integration.dto.req'
import type { UpsertIikoIntegrationDtoReq } from './dto/requests/upsert-iiko-integration.dto.req'
import type { UpsertMoySkladIntegrationDtoReq } from './dto/requests/upsert-moysklad-integration.dto.req'
import type {
	IikoImportPreviewDto,
	IikoIntegrationDto,
	IikoIntegrationStatusDto,
	IikoQueuedSyncDto,
	IikoSyncProgressDto,
	IikoSyncRunDto,
	IikoTestConnectionDto,
	IikoWebhookEventDto,
	IikoWebhookSetupDto
} from './dto/responses/iiko.dto.res'
import type {
	MoySkladIntegrationDto,
	MoySkladIntegrationStatusDto,
	MoySkladOrderExportRefsDto,
	MoySkladQueuedSyncDto,
	MoySkladSyncProgressDto,
	MoySkladSyncRunDto,
	MoySkladTestConnectionDto
} from './dto/responses/moysklad.dto.res'
import type {
	IntegrationProviderAdapter,
	IntegrationProviderConnectionResult,
	IntegrationProviderProduct,
	IntegrationProviderRawMeta,
	IntegrationProviderStockRow,
	IntegrationProviderVariant
} from './provider-adapter.contract'

export const ORDER_EXPORT_PORT = Symbol('ORDER_EXPORT_PORT')
export const INTEGRATION_ADVANCED_SETTINGS_PORT = Symbol(
	'INTEGRATION_ADVANCED_SETTINGS_PORT'
)

export type OrderExportQueueResult = {
	ok: true
	queued: boolean
	exportId?: string
	jobId?: string
	reason?: string
}

export type OrderExportWaitResult = {
	ok: boolean
	status: 'SUCCESS' | 'ERROR' | 'SKIPPED' | 'TIMEOUT' | 'NOT_QUEUED'
	exportId?: string
	error?: string | null
	reason?: string
}

export interface OrderExportPort {
	enqueueCompletedOrder(
		catalogId: string,
		orderId: string
	): Promise<OrderExportQueueResult>
	waitForCompletedOrderExport?(
		catalogId: string,
		orderId: string,
		params?: {
			provider?: IntegrationProvider
			timeoutMs?: number
			intervalMs?: number
		}
	): Promise<OrderExportWaitResult>
}

export interface IntegrationAdvancedSettingsPort {
	getMoySklad(): Promise<MoySkladIntegrationDto>
	getMoySkladStatus(): Promise<MoySkladIntegrationStatusDto>
	getMoySkladRuns(limit?: number | string): Promise<MoySkladSyncRunDto[]>
	getMoySkladRunProgress(runId: string): Promise<MoySkladSyncProgressDto>
	getMoySkladOrderExportRefs(): Promise<MoySkladOrderExportRefsDto>
	upsertMoySklad(
		dto: UpsertMoySkladIntegrationDtoReq
	): Promise<MoySkladIntegrationDto>
	updateMoySklad(
		dto: UpdateMoySkladIntegrationDtoReq
	): Promise<MoySkladIntegrationDto>
	removeMoySklad(): Promise<{ ok: boolean }>
	testMoySkladConnection(
		dto: TestMoySkladConnectionDtoReq
	): Promise<MoySkladTestConnectionDto>
	syncMoySkladCatalog(): Promise<MoySkladQueuedSyncDto>
	cancelMoySkladSync(): Promise<void>

	getIiko(): Promise<IikoIntegrationDto>
	getIikoStatus(): Promise<IikoIntegrationStatusDto>
	getIikoRuns(limit?: number | string): Promise<IikoSyncRunDto[]>
	getIikoWebhookEvents(
		limit?: number | string,
		status?: string
	): Promise<IikoWebhookEventDto[]>
	retryIikoWebhookEvent(eventId: string): Promise<IikoWebhookEventDto>
	getIikoRunProgress(runId: string): Promise<IikoSyncProgressDto>
	upsertIiko(dto: UpsertIikoIntegrationDtoReq): Promise<IikoIntegrationDto>
	updateIiko(dto: UpdateIikoIntegrationDtoReq): Promise<IikoIntegrationDto>
	removeIiko(): Promise<{ ok: boolean }>
	testIikoConnection(
		dto?: TestIikoConnectionDtoReq
	): Promise<IikoTestConnectionDto>
	previewIikoImport(dto: PreviewIikoImportDtoReq): Promise<IikoImportPreviewDto>
	syncIikoCatalog(): Promise<IikoQueuedSyncDto>
	syncIikoStock(): Promise<IikoQueuedSyncDto>
	syncIikoProduct(productId: string): Promise<IikoQueuedSyncDto>
	setupIikoWebhooks(): Promise<IikoWebhookSetupDto>
	disableIikoWebhooks(): Promise<{ ok: boolean }>
}

export type {
	IntegrationProviderAdapter,
	IntegrationProviderConnectionResult,
	IntegrationProviderProduct,
	IntegrationProviderRawMeta,
	IntegrationProviderStockRow,
	IntegrationProviderVariant
}

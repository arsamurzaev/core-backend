import { Role } from '@generated/enums'
import {
	Body,
	Controller,
	Delete,
	Get,
	Headers,
	HttpCode,
	Param,
	Patch,
	Post,
	Put,
	Query,
	Req,
	UseGuards
} from '@nestjs/common'
import {
	ApiOkResponse,
	ApiOperation,
	ApiParam,
	ApiQuery,
	ApiSecurity,
	ApiTags
} from '@nestjs/swagger'

import { Public } from '@/shared/http/decorators/public.decorator'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { SessionGuard } from '../auth/guards/session.guard'
import type { AuthRequest } from '../auth/types/auth-request'

import { ApplyMoySkladMappingDtoReq } from './dto/requests/apply-moysklad-mapping.dto.req'
import { PreviewIikoImportDtoReq } from './dto/requests/preview-iiko-import.dto.req'
import { TestIikoConnectionDtoReq } from './dto/requests/test-iiko-connection.dto.req'
import { TestMoySkladConnectionDtoReq } from './dto/requests/test-moysklad-connection.dto.req'
import { UpdateIikoIntegrationDtoReq } from './dto/requests/update-iiko-integration.dto.req'
import { UpdateMoySkladIntegrationDtoReq } from './dto/requests/update-moysklad-integration.dto.req'
import { UpsertIikoIntegrationDtoReq } from './dto/requests/upsert-iiko-integration.dto.req'
import { UpsertMoySkladIntegrationDtoReq } from './dto/requests/upsert-moysklad-integration.dto.req'
import {
	IikoImportPreviewDto,
	IikoIntegrationDto,
	IikoIntegrationStatusDto,
	IikoOrderExportDto,
	IikoOrderExportTimelineDto,
	IikoQueuedOrderExportDto,
	IikoQueuedSyncDto,
	IikoRestaurantTablesDto,
	IikoSyncProgressDto,
	IikoSyncRunDto,
	IikoTestConnectionDto,
	IikoWebhookEventDto,
	IikoWebhookSetupDto
} from './dto/responses/iiko.dto.res'
import { IntegrationPayloadTokenService } from './integration-payload-token.service'
import {
	MoySkladIntegrationDto,
	MoySkladIntegrationStatusDto,
	MoySkladMappingApplyReportDto,
	MoySkladMappingPreviewDto,
	MoySkladOrderExportDto,
	MoySkladOrderExportRefsDto,
	MoySkladQueuedOrderExportDto,
	MoySkladQueuedSyncDto,
	MoySkladSyncProgressDto,
	MoySkladSyncRunDto,
	MoySkladTestConnectionDto
} from './dto/responses/moysklad.dto.res'
import { IntegrationService } from './integration.service'

@ApiTags('Integration')
@Controller('integration')
export class IntegrationController {
	constructor(
		private readonly integrationService: IntegrationService,
		private readonly payloadTokens: IntegrationPayloadTokenService
	) {}

	@Get('/payload/public-key')
	@ApiOperation({ summary: 'Get public key for integration payload tokens' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	async getIntegrationPayloadPublicKey() {
		return {
			ok: true,
			...this.payloadTokens.getPublicKey()
		}
	}

	@Get('/moysklad')
	@ApiOperation({ summary: 'Получить настройки интеграции MoySklad' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: MoySkladIntegrationDto })
	async getMoySklad() {
		return this.integrationService.getMoySklad()
	}

	@Get('/moysklad/status')
	@ApiOperation({ summary: 'Получить статус интеграции MoySklad' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: MoySkladIntegrationStatusDto })
	async getMoySkladStatus() {
		return this.integrationService.getMoySkladStatus()
	}

	@Get('/iiko')
	@ApiOperation({ summary: 'Get iiko integration settings' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: IikoIntegrationDto })
	async getIiko() {
		return this.integrationService.getIiko()
	}

	@Get('/iiko/status')
	@ApiOperation({ summary: 'Get iiko integration status' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: IikoIntegrationStatusDto })
	async getIikoStatus() {
		return this.integrationService.getIikoStatus()
	}

	@Put('/iiko')
	@ApiOperation({ summary: 'Create or replace iiko integration settings' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: IikoIntegrationDto })
	async upsertIiko(@Body() dto: UpsertIikoIntegrationDtoReq) {
		return this.integrationService.upsertIiko(dto)
	}

	@Patch('/iiko')
	@ApiOperation({ summary: 'Update iiko integration settings' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: IikoIntegrationDto })
	async updateIiko(@Body() dto: UpdateIikoIntegrationDtoReq) {
		return this.integrationService.updateIiko(dto)
	}

	@Delete('/iiko')
	@ApiOperation({ summary: 'Remove iiko integration settings' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: OkResponseDto })
	async removeIiko() {
		return this.integrationService.removeIiko()
	}

	@Post('/iiko/test-connection')
	@ApiOperation({ summary: 'Test iikoCloud connection' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: IikoTestConnectionDto })
	async testIikoConnection(@Body() dto: TestIikoConnectionDtoReq) {
		return this.integrationService.testIikoConnection(dto)
	}

	@Get('/iiko/tables')
	@ApiOperation({ summary: 'Get iiko restaurant tables for QR hall orders' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: IikoRestaurantTablesDto })
	async getIikoTables() {
		return this.integrationService.getIikoTables()
	}

	@Post('/iiko/import-preview')
	@ApiOperation({ summary: 'Preview iiko external menu import' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: IikoImportPreviewDto })
	async previewIikoImport(@Body() dto: PreviewIikoImportDtoReq) {
		return this.integrationService.previewIikoImport(dto)
	}

	@Post('/iiko/sync')
	@ApiOperation({ summary: 'Queue full iiko menu sync' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: IikoQueuedSyncDto })
	async syncIikoCatalog() {
		return this.integrationService.syncIikoCatalog()
	}

	@Post('/iiko/stock-sync')
	@ApiOperation({ summary: 'Queue iiko stop-list stock sync' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: IikoQueuedSyncDto })
	async syncIikoStock() {
		return this.integrationService.syncIikoStock()
	}

	@Post('/iiko/sync-product/:id')
	@ApiOperation({ summary: 'Queue one iiko product sync' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiParam({
		name: 'id',
		description: 'Local product ID'
	})
	@ApiOkResponse({ type: IikoQueuedSyncDto })
	async syncIikoProduct(@Param('id') id: string) {
		return this.integrationService.syncIikoProduct(id)
	}

	@Post('/iiko/webhooks/setup')
	@ApiOperation({ summary: 'Register iiko webhooks for the saved integration' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: IikoWebhookSetupDto })
	async setupIikoWebhooks() {
		return this.integrationService.setupIikoWebhooks()
	}

	@Delete('/iiko/webhooks')
	@ApiOperation({ summary: 'Disable local iiko webhook handling' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: OkResponseDto })
	async disableIikoWebhooks() {
		return this.integrationService.disableIikoWebhooks()
	}

	@Get('/iiko/runs')
	@ApiOperation({ summary: 'Get iiko sync history' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiQuery({
		name: 'limit',
		required: false,
		type: Number,
		description: 'How many recent sync runs to return'
	})
	@ApiOkResponse({ type: IikoSyncRunDto, isArray: true })
	async getIikoRuns(@Query('limit') limit?: number | string) {
		return this.integrationService.getIikoRuns(limit)
	}

	@Get('/iiko/runs/:runId/progress')
	@ApiOperation({ summary: 'Get iiko sync progress' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiParam({ name: 'runId' })
	@ApiOkResponse({ type: IikoSyncProgressDto })
	async getIikoRunProgress(@Param('runId') runId: string) {
		return this.integrationService.getIikoRunProgress(runId)
	}

	@Get('/iiko/order-exports')
	@ApiOperation({ summary: 'Get iiko order export history' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiQuery({
		name: 'limit',
		required: false,
		type: Number,
		description: 'How many recent order exports to return'
	})
	@ApiOkResponse({ type: IikoOrderExportDto, isArray: true })
	async getIikoOrderExports(@Query('limit') limit?: number | string) {
		return this.integrationService.getIikoOrderExports(limit)
	}

	@Get('/iiko/webhook-events')
	@ApiOperation({ summary: 'Get iiko webhook event journal' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiQuery({
		name: 'limit',
		required: false,
		type: Number,
		description: 'How many recent webhook events to return'
	})
	@ApiQuery({
		name: 'status',
		required: false,
		type: String,
		description: 'Optional webhook event status filter'
	})
	@ApiOkResponse({ type: IikoWebhookEventDto, isArray: true })
	async getIikoWebhookEvents(
		@Query('limit') limit?: number | string,
		@Query('status') status?: string
	) {
		return this.integrationService.getIikoWebhookEvents(limit, status)
	}

	@Post('/iiko/webhook-events/:eventId/retry')
	@ApiOperation({ summary: 'Retry failed iiko webhook event processing' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiParam({ name: 'eventId' })
	@ApiOkResponse({ type: IikoWebhookEventDto })
	async retryIikoWebhookEvent(@Param('eventId') eventId: string) {
		return this.integrationService.retryIikoWebhookEvent(eventId)
	}

	@Get('/moysklad/runs')
	@ApiOperation({ summary: 'Получить историю sync MoySklad' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiQuery({
		name: 'limit',
		required: false,
		type: Number,
		description: 'Сколько последних запусков вернуть'
	})
	@ApiOkResponse({ type: MoySkladSyncRunDto, isArray: true })
	async getMoySkladRuns(@Query('limit') limit?: number | string) {
		return this.integrationService.getMoySkladRuns(limit)
	}

	@Get('/moysklad/runs/:runId/progress')
	@ApiOperation({ summary: 'Получить прогресс sync MoySklad' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiParam({ name: 'runId' })
	@ApiOkResponse({ type: MoySkladSyncProgressDto })
	async getMoySkladRunProgress(@Param('runId') runId: string) {
		return this.integrationService.getMoySkladRunProgress(runId)
	}

	@Get('/moysklad/order-exports')
	@ApiOperation({ summary: 'Получить историю экспорта заказов MoySklad' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiQuery({
		name: 'limit',
		required: false,
		type: Number,
		description: 'Сколько последних экспортов заказов вернуть'
	})
	@ApiOkResponse({ type: MoySkladOrderExportDto, isArray: true })
	async getMoySkladOrderExports(@Query('limit') limit?: number | string) {
		return this.integrationService.getMoySkladOrderExports(limit)
	}

	@Get('/moysklad/order-export-refs')
	@ApiOperation({
		summary:
			'Получить организации, контрагентов и склады MoySklad для экспорта заказов'
	})
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: MoySkladOrderExportRefsDto })
	async getMoySkladOrderExportRefs() {
		return this.integrationService.getMoySkladOrderExportRefs()
	}

	@Get('/moysklad/mapping-preview')
	@ApiOperation({ summary: 'Preview MoySklad characteristic mapping' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: MoySkladMappingPreviewDto })
	async previewMoySkladMapping() {
		return this.integrationService.previewMoySkladMapping()
	}

	@Post('/moysklad/mapping-preview/apply')
	@ApiOperation({ summary: 'Apply MoySklad characteristic mapping preview' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: MoySkladMappingApplyReportDto })
	async applyMoySkladMapping(@Body() dto: ApplyMoySkladMappingDtoReq) {
		return this.integrationService.applyMoySkladMapping(dto)
	}

	@Put('/moysklad')
	@ApiOperation({ summary: 'Создать или заменить настройки MoySklad' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: MoySkladIntegrationDto })
	async upsertMoySklad(@Body() dto: UpsertMoySkladIntegrationDtoReq) {
		return this.integrationService.upsertMoySklad(dto)
	}

	@Patch('/moysklad')
	@ApiOperation({ summary: 'Обновить настройки MoySklad' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: MoySkladIntegrationDto })
	async updateMoySklad(@Body() dto: UpdateMoySkladIntegrationDtoReq) {
		return this.integrationService.updateMoySklad(dto)
	}

	@Delete('/moysklad')
	@ApiOperation({ summary: 'Удалить настройки MoySklad' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: OkResponseDto })
	async removeMoySklad() {
		return this.integrationService.removeMoySklad()
	}

	@Post('/moysklad/test-connection')
	@ApiOperation({ summary: 'Проверить подключение к MoySklad' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: MoySkladTestConnectionDto })
	async testMoySkladConnection(@Body() dto: TestMoySkladConnectionDtoReq) {
		return this.integrationService.testMoySkladConnection(dto)
	}

	@Post('/moysklad/sync')
	@ApiOperation({ summary: 'Поставить полный sync MoySklad в очередь' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: MoySkladQueuedSyncDto })
	async syncMoySkladCatalog() {
		return this.integrationService.syncMoySkladCatalog()
	}

	@Post('/moysklad/sync-product/:id')
	@ApiOperation({ summary: 'Поставить sync одного товара MoySklad в очередь' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiParam({
		name: 'id',
		description: 'ID локального товара'
	})
	@ApiOkResponse({ type: MoySkladQueuedSyncDto })
	async syncMoySkladProduct(@Param('id') id: string) {
		return this.integrationService.syncMoySkladProduct(id)
	}

	@Post('/moysklad/sync-stock')
	@ApiOperation({
		summary: 'Поставить sync остатков MoySklad в очередь'
	})
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: MoySkladQueuedSyncDto })
	async syncMoySkladStock() {
		return this.integrationService.syncMoySkladStock()
	}

	@Post('/webhooks/moysklad/stock/:integrationId/:secret')
	@Public()
	@SkipCatalog()
	@HttpCode(204)
	@ApiOperation({ summary: 'Receive MoySklad stock webhook' })
	@ApiParam({ name: 'integrationId' })
	@ApiParam({ name: 'secret' })
	@ApiQuery({ name: 'requestId', required: false, type: String })
	async receiveMoySkladStockWebhook(
		@Param('integrationId') integrationId: string,
		@Param('secret') secret: string,
		@Query('requestId') requestId: string | string[] | undefined,
		@Body() payload: unknown
	): Promise<void> {
		await this.integrationService.receiveMoySkladStockWebhook({
			integrationId,
			secret,
			requestId,
			payload
		})
	}

	@Post('/webhooks/moysklad/product-delete/:integrationId/:secret')
	@Public()
	@SkipCatalog()
	@HttpCode(204)
	@ApiOperation({ summary: 'Receive MoySklad product delete webhook' })
	@ApiParam({ name: 'integrationId' })
	@ApiParam({ name: 'secret' })
	async receiveMoySkladProductDeleteWebhook(
		@Param('integrationId') integrationId: string,
		@Param('secret') secret: string,
		@Body() payload: unknown
	): Promise<void> {
		await this.integrationService.receiveMoySkladProductDeleteWebhook({
			integrationId,
			secret,
			payload
		})
	}

	@Post('/webhooks/moysklad/product-change/:integrationId/:secret')
	@Public()
	@SkipCatalog()
	@HttpCode(204)
	@ApiOperation({ summary: 'Receive MoySklad product change webhook' })
	@ApiParam({ name: 'integrationId' })
	@ApiParam({ name: 'secret' })
	async receiveMoySkladProductChangeWebhook(
		@Param('integrationId') integrationId: string,
		@Param('secret') secret: string,
		@Body() payload: unknown
	): Promise<void> {
		await this.integrationService.receiveMoySkladProductChangeWebhook({
			integrationId,
			secret,
			payload
		})
	}

	@Post('/webhooks/moysklad/productfolder/:integrationId/:secret')
	@Public()
	@SkipCatalog()
	@HttpCode(204)
	@ApiOperation({ summary: 'Receive MoySklad product folder webhook' })
	@ApiParam({ name: 'integrationId' })
	@ApiParam({ name: 'secret' })
	async receiveMoySkladProductFolderWebhook(
		@Param('integrationId') integrationId: string,
		@Param('secret') secret: string,
		@Body() payload: unknown
	): Promise<void> {
		await this.integrationService.receiveMoySkladProductFolderWebhook({
			integrationId,
			secret,
			payload
		})
	}

	@Post('/webhooks/iiko/:integrationId/:secret')
	@Public()
	@SkipCatalog()
	@HttpCode(204)
	@ApiOperation({ summary: 'Receive iikoCloud webhook' })
	@ApiParam({ name: 'integrationId' })
	@ApiParam({ name: 'secret' })
	async receiveIikoWebhook(
		@Param('integrationId') integrationId: string,
		@Param('secret') secret: string,
		@Headers() headers: Record<string, unknown>,
		@Body() payload: unknown
	): Promise<void> {
		await this.integrationService.receiveIikoWebhook({
			integrationId,
			secret,
			headers,
			payload
		})
	}

	@Post('/moysklad/order-exports/:id/retry')
	@ApiOperation({
		summary: 'Повторно поставить экспорт заказа MoySklad в очередь'
	})
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiParam({
		name: 'id',
		description: 'ID записи IntegrationOrderExport'
	})
	@ApiOkResponse({ type: MoySkladQueuedOrderExportDto })
	async retryMoySkladOrderExport(
		@Param('id') id: string,
		@Req() req: AuthRequest
	) {
		return this.integrationService.retryMoySkladOrderExport(id, req)
	}

	@Post('/iiko/order-exports/:id/retry')
	@ApiOperation({ summary: 'Queue iiko order export retry' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiParam({
		name: 'id',
		description: 'IntegrationOrderExport record id'
	})
	@ApiOkResponse({ type: IikoQueuedOrderExportDto })
	async retryIikoOrderExport(@Param('id') id: string, @Req() req: AuthRequest) {
		return this.integrationService.retryIikoOrderExport(id, req)
	}

	@Get('/iiko/orders/:orderId/export-timeline')
	@ApiOperation({ summary: 'Get iiko order export timeline by order id' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiParam({ name: 'orderId' })
	@ApiOkResponse({ type: IikoOrderExportTimelineDto })
	async getIikoOrderExportTimeline(@Param('orderId') orderId: string) {
		return this.integrationService.getIikoOrderExportTimeline(orderId)
	}

	@Delete('/moysklad/sync')
	@ApiOperation({ summary: 'Отменить текущий sync MoySklad' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOkResponse({ type: OkResponseDto })
	async cancelMoySkladSync() {
		await this.integrationService.cancelMoySkladSync()
		return { ok: true }
	}
}

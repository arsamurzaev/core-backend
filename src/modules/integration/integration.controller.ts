import { Role } from '@generated/enums'
import {
	Body,
	Controller,
	Delete,
	Get,
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

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { Public } from '@/shared/http/decorators/public.decorator'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { SessionGuard } from '../auth/guards/session.guard'
import type { AuthRequest } from '../auth/types/auth-request'

import { ApplyMoySkladMappingDtoReq } from './dto/requests/apply-moysklad-mapping.dto.req'
import { TestMoySkladConnectionDtoReq } from './dto/requests/test-moysklad-connection.dto.req'
import { UpdateMoySkladIntegrationDtoReq } from './dto/requests/update-moysklad-integration.dto.req'
import { UpsertMoySkladIntegrationDtoReq } from './dto/requests/upsert-moysklad-integration.dto.req'
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
	constructor(private readonly integrationService: IntegrationService) {}

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
		summary: 'РџРѕСЃС‚Р°РІРёС‚СЊ sync РѕСЃС‚Р°С‚РєРѕРІ MoySklad РІ РѕС‡РµСЂРµРґСЊ'
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

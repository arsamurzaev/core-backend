import { Role } from '@generated/enums'
import {
	BadRequestException,
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
	ApiCreatedResponse,
	ApiOkResponse,
	ApiOperation,
	ApiParam,
	ApiQuery,
	ApiSecurity,
	ApiTags,
	ApiUnauthorizedResponse
} from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import type { Request } from 'express'

import { Roles } from '@/modules/auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '@/modules/auth/guards/catalog-access.guard'
import { SessionGuard } from '@/modules/auth/guards/session.guard'
import {
	AuthSessionsResponseDto,
	ChangePasswordDtoReq
} from '@/modules/auth/public'
import type { AuthRequest } from '@/modules/auth/types/auth-request'
import {
	CatalogSaleUnitDto,
	CreateCatalogSaleUnitDtoReq,
	UpdateCatalogSaleUnitDtoReq
} from '@/modules/catalog-sale-unit/public'
import {
	IikoImportPreviewDto,
	IikoIntegrationDto,
	IikoIntegrationStatusDto,
	IikoQueuedSyncDto,
	IikoSyncProgressDto,
	IikoSyncRunDto,
	IikoTestConnectionDto,
	IikoWebhookEventDto,
	IikoWebhookSetupDto,
	MoySkladIntegrationDto,
	MoySkladIntegrationStatusDto,
	MoySkladOrderExportRefsDto,
	MoySkladQueuedSyncDto,
	MoySkladSyncProgressDto,
	MoySkladSyncRunDto,
	MoySkladTestConnectionDto,
	PreviewIikoImportDtoReq,
	TestIikoConnectionDtoReq,
	TestMoySkladConnectionDtoReq,
	UpdateIikoIntegrationDtoReq,
	UpdateMoySkladIntegrationDtoReq,
	UpsertIikoIntegrationDtoReq,
	UpsertMoySkladIntegrationDtoReq
} from '@/modules/integration/public'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

import { CatalogAdvancedSettingsService } from './catalog-advanced-settings.service'
import { CreateCatalogDomainDtoReq } from './dto/requests/create-catalog-domain.dto.req'
import { UpdateCatalogYandexMetrikaDtoReq } from './dto/requests/update-catalog-yandex-metrika.dto.req'
import {
	CatalogDomainCheckDto,
	CatalogDomainDto
} from './dto/responses/catalog-domain.dto.res'
import { CatalogYandexMetrikaDto } from './dto/responses/catalog-yandex-metrika.dto.res'

@ApiTags('Catalog advanced settings')
@ApiSecurity('csrf')
@Roles(Role.CATALOG)
@UseGuards(SessionGuard, CatalogAccessGuard)
@Controller('catalog/current/advanced-settings')
export class CatalogAdvancedSettingsController {
	constructor(private readonly service: CatalogAdvancedSettingsService) {}

	@Post('password')
	@SkipThrottle()
	@ApiOperation({ summary: 'Change current catalog advanced settings password' })
	@ApiOkResponse({ description: 'Пароль изменён', type: OkResponseDto })
	@ApiUnauthorizedResponse({ description: 'Не авторизован или неверный пароль' })
	async changePassword(@Body() dto: ChangePasswordDtoReq, @Req() req: Request) {
		const authReq = req as AuthRequest
		await this.service.changePassword({
			dto,
			sessionId: authReq.sessionId ?? null,
			userId: authReq.user.id
		})
		return { ok: true }
	}

	@Get('sessions')
	@SkipThrottle()
	@ApiOperation({ summary: 'List current catalog advanced settings sessions' })
	@ApiOkResponse({ type: AuthSessionsResponseDto })
	@ApiUnauthorizedResponse({ description: 'Не авторизован' })
	listSessions(@Req() req: Request): Promise<AuthSessionsResponseDto> {
		const authReq = req as AuthRequest
		return this.service.listSessions({
			currentSessionId: authReq.sessionId ?? null,
			userId: authReq.user.id
		})
	}

	@Post('sessions/revoke-others')
	@SkipThrottle()
	@ApiOperation({ summary: 'Revoke other catalog advanced settings sessions' })
	@ApiOkResponse({ type: OkResponseDto })
	@ApiUnauthorizedResponse({ description: 'Не авторизован' })
	revokeOtherSessions(@Req() req: Request): Promise<OkResponseDto> {
		const authReq = req as AuthRequest
		return this.service.revokeOtherSessions({
			currentSessionId: authReq.sessionId ?? null,
			userId: authReq.user.id
		})
	}

	@Post('sessions/:sid/revoke')
	@SkipThrottle()
	@ApiOperation({ summary: 'Revoke catalog advanced settings session' })
	@ApiParam({ name: 'sid', description: 'Session ID' })
	@ApiOkResponse({ type: OkResponseDto })
	@ApiUnauthorizedResponse({ description: 'Не авторизован' })
	revokeSession(
		@Param('sid') sid: string,
		@Req() req: Request
	): Promise<OkResponseDto> {
		const authReq = req as AuthRequest
		return this.service.revokeSession({
			currentSessionId: authReq.sessionId ?? null,
			sid,
			userId: authReq.user.id
		})
	}

	@Get('domains')
	@ApiOperation({ summary: 'List current catalog advanced settings domains' })
	@ApiOkResponse({ type: CatalogDomainDto, isArray: true })
	listDomains(): Promise<CatalogDomainDto[]> {
		return this.service.listDomains()
	}

	@Post('domains')
	@ApiOperation({
		summary: 'Attach advanced settings domain to current catalog'
	})
	@ApiCreatedResponse({ type: CatalogDomainDto })
	createDomain(
		@Body() dto: CreateCatalogDomainDtoReq
	): Promise<CatalogDomainDto> {
		return this.service.createDomain(dto)
	}

	@Post('domains/:id/check')
	@ApiOperation({ summary: 'Check advanced settings catalog domain DNS' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: CatalogDomainCheckDto })
	checkDomain(@Param('id') id: string): Promise<CatalogDomainCheckDto> {
		return this.service.checkDomain(id)
	}

	@Delete('domains/:id')
	@HttpCode(200)
	@ApiOperation({ summary: 'Disable advanced settings catalog domain' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: CatalogDomainDto })
	disableDomain(@Param('id') id: string): Promise<CatalogDomainDto> {
		return this.service.disableDomain(id)
	}

	@Get('sale-units')
	@ApiOperation({
		summary: 'List advanced settings catalog sale units'
	})
	@ApiQuery({
		name: 'includeInactive',
		required: false,
		schema: { type: 'boolean' },
		description: 'Include disabled, non-archived units.'
	})
	@ApiQuery({
		name: 'includeArchived',
		required: false,
		schema: { type: 'boolean' },
		description: 'Include archived units.'
	})
	@ApiOkResponse({ type: CatalogSaleUnitDto, isArray: true })
	listSaleUnits(
		@Query('includeInactive') includeInactive?: string,
		@Query('includeArchived') includeArchived?: string
	) {
		return this.service.listSaleUnits({
			includeInactive: this.parseBooleanQuery(includeInactive, 'includeInactive'),
			includeArchived: this.parseBooleanQuery(includeArchived, 'includeArchived')
		})
	}

	@Get('sale-units/:id')
	@ApiOperation({
		summary: 'Get advanced settings catalog sale unit'
	})
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: CatalogSaleUnitDto })
	getSaleUnit(@Param('id') id: string) {
		return this.service.getSaleUnit(id)
	}

	@Post('sale-units')
	@ApiOperation({
		summary: 'Create advanced settings catalog sale unit'
	})
	@ApiCreatedResponse({ type: CatalogSaleUnitDto })
	createSaleUnit(@Body() dto: CreateCatalogSaleUnitDtoReq) {
		return this.service.createSaleUnit(dto)
	}

	@Patch('sale-units/:id')
	@ApiOperation({
		summary: 'Update advanced settings catalog sale unit'
	})
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: CatalogSaleUnitDto })
	updateSaleUnit(
		@Param('id') id: string,
		@Body() dto: UpdateCatalogSaleUnitDtoReq
	) {
		return this.service.updateSaleUnit(id, dto)
	}

	@Delete('sale-units/:id')
	@HttpCode(200)
	@ApiOperation({
		summary: 'Archive advanced settings catalog sale unit'
	})
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: OkResponseDto })
	archiveSaleUnit(@Param('id') id: string): Promise<OkResponseDto> {
		return this.service.archiveSaleUnit(id)
	}

	@Get('metrics/yandex/catalog')
	@ApiOperation({ summary: 'Get catalog scoped Yandex Metrika counter' })
	@ApiOkResponse({ type: CatalogYandexMetrikaDto })
	getYandexMetrika(): Promise<CatalogYandexMetrikaDto> {
		return this.service.getYandexMetrika()
	}

	@Put('metrics/yandex/catalog')
	@ApiOperation({ summary: 'Set catalog scoped Yandex Metrika counter' })
	@ApiOkResponse({ type: CatalogYandexMetrikaDto })
	updateYandexMetrika(
		@Body() dto: UpdateCatalogYandexMetrikaDtoReq
	): Promise<CatalogYandexMetrikaDto> {
		return this.service.updateYandexMetrika(dto)
	}

	@Delete('metrics/yandex/catalog')
	@HttpCode(200)
	@ApiOperation({ summary: 'Remove catalog scoped Yandex Metrika counter' })
	@ApiOkResponse({ type: OkResponseDto })
	deleteYandexMetrika(): Promise<OkResponseDto> {
		return this.service.deleteYandexMetrika()
	}

	@Get('integrations/moysklad')
	@ApiOperation({ summary: 'Get advanced settings MoySklad integration' })
	@ApiOkResponse({ type: MoySkladIntegrationDto })
	getMoySklad(): Promise<MoySkladIntegrationDto> {
		return this.service.getMoySklad()
	}

	@Get('integrations/moysklad/status')
	@ApiOperation({ summary: 'Get advanced settings MoySklad status' })
	@ApiOkResponse({ type: MoySkladIntegrationStatusDto })
	getMoySkladStatus(): Promise<MoySkladIntegrationStatusDto> {
		return this.service.getMoySkladStatus()
	}

	@Get('integrations/moysklad/runs')
	@ApiOperation({ summary: 'Get advanced settings MoySklad sync history' })
	@ApiQuery({
		name: 'limit',
		required: false,
		type: Number,
		description: 'Сколько последних запусков вернуть'
	})
	@ApiOkResponse({ type: MoySkladSyncRunDto, isArray: true })
	getMoySkladRuns(
		@Query('limit') limit?: number
	): Promise<MoySkladSyncRunDto[]> {
		return this.service.getMoySkladRuns(limit)
	}

	@Get('integrations/moysklad/runs/:runId/progress')
	@ApiOperation({
		summary: 'Get advanced settings MoySklad sync progress'
	})
	@ApiParam({ name: 'runId' })
	@ApiOkResponse({ type: MoySkladSyncProgressDto })
	getMoySkladRunProgress(
		@Param('runId') runId: string
	): Promise<MoySkladSyncProgressDto> {
		return this.service.getMoySkladRunProgress(runId)
	}

	@Get('integrations/moysklad/order-export-refs')
	@ApiOperation({
		summary: 'Get advanced settings MoySklad order export refs'
	})
	@ApiOkResponse({ type: MoySkladOrderExportRefsDto })
	getMoySkladOrderExportRefs(): Promise<MoySkladOrderExportRefsDto> {
		return this.service.getMoySkladOrderExportRefs()
	}

	@Put('integrations/moysklad')
	@ApiOperation({ summary: 'Create or replace advanced settings MoySklad' })
	@ApiOkResponse({ type: MoySkladIntegrationDto })
	upsertMoySklad(
		@Body() dto: UpsertMoySkladIntegrationDtoReq
	): Promise<MoySkladIntegrationDto> {
		return this.service.upsertMoySklad(dto)
	}

	@Patch('integrations/moysklad')
	@ApiOperation({ summary: 'Update advanced settings MoySklad' })
	@ApiOkResponse({ type: MoySkladIntegrationDto })
	updateMoySklad(
		@Body() dto: UpdateMoySkladIntegrationDtoReq
	): Promise<MoySkladIntegrationDto> {
		return this.service.updateMoySklad(dto)
	}

	@Delete('integrations/moysklad')
	@ApiOperation({ summary: 'Remove advanced settings MoySklad' })
	@ApiOkResponse({ type: OkResponseDto })
	removeMoySklad(): Promise<OkResponseDto> {
		return this.service.removeMoySklad()
	}

	@Post('integrations/moysklad/test-connection')
	@ApiOperation({ summary: 'Test advanced settings MoySklad connection' })
	@ApiOkResponse({ type: MoySkladTestConnectionDto })
	testMoySkladConnection(
		@Body() dto: TestMoySkladConnectionDtoReq
	): Promise<MoySkladTestConnectionDto> {
		return this.service.testMoySkladConnection(dto)
	}

	@Post('integrations/moysklad/sync')
	@ApiOperation({ summary: 'Queue advanced settings MoySklad full sync' })
	@ApiOkResponse({ type: MoySkladQueuedSyncDto })
	syncMoySkladCatalog(): Promise<MoySkladQueuedSyncDto> {
		return this.service.syncMoySkladCatalog()
	}

	@Delete('integrations/moysklad/sync')
	@ApiOperation({ summary: 'Cancel advanced settings MoySklad sync' })
	@ApiOkResponse({ type: OkResponseDto })
	cancelMoySkladSync(): Promise<OkResponseDto> {
		return this.service.cancelMoySkladSync()
	}

	@Get('integrations/iiko')
	@ApiOperation({ summary: 'Get advanced settings iiko integration' })
	@ApiOkResponse({ type: IikoIntegrationDto })
	getIiko(): Promise<IikoIntegrationDto> {
		return this.service.getIiko()
	}

	@Get('integrations/iiko/status')
	@ApiOperation({ summary: 'Get advanced settings iiko status' })
	@ApiOkResponse({ type: IikoIntegrationStatusDto })
	getIikoStatus(): Promise<IikoIntegrationStatusDto> {
		return this.service.getIikoStatus()
	}

	@Get('integrations/iiko/runs')
	@ApiOperation({ summary: 'Get advanced settings iiko sync history' })
	@ApiQuery({
		name: 'limit',
		required: false,
		type: Number,
		description: 'How many recent sync runs to return'
	})
	@ApiOkResponse({ type: IikoSyncRunDto, isArray: true })
	getIikoRuns(@Query('limit') limit?: number): Promise<IikoSyncRunDto[]> {
		return this.service.getIikoRuns(limit)
	}

	@Get('integrations/iiko/webhook-events')
	@ApiOperation({ summary: 'Get advanced settings iiko webhook journal' })
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
	getIikoWebhookEvents(
		@Query('limit') limit?: number,
		@Query('status') status?: string
	): Promise<IikoWebhookEventDto[]> {
		return this.service.getIikoWebhookEvents(limit, status)
	}

	@Post('integrations/iiko/webhook-events/:eventId/retry')
	@ApiOperation({ summary: 'Retry advanced settings iiko webhook event' })
	@ApiParam({ name: 'eventId' })
	@ApiOkResponse({ type: IikoWebhookEventDto })
	retryIikoWebhookEvent(
		@Param('eventId') eventId: string
	): Promise<IikoWebhookEventDto> {
		return this.service.retryIikoWebhookEvent(eventId)
	}

	@Get('integrations/iiko/runs/:runId/progress')
	@ApiOperation({ summary: 'Get advanced settings iiko sync progress' })
	@ApiParam({ name: 'runId' })
	@ApiOkResponse({ type: IikoSyncProgressDto })
	getIikoRunProgress(
		@Param('runId') runId: string
	): Promise<IikoSyncProgressDto> {
		return this.service.getIikoRunProgress(runId)
	}

	@Put('integrations/iiko')
	@ApiOperation({ summary: 'Create or replace advanced settings iiko' })
	@ApiOkResponse({ type: IikoIntegrationDto })
	upsertIiko(
		@Body() dto: UpsertIikoIntegrationDtoReq
	): Promise<IikoIntegrationDto> {
		return this.service.upsertIiko(dto)
	}

	@Patch('integrations/iiko')
	@ApiOperation({ summary: 'Update advanced settings iiko' })
	@ApiOkResponse({ type: IikoIntegrationDto })
	updateIiko(
		@Body() dto: UpdateIikoIntegrationDtoReq
	): Promise<IikoIntegrationDto> {
		return this.service.updateIiko(dto)
	}

	@Delete('integrations/iiko')
	@ApiOperation({ summary: 'Remove advanced settings iiko' })
	@ApiOkResponse({ type: OkResponseDto })
	removeIiko(): Promise<OkResponseDto> {
		return this.service.removeIiko()
	}

	@Post('integrations/iiko/test-connection')
	@ApiOperation({ summary: 'Test advanced settings iiko connection' })
	@ApiOkResponse({ type: IikoTestConnectionDto })
	testIikoConnection(
		@Body() dto: TestIikoConnectionDtoReq
	): Promise<IikoTestConnectionDto> {
		return this.service.testIikoConnection(dto)
	}

	@Post('integrations/iiko/import-preview')
	@ApiOperation({
		summary: 'Preview advanced settings iiko external menu import'
	})
	@ApiOkResponse({ type: IikoImportPreviewDto })
	previewIikoImport(
		@Body() dto: PreviewIikoImportDtoReq
	): Promise<IikoImportPreviewDto> {
		return this.service.previewIikoImport(dto)
	}

	@Post('integrations/iiko/sync')
	@ApiOperation({ summary: 'Queue advanced settings iiko full menu sync' })
	@ApiOkResponse({ type: IikoQueuedSyncDto })
	syncIikoCatalog(): Promise<IikoQueuedSyncDto> {
		return this.service.syncIikoCatalog()
	}

	@Post('integrations/iiko/stock-sync')
	@ApiOperation({ summary: 'Queue advanced settings iiko stop-list sync' })
	@ApiOkResponse({ type: IikoQueuedSyncDto })
	syncIikoStock(): Promise<IikoQueuedSyncDto> {
		return this.service.syncIikoStock()
	}

	@Post('integrations/iiko/sync-product/:id')
	@ApiOperation({ summary: 'Queue advanced settings iiko product sync' })
	@ApiParam({
		name: 'id',
		description: 'Local product ID'
	})
	@ApiOkResponse({ type: IikoQueuedSyncDto })
	syncIikoProduct(@Param('id') id: string): Promise<IikoQueuedSyncDto> {
		return this.service.syncIikoProduct(id)
	}

	@Post('integrations/iiko/webhooks/setup')
	@ApiOperation({ summary: 'Register advanced settings iiko webhooks' })
	@ApiOkResponse({ type: IikoWebhookSetupDto })
	setupIikoWebhooks(): Promise<IikoWebhookSetupDto> {
		return this.service.setupIikoWebhooks()
	}

	@Delete('integrations/iiko/webhooks')
	@ApiOperation({ summary: 'Disable advanced settings iiko webhooks locally' })
	@ApiOkResponse({ type: OkResponseDto })
	disableIikoWebhooks(): Promise<OkResponseDto> {
		return this.service.disableIikoWebhooks()
	}

	private parseBooleanQuery(value: string | undefined, name: string): boolean {
		if (!value) return false
		const normalized = value.trim().toLowerCase()
		if (['1', 'true', 'yes'].includes(normalized)) return true
		if (['0', 'false', 'no'].includes(normalized)) return false
		throw new BadRequestException(`${name} must be a boolean value`)
	}
}

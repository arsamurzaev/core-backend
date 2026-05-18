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
	MoySkladIntegrationDto,
	MoySkladIntegrationStatusDto,
	MoySkladOrderExportRefsDto,
	MoySkladQueuedSyncDto,
	MoySkladSyncProgressDto,
	MoySkladSyncRunDto,
	MoySkladTestConnectionDto,
	TestMoySkladConnectionDtoReq,
	UpdateMoySkladIntegrationDtoReq,
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
}

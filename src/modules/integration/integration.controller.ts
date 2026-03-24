import { Role } from '@generated/enums'
import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Put,
	Query,
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

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { SessionGuard } from '../auth/guards/session.guard'

import { TestMoySkladConnectionDtoReq } from './dto/requests/test-moysklad-connection.dto.req'
import { UpdateMoySkladIntegrationDtoReq } from './dto/requests/update-moysklad-integration.dto.req'
import { UpsertMoySkladIntegrationDtoReq } from './dto/requests/upsert-moysklad-integration.dto.req'
import {
	MoySkladIntegrationDto,
	MoySkladIntegrationStatusDto,
	MoySkladQueuedSyncDto,
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
	async getMoySkladRuns(@Query('limit') limit?: number) {
		return this.integrationService.getMoySkladRuns(limit)
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

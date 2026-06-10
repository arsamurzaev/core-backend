import { Role } from '@generated/enums'
import {
	BadRequestException,
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
	ApiBadRequestResponse,
	ApiCreatedResponse,
	ApiForbiddenResponse,
	ApiNotFoundResponse,
	ApiOkResponse,
	ApiOperation,
	ApiParam,
	ApiQuery,
	ApiSecurity,
	ApiTags
} from '@nestjs/swagger'

import { Roles } from '@/modules/auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '@/modules/auth/guards/catalog-access.guard'
import { SessionGuard } from '@/modules/auth/guards/session.guard'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

import { CatalogPriceListService } from './catalog-price-list.service'
import { BulkUpsertCatalogPriceListPricesDtoReq } from './dto/requests/catalog-price-list-price.dto.req'
import {
	CreateCatalogPriceListDtoReq,
	UpdateCatalogPriceListDtoReq
} from './dto/requests/catalog-price-list.dto.req'
import { SetActivePriceListDtoReq } from './dto/requests/set-active-price-list.dto.req'
import {
	ActiveCatalogPriceListDto,
	CatalogPriceListDto,
	CatalogPriceListPriceDto
} from './dto/responses/catalog-price-list.dto.res'

@ApiTags('CatalogPriceList')
@Controller()
@UseGuards(SessionGuard, CatalogAccessGuard)
@Roles(Role.CATALOG)
export class CatalogPriceListController {
	constructor(private readonly service: CatalogPriceListService) {}

	@Get('catalog-price-lists')
	@ApiOperation({ summary: 'Список прайс-листов текущего каталога' })
	@ApiQuery({ name: 'includeArchived', required: false })
	@ApiQuery({ name: 'includeInactive', required: false })
	@ApiOkResponse({ type: CatalogPriceListDto, isArray: true })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	getAll(
		@Query('includeArchived') includeArchived?: string,
		@Query('includeInactive') includeInactive?: string
	) {
		return this.service.getAll({
			includeArchived: this.parseBooleanQuery(includeArchived, 'includeArchived'),
			includeInactive: this.parseBooleanQuery(includeInactive, 'includeInactive')
		})
	}

	@Post('catalog-price-lists')
	@ApiSecurity('csrf')
	@ApiOperation({ summary: 'Создать прайс-лист в родительском каталоге' })
	@ApiCreatedResponse({ type: CatalogPriceListDto })
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	create(@Body() dto: CreateCatalogPriceListDtoReq) {
		return this.service.create(dto)
	}

	@Patch('catalog-price-lists/:id')
	@ApiSecurity('csrf')
	@ApiOperation({ summary: 'Обновить прайс-лист родительского каталога' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: CatalogPriceListDto })
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiNotFoundResponse({ description: 'Прайс-лист не найден' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	update(@Param('id') id: string, @Body() dto: UpdateCatalogPriceListDtoReq) {
		return this.service.update(id, dto)
	}

	@Delete('catalog-price-lists/:id')
	@ApiSecurity('csrf')
	@ApiOperation({ summary: 'Архивировать прайс-лист родительского каталога' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: OkResponseDto })
	@ApiNotFoundResponse({ description: 'Прайс-лист не найден' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	archive(@Param('id') id: string) {
		return this.service.archive(id)
	}

	@Get('catalog-price-lists/:id/prices')
	@ApiOperation({ summary: 'Список цен прайс-листа' })
	@ApiParam({ name: 'id' })
	@ApiQuery({ name: 'includeArchived', required: false })
	@ApiOkResponse({ type: CatalogPriceListPriceDto, isArray: true })
	@ApiNotFoundResponse({ description: 'Прайс-лист не найден' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	getPrices(
		@Param('id') id: string,
		@Query('includeArchived') includeArchived?: string
	) {
		return this.service.getPrices(
			id,
			this.parseBooleanQuery(includeArchived, 'includeArchived')
		)
	}

	@Put('catalog-price-lists/:id/prices/bulk')
	@ApiSecurity('csrf')
	@ApiOperation({ summary: 'Массово сохранить цены прайс-листа' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: CatalogPriceListPriceDto, isArray: true })
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiNotFoundResponse({ description: 'Прайс-лист не найден' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	bulkUpsertPrices(
		@Param('id') id: string,
		@Body() dto: BulkUpsertCatalogPriceListPricesDtoReq
	) {
		return this.service.bulkUpsertPrices(id, dto)
	}

	@Patch('catalog/settings/active-price-list')
	@ApiSecurity('csrf')
	@ApiOperation({ summary: 'Выбрать активный прайс-лист текущего каталога' })
	@ApiOkResponse({ type: ActiveCatalogPriceListDto })
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	setActivePriceList(@Body() dto: SetActivePriceListDtoReq) {
		return this.service.setActivePriceList(dto)
	}

	private parseBooleanQuery(value: string | undefined, name: string): boolean {
		if (!value) return false
		const normalized = value.trim().toLowerCase()
		if (['1', 'true', 'yes'].includes(normalized)) return true
		if (['0', 'false', 'no'].includes(normalized)) return false
		throw new BadRequestException(`Параметр ${name} должен быть булевым`)
	}
}

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
import { OptionalSessionGuard } from '@/modules/auth/guards/optional-session.guard'
import { SessionGuard } from '@/modules/auth/guards/session.guard'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

import { CatalogSaleUnitService } from './catalog-sale-unit.service'
import { CreateCatalogSaleUnitDtoReq } from './dto/requests/create-catalog-sale-unit.dto.req'
import { UpdateCatalogSaleUnitDtoReq } from './dto/requests/update-catalog-sale-unit.dto.req'
import { CatalogSaleUnitDto } from './dto/responses/catalog-sale-unit.dto.res'

@ApiTags('CatalogSaleUnit')
@Controller('catalog-sale-unit')
export class CatalogSaleUnitController {
	constructor(private readonly service: CatalogSaleUnitService) {}

	@Get()
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'Получить единицы продажи текущего каталога' })
	@ApiQuery({
		name: 'includeArchived',
		required: false,
		schema: { type: 'boolean' }
	})
	@ApiQuery({
		name: 'includeInactive',
		required: false,
		schema: { type: 'boolean' }
	})
	@ApiOkResponse({ type: CatalogSaleUnitDto, isArray: true })
	getAll(
		@Query('includeArchived') includeArchived?: string,
		@Query('includeInactive') includeInactive?: string
	) {
		return this.service.getAll({
			includeArchived: this.parseBooleanQuery(includeArchived, 'includeArchived'),
			includeInactive: this.parseBooleanQuery(includeInactive, 'includeInactive')
		})
	}

	@Get('/:id')
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'Получить единицу продажи текущего каталога' })
	@ApiParam({ name: 'id', description: 'ID единицы продажи' })
	@ApiOkResponse({ type: CatalogSaleUnitDto })
	@ApiNotFoundResponse({ description: 'Единица продажи не найдена' })
	getById(@Param('id') id: string) {
		return this.service.getById(id)
	}

	@Post()
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Создать единицу продажи текущего каталога' })
	@ApiCreatedResponse({ type: CatalogSaleUnitDto })
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	create(@Body() dto: CreateCatalogSaleUnitDtoReq) {
		return this.service.create(dto)
	}

	@Patch('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Обновить единицу продажи текущего каталога' })
	@ApiParam({ name: 'id', description: 'ID единицы продажи' })
	@ApiOkResponse({ type: CatalogSaleUnitDto })
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiNotFoundResponse({ description: 'Единица продажи не найдена' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	update(@Param('id') id: string, @Body() dto: UpdateCatalogSaleUnitDtoReq) {
		return this.service.update(id, dto)
	}

	@Delete('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Архивировать единицу продажи текущего каталога' })
	@ApiParam({ name: 'id', description: 'ID единицы продажи' })
	@ApiOkResponse({ type: OkResponseDto })
	@ApiNotFoundResponse({ description: 'Единица продажи не найдена' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	archive(@Param('id') id: string) {
		return this.service.archive(id)
	}

	private parseBooleanQuery(value: string | undefined, name: string): boolean {
		if (!value) return false
		const normalized = value.trim().toLowerCase()
		if (['1', 'true', 'yes'].includes(normalized)) return true
		if (['0', 'false', 'no'].includes(normalized)) return false
		throw new BadRequestException(`Параметр ${name} должен быть boolean`)
	}
}

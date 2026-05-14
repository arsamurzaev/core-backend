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
	@ApiOperation({ summary: 'List current catalog sale units' })
	@ApiQuery({
		name: 'includeArchived',
		required: false,
		schema: { type: 'boolean' }
	})
	@ApiOkResponse({ type: CatalogSaleUnitDto, isArray: true })
	getAll(@Query('includeArchived') includeArchived?: string) {
		return this.service.getAll({
			includeArchived: this.parseBooleanQuery(includeArchived)
		})
	}

	@Get('/:id')
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'Get current catalog sale unit' })
	@ApiParam({ name: 'id', description: 'Catalog sale unit ID' })
	@ApiOkResponse({ type: CatalogSaleUnitDto })
	@ApiNotFoundResponse({ description: 'Sale unit not found' })
	getById(@Param('id') id: string) {
		return this.service.getById(id)
	}

	@Post()
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Create current catalog sale unit' })
	@ApiCreatedResponse({ type: CatalogSaleUnitDto })
	@ApiBadRequestResponse({ description: 'Validation error' })
	@ApiForbiddenResponse({ description: 'Forbidden' })
	create(@Body() dto: CreateCatalogSaleUnitDtoReq) {
		return this.service.create(dto)
	}

	@Patch('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Update current catalog sale unit' })
	@ApiParam({ name: 'id', description: 'Catalog sale unit ID' })
	@ApiOkResponse({ type: CatalogSaleUnitDto })
	@ApiBadRequestResponse({ description: 'Validation error' })
	@ApiNotFoundResponse({ description: 'Sale unit not found' })
	@ApiForbiddenResponse({ description: 'Forbidden' })
	update(@Param('id') id: string, @Body() dto: UpdateCatalogSaleUnitDtoReq) {
		return this.service.update(id, dto)
	}

	@Delete('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Archive current catalog sale unit' })
	@ApiParam({ name: 'id', description: 'Catalog sale unit ID' })
	@ApiOkResponse({ type: OkResponseDto })
	@ApiNotFoundResponse({ description: 'Sale unit not found' })
	@ApiForbiddenResponse({ description: 'Forbidden' })
	archive(@Param('id') id: string) {
		return this.service.archive(id)
	}

	private parseBooleanQuery(value?: string): boolean {
		if (!value) return false
		const normalized = value.trim().toLowerCase()
		if (['1', 'true', 'yes'].includes(normalized)) return true
		if (['0', 'false', 'no'].includes(normalized)) return false
		throw new BadRequestException('includeArchived must be a boolean value')
	}
}

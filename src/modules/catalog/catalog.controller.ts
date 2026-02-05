import { Role } from '@generated/enums'
import {
	Body,
	Controller,
	Get,
	Param,
	Patch,
	Post,
	UseGuards
} from '@nestjs/common'
import {
	ApiCreatedResponse,
	ApiOkResponse,
	ApiOperation,
	ApiParam,
	ApiSecurity,
	ApiTags
} from '@nestjs/swagger'

import { Public } from '@/shared/http/decorators/public.decorator'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { SessionGuard } from '../auth/guards/session.guard'

import { CatalogService } from './catalog.service'
import { CreateCatalogDtoReq } from './dto/requests/create-catalog.dto.req'
import { UpdateCatalogDtoReq } from './dto/requests/update-catalog.dto.req'
import {
	CatalogCreateResponseDto,
	CatalogDto
} from './dto/responses/catalog.dto.res'

@ApiTags('Catalog')
@ApiSecurity('csrf')
@UseGuards(SessionGuard)
@Controller('catalog')
export class CatalogController {
	constructor(private readonly catalogService: CatalogService) {}

	@Get('/current')
	@ApiOperation({ summary: 'Get current catalog' })
	@Public()
	@ApiOkResponse({ type: CatalogDto })
	async getCurrent() {
		return this.catalogService.getCurrent()
	}

	@Patch('/current')
	@ApiOperation({ summary: 'Update current catalog' })
	@Roles(Role.CATALOG)
	@UseGuards(CatalogAccessGuard)
	@ApiOkResponse({ type: CatalogDto })
	async updateCurrent(@Body() dto: UpdateCatalogDtoReq) {
		return this.catalogService.updateCurrent(dto)
	}

	@Get()
	@ApiOperation({ summary: 'List catalogs' })
	@Roles(Role.ADMIN)
	@SkipCatalog()
	@ApiOkResponse({ type: CatalogDto, isArray: true })
	async getAll() {
		return this.catalogService.getAll()
	}

	@Get('/:id')
	@ApiOperation({ summary: 'Get catalog by id' })
	@ApiParam({
		name: 'id',
		description: 'Catalog id'
	})
	@Roles(Role.ADMIN)
	@SkipCatalog()
	@ApiOkResponse({ type: CatalogDto })
	async getById(@Param('id') id: string) {
		return this.catalogService.getById(id)
	}

	@Patch('/:id')
	@ApiOperation({ summary: 'Update catalog by id' })
	@ApiParam({
		name: 'id',
		description: 'Catalog id'
	})
	@Roles(Role.ADMIN)
	@SkipCatalog()
	@ApiOkResponse({ type: CatalogDto })
	async updateById(@Param('id') id: string, @Body() dto: UpdateCatalogDtoReq) {
		return this.catalogService.updateById(id, dto)
	}

	@Post()
	@ApiOperation({ summary: 'Create catalog' })
	@Roles(Role.ADMIN)
	@SkipCatalog()
	@ApiCreatedResponse({ type: CatalogCreateResponseDto })
	async create(@Body() dto: CreateCatalogDtoReq) {
		return this.catalogService.create(dto)
	}
}

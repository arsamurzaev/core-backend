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
import { ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger'

import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { SessionGuard } from '../auth/guards/session.guard'

import { CatalogService } from './catalog.service'
import { CreateCatalogDtoReq } from './dto/requests/create-catalog.dto.req'
import { UpdateCatalogDtoReq } from './dto/requests/update-catalog.dto.req'

@ApiTags('Catalog')
@ApiSecurity('csrf')
@UseGuards(SessionGuard)
@Controller('catalog')
export class CatalogController {
	constructor(private readonly catalogService: CatalogService) {}

	@Get('/current')
	@ApiOperation({ summary: 'Get current catalog' })
	@Roles(Role.CATALOG_OWNER)
	@UseGuards(CatalogAccessGuard)
	async getCurrent() {
		return this.catalogService.getCurrent()
	}

	@Patch('/current')
	@ApiOperation({ summary: 'Update current catalog' })
	@Roles(Role.CATALOG_OWNER)
	@UseGuards(CatalogAccessGuard)
	async updateCurrent(@Body() dto: UpdateCatalogDtoReq) {
		return this.catalogService.updateCurrent(dto)
	}

	@Get()
	@ApiOperation({ summary: 'List catalogs' })
	@Roles(Role.ADMIN)
	@SkipCatalog()
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
	async updateById(@Param('id') id: string, @Body() dto: UpdateCatalogDtoReq) {
		return this.catalogService.updateById(id, dto)
	}

	@Post()
	@ApiOperation({ summary: 'Create catalog' })
	@Roles(Role.ADMIN)
	@SkipCatalog()
	async create(@Body() dto: CreateCatalogDtoReq) {
		return this.catalogService.create(dto)
	}
}

import { Role } from '@generated/enums'
import {
	Body,
	Controller,
	Get,
	Param,
	Patch,
	Post,
	Res,
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
import type { Response } from 'express'

import {
	PUBLIC_CACHE_CONTROL_STANDARD,
	setPublicCacheHeaders
} from '@/shared/http/cache-control'
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
	CatalogCurrentDto,
	CatalogCurrentShellDto,
	CatalogDto,
	CatalogTypeDto
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
	@ApiOkResponse({ type: CatalogCurrentDto })
	async getCurrent(
		@Res({ passthrough: true }) res: Response
	): Promise<CatalogCurrentDto> {
		setPublicCacheHeaders(res, PUBLIC_CACHE_CONTROL_STANDARD)
		return this.catalogService.getCurrent() as Promise<CatalogCurrentDto>
	}

	@Get('/current/shell')
	@ApiOperation({ summary: 'Get current catalog shell' })
	@Public()
	@ApiOkResponse({ type: CatalogCurrentShellDto })
	async getCurrentShell(
		@Res({ passthrough: true }) res: Response
	): Promise<CatalogCurrentShellDto> {
		setPublicCacheHeaders(res, PUBLIC_CACHE_CONTROL_STANDARD)
		return this.catalogService.getCurrentShell() as Promise<CatalogCurrentShellDto>
	}

	@Get('/current/type-schema')
	@ApiOperation({ summary: 'Get current catalog type schema' })
	@Public()
	@ApiOkResponse({ type: CatalogTypeDto })
	async getCurrentTypeSchema(
		@Res({ passthrough: true }) res: Response
	): Promise<CatalogTypeDto> {
		setPublicCacheHeaders(res, PUBLIC_CACHE_CONTROL_STANDARD)
		return this.catalogService.getCurrentTypeSchema() as Promise<CatalogTypeDto>
	}

	@Patch('/current')
	@ApiOperation({ summary: 'Update current catalog' })
	@Roles(Role.CATALOG)
	@UseGuards(CatalogAccessGuard)
	@ApiOkResponse({ type: CatalogCurrentShellDto })
	async updateCurrent(
		@Body() dto: UpdateCatalogDtoReq
	): Promise<CatalogCurrentShellDto> {
		return this.catalogService.updateCurrent(dto) as Promise<CatalogCurrentShellDto>
	}

	@Get()
	@ApiOperation({ summary: 'List catalogs' })
	@Roles(Role.ADMIN)
	@SkipCatalog()
	@ApiOkResponse({ type: CatalogDto, isArray: true })
	async getAll(): Promise<CatalogDto[]> {
		return this.catalogService.getAll() as Promise<CatalogDto[]>
	}

	@Get('/:id')
	@ApiOperation({ summary: 'Get catalog by id' })
	@ApiParam({
		name: 'id',
		description: 'ID каталога'
	})
	@Roles(Role.ADMIN)
	@SkipCatalog()
	@ApiOkResponse({ type: CatalogDto })
	async getById(@Param('id') id: string): Promise<CatalogDto> {
		return this.catalogService.getById(id) as Promise<CatalogDto>
	}

	@Patch('/:id')
	@ApiOperation({ summary: 'Update catalog by id' })
	@ApiParam({
		name: 'id',
		description: 'ID каталога'
	})
	@Roles(Role.ADMIN)
	@SkipCatalog()
	@ApiOkResponse({ type: CatalogDto })
	async updateById(
		@Param('id') id: string,
		@Body() dto: UpdateCatalogDtoReq
	): Promise<CatalogDto> {
		return this.catalogService.updateById(id, dto) as Promise<CatalogDto>
	}

	@Post()
	@ApiOperation({ summary: 'Create catalog' })
	@Roles(Role.ADMIN)
	@SkipCatalog()
	@ApiCreatedResponse({ type: CatalogCreateResponseDto })
	async create(
		@Body() dto: CreateCatalogDtoReq
	): Promise<CatalogCreateResponseDto> {
		return this.catalogService.create(dto) as Promise<CatalogCreateResponseDto>
	}
}

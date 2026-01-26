import { Role, SeoEntityType } from '@generated/enums'
import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	UseGuards
} from '@nestjs/common'
import { ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger'

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { SessionGuard } from '../auth/guards/session.guard'

import { CreateSeoDtoReq } from './dto/requests/create-seo.dto.req'
import { UpdateSeoDtoReq } from './dto/requests/update-seo.dto.req'
import { SeoService } from './seo.service'

@ApiTags('Seo')
@Controller('seo')
export class SeoController {
	constructor(private readonly seoService: SeoService) {}

	@Get()
	@ApiOperation({ summary: 'List seo settings' })
	async getAll() {
		return this.seoService.getAll()
	}

	@Get('/entity/:entityType/:entityId')
	@ApiOperation({ summary: 'Get seo setting by entity' })
	@ApiParam({
		name: 'entityType',
		description: 'Entity type'
	})
	@ApiParam({
		name: 'entityId',
		description: 'Entity id'
	})
	async getByEntity(
		@Param('entityType') entityType: SeoEntityType,
		@Param('entityId') entityId: string
	) {
		return this.seoService.getByEntity(entityType, entityId)
	}

	@Get('/:id')
	@ApiOperation({ summary: 'Get seo setting by id' })
	@ApiParam({ name: 'id', description: 'Seo setting id' })
	async getById(@Param('id') id: string) {
		return this.seoService.getById(id)
	}

	@Post()
	@ApiOperation({ summary: 'Create seo setting' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG_OWNER)
	async create(@Body() dto: CreateSeoDtoReq) {
		return this.seoService.create(dto)
	}

	@Patch('/:id')
	@ApiOperation({ summary: 'Update seo setting' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG_OWNER)
	@ApiParam({ name: 'id', description: 'Seo setting id' })
	async update(@Param('id') id: string, @Body() dto: UpdateSeoDtoReq) {
		return this.seoService.update(id, dto)
	}

	@Delete('/:id')
	@ApiOperation({ summary: 'Delete seo setting' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG_OWNER)
	@ApiParam({ name: 'id', description: 'Seo setting id' })
	async remove(@Param('id') id: string) {
		return this.seoService.remove(id)
	}
}

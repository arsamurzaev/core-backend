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
import {
	ApiCreatedResponse,
	ApiOkResponse,
	ApiOperation,
	ApiParam,
	ApiSecurity,
	ApiTags
} from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { SessionGuard } from '../auth/guards/session.guard'

import { CreateSeoDtoReq } from './dto/requests/create-seo.dto.req'
import { UpdateSeoDtoReq } from './dto/requests/update-seo.dto.req'
import { SeoDto } from './dto/responses/seo.dto.res'
import { SeoService } from './seo.service'

@ApiTags('Seo')
@Controller('seo')
export class SeoController {
	constructor(private readonly seoService: SeoService) {}

	@Get()
	@ApiOperation({ summary: 'List seo settings' })
	@ApiOkResponse({ type: SeoDto, isArray: true })
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
	@ApiOkResponse({ type: SeoDto })
	async getByEntity(
		@Param('entityType') entityType: SeoEntityType,
		@Param('entityId') entityId: string
	) {
		return this.seoService.getByEntity(entityType, entityId)
	}

	@Get('/:id')
	@ApiOperation({ summary: 'Get seo setting by id' })
	@ApiParam({ name: 'id', description: 'Seo setting id' })
	@ApiOkResponse({ type: SeoDto })
	async getById(@Param('id') id: string) {
		return this.seoService.getById(id)
	}

	@Post()
	@ApiOperation({ summary: 'Create seo setting' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiCreatedResponse({ type: SeoDto })
	async create(@Body() dto: CreateSeoDtoReq) {
		return this.seoService.create(dto)
	}

	@Patch('/:id')
	@ApiOperation({ summary: 'Update seo setting' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiParam({ name: 'id', description: 'Seo setting id' })
	@ApiOkResponse({ type: SeoDto })
	async update(@Param('id') id: string, @Body() dto: UpdateSeoDtoReq) {
		return this.seoService.update(id, dto)
	}

	@Delete('/:id')
	@ApiOperation({ summary: 'Delete seo setting' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiParam({ name: 'id', description: 'Seo setting id' })
	@ApiOkResponse({ type: OkResponseDto })
	async remove(@Param('id') id: string) {
		return this.seoService.remove(id)
	}
}

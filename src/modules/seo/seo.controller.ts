import { Role, SeoEntityType } from '@generated/enums'
import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Req,
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

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import {
	PUBLIC_CACHE_CONTROL_SHORT,
	setUserAwarePublicCacheHeaders
} from '@/shared/http/cache-control'
import type { Response } from 'express'

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { OptionalSessionGuard } from '../auth/guards/optional-session.guard'
import { SessionGuard } from '../auth/guards/session.guard'
import type { AuthRequest } from '../auth/types/auth-request'

import { CreateSeoDtoReq } from './dto/requests/create-seo.dto.req'
import { UpdateSeoDtoReq } from './dto/requests/update-seo.dto.req'
import { SeoDto } from './dto/responses/seo.dto.res'
import { SeoService } from './seo.service'

@ApiTags('Seo')
@Controller('seo')
export class SeoController {
	constructor(private readonly seoService: SeoService) {}

	@Get()
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'List seo settings' })
	@ApiOkResponse({ type: SeoDto, isArray: true })
	async getAll(
		@Res({ passthrough: true }) res: Response,
		@Req() req: AuthRequest
	) {
		this.applyPublicReadCacheHeaders(res, req)
		return this.seoService.getAll()
	}

	@Get('/entity/:entityType/:entityId')
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'Get seo setting by entity' })
	@ApiParam({
		name: 'entityType',
		description: 'Тип сущности'
	})
	@ApiParam({
		name: 'entityId',
		description: 'ID сущности'
	})
	@ApiOkResponse({ type: SeoDto })
	async getByEntity(
		@Param('entityType') entityType: SeoEntityType,
		@Param('entityId') entityId: string,
		@Res({ passthrough: true }) res: Response,
		@Req() req: AuthRequest
	) {
		this.applyPublicReadCacheHeaders(res, req)
		return this.seoService.getByEntity(entityType, entityId)
	}

	@Get('/:id')
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'Get seo setting by id' })
	@ApiParam({ name: 'id', description: 'ID SEO-настройки' })
	@ApiOkResponse({ type: SeoDto })
	async getById(
		@Param('id') id: string,
		@Res({ passthrough: true }) res: Response,
		@Req() req: AuthRequest
	) {
		this.applyPublicReadCacheHeaders(res, req)
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
	@ApiParam({ name: 'id', description: 'ID SEO-настройки' })
	@ApiOkResponse({ type: SeoDto })
	async update(@Param('id') id: string, @Body() dto: UpdateSeoDtoReq) {
		return this.seoService.update(id, dto)
	}

	@Delete('/:id')
	@ApiOperation({ summary: 'Delete seo setting' })
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiParam({ name: 'id', description: 'ID SEO-настройки' })
	@ApiOkResponse({ type: OkResponseDto })
	async remove(@Param('id') id: string) {
		return this.seoService.remove(id)
	}

	private applyPublicReadCacheHeaders(
		res: Response,
		req?: Pick<AuthRequest, 'user'>
	): void {
		setUserAwarePublicCacheHeaders(res, {
			isPrivate: Boolean(req?.user),
			publicCacheControl: PUBLIC_CACHE_CONTROL_SHORT
		})
	}
}

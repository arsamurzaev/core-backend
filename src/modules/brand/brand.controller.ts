import { Role } from '@generated/enums'
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
	ApiBadRequestResponse,
	ApiCreatedResponse,
	ApiForbiddenResponse,
	ApiNotFoundResponse,
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

import { BrandService } from './brand.service'
import { CreateBrandDtoReq } from './dto/requests/create-brand.dto.req'
import { UpdateBrandDtoReq } from './dto/requests/update-brand.dto.req'
import { BrandDto } from './dto/responses/brand.dto.res'

@ApiTags('Brand')
@Controller('brand')
export class BrandController {
	constructor(private readonly brandService: BrandService) {}

	@Get()
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'List brands' })
	@ApiOkResponse({
		description: 'Список брендов',
		type: BrandDto,
		isArray: true
	})
	async getAll(
		@Res({ passthrough: true }) res: Response,
		@Req() req: AuthRequest
	) {
		this.applyPublicReadCacheHeaders(res, req)
		return this.brandService.getAll()
	}

	@Get('/:id')
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'Get brand by id' })
	@ApiParam({
		name: 'id',
		description: 'ID бренда'
	})
	@ApiOkResponse({
		description: 'Детали бренда',
		type: BrandDto
	})
	@ApiNotFoundResponse({ description: 'Бренд не найден' })
	async getById(
		@Param('id') id: string,
		@Res({ passthrough: true }) res: Response,
		@Req() req: AuthRequest
	) {
		this.applyPublicReadCacheHeaders(res, req)
		return this.brandService.getById(id)
	}

	@Post()
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Create brand' })
	@ApiCreatedResponse({
		description: 'Бренд создан',
		type: BrandDto
	})
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiForbiddenResponse({ description: 'Доступ запрещён' })
	async create(@Body() dto: CreateBrandDtoReq) {
		return this.brandService.create(dto)
	}

	@Patch('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Update brand' })
	@ApiParam({
		name: 'id',
		description: 'ID бренда'
	})
	@ApiOkResponse({
		description: 'Бренд обновлён',
		type: BrandDto
	})
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiNotFoundResponse({ description: 'Бренд не найден' })
	@ApiForbiddenResponse({ description: 'Доступ запрещён' })
	async update(@Param('id') id: string, @Body() dto: UpdateBrandDtoReq) {
		return this.brandService.update(id, dto)
	}

	@Delete('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Delete brand' })
	@ApiParam({
		name: 'id',
		description: 'ID бренда'
	})
	@ApiOkResponse({ description: 'Бренд удалён', type: OkResponseDto })
	@ApiNotFoundResponse({ description: 'Бренд не найден' })
	@ApiForbiddenResponse({ description: 'Доступ запрещён' })
	async remove(@Param('id') id: string) {
		return this.brandService.remove(id)
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

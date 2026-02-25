import { Role } from '@generated/enums'
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

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { SessionGuard } from '../auth/guards/session.guard'

import { BrandService } from './brand.service'
import { CreateBrandDtoReq } from './dto/requests/create-brand.dto.req'
import { UpdateBrandDtoReq } from './dto/requests/update-brand.dto.req'
import { BrandDto } from './dto/responses/brand.dto.res'

@ApiTags('Brand')
@Controller('brand')
export class BrandController {
	constructor(private readonly brandService: BrandService) {}

	@Get()
	@ApiOperation({ summary: 'List brands' })
	@ApiOkResponse({
		description: 'Список брендов',
		type: BrandDto,
		isArray: true
	})
	async getAll() {
		return this.brandService.getAll()
	}

	@Get('/:id')
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
	async getById(@Param('id') id: string) {
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
}

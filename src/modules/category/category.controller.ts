import { Role } from '@generated/enums'
import {
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

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { SessionGuard } from '../auth/guards/session.guard'

import { CategoryService } from './category.service'
import { CreateCategoryDtoReq } from './dto/requests/create-category.dto.req'
import { UpdateCategoryDtoReq } from './dto/requests/update-category.dto.req'
import {
	CategoryDto,
	CategoryProductsPageDto,
	CategoryWithRelationsDto
} from './dto/responses/category.dto.res'

@ApiTags('Category')
@Controller('category')
export class CategoryController {
	constructor(private readonly categoryService: CategoryService) {}

	@Get()
	@ApiOperation({ summary: 'List categories' })
	@ApiOkResponse({
		description: 'Список категорий',
		type: CategoryDto,
		isArray: true
	})
	async getAll() {
		return this.categoryService.getAll()
	}

	@Get('/:id')
	@ApiOperation({ summary: 'Get category by id' })
	@ApiParam({
		name: 'id',
		description: 'ID категории'
	})
	@ApiOkResponse({
		description: 'Детали категории',
		type: CategoryWithRelationsDto
	})
	@ApiNotFoundResponse({ description: 'Категория не найдена' })
	async getById(@Param('id') id: string) {
		return this.categoryService.getById(id)
	}

	@Get('/:id/products/infinite')
	@ApiOperation({ summary: 'List category products (infinite)' })
	@ApiParam({
		name: 'id',
		description: 'ID категории'
	})
	@ApiQuery({
		name: 'cursor',
		required: false,
		description: 'Курсор из предыдущего ответа (opaque)'
	})
	@ApiQuery({
		name: 'limit',
		required: false,
		description: 'Размер страницы (1-100)',
		schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
	})
	@ApiOkResponse({
		description: 'Страница товаров категории',
		type: CategoryProductsPageDto
	})
	@ApiNotFoundResponse({ description: 'Категория не найдена' })
	async getProductsByCategory(
		@Param('id') id: string,
		@Query('cursor') cursor?: string,
		@Query('limit') limit?: string
	) {
		return this.categoryService.getProductsByCategory(id, { cursor, limit })
	}

	@Post()
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Create category' })
	@ApiCreatedResponse({
		description: 'Категория создана',
		type: CategoryDto
	})
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiForbiddenResponse({ description: 'Доступ запрещён' })
	async create(@Body() dto: CreateCategoryDtoReq) {
		return this.categoryService.create(dto)
	}

	@Patch('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Update category' })
	@ApiParam({
		name: 'id',
		description: 'ID категории'
	})
	@ApiOkResponse({
		description: 'Категория обновлена',
		type: CategoryWithRelationsDto
	})
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiNotFoundResponse({ description: 'Категория не найдена' })
	@ApiForbiddenResponse({ description: 'Доступ запрещён' })
	async update(@Param('id') id: string, @Body() dto: UpdateCategoryDtoReq) {
		return this.categoryService.update(id, dto)
	}

	@Delete('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Delete category' })
	@ApiParam({
		name: 'id',
		description: 'ID категории'
	})
	@ApiOkResponse({ description: 'Категория удалена', type: OkResponseDto })
	@ApiNotFoundResponse({ description: 'Категория не найдена' })
	@ApiForbiddenResponse({ description: 'Доступ запрещён' })
	async remove(@Param('id') id: string) {
		return this.categoryService.remove(id)
	}
}

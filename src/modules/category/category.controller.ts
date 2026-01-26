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
import { Role } from '@generated/enums'

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { SessionGuard } from '../auth/guards/session.guard'

import { CategoryService } from './category.service'
import { CreateCategoryDtoReq } from './dto/requests/create-category.dto.req'
import { UpdateCategoryDtoReq } from './dto/requests/update-category.dto.req'

@ApiTags('Category')
@Controller('category')
export class CategoryController {
	constructor(private readonly categoryService: CategoryService) {}

	@Get()
	@ApiOperation({ summary: 'List categories' })
	@ApiOkResponse({ description: 'Categories list' })
	async getAll() {
		return this.categoryService.getAll()
	}

	@Get('/:id')
	@ApiOperation({ summary: 'Get category by id' })
	@ApiParam({
		name: 'id',
		description: 'Category id'
	})
	@ApiOkResponse({ description: 'Category details' })
	@ApiNotFoundResponse({ description: 'Category not found' })
	async getById(@Param('id') id: string) {
		return this.categoryService.getById(id)
	}

	@Post()
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG_OWNER)
	@ApiOperation({ summary: 'Create category' })
	@ApiCreatedResponse({ description: 'Category created' })
	@ApiBadRequestResponse({ description: 'Validation error' })
	@ApiForbiddenResponse({ description: 'Forbidden' })
	async create(@Body() dto: CreateCategoryDtoReq) {
		return this.categoryService.create(dto)
	}

	@Patch('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG_OWNER)
	@ApiOperation({ summary: 'Update category' })
	@ApiParam({
		name: 'id',
		description: 'Category id'
	})
	@ApiOkResponse({ description: 'Category updated' })
	@ApiBadRequestResponse({ description: 'Validation error' })
	@ApiNotFoundResponse({ description: 'Category not found' })
	@ApiForbiddenResponse({ description: 'Forbidden' })
	async update(@Param('id') id: string, @Body() dto: UpdateCategoryDtoReq) {
		return this.categoryService.update(id, dto)
	}

	@Delete('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG_OWNER)
	@ApiOperation({ summary: 'Delete category' })
	@ApiParam({
		name: 'id',
		description: 'Category id'
	})
	@ApiOkResponse({ description: 'Category deleted' })
	@ApiNotFoundResponse({ description: 'Category not found' })
	@ApiForbiddenResponse({ description: 'Forbidden' })
	async remove(@Param('id') id: string) {
		return this.categoryService.remove(id)
	}
}

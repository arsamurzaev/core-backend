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
import { ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger'

import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { SessionGuard } from '../auth/guards/session.guard'

import { CreateProductDtoReq } from './dto/requests/create-product.dto.req'
import { UpdateProductDtoReq } from './dto/requests/update-product.dto.req'
import { ProductService } from './product.service'

@ApiTags('Product')
@Controller('product')
export class ProductController {
	constructor(private readonly productService: ProductService) {}

	@Get()
	@ApiOperation({ summary: 'List products' })
	async getAll() {
		return this.productService.getAll()
	}

	@Get('/slug/:slug')
	@ApiOperation({ summary: 'Get product by slug' })
	@ApiParam({
		name: 'slug',
		description: 'Product slug'
	})
	async getBySlug(@Param('slug') slug: string) {
		return this.productService.getBySlug(slug)
	}

	@Get('/:id')
	@ApiOperation({ summary: 'Get product by id' })
	@ApiParam({
		name: 'id',
		description: 'Product id'
	})
	async getById(@Param('id') id: string) {
		return this.productService.getById(id)
	}

	@Post()
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG_OWNER)
	@ApiOperation({ summary: 'Create product' })
	async create(@Body() dto: CreateProductDtoReq) {
		return this.productService.create(dto)
	}

	@Patch('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG_OWNER)
	@ApiOperation({ summary: 'Update product' })
	@ApiParam({
		name: 'id',
		description: 'Product id'
	})
	async update(@Param('id') id: string, @Body() dto: UpdateProductDtoReq) {
		return this.productService.update(id, dto)
	}

	@Delete('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG_OWNER)
	@ApiOperation({ summary: 'Delete product' })
	@ApiParam({
		name: 'id',
		description: 'Product id'
	})
	async remove(@Param('id') id: string) {
		return this.productService.remove(id)
	}
}

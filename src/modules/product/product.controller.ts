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

import { CreateProductDtoReq } from './dto/requests/create-product.dto.req'
import { UpdateProductDtoReq } from './dto/requests/update-product.dto.req'
import {
	ProductCreateResponseDto,
	ProductDto,
	ProductWithAttributesDto
} from './dto/responses/product.dto.res'
import { ProductService } from './product.service'

@ApiTags('Product')
@Controller('product')
export class ProductController {
	constructor(private readonly productService: ProductService) {}

	@Get()
	@ApiOperation({ summary: 'List products' })
	@ApiOkResponse({ type: ProductDto, isArray: true })
	async getAll() {
		return this.productService.getAll()
	}

	@Get('/popular')
	@ApiOperation({ summary: 'List popular products' })
	@ApiOkResponse({ type: ProductDto, isArray: true })
	async getPopular() {
		return this.productService.getPopular()
	}

	@Get('/slug/:slug')
	@ApiOperation({ summary: 'Get product by slug' })
	@ApiParam({
		name: 'slug',
		description: 'Product slug'
	})
	@ApiOkResponse({ type: ProductWithAttributesDto })
	async getBySlug(@Param('slug') slug: string) {
		return this.productService.getBySlug(slug)
	}

	@Get('/:id')
	@ApiOperation({ summary: 'Get product by id' })
	@ApiParam({
		name: 'id',
		description: 'Product id'
	})
	@ApiOkResponse({ type: ProductWithAttributesDto })
	async getById(@Param('id') id: string) {
		return this.productService.getById(id)
	}

	@Post()
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Create product' })
	@ApiCreatedResponse({ type: ProductCreateResponseDto })
	async create(@Body() dto: CreateProductDtoReq) {
		return this.productService.create(dto)
	}

	@Patch('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Update product' })
	@ApiParam({
		name: 'id',
		description: 'Product id'
	})
	@ApiOkResponse({ type: ProductWithAttributesDto })
	async update(@Param('id') id: string, @Body() dto: UpdateProductDtoReq) {
		return this.productService.update(id, dto)
	}

	@Delete('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Delete product' })
	@ApiParam({
		name: 'id',
		description: 'Product id'
	})
	@ApiOkResponse({ type: OkResponseDto })
	async remove(@Param('id') id: string) {
		return this.productService.remove(id)
	}
}

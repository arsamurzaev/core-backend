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
import { SetProductVariantsDtoReq } from './dto/requests/set-product-variants.dto.req'
import { UpdateProductDtoReq } from './dto/requests/update-product.dto.req'
import {
	ProductCreateResponseDto,
	ProductDto,
	ProductUpdateResponseDto,
	ProductVariantsResponseDto,
	ProductWithAttributesDto,
	ProductWithDetailsDto
} from './dto/responses/product.dto.res'
import { ProductService } from './product.service'

@ApiTags('Товар')
@Controller('product')
export class ProductController {
	constructor(private readonly productService: ProductService) {}

	@Get()
	@ApiOperation({ summary: 'Список товаров' })
	@ApiOkResponse({ type: ProductDto, isArray: true })
	async getAll() {
		return this.productService.getAll()
	}

	@Get('/popular')
	@ApiOperation({ summary: 'Список популярных товаров' })
	@ApiOkResponse({ type: ProductWithAttributesDto, isArray: true })
	async getPopular() {
		return this.productService.getPopular()
	}

	@Get('/slug/:slug')
	@ApiOperation({ summary: 'Получить товар по slug' })
	@ApiParam({
		name: 'slug',
		description: 'Слаг товара'
	})
	@ApiOkResponse({ type: ProductWithDetailsDto })
	async getBySlug(@Param('slug') slug: string) {
		return this.productService.getBySlug(slug)
	}

	@Get('/:id')
	@ApiOperation({ summary: 'Получить товар по id' })
	@ApiParam({
		name: 'id',
		description: 'ID товара'
	})
	@ApiOkResponse({ type: ProductWithDetailsDto })
	async getById(@Param('id') id: string) {
		return this.productService.getById(id)
	}

	@Post()
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Создать товар' })
	@ApiCreatedResponse({ type: ProductCreateResponseDto })
	async create(@Body() dto: CreateProductDtoReq) {
		return this.productService.create(dto)
	}

	@Patch('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Обновить товар' })
	@ApiParam({
		name: 'id',
		description: 'ID товара'
	})
	@ApiOkResponse({ type: ProductUpdateResponseDto })
	async update(@Param('id') id: string, @Body() dto: UpdateProductDtoReq) {
		return this.productService.update(id, dto)
	}

	@Post('/:id/variants')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Создать/заменить вариации товара' })
	@ApiParam({
		name: 'id',
		description: 'ID товара'
	})
	@ApiOkResponse({ type: ProductVariantsResponseDto })
	async setVariants(
		@Param('id') id: string,
		@Body() dto: SetProductVariantsDtoReq
	) {
		return this.productService.setVariants(id, dto)
	}

	@Delete('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Удалить товар' })
	@ApiParam({
		name: 'id',
		description: 'ID товара'
	})
	@ApiOkResponse({ type: OkResponseDto })
	async remove(@Param('id') id: string) {
		return this.productService.remove(id)
	}
}

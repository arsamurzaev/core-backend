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
	ApiCreatedResponse,
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

import { CreateProductDtoReq } from './dto/requests/create-product.dto.req'
import { SetProductVariantsDtoReq } from './dto/requests/set-product-variants.dto.req'
import { UpdateProductDtoReq } from './dto/requests/update-product.dto.req'
import {
	ProductCreateResponseDto,
	ProductDto,
	ProductInfinitePageDto,
	ProductUpdateResponseDto,
	ProductVariantsResponseDto,
	ProductWithDetailsDto
} from './dto/responses/product.dto.res'
import { ProductService } from './product.service'

@ApiTags('Товар')
@Controller('product')
export class ProductController {
	constructor(private readonly productService: ProductService) {}

	@Get()
	@ApiOperation({
		summary: 'Список товаров',
		description:
			'В media.variants для каждого изображения возвращается только variant с назначением card.'
	})
	@ApiOkResponse({ type: ProductDto, isArray: true })
	async getAll() {
		return this.productService.getAll()
	}

	@Get('/infinite')
	@ApiOperation({
		summary: 'Список товаров с фильтрами (бесконечный скролл)',
		description:
			'Поддерживает фильтры по категориям/брендам/цене/поиску, фильтрацию по атрибутам и детерминированный рандом через seed. В media.variants возвращается только variant с назначением card.'
	})
	@ApiQuery({
		name: 'cursor',
		required: false,
		description: 'Курсор из предыдущего ответа (opaque base64)'
	})
	@ApiQuery({
		name: 'limit',
		required: false,
		description: 'Размер страницы (1-50), по умолчанию 24'
	})
	@ApiQuery({
		name: 'seed',
		required: false,
		description: 'Seed для детерминированной рандомизации'
	})
	@ApiQuery({
		name: 'categories',
		required: false,
		description: 'ID категорий через запятую'
	})
	@ApiQuery({
		name: 'brands',
		required: false,
		description: 'ID брендов через запятую'
	})
	@ApiQuery({
		name: 'minPrice',
		required: false,
		description: 'Минимальная цена'
	})
	@ApiQuery({
		name: 'maxPrice',
		required: false,
		description: 'Максимальная цена'
	})
	@ApiQuery({
		name: 'searchTerm',
		required: false,
		description: 'Поиск по названию (contains, insensitive)'
	})
	@ApiQuery({
		name: 'isPopular',
		required: false,
		description: 'Фильтр по популярным товарам (true/false)'
	})
	@ApiQuery({
		name: 'isDiscount',
		required: false,
		description:
			'Только товары с активной скидкой (учитываются атрибуты discount, discountStartAt, discountEndAt)'
	})
	@ApiQuery({
		name: 'attributes',
		required: false,
		description:
			'JSON-объект фильтров атрибутов. Дополнительно поддерживаются query-параметры attr.<key>, attrMin.<key>, attrMax.<key>, attrBool.<key>.'
	})
	@ApiOkResponse({ type: ProductInfinitePageDto })
	async getInfinite(@Query() query: Record<string, unknown>) {
		return this.productService.getInfinite(query)
	}

	@Get('/popular')
	@ApiOperation({
		summary: 'Список популярных товаров',
		description:
			'В media.variants для каждого изображения возвращается только variant с назначением card.'
	})
	@ApiOkResponse({ type: ProductWithDetailsDto, isArray: true })
	async getPopular() {
		return this.productService.getPopular()
	}

	@Get('/slug/:slug')
	@ApiOperation({
		summary: 'Получить товар по slug',
		description:
			'В media.variants возвращаются варианты thumb и detail. thumb подходит для миниатюр и корзины, detail для страницы товара.'
	})
	@ApiParam({
		name: 'slug',
		description: 'Слаг товара'
	})
	@ApiOkResponse({ type: ProductWithDetailsDto })
	async getBySlug(@Param('slug') slug: string) {
		return this.productService.getBySlug(slug)
	}

	@Get('/:id')
	@ApiOperation({
		summary: 'Получить товар по id',
		description:
			'В media.variants возвращаются варианты thumb и detail. thumb подходит для миниатюр и корзины, detail для страницы товара.'
	})
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
	@ApiOperation({
		summary: 'Создать товар',
		description:
			'Для привязки к категориям передайте массив categories (товар добавится в начало каждой категории).'
	})
	@ApiCreatedResponse({ type: ProductCreateResponseDto })
	async create(@Body() dto: CreateProductDtoReq) {
		return this.productService.create(dto)
	}

	@Patch('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Обновить товар',
		description:
			'Для изменения позиции товара в категории передайте categoryId и categoryPosition. В ответе media.variants возвращаются варианты thumb и detail.'
	})
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
	@ApiOperation({
		summary: 'Создать/заменить вариации товара',
		description: 'В ответе media.variants возвращаются варианты thumb и detail.'
	})
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

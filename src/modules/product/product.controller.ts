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
	Req,
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
import { RequestContext } from '@/shared/tenancy/request-context'

import { canReadInactiveCatalogProducts } from '../auth/catalog-visibility.utils'
import { Roles } from '../auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '../auth/guards/catalog-access.guard'
import { OptionalSessionGuard } from '../auth/guards/optional-session.guard'
import { SessionGuard } from '../auth/guards/session.guard'
import type { AuthRequest } from '../auth/types/auth-request'

import { CreateProductDtoReq } from './dto/requests/create-product.dto.req'
import { SetProductVariantsDtoReq } from './dto/requests/set-product-variants.dto.req'
import { UpdateProductCategoryPositionDtoReq } from './dto/requests/update-product-category-position.dto.req'
import { UpdateProductDtoReq } from './dto/requests/update-product.dto.req'
import {
	ProductCreateResponseDto,
	ProductCursorPageDto,
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
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({
		summary: 'Список товаров',
		description:
			'В media.variants для каждого изображения возвращается только variant с назначением card.'
	})
	@ApiOkResponse({ type: ProductDto, isArray: true })
	async getAll(@Req() req: AuthRequest) {
		return this.productService.getAll({
			includeInactive: this.canReadInactive(req)
		})
	}

	@Get('/infinite')
	@UseGuards(OptionalSessionGuard)
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
	async getInfinite(
		@Query() query: Record<string, unknown>,
		@Req() req: AuthRequest
	) {
		return this.productService.getInfinite(query, {
			includeInactive: this.canReadInactive(req)
		})
	}

	@Get('/recommendations/infinite')
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({
		summary: 'Список рекомендаций под фильтром (бесконечный скролл)',
		description:
			'Временная реализация: возвращает товары, которые не попадают в текущий фильтр. Поддерживает те же query-параметры и deterministic seed, что и /product/infinite.'
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
	async getRecommendationsInfinite(
		@Query() query: Record<string, unknown>,
		@Req() req: AuthRequest
	) {
		return this.productService.getRecommendationsInfinite(query, {
			includeInactive: this.canReadInactive(req)
		})
	}

	@Get('/uncategorized/infinite')
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({
		summary: 'Список товаров без категории (бесконечный скролл)',
		description:
			'Возвращает товары без активной привязки к категориям. В media.variants для каждого изображения возвращается только variant с назначением card.'
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
	@ApiOkResponse({ type: ProductCursorPageDto })
	async getUncategorizedInfinite(
		@Query('cursor') cursor?: string,
		@Query('limit') limit?: string,
		@Req() req?: AuthRequest
	) {
		return this.productService.getUncategorizedInfinite({
			cursor,
			limit,
			includeInactive: this.canReadInactive(req)
		})
	}

	@Get('/popular')
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({
		summary: 'Список популярных товаров',
		description:
			'В media.variants для каждого изображения возвращается только variant с назначением card.'
	})
	@ApiOkResponse({ type: ProductWithDetailsDto, isArray: true })
	async getPopular(@Req() req: AuthRequest) {
		return this.productService.getPopular({
			includeInactive: this.canReadInactive(req)
		})
	}

	@Get('/slug/:slug')
	@UseGuards(OptionalSessionGuard)
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
	async getBySlug(@Param('slug') slug: string, @Req() req: AuthRequest) {
		return this.productService.getBySlug(slug, {
			includeInactive: this.canReadInactive(req)
		})
	}

	@Get('/:id')
	@UseGuards(OptionalSessionGuard)
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
	async getById(@Param('id') id: string, @Req() req: AuthRequest) {
		return this.productService.getById(id, {
			includeInactive: this.canReadInactive(req)
		})
	}

	@Post()
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Создать товар',
		description:
			'Для привязки к категориям передайте массив categories (товар добавится в начало каждой категории). При необходимости можно сразу передать variants.'
	})
	@ApiCreatedResponse({ type: ProductCreateResponseDto })
	async create(@Body() dto: CreateProductDtoReq) {
		return this.productService.create(dto)
	}

	@Post('/:id/duplicate')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Дублировать товар',
		description:
			'Создает копию товара со всеми медиа, атрибутами, вариантами и категориями. Новый товар создается со status=HIDDEN.'
	})
	@ApiParam({
		name: 'id',
		description: 'ID товара'
	})
	@ApiCreatedResponse({ type: ProductCreateResponseDto })
	async duplicate(@Param('id') id: string) {
		return this.productService.duplicate(id)
	}

	@Patch('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Обновить товар',
		description:
			'Для замены привязок товара передайте массив categories. Для изменения позиции товара внутри одной категории передайте categoryId и categoryPosition. В ответе media.variants возвращаются варианты thumb и detail.'
	})
	@ApiParam({
		name: 'id',
		description: 'ID товара'
	})
	@ApiOkResponse({ type: ProductUpdateResponseDto })
	async update(@Param('id') id: string, @Body() dto: UpdateProductDtoReq) {
		return this.productService.update(id, dto)
	}

	@Patch('/:id/category-position')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Изменить позицию товара в категории',
		description:
			'Меняет позицию товара внутри конкретной категории. Если товар еще не привязан к категории, привязка будет создана на указанной позиции.'
	})
	@ApiParam({
		name: 'id',
		description: 'ID товара'
	})
	@ApiOkResponse({ type: ProductUpdateResponseDto })
	async updateCategoryPosition(
		@Param('id') id: string,
		@Body() dto: UpdateProductCategoryPositionDtoReq
	) {
		return this.productService.updateCategoryPosition(id, dto)
	}

	@Patch('/:id/toggle-status')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Переключить статус товара',
		description:
			'Переключает статус товара между ACTIVE и HIDDEN. В ответе media.variants возвращаются варианты thumb и detail.'
	})
	@ApiParam({
		name: 'id',
		description: 'ID товара'
	})
	@ApiOkResponse({ type: ProductUpdateResponseDto })
	async toggleStatus(@Param('id') id: string) {
		return this.productService.toggleStatus(id)
	}

	@Patch('/:id/toggle-popular')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Переключить популярность товара',
		description:
			'Переключает флаг isPopular у товара. В ответе media.variants возвращаются варианты thumb и detail.'
	})
	@ApiParam({
		name: 'id',
		description: 'ID товара'
	})
	@ApiOkResponse({ type: ProductUpdateResponseDto })
	async togglePopular(@Param('id') id: string) {
		return this.productService.togglePopular(id)
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

	private canReadInactive(req?: Pick<AuthRequest, 'user'>): boolean {
		return canReadInactiveCatalogProducts(
			req?.user,
			RequestContext.get()?.ownerUserId
		)
	}
}

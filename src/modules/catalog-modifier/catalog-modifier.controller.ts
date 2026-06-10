import { Role } from '@generated/enums'
import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Put,
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

import { Roles } from '@/modules/auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '@/modules/auth/guards/catalog-access.guard'
import { OptionalSessionGuard } from '@/modules/auth/guards/optional-session.guard'
import { SessionGuard } from '@/modules/auth/guards/session.guard'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'

import { CatalogModifierService } from './catalog-modifier.service'
import {
	CreateCatalogModifierGroupDtoReq,
	UpdateCatalogModifierGroupDtoReq
} from './dto/requests/catalog-modifier-group.dto.req'
import {
	CreateCatalogModifierOptionDtoReq,
	UpdateCatalogModifierOptionDtoReq
} from './dto/requests/catalog-modifier-option.dto.req'
import { SetProductModifiersDtoReq } from './dto/requests/set-product-modifiers.dto.req'
import {
	CatalogModifierGroupDto,
	CatalogModifierOptionDto,
	CatalogModifierStateDto,
	ProductModifierGroupDto
} from './dto/responses/catalog-modifier.dto.res'

@ApiTags('CatalogModifier')
@Controller('catalog-modifier')
export class CatalogModifierController {
	constructor(private readonly service: CatalogModifierService) {}

	@Get()
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'Состояние модификаторов текущего каталога' })
	@ApiQuery({ name: 'includeArchived', required: false })
	@ApiQuery({ name: 'includeInactive', required: false })
	@ApiOkResponse({ type: CatalogModifierStateDto })
	getState(
		@Query('includeArchived') includeArchived?: string,
		@Query('includeInactive') includeInactive?: string
	) {
		return this.service.getState({
			includeArchived: this.parseBooleanQuery(includeArchived, 'includeArchived'),
			includeInactive: this.parseBooleanQuery(includeInactive, 'includeInactive')
		})
	}

	@Get('groups')
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'Список групп модификаторов текущего каталога' })
	@ApiOkResponse({ type: CatalogModifierGroupDto, isArray: true })
	getGroups(
		@Query('includeArchived') includeArchived?: string,
		@Query('includeInactive') includeInactive?: string
	) {
		return this.service.getGroups({
			includeArchived: this.parseBooleanQuery(includeArchived, 'includeArchived'),
			includeInactive: this.parseBooleanQuery(includeInactive, 'includeInactive')
		})
	}

	@Post('groups')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Создать группу модификаторов текущего каталога' })
	@ApiCreatedResponse({ type: CatalogModifierGroupDto })
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	createGroup(@Body() dto: CreateCatalogModifierGroupDtoReq) {
		return this.service.createGroup(dto)
	}

	@Patch('groups/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Обновить группу модификаторов текущего каталога' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: CatalogModifierGroupDto })
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiNotFoundResponse({ description: 'Группа модификаторов не найдена' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	updateGroup(
		@Param('id') id: string,
		@Body() dto: UpdateCatalogModifierGroupDtoReq
	) {
		return this.service.updateGroup(id, dto)
	}

	@Delete('groups/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({
		summary: 'Архивировать группу модификаторов текущего каталога'
	})
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: OkResponseDto })
	@ApiNotFoundResponse({ description: 'Группа модификаторов не найдена' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	archiveGroup(@Param('id') id: string) {
		return this.service.archiveGroup(id)
	}

	@Get('options')
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'Список опций модификаторов текущего каталога' })
	@ApiOkResponse({ type: CatalogModifierOptionDto, isArray: true })
	getOptions(
		@Query('includeArchived') includeArchived?: string,
		@Query('includeInactive') includeInactive?: string
	) {
		return this.service.getOptions({
			includeArchived: this.parseBooleanQuery(includeArchived, 'includeArchived'),
			includeInactive: this.parseBooleanQuery(includeInactive, 'includeInactive')
		})
	}

	@Post('options')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Создать опцию модификатора текущего каталога' })
	@ApiCreatedResponse({ type: CatalogModifierOptionDto })
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	createOption(@Body() dto: CreateCatalogModifierOptionDtoReq) {
		return this.service.createOption(dto)
	}

	@Patch('options/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Обновить опцию модификатора текущего каталога' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: CatalogModifierOptionDto })
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiNotFoundResponse({ description: 'Опция модификатора не найдена' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	updateOption(
		@Param('id') id: string,
		@Body() dto: UpdateCatalogModifierOptionDtoReq
	) {
		return this.service.updateOption(id, dto)
	}

	@Delete('options/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Архивировать опцию модификатора текущего каталога' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: OkResponseDto })
	@ApiNotFoundResponse({ description: 'Опция модификатора не найдена' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	archiveOption(@Param('id') id: string) {
		return this.service.archiveOption(id)
	}

	@Get('products/:productId')
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'Список модификаторов товара' })
	@ApiParam({ name: 'productId' })
	@ApiOkResponse({ type: ProductModifierGroupDto, isArray: true })
	getProductModifiers(@Param('productId') productId: string) {
		return this.service.getProductModifiers(productId)
	}

	@Put('products/:productId')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Заменить модификаторы товара' })
	@ApiParam({ name: 'productId' })
	@ApiOkResponse({ type: ProductModifierGroupDto, isArray: true })
	@ApiBadRequestResponse({ description: 'Ошибка валидации' })
	@ApiNotFoundResponse({ description: 'Товар не найден' })
	@ApiForbiddenResponse({ description: 'Доступ запрещен' })
	setProductModifiers(
		@Param('productId') productId: string,
		@Body() dto: SetProductModifiersDtoReq
	) {
		return this.service.setProductModifiers(productId, dto)
	}

	private parseBooleanQuery(value: string | undefined, name: string): boolean {
		if (!value) return false
		const normalized = value.trim().toLowerCase()
		if (['1', 'true', 'yes'].includes(normalized)) return true
		if (['0', 'false', 'no'].includes(normalized)) return false
		throw new BadRequestException(`Параметр ${name} должен быть булевым`)
	}
}

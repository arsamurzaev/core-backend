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
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { CreateProductTypeFromTemplateDtoReq } from './dto/requests/create-product-type-from-template.dto.req'
import { CreateProductTypeDtoReq } from './dto/requests/create-product-type.dto.req'
import { UpdateProductTypeDtoReq } from './dto/requests/update-product-type.dto.req'
import { ProductTypeMatrixEditorSchemaDto } from './dto/responses/product-type-matrix-editor-schema.dto.res'
import { ProductTypeDto } from './dto/responses/product-type.dto.res'
import { ProductTypeService } from './product-type.service'

@ApiTags('ProductType')
@Controller('product-type')
export class ProductTypeController {
	constructor(private readonly productTypeService: ProductTypeService) {}

	@Get()
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'List catalog product types' })
	@ApiQuery({
		name: 'includeArchived',
		required: false,
		schema: { type: 'boolean' }
	})
	@ApiOkResponse({ type: ProductTypeDto, isArray: true })
	async getAll(@Query('includeArchived') includeArchived?: string) {
		return this.productTypeService.getAll({
			includeArchived: this.parseBooleanQuery(includeArchived)
		})
	}

	@Get('/system-templates')
	@SkipCatalog()
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'List system product type templates' })
	@ApiQuery({
		name: 'includeArchived',
		required: false,
		schema: { type: 'boolean' }
	})
	@ApiOkResponse({ type: ProductTypeDto, isArray: true })
	async getSystemTemplates(@Query('includeArchived') includeArchived?: string) {
		return this.productTypeService.getSystemTemplates({
			includeArchived: this.parseBooleanQuery(includeArchived)
		})
	}

	@Get('/system-templates/:id')
	@SkipCatalog()
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'Get system product type template' })
	@ApiParam({ name: 'id', description: 'Template ID' })
	@ApiOkResponse({ type: ProductTypeDto })
	@ApiNotFoundResponse({ description: 'Template not found' })
	async getSystemTemplateById(@Param('id') id: string) {
		return this.productTypeService.getSystemTemplateById(id)
	}

	@Get('/:id/matrix-editor/schema')
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'Get product type matrix editor schema' })
	@ApiParam({ name: 'id', description: 'Catalog product type ID' })
	@ApiOkResponse({ type: ProductTypeMatrixEditorSchemaDto })
	@ApiNotFoundResponse({ description: 'Product type not found' })
	async getMatrixEditorSchema(@Param('id') id: string) {
		return this.productTypeService.getMatrixEditorSchema(id)
	}

	@Get('/:id')
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'Get catalog product type' })
	@ApiParam({ name: 'id', description: 'Product type ID' })
	@ApiOkResponse({ type: ProductTypeDto })
	@ApiNotFoundResponse({ description: 'Product type not found' })
	async getById(@Param('id') id: string) {
		return this.productTypeService.getById(id)
	}

	@Post()
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Create catalog product type' })
	@ApiCreatedResponse({ type: ProductTypeDto })
	@ApiBadRequestResponse({ description: 'Validation error' })
	@ApiForbiddenResponse({ description: 'Forbidden' })
	async create(@Body() dto: CreateProductTypeDtoReq) {
		return this.productTypeService.create(dto)
	}

	@Post('/system-templates')
	@ApiSecurity('csrf')
	@SkipCatalog()
	@UseGuards(SessionGuard)
	@Roles(Role.ADMIN)
	@ApiOperation({ summary: 'Create system product type template' })
	@ApiCreatedResponse({ type: ProductTypeDto })
	@ApiBadRequestResponse({ description: 'Validation error' })
	@ApiForbiddenResponse({ description: 'Forbidden' })
	async createSystemTemplate(@Body() dto: CreateProductTypeDtoReq) {
		return this.productTypeService.createSystemTemplate(dto)
	}

	@Post('/from-template/:templateId')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Create catalog product type from system template' })
	@ApiParam({ name: 'templateId', description: 'System template ID' })
	@ApiCreatedResponse({ type: ProductTypeDto })
	@ApiBadRequestResponse({ description: 'Validation error' })
	@ApiNotFoundResponse({ description: 'Template not found' })
	@ApiForbiddenResponse({ description: 'Forbidden' })
	async createFromTemplate(
		@Param('templateId') templateId: string,
		@Body() dto: CreateProductTypeFromTemplateDtoReq
	) {
		return this.productTypeService.createFromTemplate(templateId, dto)
	}

	@Patch('/system-templates/:id')
	@ApiSecurity('csrf')
	@SkipCatalog()
	@UseGuards(SessionGuard)
	@Roles(Role.ADMIN)
	@ApiOperation({ summary: 'Update system product type template' })
	@ApiParam({ name: 'id', description: 'Template ID' })
	@ApiOkResponse({ type: ProductTypeDto })
	@ApiBadRequestResponse({ description: 'Validation error' })
	@ApiNotFoundResponse({ description: 'Template not found' })
	@ApiForbiddenResponse({ description: 'Forbidden' })
	async updateSystemTemplate(
		@Param('id') id: string,
		@Body() dto: UpdateProductTypeDtoReq
	) {
		return this.productTypeService.updateSystemTemplate(id, dto)
	}

	@Patch('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Update catalog product type' })
	@ApiParam({ name: 'id', description: 'Product type ID' })
	@ApiOkResponse({ type: ProductTypeDto })
	@ApiBadRequestResponse({ description: 'Validation error' })
	@ApiNotFoundResponse({ description: 'Product type not found' })
	@ApiForbiddenResponse({ description: 'Forbidden' })
	async update(@Param('id') id: string, @Body() dto: UpdateProductTypeDtoReq) {
		return this.productTypeService.update(id, dto)
	}

	@Delete('/system-templates/:id')
	@ApiSecurity('csrf')
	@SkipCatalog()
	@UseGuards(SessionGuard)
	@Roles(Role.ADMIN)
	@ApiOperation({ summary: 'Archive system product type template' })
	@ApiParam({ name: 'id', description: 'Template ID' })
	@ApiOkResponse({ type: OkResponseDto })
	@ApiNotFoundResponse({ description: 'Template not found' })
	@ApiForbiddenResponse({ description: 'Forbidden' })
	async archiveSystemTemplate(@Param('id') id: string) {
		return this.productTypeService.archiveSystemTemplate(id)
	}

	@Delete('/:id')
	@ApiSecurity('csrf')
	@UseGuards(SessionGuard, CatalogAccessGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Archive catalog product type' })
	@ApiParam({ name: 'id', description: 'Product type ID' })
	@ApiOkResponse({ type: OkResponseDto })
	@ApiNotFoundResponse({ description: 'Product type not found' })
	@ApiForbiddenResponse({ description: 'Forbidden' })
	async archive(@Param('id') id: string) {
		return this.productTypeService.archive(id)
	}

	private parseBooleanQuery(value?: string): boolean {
		if (!value) return false
		const normalized = value.trim().toLowerCase()
		if (['1', 'true', 'yes'].includes(normalized)) return true
		if (['0', 'false', 'no'].includes(normalized)) return false
		throw new BadRequestException('includeArchived must be a boolean value')
	}
}

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
	ApiTags
} from '@nestjs/swagger'

import { Roles } from '@/modules/auth/decorators/roles.decorator'
import { SessionGuard } from '@/modules/auth/guards/session.guard'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { AttributeService } from './attribute.service'
import { CreateAttributeEnumDtoReq } from './dto/requests/create-attribute-enum.dto.req'
import { CreateAttributeDtoReq } from './dto/requests/create-attribute.dto.req'
import { UpdateAttributeEnumDtoReq } from './dto/requests/update-attribute-enum.dto.req'
import { UpdateAttributeDtoReq } from './dto/requests/update-attribute.dto.req'
import {
	AttributeDto,
	AttributeEnumValueDto
} from './dto/responses/attribute.dto.res'

@ApiTags('Attribute')
@SkipCatalog()
@Controller('attribute')
export class AttributeController {
	constructor(private readonly attributeService: AttributeService) {}

	@Get('/type/:typeId')
	@ApiOperation({ summary: 'List attributes by type' })
	@ApiParam({ name: 'typeId', description: 'ID или код типа' })
	@ApiOkResponse({ type: AttributeDto, isArray: true })
	async getByType(@Param('typeId') typeId: string) {
		return this.attributeService.getByType(typeId)
	}

	@Get('/:id')
	@ApiOperation({ summary: 'Get attribute by id' })
	@ApiParam({ name: 'id', description: 'ID атрибута' })
	@ApiOkResponse({ type: AttributeDto })
	async getById(@Param('id') id: string) {
		return this.attributeService.getById(id)
	}

	@Post()
	@UseGuards(SessionGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Create attribute' })
	@ApiCreatedResponse({ type: AttributeDto })
	async create(@Body() dto: CreateAttributeDtoReq) {
		return this.attributeService.create(dto)
	}

	@Patch('/:id')
	@UseGuards(SessionGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Update attribute' })
	@ApiParam({ name: 'id', description: 'ID атрибута' })
	@ApiOkResponse({ type: AttributeDto })
	async update(@Param('id') id: string, @Body() dto: UpdateAttributeDtoReq) {
		return this.attributeService.update(id, dto)
	}

	@Delete('/:id')
	@UseGuards(SessionGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Delete attribute' })
	@ApiParam({ name: 'id', description: 'ID атрибута' })
	@ApiOkResponse({ type: OkResponseDto })
	async remove(@Param('id') id: string) {
		return this.attributeService.remove(id)
	}

	@Get('/:attributeId/enum')
	@ApiOperation({ summary: 'List enum values' })
	@ApiParam({ name: 'attributeId', description: 'ID атрибута' })
	@ApiOkResponse({ type: AttributeEnumValueDto, isArray: true })
	async getEnumValues(@Param('attributeId') attributeId: string) {
		return this.attributeService.getEnumValues(attributeId)
	}

	@Post('/:attributeId/enum')
	@UseGuards(SessionGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Create enum value' })
	@ApiParam({ name: 'attributeId', description: 'ID атрибута' })
	@ApiCreatedResponse({ type: AttributeEnumValueDto })
	async createEnumValue(
		@Param('attributeId') attributeId: string,
		@Body() dto: CreateAttributeEnumDtoReq
	) {
		return this.attributeService.createEnumValue(attributeId, dto)
	}

	@Patch('/:attributeId/enum/:id')
	@UseGuards(SessionGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Update enum value' })
	@ApiParam({ name: 'attributeId', description: 'ID атрибута' })
	@ApiParam({ name: 'id', description: 'ID значения перечисления' })
	@ApiOkResponse({ type: AttributeEnumValueDto })
	async updateEnumValue(
		@Param('attributeId') attributeId: string,
		@Param('id') id: string,
		@Body() dto: UpdateAttributeEnumDtoReq
	) {
		return this.attributeService.updateEnumValue(attributeId, id, dto)
	}

	@Delete('/:attributeId/enum/:id')
	@UseGuards(SessionGuard)
	@Roles(Role.CATALOG)
	@ApiOperation({ summary: 'Delete enum value' })
	@ApiParam({ name: 'attributeId', description: 'ID атрибута' })
	@ApiParam({ name: 'id', description: 'ID значения перечисления' })
	@ApiOkResponse({ type: OkResponseDto })
	async removeEnumValue(
		@Param('attributeId') attributeId: string,
		@Param('id') id: string
	) {
		return this.attributeService.removeEnumValue(attributeId, id)
	}
}

import { Role } from '@generated/enums'
import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Patch,
	Post,
	Req,
	Res,
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
import { OptionalSessionGuard } from '@/modules/auth/guards/optional-session.guard'
import { SessionGuard } from '@/modules/auth/guards/session.guard'
import {
	PUBLIC_CACHE_CONTROL_SHORT,
	setUserAwarePublicCacheHeaders
} from '@/shared/http/cache-control'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'
import type { Response } from 'express'
import type { AuthRequest } from '@/modules/auth/types/auth-request'

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
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'List attributes by type' })
	@ApiParam({ name: 'typeId', description: 'ID или код типа' })
	@ApiOkResponse({ type: AttributeDto, isArray: true })
	async getByType(
		@Param('typeId') typeId: string,
		@Res({ passthrough: true }) res: Response,
		@Req() req: AuthRequest
	) {
		this.applyPublicReadCacheHeaders(res, req)
		return this.attributeService.getByType(typeId)
	}

	@Get('/:id')
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'Get attribute by id' })
	@ApiParam({ name: 'id', description: 'ID атрибута' })
	@ApiOkResponse({ type: AttributeDto })
	async getById(
		@Param('id') id: string,
		@Res({ passthrough: true }) res: Response,
		@Req() req: AuthRequest
	) {
		this.applyPublicReadCacheHeaders(res, req)
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
	@UseGuards(OptionalSessionGuard)
	@ApiOperation({ summary: 'List enum values' })
	@ApiParam({ name: 'attributeId', description: 'ID атрибута' })
	@ApiOkResponse({ type: AttributeEnumValueDto, isArray: true })
	async getEnumValues(
		@Param('attributeId') attributeId: string,
		@Res({ passthrough: true }) res: Response,
		@Req() req: AuthRequest
	) {
		this.applyPublicReadCacheHeaders(res, req)
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

	private applyPublicReadCacheHeaders(
		res: Response,
		req?: Pick<AuthRequest, 'user'>
	): void {
		setUserAwarePublicCacheHeaders(res, {
			isPrivate: Boolean(req?.user),
			publicCacheControl: PUBLIC_CACHE_CONTROL_SHORT
		})
	}
}

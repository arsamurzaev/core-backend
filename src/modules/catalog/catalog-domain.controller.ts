import { Role } from '@generated/enums'
import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	Param,
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

import { Roles } from '@/modules/auth/decorators/roles.decorator'
import { CatalogAccessGuard } from '@/modules/auth/guards/catalog-access.guard'
import { SessionGuard } from '@/modules/auth/guards/session.guard'

import { CatalogDomainService } from './catalog-domain.service'
import { CreateCatalogDomainDtoReq } from './dto/requests/create-catalog-domain.dto.req'
import {
	CatalogDomainCheckDto,
	CatalogDomainDto
} from './dto/responses/catalog-domain.dto.res'

@ApiTags('Catalog domains')
@ApiSecurity('csrf')
@Roles(Role.CATALOG)
@UseGuards(SessionGuard, CatalogAccessGuard)
@Controller('catalog/current/domains')
export class CatalogDomainController {
	constructor(private readonly service: CatalogDomainService) {}

	@Get()
	@ApiOperation({ summary: 'List current catalog domains' })
	@ApiOkResponse({ type: CatalogDomainDto, isArray: true })
	list(): Promise<CatalogDomainDto[]> {
		return this.service.listCurrent()
	}

	@Post()
	@ApiOperation({ summary: 'Attach domain to current catalog' })
	@ApiCreatedResponse({ type: CatalogDomainDto })
	create(@Body() dto: CreateCatalogDomainDtoReq): Promise<CatalogDomainDto> {
		return this.service.createCurrent(dto)
	}

	@Post('/:id/check')
	@ApiOperation({ summary: 'Check DNS and activate current catalog domain' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: CatalogDomainCheckDto })
	check(@Param('id') id: string): Promise<CatalogDomainCheckDto> {
		return this.service.checkCurrent(id)
	}

	@Delete('/:id')
	@HttpCode(200)
	@ApiOperation({ summary: 'Disable current catalog domain' })
	@ApiParam({ name: 'id' })
	@ApiOkResponse({ type: CatalogDomainDto })
	disable(@Param('id') id: string): Promise<CatalogDomainDto> {
		return this.service.disableCurrent(id)
	}
}

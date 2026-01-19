import { Role } from '@generated/enums'
import { Body, Controller, Post, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiSecurity } from '@nestjs/swagger'

import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { Roles } from '../auth/decorators/roles.decorator'
import { SessionGuard } from '../auth/guards/session.guard'

import { CatalogService } from './catalog.service'
import { CreateCatalogDtoReq } from './dto/requests/create-catalog.dto.req'

@SkipCatalog()
@ApiSecurity('csrf')
@UseGuards(SessionGuard)
@Controller('catalog')
export class CatalogController {
	constructor(private readonly catalogService: CatalogService) {}

	@Post()
	@ApiOperation({ summary: 'Создание каталога' })
	@Roles(Role.ADMIN)
	async create(@Body() dto: CreateCatalogDtoReq) {
		return this.catalogService.create(dto)
	}
}

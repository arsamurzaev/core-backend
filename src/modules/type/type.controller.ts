import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common'
import {
	ApiCreatedResponse,
	ApiOkResponse,
	ApiOperation,
	ApiParam,
	ApiTags
} from '@nestjs/swagger'

import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { CreateTypeDtoReq } from './dto/req/create-type.dto.req'
import { TypeDto } from './dto/responses/type.dto.res'
import { TypeService } from './type.service'

@ApiTags('Type')
@SkipCatalog()
@Controller('type')
export class TypeController {
	constructor(private readonly typeService: TypeService) {}

	@ApiOperation({
		summary: 'Получить все типы',
		description: 'Получить все типы, которые есть в системе.'
	})
	@Get('/get-all')
	@ApiOkResponse({ type: TypeDto, isArray: true })
	async getAll() {
		return this.typeService.getAll()
	}

	@ApiOperation({
		summary: 'Создание типа',
		description: 'Создание нового типа.'
	})
	@Post()
	@ApiCreatedResponse({ type: TypeDto })
	async create(@Body() dto: CreateTypeDtoReq) {
		return this.typeService.create(dto)
	}

	@ApiOperation({
		summary: 'Удаление типа',
		description: 'Удаление'
	})
	@Delete('/:id')
	@ApiParam({
		description: 'Type id',
		name: 'id'
	})
	@ApiOkResponse({ type: OkResponseDto })
	async delete(@Param('id') id: string) {
		return this.typeService.delete(id)
	}
}

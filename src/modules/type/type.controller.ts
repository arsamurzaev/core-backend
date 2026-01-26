import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'

import { SkipCatalog } from '@/shared/tenancy/decorators/skip-catalog.decorator'

import { CreateTypeDtoReq } from './dto/req/create-type.dto.req'
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
	async getAll() {
		return this.typeService.getAll()
	}

	@ApiOperation({
		summary: 'Создание типа',
		description: 'Создание нового типа.'
	})
	@Post()
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
	async delete(@Param('id') id: string) {
		return this.typeService.delete(id)
	}
}

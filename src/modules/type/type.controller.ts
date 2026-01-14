import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiOperation } from '@nestjs/swagger'

import { CreateTypeDtoReq } from './dto/req/create-type.dto.req'
import { TypeService } from './type.service'

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
}

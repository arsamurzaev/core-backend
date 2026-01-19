import { Controller } from '@nestjs/common'


import { CategoryService } from './category.service'

@Controller('category')
export class CategoryController {
	constructor(private readonly categoryService: CategoryService) {}

	// @Get()
	// @PublicCache({ ttlSec: 60, version: 'products' }) // например 60 сек
	// list(@Query() page: PageDto, @Query('filters') filters?: string) {
	// 	// filters можно принимать JSON-строкой или объектом — как у тебя сделано
	// 	return this.categoryService.list({ page, filters })
	// }
}

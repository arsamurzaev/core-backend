import { Test, TestingModule } from '@nestjs/testing'

import { CategoryController } from './category.controller'
import { CategoryService } from './category.service'

describe('CategoryController', () => {
	let controller: CategoryController

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [CategoryController],
			providers: [
				{
					provide: CategoryService,
					useValue: {
						getAll: jest.fn(),
						getById: jest.fn(),
						create: jest.fn(),
						update: jest.fn(),
						remove: jest.fn()
					}
				}
			]
		}).compile()

		controller = module.get<CategoryController>(CategoryController)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})
})

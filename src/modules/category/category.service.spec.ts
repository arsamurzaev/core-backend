import { Test, TestingModule } from '@nestjs/testing'

import { CategoryRepository } from './category.repository'
import { CategoryService } from './category.service'

describe('CategoryService', () => {
	let service: CategoryService

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CategoryService,
				{
					provide: CategoryRepository,
					useValue: {
						findAll: jest.fn(),
						findById: jest.fn(),
						create: jest.fn(),
						update: jest.fn(),
						softDelete: jest.fn(),
						findProductsByIds: jest.fn()
					}
				}
			]
		}).compile()

		service = module.get<CategoryService>(CategoryService)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})
})

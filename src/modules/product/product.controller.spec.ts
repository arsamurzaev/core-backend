import { Test, TestingModule } from '@nestjs/testing'

import { overrideControllerAuthGuards } from '@/shared/testing/controller-guards.testing'

import { ProductController } from './product.controller'
import { ProductService } from './product.service'

describe('ProductController', () => {
	let controller: ProductController

	beforeEach(async () => {
		const module: TestingModule = await overrideControllerAuthGuards(
			Test.createTestingModule({
				controllers: [ProductController],
				providers: [
					{
						provide: ProductService,
						useValue: {
							getAll: jest.fn(),
							getInfinite: jest.fn(),
							getRecommendationsInfinite: jest.fn(),
							getUncategorizedInfinite: jest.fn(),
							getPopular: jest.fn(),
							getById: jest.fn(),
							getBySlug: jest.fn(),
							create: jest.fn(),
							duplicate: jest.fn(),
							update: jest.fn(),
							toggleStatus: jest.fn(),
							togglePopular: jest.fn(),
							remove: jest.fn()
						}
					}
				]
			})
		).compile()

		controller = module.get<ProductController>(ProductController)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})
})

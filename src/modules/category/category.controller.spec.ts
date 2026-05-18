import { Test, TestingModule } from '@nestjs/testing'

import { overrideControllerAuthGuards } from '@/shared/testing/controller-guards.testing'

import { CategoryController } from './category.controller'
import { CategoryService } from './category.service'

describe('CategoryController', () => {
	let controller: CategoryController
	let service: jest.Mocked<CategoryService>

	beforeEach(async () => {
		const module: TestingModule = await overrideControllerAuthGuards(
			Test.createTestingModule({
				controllers: [CategoryController],
				providers: [
					{
						provide: CategoryService,
						useValue: {
							getAll: jest.fn(),
							getById: jest.fn(),
							getProductsByCategory: jest.fn(),
							getProductCardsByCategory: jest.fn(),
							create: jest.fn(),
							update: jest.fn(),
							updatePositions: jest.fn(),
							updatePosition: jest.fn(),
							remove: jest.fn()
						}
					}
				]
			})
		).compile()

		controller = module.get<CategoryController>(CategoryController)
		service = module.get(CategoryService)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})

	it('passes includeEmpty=false to category list service', async () => {
		service.getAll.mockResolvedValue([] as any)
		const res = { setHeader: jest.fn() } as any

		await controller.getAll(res, 'false')

		expect(service.getAll).toHaveBeenCalledWith({ includeEmpty: false })
	})

	it('delegates category position updates to service', async () => {
		service.updatePosition.mockResolvedValue({ id: 'cat-1' } as any)

		await controller.updatePosition('cat-1', { position: 2 })

		expect(service.updatePosition).toHaveBeenCalledWith('cat-1', {
			position: 2
		})
	})
})

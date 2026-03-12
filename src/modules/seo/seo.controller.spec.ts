import { Test, TestingModule } from '@nestjs/testing'

import { overrideControllerAuthGuards } from '@/shared/testing/controller-guards.testing'

import { SeoController } from './seo.controller'
import { SeoService } from './seo.service'

describe('SeoController', () => {
	let controller: SeoController

	beforeEach(async () => {
		const module: TestingModule = await overrideControllerAuthGuards(
			Test.createTestingModule({
				controllers: [SeoController],
				providers: [
					{
						provide: SeoService,
						useValue: {
							getAll: jest.fn(),
							getByEntity: jest.fn(),
							getById: jest.fn(),
							create: jest.fn(),
							update: jest.fn(),
							remove: jest.fn()
						}
					}
				]
			})
		).compile()

		controller = module.get<SeoController>(SeoController)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})
})

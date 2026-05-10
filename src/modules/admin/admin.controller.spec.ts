import { Test, TestingModule } from '@nestjs/testing'

import { overrideControllerAuthGuards } from '@/shared/testing/controller-guards.testing'

import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

describe('AdminController', () => {
	let controller: AdminController
	let service: jest.Mocked<Pick<AdminService, 'deleteCatalogContent'>>

	beforeEach(async () => {
		const module: TestingModule = await overrideControllerAuthGuards(
			Test.createTestingModule({
				controllers: [AdminController],
				providers: [
					{
						provide: AdminService,
						useValue: {
							deleteCatalogContent: jest.fn()
						}
					}
				]
			})
		).compile()

		controller = module.get<AdminController>(AdminController)
		service = module.get(AdminService)
	})

	it('delegates catalog content soft-delete to service', async () => {
		const result = {
			ok: true,
			catalogId: 'catalog-1',
			deletedAt: new Date('2026-05-10T00:00:00.000Z'),
			counts: {
				products: 1,
				productVariants: 2,
				productAttributes: 3,
				variantAttributes: 4,
				categories: 5,
				brands: 6,
				seoSettings: 7,
				productMediaLinks: 8,
				categoryProductLinks: 9,
				integrationProductLinks: 10,
				integrationCategoryLinks: 11
			}
		}
		service.deleteCatalogContent.mockResolvedValue(result)

		await expect(controller.deleteCatalogContent('catalog-1')).resolves.toBe(
			result
		)
		expect(service.deleteCatalogContent).toHaveBeenCalledWith('catalog-1')
	})
})

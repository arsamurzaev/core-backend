import { BadRequestException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { overrideControllerAuthGuards } from '@/shared/testing/controller-guards.testing'

import { ProductTypeController } from './product-type.controller'
import { ProductTypeService } from './product-type.service'

describe('ProductTypeController', () => {
	let controller: ProductTypeController
	let service: jest.Mocked<ProductTypeService>

	beforeEach(async () => {
		const module: TestingModule = await overrideControllerAuthGuards(
			Test.createTestingModule({
				controllers: [ProductTypeController],
				providers: [
					{
						provide: ProductTypeService,
						useValue: {
							getAll: jest.fn(),
							getById: jest.fn(),
							getMatrixEditorSchema: jest.fn(),
							getSystemTemplates: jest.fn(),
							getSystemTemplateById: jest.fn(),
							create: jest.fn(),
							createSystemTemplate: jest.fn(),
							createFromTemplate: jest.fn(),
							update: jest.fn(),
							updateSystemTemplate: jest.fn(),
							archive: jest.fn(),
							archiveSystemTemplate: jest.fn()
						}
					}
				]
			})
		).compile()

		controller = module.get<ProductTypeController>(ProductTypeController)
		service = module.get(ProductTypeService)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})

	it('passes includeArchived query to catalog list service', async () => {
		service.getAll.mockResolvedValue([])

		await controller.getAll('yes')

		expect(service.getAll).toHaveBeenCalledWith({ includeArchived: true })
	})

	it('passes false includeArchived query to system templates service', async () => {
		service.getSystemTemplates.mockResolvedValue([])

		await controller.getSystemTemplates('0')

		expect(service.getSystemTemplates).toHaveBeenCalledWith({
			includeArchived: false
		})
	})

	it('rejects invalid includeArchived query value', async () => {
		await expect(controller.getAll('later')).rejects.toBeInstanceOf(
			BadRequestException
		)

		expect(service.getAll).not.toHaveBeenCalled()
	})

	it('delegates template copy to service', async () => {
		service.createFromTemplate.mockResolvedValue({ id: 'product-type-id' } as any)

		await controller.createFromTemplate('template-id', { name: 'Shoes' })

		expect(service.createFromTemplate).toHaveBeenCalledWith('template-id', {
			name: 'Shoes'
		})
	})

	it('delegates matrix editor schema lookup to service', async () => {
		service.getMatrixEditorSchema.mockResolvedValue({
			type: { id: 'product-type-id' },
			attributes: [],
			variantAttributes: [],
			requiredAttributes: [],
			enumValues: []
		} as any)

		await controller.getMatrixEditorSchema('product-type-id')

		expect(service.getMatrixEditorSchema).toHaveBeenCalledWith('product-type-id')
	})
})

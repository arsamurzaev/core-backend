import { Test, TestingModule } from '@nestjs/testing'

import { overrideControllerAuthGuards } from '@/shared/testing/controller-guards.testing'

import { ProductReadService } from './product-read.service'
import { ProductController } from './product.controller'
import { ProductService } from './product.service'

describe('ProductController', () => {
	let controller: ProductController
	let productService: jest.Mocked<ProductService>
	let productReads: jest.Mocked<ProductReadService>

	beforeEach(async () => {
		const module: TestingModule = await overrideControllerAuthGuards(
			Test.createTestingModule({
				controllers: [ProductController],
				providers: [
					{
						provide: ProductService,
						useValue: {
							create: jest.fn(),
							duplicate: jest.fn(),
							diagnoseDefaultVariantsForCurrentCatalog: jest.fn(),
							repairMissingDefaultVariantsForCurrentCatalog: jest.fn(),
							repairDefaultVariantPriceMismatchesForCurrentCatalog: jest.fn(),
							previewProductTypeCompatibility: jest.fn(),
							applyProductTypeChange: jest.fn(),
							update: jest.fn(),
							updateCategoryPosition: jest.fn(),
							setVariants: jest.fn(),
							setVariantMatrix: jest.fn(),
							toggleStatus: jest.fn(),
							togglePopular: jest.fn(),
							remove: jest.fn()
						}
					},
					{
						provide: ProductReadService,
						useValue: {
							getAll: jest.fn(),
							getInfiniteCards: jest.fn(),
							getInfinite: jest.fn(),
							getRecommendationsInfiniteCards: jest.fn(),
							getRecommendationsInfinite: jest.fn(),
							getUncategorizedInfiniteCards: jest.fn(),
							getUncategorizedInfinite: jest.fn(),
							getPopularCards: jest.fn(),
							getPopular: jest.fn(),
							getById: jest.fn(),
							getBySlug: jest.fn()
						}
					}
				]
			})
		).compile()

		controller = module.get<ProductController>(ProductController)
		productService = module.get(ProductService)
		productReads = module.get(ProductReadService)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})

	it('delegates product reads to product read service', async () => {
		const response = [{ id: 'product-1' }]
		productReads.getAll.mockResolvedValue(response as any)

		await expect(
			controller.getAll(
				{ user: undefined } as any,
				{ getHeader: jest.fn(), setHeader: jest.fn() } as any
			)
		).resolves.toBe(response)
		expect(productReads.getAll).toHaveBeenCalled()
		expect(productService.create).not.toHaveBeenCalled()
	})

	it('delegates variant matrix replacement to product service', async () => {
		const dto = {
			items: [
				{
					price: 100,
					stock: 2,
					attributes: [
						{
							attributeId: 'size-attribute',
							enumValueId: 'size-s'
						}
					]
				}
			]
		}
		const response = { ok: true, id: 'product-1' }
		productService.setVariantMatrix.mockResolvedValue(response as any)

		await expect(controller.setVariantMatrix('product-1', dto)).resolves.toBe(
			response
		)
		expect(productService.setVariantMatrix).toHaveBeenCalledWith('product-1', dto)
	})

	it('delegates default variant diagnostics to product service', async () => {
		const response = {
			catalogId: 'catalog-1',
			sampleLimit: 5,
			checks: [],
			warnCount: 0,
			failCount: 0,
			ok: true
		}
		productService.diagnoseDefaultVariantsForCurrentCatalog.mockResolvedValue(
			response
		)

		await expect(controller.diagnoseDefaultVariants('5')).resolves.toBe(response)
		expect(
			productService.diagnoseDefaultVariantsForCurrentCatalog
		).toHaveBeenCalledWith(5)
	})

	it('delegates default variant price mismatch repair to product service', async () => {
		const dto = { apply: true, batchSize: 10, sampleLimit: 2 }
		const response = {
			catalogId: 'catalog-1',
			dryRun: false,
			checkedProducts: 1,
			repairableProducts: 1,
			updatedProducts: 1,
			affectedCatalogs: 1,
			batchSize: 10,
			sampleLimit: 2,
			samples: []
		}
		productService.repairDefaultVariantPriceMismatchesForCurrentCatalog.mockResolvedValue(
			response
		)

		await expect(
			controller.repairDefaultVariantPriceMismatches(dto)
		).resolves.toBe(response)
		expect(
			productService.repairDefaultVariantPriceMismatchesForCurrentCatalog
		).toHaveBeenCalledWith(dto)
	})

	it('delegates product type compatibility preview to product service', async () => {
		const dto = { productTypeId: 'product-type-1' }
		const response = {
			productId: 'product-1',
			canChangeNow: true,
			compatible: true
		}
		productService.previewProductTypeCompatibility.mockResolvedValue(
			response as any
		)

		await expect(
			controller.previewProductTypeCompatibility('product-1', dto)
		).resolves.toBe(response)
		expect(productService.previewProductTypeCompatibility).toHaveBeenCalledWith(
			'product-1',
			dto
		)
	})

	it('delegates explicit product type change apply to product service', async () => {
		const dto = {
			productTypeId: 'product-type-1',
			confirm: true as const,
			removeAttributeIds: ['material-attribute']
		}
		const response = { ok: true, id: 'product-1' }
		productService.applyProductTypeChange.mockResolvedValue(response as any)

		await expect(
			controller.applyProductTypeChange('product-1', dto)
		).resolves.toBe(response)
		expect(productService.applyProductTypeChange).toHaveBeenCalledWith(
			'product-1',
			dto
		)
	})
})

import { Test, TestingModule } from '@nestjs/testing'
import { NotFoundException } from '@nestjs/common'

import { CategoryRepository } from './category.repository'
import { CategoryService } from './category.service'
import { RequestContext } from '../../shared/tenancy/request-context'

describe('CategoryService', () => {
	let service: CategoryService
	let repo: jest.Mocked<CategoryRepository>

	const runWithCatalog = <T>(fn: () => Promise<T>) =>
		RequestContext.run(
			{
				requestId: 'req-1',
				host: 'example.test',
				catalogId: 'catalog-1'
			},
			fn
		)

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
						findProductsByIds: jest.fn(),
						findCategoryProductsPage: jest.fn()
					}
				}
			]
		}).compile()

		service = module.get<CategoryService>(CategoryService)
		repo = module.get(CategoryRepository) as jest.Mocked<CategoryRepository>
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	it('returns page and nextCursor when more items exist', async () => {
		repo.findById.mockResolvedValue({ id: 'cat-1', catalogId: 'catalog-1' } as any)
		repo.findCategoryProductsPage.mockResolvedValue([
			{ productId: 'p1', position: 0, product: { id: 'p1' } },
			{ productId: 'p2', position: 1, product: { id: 'p2' } },
			{ productId: 'p3', position: 2, product: { id: 'p3' } }
		] as any)

		const result = await runWithCatalog(() =>
			service.getProductsByCategory('cat-1', { limit: 2 })
		)

		const expectedCursor = Buffer.from(
			JSON.stringify({ position: 1, productId: 'p2' })
		).toString('base64')

		expect(repo.findCategoryProductsPage).toHaveBeenCalledWith(
			'cat-1',
			'catalog-1',
			{ cursor: undefined, take: 3 }
		)
		expect(result.items.map(item => item.productId)).toEqual(['p1', 'p2'])
		expect(result.nextCursor).toBe(expectedCursor)
	})

	it('returns null nextCursor when last page', async () => {
		repo.findById.mockResolvedValue({ id: 'cat-1', catalogId: 'catalog-1' } as any)
		repo.findCategoryProductsPage.mockResolvedValue([
			{ productId: 'p1', position: 0, product: { id: 'p1' } },
			{ productId: 'p2', position: 1, product: { id: 'p2' } }
		] as any)

		const result = await runWithCatalog(() =>
			service.getProductsByCategory('cat-1', { limit: 2 })
		)

		expect(result.items.map(item => item.productId)).toEqual(['p1', 'p2'])
		expect(result.nextCursor).toBeNull()
	})

	it('throws when category not found', async () => {
		repo.findById.mockResolvedValue(null)

		await expect(
			runWithCatalog(() => service.getProductsByCategory('cat-1'))
		).rejects.toBeInstanceOf(NotFoundException)
	})
})

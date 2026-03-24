import { NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { CacheService } from '@/shared/cache/cache.service'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'

import { RequestContext } from '../../shared/tenancy/request-context'

import { CategoryRepository } from './category.repository'
import { CategoryService } from './category.service'

describe('CategoryService', () => {
	let service: CategoryService
	let serviceState: {
		firstPageCacheTtlSec: number
		nextPageCacheTtlSec: number
	}
	let repo: jest.Mocked<CategoryRepository>
	let cache: jest.Mocked<CacheService>

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
						findCategoryProductPositions: jest.fn(),
						findCategoryProductsPage: jest.fn()
					}
				},
				{
					provide: CacheService,
					useValue: {
						buildKey: jest.fn(),
						getVersion: jest.fn(),
						bumpVersion: jest.fn(),
						getJson: jest.fn(),
						setJson: jest.fn(),
						del: jest.fn()
					}
				},
				{
					provide: MediaRepository,
					useValue: {
						findById: jest.fn(),
						findByIds: jest.fn()
					}
				},
				{
					provide: MediaUrlService,
					useValue: {
						mapMedia: jest.fn()
					}
				}
			]
		}).compile()

		service = module.get<CategoryService>(CategoryService)
		serviceState = service as unknown as {
			firstPageCacheTtlSec: number
			nextPageCacheTtlSec: number
		}
		repo = module.get(CategoryRepository)
		cache = module.get(CacheService)

		cache.buildKey.mockImplementation(parts =>
			parts
				.filter(part => part !== undefined && part !== null && part !== '')
				.map(part => String(part))
				.join(':')
		)
		cache.getVersion.mockResolvedValue(0)
		cache.getJson.mockResolvedValue(null)
		cache.setJson.mockResolvedValue(undefined)
		serviceState.firstPageCacheTtlSec = 0
		serviceState.nextPageCacheTtlSec = 0
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	it('returns integration metadata in category product pages', async () => {
		const syncedAt = new Date('2026-03-23T15:37:00.336Z')

		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)
		repo.findCategoryProductsPage.mockResolvedValue([
			{
				productId: 'p1',
				position: 0,
				product: {
					id: 'p1',
					media: [],
					integrationLinks: [
						{
							externalId: 'ms-123',
							externalCode: 'code-123',
							lastSyncedAt: syncedAt,
							integration: { provider: 'MOYSKLAD' }
						}
					]
				}
			}
		] as any)

		const result = await runWithCatalog(() =>
			service.getProductsByCategory('cat-1', { limit: 2 })
		)

		expect(result.items[0]).toMatchObject({
			productId: 'p1',
			product: {
				id: 'p1',
				integration: {
					provider: 'MOYSKLAD',
					externalId: 'ms-123',
					externalCode: 'code-123',
					lastSyncedAt: syncedAt
				}
			}
		})
	})

	it('returns page and nextCursor when more items exist', async () => {
		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)
		repo.findCategoryProductsPage.mockResolvedValue([
			{ productId: 'p1', position: 0, product: { id: 'p1', media: [] } },
			{ productId: 'p2', position: 1, product: { id: 'p2', media: [] } },
			{ productId: 'p3', position: 2, product: { id: 'p3', media: [] } }
		] as any)

		const result = await runWithCatalog(() =>
			service.getProductsByCategory('cat-1', { limit: 2 })
		)

		const expectedCursor = Buffer.from(
			JSON.stringify({ position: 1, productId: 'p2' })
		).toString('base64')

		expect(repo.findCategoryProductsPage.mock.calls).toContainEqual([
			'cat-1',
			'catalog-1',
			{ cursor: undefined, take: 3, includeInactive: false }
		])
		expect(result.items.map(item => item.productId)).toEqual(['p1', 'p2'])
		expect(result.nextCursor).toBe(expectedCursor)
	})

	it('returns null nextCursor when last page', async () => {
		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)
		repo.findCategoryProductsPage.mockResolvedValue([
			{ productId: 'p1', position: 0, product: { id: 'p1', media: [] } },
			{ productId: 'p2', position: 1, product: { id: 'p2', media: [] } }
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

	it('returns cached page for category products when cache is warm', async () => {
		serviceState.firstPageCacheTtlSec = 120

		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)

		const cached = {
			items: [{ productId: 'p1', position: 0, product: { id: 'p1', media: [] } }],
			nextCursor: null
		}
		cache.getJson.mockResolvedValue(cached as any)

		const result = await runWithCatalog(() =>
			service.getProductsByCategory('cat-1', { limit: 2 })
		)

		expect(result).toEqual(cached)
		expect(repo.findCategoryProductsPage.mock.calls).toHaveLength(0)
		expect(cache.getJson.mock.calls.length).toBeGreaterThan(0)
	})

	it('skips category products cache in includeInactive mode', async () => {
		serviceState.firstPageCacheTtlSec = 120

		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)
		repo.findCategoryProductsPage.mockResolvedValue([] as any)

		await runWithCatalog(() =>
			service.getProductsByCategory('cat-1', {
				limit: 2,
				includeInactive: true
			})
		)

		expect(cache.getJson).not.toHaveBeenCalled()
		expect(repo.findCategoryProductsPage).toHaveBeenCalledWith(
			'cat-1',
			'catalog-1',
			{ cursor: undefined, take: 3, includeInactive: true }
		)
	})

	it('appends new products to the end of category when positions are omitted', async () => {
		repo.findProductsByIds.mockResolvedValue([
			{ id: 'p1' },
			{ id: 'p2' },
			{ id: 'p3' },
			{ id: 'p4' }
		] as any)
		repo.findCategoryProductPositions.mockResolvedValue([
			{ productId: 'p1', position: 10 },
			{ productId: 'p2', position: 12 }
		] as any)
		repo.update.mockResolvedValue({
			id: 'cat-1',
			imageMedia: null,
			children: []
		} as any)

		await runWithCatalog(() =>
			service.update('cat-1', {
				products: [
					{ productId: 'p1' },
					{ productId: 'p2' },
					{ productId: 'p3' },
					{ productId: 'p4' }
				]
			})
		)

		expect(repo.update.mock.calls[0]).toEqual([
			'cat-1',
			'catalog-1',
			expect.objectContaining({
				categoryProducts: {
					deleteMany: {},
					create: [
						{ product: { connect: { id: 'p1' } }, position: 10 },
						{ product: { connect: { id: 'p2' } }, position: 12 },
						{ product: { connect: { id: 'p3' } }, position: 13 },
						{ product: { connect: { id: 'p4' } }, position: 14 }
					]
				}
			})
		])
	})

	it('builds category products for create using explicit and appended positions', async () => {
		repo.findProductsByIds.mockResolvedValue([
			{ id: 'p1' },
			{ id: 'p2' },
			{ id: 'p3' }
		] as any)
		repo.create.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)

		await runWithCatalog(() =>
			service.create({
				name: 'Test category',
				products: [
					{ productId: 'p1', position: 5 },
					{ productId: 'p2' },
					{ productId: 'p3' }
				]
			} as any)
		)

		expect(repo.create.mock.calls[0]).toEqual([
			expect.objectContaining({
				categoryProducts: {
					create: [
						{ product: { connect: { id: 'p1' } }, position: 5 },
						{ product: { connect: { id: 'p2' } }, position: 6 },
						{ product: { connect: { id: 'p3' } }, position: 7 }
					]
				}
			})
		])
	})
})

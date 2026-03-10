import { Test, TestingModule } from '@nestjs/testing'

import { CacheService } from '@/shared/cache/cache.service'
import {
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { RequestContext } from '@/shared/tenancy/request-context'

import { ProductAttributeBuilder } from './product-attribute.builder'
import { ProductVariantBuilder } from './product-variant.builder'
import { ProductRepository } from './product.repository'
import { ProductService } from './product.service'

describe('ProductService', () => {
	let service: ProductService
	let repo: jest.Mocked<ProductRepository>
	let attributeBuilder: jest.Mocked<ProductAttributeBuilder>
	let cache: jest.Mocked<CacheService>

	const runWithCatalog = <T>(fn: () => Promise<T>) =>
		RequestContext.run(
			{
				requestId: 'req-1',
				host: 'example.test',
				catalogId: 'catalog-1',
				typeId: 'type-1'
			},
			fn
		)

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ProductService,
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
					provide: ProductAttributeBuilder,
					useValue: {
						buildForCreate: jest.fn(),
						buildForUpdate: jest.fn()
					}
				},
				{
					provide: ProductVariantBuilder,
					useValue: {
						build: jest.fn()
					}
				},
				{
					provide: ProductRepository,
					useValue: {
						findAll: jest.fn(),
						findPopular: jest.fn(),
						findById: jest.fn(),
						findBySlug: jest.fn(),
						findByIdsWithAttributes: jest.fn(),
						findFilteredProductIdsPageDefault: jest.fn(),
						findFilteredProductIdsPageSeeded: jest.fn(),
						findAttributesByTypeAndKeys: jest.fn(),
						findBrandById: jest.fn(),
						findCategoryById: jest.fn(),
						findCategoriesByIds: jest.fn(),
						existsSlug: jest.fn(),
						existsName: jest.fn(),
						existsSku: jest.fn(),
						create: jest.fn(),
						update: jest.fn(),
						softDelete: jest.fn(),
						upsertCategoryProductPosition: jest.fn()
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

		service = module.get<ProductService>(ProductService)
		repo = module.get(ProductRepository)
		attributeBuilder = module.get(ProductAttributeBuilder)
		cache = module.get(CacheService)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	it('returns seeded infinite page with next cursor', async () => {
		repo.findAttributesByTypeAndKeys.mockResolvedValue([] as any)
		repo.findFilteredProductIdsPageSeeded.mockResolvedValue([
			{ id: 'product-1', score: '001' },
			{ id: 'product-2', score: '010' },
			{ id: 'product-3', score: '100' }
		] as any)
		repo.findByIdsWithAttributes.mockResolvedValue([
			{ id: 'product-1', media: [] },
			{ id: 'product-2', media: [] }
		] as any)

		const result = await runWithCatalog(() =>
			service.getInfinite({
				limit: '2',
				seed: 'seed-1'
			})
		)

		expect(result.items).toHaveLength(2)
		expect(result.seed).toBe('seed-1')
		expect(result.nextCursor).toEqual(expect.any(String))
		expect(repo.findFilteredProductIdsPageSeeded.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				catalogId: 'catalog-1',
				seed: 'seed-1',
				take: 3
			})
		)
	})

	it('allows using one brand for multiple products', async () => {
		repo.findBrandById.mockResolvedValue({ id: 'brand-1' } as any)
		repo.existsSlug.mockResolvedValue(false)
		repo.existsName.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.create
			.mockResolvedValueOnce({ id: 'product-1', slug: 'first' } as any)
			.mockResolvedValueOnce({ id: 'product-2', slug: 'second' } as any)
		attributeBuilder.buildForCreate.mockResolvedValue([])

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'First Product',
					price: 100,
					brandId: 'brand-1'
				})
			)
		).resolves.toEqual({ ok: true, id: 'product-1', slug: 'first' })

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'Second Product',
					price: 120,
					brandId: 'brand-1'
				})
			)
		).resolves.toEqual({ ok: true, id: 'product-2', slug: 'second' })

		expect(repo.findBrandById.mock.calls).toHaveLength(2)
	})

	it('rejects duplicate product name in catalog', async () => {
		repo.existsName.mockResolvedValue(true)

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'Duplicate Product',
					price: 100
				})
			)
		).rejects.toThrow(
			'РўРѕРІР°СЂ СЃ С‚Р°РєРёРј РЅР°Р·РІР°РЅРёРµРј СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚'
		)
	})

	it('adds created product to categories with first position', async () => {
		repo.existsSlug.mockResolvedValue(false)
		repo.existsName.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.findCategoriesByIds.mockResolvedValue([
			{ id: 'category-1' },
			{ id: 'category-2' }
		] as any)
		repo.create.mockResolvedValue({ id: 'product-1', slug: 'first' } as any)
		attributeBuilder.buildForCreate.mockResolvedValue([])

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'Product in Category',
					price: 100,
					categories: ['category-1', 'category-2']
				})
			)
		).resolves.toEqual({ ok: true, id: 'product-1', slug: 'first' })

		expect(repo.upsertCategoryProductPosition.mock.calls).toContainEqual([
			'product-1',
			'category-1',
			'catalog-1',
			0
		])
		expect(repo.upsertCategoryProductPosition.mock.calls).toContainEqual([
			'product-1',
			'category-2',
			'catalog-1',
			0
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
	})

	it('updates category position when categoryId and categoryPosition are passed', async () => {
		repo.findCategoryById.mockResolvedValue({ id: 'category-1' } as any)
		repo.update.mockResolvedValue({ id: 'product-1', media: [] } as any)

		await expect(
			runWithCatalog(() =>
				service.update('product-1', {
					categoryId: 'category-1',
					categoryPosition: 3
				})
			)
		).resolves.toMatchObject({ ok: true, id: 'product-1' })

		expect(repo.upsertCategoryProductPosition.mock.calls).toContainEqual([
			'product-1',
			'category-1',
			'catalog-1',
			3
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
	})

	it('rejects categoryPosition without categoryId', async () => {
		await expect(
			runWithCatalog(() =>
				service.update('product-1', {
					categoryPosition: 2
				})
			)
		).rejects.toThrow(
			'categoryPosition можно передать только вместе с categoryId'
		)
	})

	it('invalidates category products cache on remove', async () => {
		repo.softDelete.mockResolvedValue({ id: 'product-1' } as any)

		await expect(
			runWithCatalog(() => service.remove('product-1'))
		).resolves.toEqual({ ok: true })

		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
	})
})

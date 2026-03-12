import { Test, TestingModule } from '@nestjs/testing'

import { CacheService } from '@/shared/cache/cache.service'
import {
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { RequestContext } from '@/shared/tenancy/request-context'

import type { ProductAttributeValueDto } from './dto/requests/product-attribute.dto.req'
import { ProductAttributeBuilder } from './product-attribute.builder'
import type { ProductAttributeValueData } from './product-attribute.builder'
import {
	encodeProductDefaultCursor,
	encodeProductSeedCursor
} from './product-query.utils'
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
						buildForUpdate: jest.fn(),
						prepareRemovedAttributeIdsForUpdate: jest.fn()
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

	it('returns default infinite page with next cursor', async () => {
		repo.findAttributesByTypeAndKeys.mockResolvedValue([] as any)
		repo.findFilteredProductIdsPageDefault.mockResolvedValue([
			{ id: 'product-1', updatedAt: new Date('2026-03-12T10:00:00.000Z') },
			{ id: 'product-2', updatedAt: new Date('2026-03-12T09:00:00.000Z') },
			{ id: 'product-3', updatedAt: new Date('2026-03-12T08:00:00.000Z') }
		] as any)
		repo.findByIdsWithAttributes.mockResolvedValue([
			{ id: 'product-1', media: [] },
			{ id: 'product-2', media: [] }
		] as any)

		const result = await runWithCatalog(() =>
			service.getInfinite({
				limit: '2'
			})
		)

		expect(result.items).toHaveLength(2)
		expect(result.seed).toBeNull()
		expect(result.nextCursor).toEqual(expect.any(String))
		expect(repo.findFilteredProductIdsPageDefault.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				catalogId: 'catalog-1',
				take: 3,
				cursor: undefined
			})
		)
	})

	it('passes decoded default cursor to default infinite query', async () => {
		const updatedAt = new Date('2026-03-11T10:00:00.000Z')
		const cursor = encodeProductDefaultCursor({
			id: 'product-9',
			updatedAt
		})

		repo.findAttributesByTypeAndKeys.mockResolvedValue([] as any)
		repo.findFilteredProductIdsPageDefault.mockResolvedValue([] as any)
		repo.findByIdsWithAttributes.mockResolvedValue([] as any)

		const result = await runWithCatalog(() =>
			service.getInfinite({
				limit: '2',
				cursor
			})
		)

		expect(result.seed).toBeNull()
		expect(result.nextCursor).toBeNull()
		expect(repo.findFilteredProductIdsPageDefault.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				catalogId: 'catalog-1',
				take: 3,
				cursor: {
					id: 'product-9',
					updatedAt
				}
			})
		)
	})

	it('reuses seeded cursor when explicit seed is not passed', async () => {
		const cursor = encodeProductSeedCursor('seed-1', {
			id: 'product-9',
			score: '009'
		})

		repo.findAttributesByTypeAndKeys.mockResolvedValue([] as any)
		repo.findFilteredProductIdsPageSeeded.mockResolvedValue([] as any)
		repo.findByIdsWithAttributes.mockResolvedValue([] as any)

		const result = await runWithCatalog(() =>
			service.getInfinite({
				limit: '2',
				cursor
			})
		)

		expect(result.seed).toBe('seed-1')
		expect(repo.findFilteredProductIdsPageSeeded.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				catalogId: 'catalog-1',
				seed: 'seed-1',
				take: 3,
				cursor: {
					id: 'product-9',
					score: '009'
				}
			})
		)
	})

	it('ignores seeded cursor when query seed changes', async () => {
		const cursor = encodeProductSeedCursor('seed-1', {
			id: 'product-9',
			score: '009'
		})

		repo.findAttributesByTypeAndKeys.mockResolvedValue([] as any)
		repo.findFilteredProductIdsPageSeeded.mockResolvedValue([] as any)
		repo.findByIdsWithAttributes.mockResolvedValue([] as any)

		const result = await runWithCatalog(() =>
			service.getInfinite({
				limit: '2',
				seed: 'seed-2',
				cursor
			})
		)

		expect(result.seed).toBe('seed-2')
		expect(repo.findFilteredProductIdsPageSeeded.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				catalogId: 'catalog-1',
				seed: 'seed-2',
				take: 3,
				cursor: undefined
			})
		)
	})

	it('resolves discount attribute ids only for discount infinite filter', async () => {
		repo.findAttributesByTypeAndKeys.mockResolvedValueOnce([
			{ id: 'discount-id', key: 'discount' },
			{ id: 'discount-start-id', key: 'discountStartAt' },
			{ id: 'discount-end-id', key: 'discountEndAt' }
		] as any)
		repo.findFilteredProductIdsPageDefault.mockResolvedValue([] as any)
		repo.findByIdsWithAttributes.mockResolvedValue([] as any)

		const result = await runWithCatalog(() =>
			service.getInfinite({
				limit: '2',
				isDiscount: 'true'
			})
		)

		expect(result.seed).toBeNull()
		expect(repo.findFilteredProductIdsPageDefault.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				catalogId: 'catalog-1',
				isDiscount: true,
				discountAttributeIds: {
					discountId: 'discount-id',
					discountStartAtId: 'discount-start-id',
					discountEndAtId: 'discount-end-id'
				}
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
		).rejects.toThrow('Товар с таким названием уже существует')
	})

	it('rejects removing and updating the same attribute in one request', async () => {
		const attributes: ProductAttributeValueDto[] = [
			{ attributeId: 'attribute-1', valueString: 'value' }
		]
		const builtAttributes: ProductAttributeValueData[] = [
			{ attributeId: 'attribute-1' }
		]

		attributeBuilder.buildForUpdate.mockResolvedValue(builtAttributes)
		attributeBuilder.prepareRemovedAttributeIdsForUpdate.mockResolvedValue([
			'attribute-1'
		])

		await expect(
			runWithCatalog(() =>
				service.update('product-1', {
					attributes,
					removeAttributeIds: ['attribute-1']
				})
			)
		).rejects.toThrow(
			'Атрибуты нельзя одновременно обновлять и удалять: attribute-1'
		)

		expect(repo.update.mock.calls).toHaveLength(0)
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

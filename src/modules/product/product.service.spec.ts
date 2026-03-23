import { Test, TestingModule } from '@nestjs/testing'

import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_TYPE_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { RequestContext } from '@/shared/tenancy/request-context'
import { S3Service } from '@/modules/s3/s3.service'

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
	let serviceState: {
		uncategorizedFirstPageCacheTtlSec: number
		uncategorizedNextPageCacheTtlSec: number
	}
	let repo: jest.Mocked<ProductRepository>
	let attributeBuilder: jest.Mocked<ProductAttributeBuilder>
	let variantBuilder: jest.Mocked<ProductVariantBuilder>
	let cache: jest.Mocked<CacheService>
	let mediaRepo: jest.Mocked<MediaRepository>
	let s3Service: jest.Mocked<S3Service>

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
						findUncategorizedPage: jest.fn(),
						findFilteredProductIdsPageDefault: jest.fn(),
						findFilteredProductIdsPageSeeded: jest.fn(),
						findRecommendedProductIdsPageDefault: jest.fn(),
						findRecommendedProductIdsPageSeeded: jest.fn(),
						findAttributesByTypeAndKeys: jest.fn(),
						findBrandById: jest.fn(),
						findCategoryById: jest.fn(),
						findCategoriesByIds: jest.fn(),
						existsSlug: jest.fn(),
						existsName: jest.fn(),
						existsSku: jest.fn(),
						create: jest.fn(),
						update: jest.fn(),
						toggleStatus: jest.fn(),
						togglePopular: jest.fn(),
						softDelete: jest.fn(),
						syncProductCategories: jest.fn(),
						upsertCategoryProductPosition: jest.fn()
					}
				},
				{
					provide: MediaRepository,
					useValue: {
						findById: jest.fn(),
						findByIds: jest.fn(),
						findOrphanedByIds: jest.fn(),
						deleteOrphanedByIds: jest.fn()
					}
				},
				{
					provide: MediaUrlService,
					useValue: {
						mapMedia: jest.fn()
					}
				},
				{
					provide: S3Service,
					useValue: {
						deleteObjectsByKeys: jest.fn()
					}
				}
			]
		}).compile()

		service = module.get<ProductService>(ProductService)
		serviceState = service as unknown as {
			uncategorizedFirstPageCacheTtlSec: number
			uncategorizedNextPageCacheTtlSec: number
		}
		repo = module.get(ProductRepository)
		attributeBuilder = module.get(ProductAttributeBuilder)
		variantBuilder = module.get(ProductVariantBuilder)
		cache = module.get(CacheService)
		mediaRepo = module.get(MediaRepository)
		s3Service = module.get(S3Service)

		cache.buildKey.mockImplementation(parts =>
			parts
				.filter(part => part !== undefined && part !== null && part !== '')
				.map(part => String(part))
				.join(':')
		)
		cache.getVersion.mockResolvedValue(0)
		cache.getJson.mockResolvedValue(null)
		cache.setJson.mockResolvedValue(undefined)
		serviceState.uncategorizedFirstPageCacheTtlSec = 0
		serviceState.uncategorizedNextPageCacheTtlSec = 0
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

	it('returns uncategorized page with next cursor', async () => {
		repo.findUncategorizedPage.mockResolvedValue([
			{
				id: 'product-1',
				updatedAt: new Date('2026-03-12T10:00:00.000Z'),
				media: [],
				categoryProducts: [],
				productAttributes: []
			},
			{
				id: 'product-2',
				updatedAt: new Date('2026-03-12T09:00:00.000Z'),
				media: [],
				categoryProducts: [],
				productAttributes: []
			},
			{
				id: 'product-3',
				updatedAt: new Date('2026-03-12T08:00:00.000Z'),
				media: [],
				categoryProducts: [],
				productAttributes: []
			}
		] as any)

		const result = await runWithCatalog(() =>
			service.getUncategorizedInfinite({
				limit: '2'
			})
		)

		expect(result.items).toHaveLength(2)
		expect(result.nextCursor).toEqual(expect.any(String))
		expect(repo.findUncategorizedPage).toHaveBeenCalledWith('catalog-1', {
			cursor: undefined,
			take: 3,
			includeInactive: false
		})
	})

	it('passes includeInactive to infinite product loading', async () => {
		repo.findAttributesByTypeAndKeys.mockResolvedValue([] as any)
		repo.findFilteredProductIdsPageDefault.mockResolvedValue([
			{ id: 'product-1', updatedAt: new Date('2026-03-12T10:00:00.000Z') }
		] as any)
		repo.findByIdsWithAttributes.mockResolvedValue([
			{ id: 'product-1', media: [], categoryProducts: [], productAttributes: [] }
		] as any)

		await runWithCatalog(() =>
			service.getInfinite(
				{
					limit: '2'
				},
				{ includeInactive: true }
			)
		)

		expect(repo.findFilteredProductIdsPageDefault.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				catalogId: 'catalog-1',
				includeInactive: true
			})
		)
		expect(repo.findByIdsWithAttributes).toHaveBeenCalledWith(
			['product-1'],
			'catalog-1',
			true
		)
	})

	it('returns seeded recommendations page with next cursor', async () => {
		repo.findRecommendedProductIdsPageSeeded.mockResolvedValue([
			{ id: 'product-4', score: '001' },
			{ id: 'product-5', score: '010' },
			{ id: 'product-6', score: '100' }
		] as any)
		repo.findByIdsWithAttributes.mockResolvedValue([
			{ id: 'product-4', media: [], categoryProducts: [], productAttributes: [] },
			{ id: 'product-5', media: [], categoryProducts: [], productAttributes: [] }
		] as any)
		repo.findAttributesByTypeAndKeys.mockResolvedValue([] as any)

		const result = await runWithCatalog(() =>
			service.getRecommendationsInfinite({
				limit: '2',
				seed: 'seed-1',
				brands: 'brand-1'
			})
		)

		expect(result.items).toHaveLength(2)
		expect(result.seed).toBe('seed-1')
		expect(result.nextCursor).toEqual(expect.any(String))
		expect(repo.findRecommendedProductIdsPageSeeded.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				catalogId: 'catalog-1',
				seed: 'seed-1',
				brandIds: ['brand-1'],
				take: 3
			})
		)
	})

	it('returns empty recommendations when no active filters are passed', async () => {
		repo.findAttributesByTypeAndKeys.mockResolvedValue([] as any)

		const result = await runWithCatalog(() =>
			service.getRecommendationsInfinite({
				limit: '2',
				seed: 'seed-1'
			})
		)

		expect(result).toEqual({
			items: [],
			nextCursor: null,
			seed: 'seed-1'
		})
		expect(repo.findRecommendedProductIdsPageDefault).not.toHaveBeenCalled()
		expect(repo.findRecommendedProductIdsPageSeeded).not.toHaveBeenCalled()
	})

	it('returns cached uncategorized page when cache is warm', async () => {
		serviceState.uncategorizedFirstPageCacheTtlSec = 120
		const cached = {
			items: [{ id: 'product-1', media: [], categories: [], productAttributes: [] }],
			nextCursor: null
		}
		cache.getJson.mockResolvedValue(cached as any)

		const result = await runWithCatalog(() =>
			service.getUncategorizedInfinite({
				limit: '2'
			})
		)

		expect(result).toEqual(cached)
		expect(repo.findUncategorizedPage).not.toHaveBeenCalled()
		expect(cache.getJson.mock.calls.length).toBeGreaterThan(0)
	})

	it('skips uncategorized cache in includeInactive mode', async () => {
		serviceState.uncategorizedFirstPageCacheTtlSec = 120
		repo.findUncategorizedPage.mockResolvedValue([] as any)

		await runWithCatalog(() =>
			service.getUncategorizedInfinite({
				limit: '2',
				includeInactive: true
			})
		)

		expect(cache.getJson).not.toHaveBeenCalled()
		expect(repo.findUncategorizedPage).toHaveBeenCalledWith('catalog-1', {
			cursor: undefined,
			take: 3,
			includeInactive: true
		})
	})

	it('allows using one brand for multiple products', async () => {
		repo.findBrandById.mockResolvedValue({ id: 'brand-1' } as any)
		repo.existsSlug.mockResolvedValue(false)
		repo.existsName.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.findById
			.mockResolvedValueOnce({
				id: 'product-1',
				slug: 'first',
				media: [],
				productAttributes: [],
				variants: [],
				categoryProducts: []
			} as any)
			.mockResolvedValueOnce({
				id: 'product-2',
				slug: 'second',
				media: [],
				productAttributes: [],
				variants: [],
				categoryProducts: []
			} as any)
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
		).resolves.toMatchObject({ ok: true, id: 'product-1', slug: 'first' })

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'Second Product',
					price: 120,
					brandId: 'brand-1'
				})
			)
		).resolves.toMatchObject({ ok: true, id: 'product-2', slug: 'second' })

		expect(repo.findBrandById.mock.calls).toHaveLength(2)
	})

	it('creates product with variants when they are passed', async () => {
		repo.existsSlug.mockResolvedValue(false)
		repo.existsName.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.create.mockResolvedValue({ id: 'product-1', slug: 'with-variants' } as any)
		repo.findById.mockResolvedValue({
			id: 'product-1',
			slug: 'with-variants',
			media: [],
			productAttributes: [],
			variants: [{ id: 'variant-1', attributes: [] }],
			categoryProducts: []
		} as any)
		attributeBuilder.buildForCreate.mockResolvedValue([])
		const builtVariants = [
			{
				sku: 'PRODUCT-1-S',
				variantKey: 'size=s',
				price: 100,
				stock: 5,
				status: 'ACTIVE',
				attributes: [{ attributeId: 'attribute-1', value: 's' }]
			}
		] as any
		variantBuilder.build.mockResolvedValue(builtVariants)

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'Product with variants',
					price: 100,
					variants: [
						{
							price: 100,
							stock: 5,
							attributes: [{ attributeId: 'attribute-1', value: 's' }]
						}
					]
				})
			)
		).resolves.toMatchObject({ ok: true, id: 'product-1', slug: 'with-variants' })

		expect(variantBuilder.build).toHaveBeenCalledWith(
			'type-1',
			expect.any(Array),
			expect.any(String)
		)
		expect(repo.create).toHaveBeenCalledWith(
			expect.any(Object),
			expect.any(Array),
			builtVariants
		)
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATALOG_TYPE_CACHE_VERSION,
			'type-1'
		])
	})

	it('duplicates product with hidden status and copied relations', async () => {
		repo.existsName.mockResolvedValue(false)
		repo.existsSlug.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.findBrandById.mockResolvedValue({ id: 'brand-1' } as any)
		repo.findById
			.mockResolvedValueOnce({
				id: 'product-1',
				name: 'Source Product',
				slug: 'source-product',
				price: 150,
				isPopular: true,
				status: 'ACTIVE',
				position: 7,
				brand: { id: 'brand-1', name: 'Brand', slug: 'brand' },
				media: [
					{
						position: 0,
						kind: 'gallery',
						media: { id: 'media-1' }
					}
				],
				productAttributes: [
					{
						attributeId: 'attribute-1',
						enumValueId: 'enum-attr-1',
						valueString: null,
						valueInteger: null,
						valueDecimal: null,
						valueBoolean: null,
						valueDateTime: null
					}
				],
				variants: [
					{
						price: 150,
						stock: 3,
						status: 'ACTIVE',
						attributes: [
							{
								attributeId: 'variant-attribute-1',
								enumValueId: 'enum-1'
							}
						]
					}
				],
				categoryProducts: [
					{
						position: 2,
						category: { id: 'category-1', name: 'Category 1' }
					},
					{
						position: 5,
						category: { id: 'category-2', name: 'Category 2' }
					}
				]
			} as any)
			.mockResolvedValueOnce({
				id: 'product-2',
				name: 'Source Product (копия)',
				slug: 'source-product-copy',
				status: 'HIDDEN',
				media: [],
				productAttributes: [],
				variants: [],
				categoryProducts: []
			} as any)
		repo.create.mockResolvedValue({
			id: 'product-2',
			slug: 'source-product-copy'
		} as any)
		const builtVariants = [
			{
				sku: 'SOURCE-PRODUCT-KOPIYA-ENUM-1',
				variantKey: 'size=enum-1',
				price: 150,
				stock: 3,
				status: 'ACTIVE',
				attributes: [
					{
						attributeId: 'variant-attribute-1',
						enumValueId: 'enum-1'
					}
				]
			}
		] as any
		variantBuilder.build.mockResolvedValue(builtVariants)

		await expect(
			runWithCatalog(() => service.duplicate('product-1'))
		).resolves.toMatchObject({
			ok: true,
			id: 'product-2',
			name: 'Source Product (копия)',
			status: 'HIDDEN'
		})

		expect(variantBuilder.build).toHaveBeenCalledWith(
			'type-1',
			[
				{
					price: 150,
					stock: 3,
					status: 'ACTIVE',
					attributes: [
						{
							attributeId: 'variant-attribute-1',
							enumValueId: 'enum-1'
						}
					]
				}
			],
			expect.any(String)
		)
		expect(repo.create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Source Product (копия)',
				status: 'HIDDEN',
				position: 7,
				brand: { connect: { id: 'brand-1' } },
				media: {
					create: [
						{
							position: 0,
							kind: 'gallery',
							media: { connect: { id: 'media-1' } }
						}
					]
				}
			}),
			[
				{
					attributeId: 'attribute-1',
					enumValueId: 'enum-attr-1',
					valueString: null,
					valueInteger: null,
					valueDecimal: null,
					valueBoolean: null,
					valueDateTime: null
				}
			],
			builtVariants
		)
		expect(repo.upsertCategoryProductPosition.mock.calls).toContainEqual([
			'product-2',
			'category-1',
			'catalog-1',
			0
		])
		expect(repo.upsertCategoryProductPosition.mock.calls).toContainEqual([
			'product-2',
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

	it('throws when duplicated product is not found', async () => {
		repo.findById.mockResolvedValue(null)

		await expect(
			runWithCatalog(() => service.duplicate('product-404'))
		).rejects.toThrow('Товар не найден')
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
		repo.findById.mockResolvedValue({
			id: 'product-1',
			slug: 'first',
			media: [],
			productAttributes: [],
			variants: [],
			categoryProducts: []
		} as any)
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
		).resolves.toMatchObject({ ok: true, id: 'product-1', slug: 'first' })

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

	it('syncs categories when categories are passed on update', async () => {
		repo.findCategoriesByIds.mockResolvedValue([
			{ id: 'category-1' },
			{ id: 'category-2' }
		] as any)
		repo.update.mockResolvedValue({ id: 'product-1', media: [] } as any)

		await expect(
			runWithCatalog(() =>
				service.update('product-1', {
					categories: ['category-1', 'category-2']
				})
			)
		).resolves.toMatchObject({ ok: true, id: 'product-1' })

		expect(repo.syncProductCategories).toHaveBeenCalledWith(
			'product-1',
			'catalog-1',
			['category-1', 'category-2']
		)
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
	})

	it('toggles product status and invalidates caches', async () => {
		repo.toggleStatus.mockResolvedValue({
			id: 'product-1',
			status: 'HIDDEN',
			media: [],
			productAttributes: [],
			variants: [],
			categoryProducts: []
		} as any)

		await expect(
			runWithCatalog(() => service.toggleStatus('product-1'))
		).resolves.toMatchObject({
			ok: true,
			id: 'product-1',
			status: 'HIDDEN'
		})

		expect(repo.toggleStatus).toHaveBeenCalledWith('product-1', 'catalog-1')
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
	})

	it('throws when toggled product is not found', async () => {
		repo.toggleStatus.mockResolvedValue(null)

		await expect(
			runWithCatalog(() => service.toggleStatus('product-404'))
		).rejects.toThrow('Товар не найден')
	})

	it('toggles product popularity and invalidates caches', async () => {
		repo.togglePopular.mockResolvedValue({
			id: 'product-1',
			isPopular: true,
			media: [],
			productAttributes: [],
			variants: [],
			categoryProducts: []
		} as any)

		await expect(
			runWithCatalog(() => service.togglePopular('product-1'))
		).resolves.toMatchObject({
			ok: true,
			id: 'product-1',
			isPopular: true
		})

		expect(repo.togglePopular).toHaveBeenCalledWith('product-1', 'catalog-1')
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
	})

	it('throws when toggled popular product is not found', async () => {
		repo.togglePopular.mockResolvedValue(null)

		await expect(
			runWithCatalog(() => service.togglePopular('product-404'))
		).rejects.toThrow('Товар не найден')
	})

	it('rejects categoryId outside categories when both are passed', async () => {
		repo.findCategoriesByIds.mockResolvedValue([
			{ id: 'category-1' },
			{ id: 'category-2' }
		] as any)
		repo.findCategoryById.mockResolvedValue({ id: 'category-3' } as any)

		await expect(
			runWithCatalog(() =>
				service.update('product-1', {
					categories: ['category-1', 'category-2'],
					categoryId: 'category-3'
				})
			)
		).rejects.toThrow(
			'categoryId должен входить в categories, если они переданы вместе'
		)

		expect(repo.update.mock.calls).toHaveLength(0)
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
		repo.softDelete.mockResolvedValue({
			id: 'product-1',
			mediaIds: ['media-1']
		} as any)
		mediaRepo.findOrphanedByIds.mockResolvedValue([
			{
				id: 'media-1',
				storage: 's3',
				key: 'catalogs/catalog-1/products/raw/image-1.jpg',
				variants: [
					{
						key: 'catalogs/catalog-1/products/card/image-1.webp',
						storage: 's3'
					}
				]
			}
		] as any)
		mediaRepo.deleteOrphanedByIds.mockResolvedValue(1)

		await expect(
			runWithCatalog(() => service.remove('product-1'))
		).resolves.toEqual({ ok: true })

		expect(mediaRepo.findOrphanedByIds).toHaveBeenCalledWith(
			['media-1'],
			'catalog-1'
		)
		expect(s3Service.deleteObjectsByKeys).toHaveBeenCalledWith([
			'catalogs/catalog-1/products/raw/image-1.jpg',
			'catalogs/catalog-1/products/card/image-1.webp'
		])
		expect(mediaRepo.deleteOrphanedByIds).toHaveBeenCalledWith(
			['media-1'],
			'catalog-1'
		)
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
	})

	it('does not delete shared media files on remove', async () => {
		repo.softDelete.mockResolvedValue({
			id: 'product-1',
			mediaIds: ['media-1']
		} as any)
		mediaRepo.findOrphanedByIds.mockResolvedValue([])

		await expect(
			runWithCatalog(() => service.remove('product-1'))
		).resolves.toEqual({ ok: true })

		expect(s3Service.deleteObjectsByKeys).not.toHaveBeenCalled()
		expect(mediaRepo.deleteOrphanedByIds).not.toHaveBeenCalled()
	})
})

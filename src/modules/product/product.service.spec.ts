import { Test, TestingModule } from '@nestjs/testing'

import { CapabilityService } from '@/modules/capability/capability.service'
import { CAPABILITY_READER_PORT } from '@/modules/capability/contracts'
import { S3Service } from '@/modules/s3/s3.service'
import { SeoRepository } from '@/modules/seo/seo.repository'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_TYPE_CACHE_VERSION,
	CATEGORY_LIST_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { ProductMediaMapper } from '@/shared/media/product-media.mapper'
import { RequestContext } from '@/shared/tenancy/request-context'

import type { ProductAttributeValueDto } from './dto/requests/product-attribute.dto.req'
import { ProductAttributeBuilder } from './product-attribute.builder'
import type { ProductAttributeValueData } from './product-attribute.builder'
import { ProductCommandService } from './product-command.service'
import { ProductMaintenanceService } from './product-maintenance.service'
import {
	encodeProductDefaultCursor,
	encodeProductSeedCursor
} from './product-query.utils'
import { ProductReadService } from './product-read.service'
import { ProductSeoSyncService } from './product-seo-sync.service'
import { ProductTypeChangeService } from './product-type-change.service'
import { ProductVariantBuilder } from './product-variant.builder'
import { ProductVariantService } from './product-variant.service'
import { ProductWriteFinalizer } from './product-write-finalizer.service'
import { ProductRepository } from './product.repository'
import { ProductService } from './product.service'

describe('ProductService', () => {
	let service: ProductService
	let serviceState: {
		cacheTtlSec: number
		uncategorizedFirstPageCacheTtlSec: number
		uncategorizedNextPageCacheTtlSec: number
	}
	let repo: jest.Mocked<ProductRepository>
	let attributeBuilder: jest.Mocked<ProductAttributeBuilder>
	let variantBuilder: jest.Mocked<ProductVariantBuilder>
	let cache: jest.Mocked<CacheService>
	let mediaRepo: jest.Mocked<MediaRepository>
	let s3Service: jest.Mocked<S3Service>
	let productSeoSync: jest.Mocked<ProductSeoSyncService>
	let seoRepo: jest.Mocked<SeoRepository>
	let capabilities: jest.Mocked<CapabilityService>

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
				ProductCommandService,
				ProductMaintenanceService,
				ProductWriteFinalizer,
				ProductReadService,
				ProductTypeChangeService,
				ProductVariantService,
				ProductMediaMapper,
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
						findPopularCards: jest.fn(),
						findById: jest.fn(),
						findPublicById: jest.fn(),
						findBySlug: jest.fn(),
						findPublicBySlug: jest.fn(),
						findByIds: jest.fn(),
						findByIdsWithAttributes: jest.fn(),
						findByIdsWithDetails: jest.fn(),
						findVariantPickerOptions: jest.fn(),
						findVariantSummaries: jest.fn(),
						findUncategorizedPage: jest.fn(),
						findUncategorizedCardsPage: jest.fn(),
						findFilteredProductIdsPageDefault: jest.fn(),
						findFilteredProductIdsPageSeeded: jest.fn(),
						findRecommendedProductIdsPageDefault: jest.fn(),
						findRecommendedProductIdsPageSeeded: jest.fn(),
						findAttributesByTypeAndKeys: jest.fn(),
						findBrandById: jest.fn(),
						findProductTypeById: jest.fn(),
						findProductTypeValidationSchemaById: jest.fn(),
						findProductValidationRef: jest.fn(),
						findProductTypeCompatibilityPreviewRef: jest.fn(),
						findSkuById: jest.fn(),
						findCategoryById: jest.fn(),
						findCategoriesByIds: jest.fn(),
						existsSlug: jest.fn(),
						existsName: jest.fn(),
						existsSku: jest.fn(),
						existsVariantSku: jest.fn(),
						create: jest.fn(),
						update: jest.fn(),
						applyProductTypeChange: jest.fn(),
						toggleStatus: jest.fn(),
						togglePopular: jest.fn(),
						expireScheduledDiscounts: jest.fn(),
						softDelete: jest.fn(),
						setVariants: jest.fn(),
						syncProductCategories: jest.fn(),
						prependProductToCategories: jest.fn(),
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
				},
				{
					provide: SeoRepository,
					useValue: {
						findByEntity: jest.fn()
					}
				},
				{
					provide: ProductSeoSyncService,
					useValue: {
						syncProduct: jest.fn(),
						removeProduct: jest.fn()
					}
				},
				{
					provide: CapabilityService,
					useValue: {
						getCurrentFeatures: jest.fn().mockResolvedValue({
							canUseProductTypes: true,
							canUseProductVariants: true,
							canUseCatalogSaleUnits: true,
							canUseInternalInventory: false,
							canUseMoySkladIntegration: true
						}),
						canUseProductVariants: jest.fn().mockResolvedValue(true),
						assertCanUseProductTypes: jest.fn().mockResolvedValue(undefined),
						assertCanUseProductVariants: jest.fn().mockResolvedValue(undefined),
						assertCanUseCatalogSaleUnits: jest.fn().mockResolvedValue(undefined)
					}
				},
				{
					provide: CAPABILITY_READER_PORT,
					useExisting: CapabilityService
				}
			]
		}).compile()

		service = module.get<ProductService>(ProductService)
		serviceState = module.get(ProductReadService)
		repo = module.get(ProductRepository)
		attributeBuilder = module.get(ProductAttributeBuilder)
		variantBuilder = module.get(ProductVariantBuilder)
		cache = module.get(CacheService)
		mediaRepo = module.get(MediaRepository)
		s3Service = module.get(S3Service)
		productSeoSync = module.get(ProductSeoSyncService)
		seoRepo = module.get(SeoRepository)
		capabilities = module.get(CapabilityService)

		cache.buildKey.mockImplementation(parts =>
			parts
				.filter(part => part !== undefined && part !== null && part !== '')
				.map(part => String(part))
				.join(':')
		)
		cache.getVersion.mockResolvedValue(0)
		cache.getJson.mockResolvedValue(null)
		cache.setJson.mockResolvedValue(undefined)
		repo.existsVariantSku.mockResolvedValue(false)
		repo.findVariantPickerOptions.mockResolvedValue([])
		repo.findVariantSummaries.mockResolvedValue([])
		repo.findProductTypeValidationSchemaById.mockResolvedValue({
			id: 'product-type-1',
			catalogId: 'catalog-1',
			attributes: []
		} as any)
		repo.findProductValidationRef.mockResolvedValue({
			id: 'product-1',
			productTypeId: null,
			productAttributes: [],
			variants: []
		} as any)
		repo.findProductTypeCompatibilityPreviewRef.mockResolvedValue({
			id: 'product-1',
			productTypeId: null,
			productAttributes: [],
			variants: []
		} as any)
		repo.applyProductTypeChange.mockResolvedValue({
			id: 'product-1',
			slug: 'typed-product',
			media: [],
			productAttributes: [],
			variants: [],
			categoryProducts: [],
			productType: { id: 'product-type-1', code: 'shoes', name: 'Shoes' }
		} as any)
		seoRepo.findByEntity.mockResolvedValue(null)
		serviceState.cacheTtlSec = 0
		serviceState.uncategorizedFirstPageCacheTtlSec = 0
		serviceState.uncategorizedNextPageCacheTtlSec = 0
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	it('returns empty discount expiration result when nothing expired', async () => {
		repo.expireScheduledDiscounts.mockResolvedValue([])

		const now = new Date('2026-04-01T01:00:00.000Z')
		const result = await service.expireScheduledDiscounts(now)

		expect(repo.expireScheduledDiscounts).toHaveBeenCalledWith(now)
		expect(result).toEqual({
			updatedProducts: 0,
			affectedCatalogs: 0
		})
		expect(cache.bumpVersion).not.toHaveBeenCalled()
		expect(productSeoSync.syncProduct).not.toHaveBeenCalled()
	})

	it('expires scheduled discounts, invalidates caches and resyncs seo', async () => {
		repo.expireScheduledDiscounts.mockResolvedValue([
			{ productId: 'product-1', catalogId: 'catalog-1' },
			{ productId: 'product-2', catalogId: 'catalog-1' },
			{ productId: 'product-3', catalogId: 'catalog-2' }
		])
		repo.findByIdsWithDetails
			.mockResolvedValueOnce([{ id: 'product-1' }, { id: 'product-2' }] as any)
			.mockResolvedValueOnce([{ id: 'product-3' }] as any)

		const result = await service.expireScheduledDiscounts(
			new Date('2026-04-01T01:00:00.000Z')
		)

		expect(result).toEqual({
			updatedProducts: 3,
			affectedCatalogs: 2
		})
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			PRODUCTS_CACHE_VERSION,
			'catalog-1'
		)
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		)
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			PRODUCTS_CACHE_VERSION,
			'catalog-2'
		)
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-2'
		)
		expect(repo.findByIdsWithDetails).toHaveBeenNthCalledWith(
			1,
			['product-1', 'product-2'],
			'catalog-1'
		)
		expect(repo.findByIdsWithDetails).toHaveBeenNthCalledWith(
			2,
			['product-3'],
			'catalog-2'
		)
		expect(productSeoSync.syncProduct).toHaveBeenNthCalledWith(
			1,
			{ id: 'product-1' },
			'catalog-1'
		)
		expect(productSeoSync.syncProduct).toHaveBeenNthCalledWith(
			2,
			{ id: 'product-2' },
			'catalog-1'
		)
		expect(productSeoSync.syncProduct).toHaveBeenNthCalledWith(
			3,
			{ id: 'product-3' },
			'catalog-2'
		)
	})

	it('returns integration metadata for integrated products', async () => {
		const syncedAt = new Date('2026-03-23T15:37:00.336Z')

		repo.findPublicById.mockResolvedValue({
			id: 'product-1',
			media: [],
			productAttributes: [],
			variants: [],
			categoryProducts: [],
			integrationLinks: [
				{
					externalId: 'ms-123',
					externalCode: 'code-123',
					lastSyncedAt: syncedAt,
					integration: { provider: 'MOYSKLAD' }
				}
			]
		} as any)

		const result = await runWithCatalog(() => service.getById('product-1'))

		expect(result).toMatchObject({
			id: 'product-1',
			integration: {
				provider: 'MOYSKLAD',
				externalId: 'ms-123',
				externalCode: 'code-123',
				lastSyncedAt: syncedAt
			}
		})
	})

	it('returns variant integration metadata only for owner/admin detail reads', async () => {
		const syncedAt = new Date('2026-03-23T15:37:00.336Z')

		repo.findById.mockResolvedValue({
			id: 'product-1',
			media: [],
			productType: { id: 'product-type-1' },
			productAttributes: [],
			categoryProducts: [],
			integrationLinks: [],
			variants: [
				{
					id: 'variant-1',
					sku: 'SKU-XL',
					variantKey: 'size=xl',
					stock: 5,
					price: 2499,
					status: 'ACTIVE',
					isAvailable: true,
					createdAt: new Date('2026-03-23T15:00:00.000Z'),
					updatedAt: new Date('2026-03-23T15:00:00.000Z'),
					attributes: [],
					integrationLinks: [
						{
							externalId: 'variant-external-1',
							externalCode: 'MS-XL',
							lastSyncedAt: syncedAt,
							integration: { provider: 'MOYSKLAD' }
						}
					]
				}
			]
		} as any)

		const result = await runWithCatalog(() =>
			service.getById('product-1', {
				includeInactive: true,
				includeVariantIntegration: true
			})
		)

		expect(repo.findById).toHaveBeenCalledWith('product-1', 'catalog-1', true)
		expect(repo.findPublicById).not.toHaveBeenCalled()
		expect(result.variants[0]).toMatchObject({
			id: 'variant-1',
			integration: {
				provider: 'MOYSKLAD',
				externalId: 'variant-external-1',
				externalCode: 'MS-XL',
				lastSyncedAt: syncedAt
			}
		})
		expect(result.variants[0]).not.toHaveProperty('integrationLinks')
	})

	it('returns seo only for detailed product responses', async () => {
		repo.findPublicById.mockResolvedValue({
			id: 'product-1',
			media: [],
			productAttributes: [],
			variants: [],
			categoryProducts: [],
			integrationLinks: []
		} as any)
		seoRepo.findByEntity.mockResolvedValue({
			id: 'seo-1',
			entityType: 'PRODUCT',
			entityId: 'product-1',
			title: 'SEO title',
			ogMedia: null,
			twitterMedia: null
		} as any)

		const result = await runWithCatalog(() => service.getById('product-1'))

		expect(result).toMatchObject({
			id: 'product-1',
			seo: {
				id: 'seo-1',
				title: 'SEO title'
			}
		})
		expect(seoRepo.findByEntity).toHaveBeenCalledWith(
			'catalog-1',
			'PRODUCT',
			'product-1'
		)
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

	it('passes productTypeId filter to infinite product query', async () => {
		repo.findAttributesByTypeAndKeys.mockResolvedValue([] as any)
		repo.findFilteredProductIdsPageDefault.mockResolvedValue([
			{ id: 'product-1', updatedAt: new Date('2026-03-12T10:00:00.000Z') }
		] as any)
		repo.findByIdsWithAttributes.mockResolvedValue([
			{ id: 'product-1', media: [] }
		] as any)

		const result = await runWithCatalog(() =>
			service.getInfinite({
				limit: '2',
				productTypeId: 'product-type-1'
			})
		)

		expect(repo.findFilteredProductIdsPageDefault.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				catalogId: 'catalog-1',
				productTypeId: 'product-type-1',
				take: 3
			})
		)
		expect(result.items).toHaveLength(1)
		expect(repo.findByIdsWithAttributes).toHaveBeenCalledWith(
			['product-1'],
			'catalog-1',
			false
		)
	})

	it('returns lightweight infinite cards page with product attributes and without variants', async () => {
		repo.findAttributesByTypeAndKeys.mockResolvedValue([] as any)
		repo.findFilteredProductIdsPageDefault.mockResolvedValue([
			{ id: 'product-1', updatedAt: new Date('2026-03-12T10:00:00.000Z') },
			{ id: 'product-2', updatedAt: new Date('2026-03-12T09:00:00.000Z') },
			{ id: 'product-3', updatedAt: new Date('2026-03-12T08:00:00.000Z') }
		] as any)
		repo.findByIds.mockResolvedValue([
			{
				id: 'product-1',
				media: [],
				categoryProducts: [],
				integrationLinks: [],
				productAttributes: []
			},
			{
				id: 'product-2',
				media: [],
				categoryProducts: [],
				integrationLinks: [],
				productAttributes: []
			}
		] as any)

		const result = await runWithCatalog(() =>
			service.getInfiniteCards({
				limit: '2'
			})
		)

		expect(result.items).toHaveLength(2)
		expect(repo.findByIds).toHaveBeenCalledWith(
			['product-1', 'product-2'],
			'catalog-1',
			false
		)
		expect(repo.findByIdsWithAttributes).not.toHaveBeenCalled()
		expect(result.items[0]).toHaveProperty('productAttributes', [])
		expect(result.items[0]).not.toHaveProperty('variants')
	})

	it('passes productTypeId filter to infinite cards and hydrates through current catalog', async () => {
		repo.findAttributesByTypeAndKeys.mockResolvedValue([] as any)
		repo.findFilteredProductIdsPageDefault.mockResolvedValue([
			{ id: 'product-1', updatedAt: new Date('2026-03-12T10:00:00.000Z') }
		] as any)
		repo.findByIds.mockResolvedValue([
			{
				id: 'product-1',
				media: [],
				categoryProducts: [],
				integrationLinks: [],
				productAttributes: []
			}
		] as any)

		const result = await runWithCatalog(() =>
			service.getInfiniteCards({
				limit: '2',
				productTypeId: 'product-type-1'
			})
		)

		expect(result.items).toHaveLength(1)
		expect(repo.findFilteredProductIdsPageDefault.mock.calls[0]?.[0]).toEqual(
			expect.objectContaining({
				catalogId: 'catalog-1',
				productTypeId: 'product-type-1',
				take: 3
			})
		)
		expect(repo.findByIds).toHaveBeenCalledWith(['product-1'], 'catalog-1', false)
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

	it('treats productTypeId as an active recommendations filter', async () => {
		repo.findRecommendedProductIdsPageDefault.mockResolvedValue([
			{ id: 'product-4', updatedAt: new Date('2026-03-12T10:00:00.000Z') }
		] as any)
		repo.findByIdsWithAttributes.mockResolvedValue([
			{ id: 'product-4', media: [], categoryProducts: [], productAttributes: [] }
		] as any)

		const result = await runWithCatalog(() =>
			service.getRecommendationsInfinite({
				productTypeId: 'product-type-1'
			})
		)

		expect(result.items).toHaveLength(1)
		expect(repo.findRecommendedProductIdsPageDefault).toHaveBeenCalledWith(
			expect.objectContaining({
				catalogId: 'catalog-1',
				productTypeId: 'product-type-1'
			})
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

	it('returns cached lightweight recommendations page when first-page cache is warm', async () => {
		serviceState.cacheTtlSec = 120
		cache.getJson.mockResolvedValue({
			items: [{ id: 'product-1', media: [], categories: [] }],
			nextCursor: null,
			seed: 'seed-1'
		} as any)

		const result = await runWithCatalog(() =>
			service.getRecommendationsInfiniteCards({
				limit: '2',
				seed: 'seed-1',
				brands: 'brand-1'
			})
		)

		expect(result).toEqual({
			items: [{ id: 'product-1', media: [], categories: [] }],
			nextCursor: null,
			seed: 'seed-1'
		})
		expect(repo.findRecommendedProductIdsPageDefault).not.toHaveBeenCalled()
		expect(repo.findRecommendedProductIdsPageSeeded).not.toHaveBeenCalled()
		expect(repo.findByIds).not.toHaveBeenCalled()
	})

	it('returns cached uncategorized page when cache is warm', async () => {
		serviceState.uncategorizedFirstPageCacheTtlSec = 120
		const cached = {
			items: [
				{ id: 'product-1', media: [], categories: [], productAttributes: [] }
			],
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

	it('returns lightweight uncategorized page with product attributes and without variants', async () => {
		repo.findUncategorizedCardsPage.mockResolvedValue([
			{
				id: 'product-1',
				updatedAt: new Date('2026-03-12T10:00:00.000Z'),
				media: [],
				categoryProducts: [],
				integrationLinks: [],
				productAttributes: []
			},
			{
				id: 'product-2',
				updatedAt: new Date('2026-03-12T09:00:00.000Z'),
				media: [],
				categoryProducts: [],
				integrationLinks: [],
				productAttributes: []
			},
			{
				id: 'product-3',
				updatedAt: new Date('2026-03-12T08:00:00.000Z'),
				media: [],
				categoryProducts: [],
				integrationLinks: [],
				productAttributes: []
			}
		] as any)

		const result = await runWithCatalog(() =>
			service.getUncategorizedInfiniteCards({
				limit: '2'
			})
		)

		expect(result.items).toHaveLength(2)
		expect(repo.findUncategorizedCardsPage).toHaveBeenCalledWith('catalog-1', {
			cursor: undefined,
			take: 3,
			includeInactive: false
		})
		expect(repo.findUncategorizedPage).not.toHaveBeenCalled()
		expect(result.items[0]).toHaveProperty('productAttributes', [])
		expect(result.items[0]).not.toHaveProperty('variants')
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

	it('returns lightweight popular cards with product attributes, variant summary and without variants', async () => {
		serviceState.cacheTtlSec = 120
		repo.findPopularCards.mockResolvedValue([
			{
				id: 'product-1',
				media: [],
				categoryProducts: [],
				integrationLinks: [],
				isPopular: true,
				productType: { id: 'product-type-1' },
				productAttributes: []
			}
		] as any)
		repo.findVariantSummaries.mockResolvedValue([
			{
				productId: 'product-1',
				minPrice: '100.00',
				maxPrice: '150.00',
				activeCount: 2,
				totalStock: 7,
				singleVariantId: null
			}
		])
		repo.findVariantPickerOptions.mockResolvedValue([
			{
				id: 'variant-1',
				productId: 'product-1',
				sku: 'VEST-M',
				variantKey: 'm',
				stock: 7,
				price: '150.00',
				status: 'ACTIVE',
				isAvailable: true,
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
				attributes: [
					{
						attribute: { displayOrder: 1 },
						enumValue: {
							displayName: 'M',
							value: 'm',
							displayOrder: 2
						}
					}
				],
				saleUnits: [
					{
						id: 'sale-unit-1',
						baseQuantity: '2.0000',
						price: '140.00',
						isDefault: true,
						displayOrder: 0
					}
				]
			}
		] as any)

		const result = await runWithCatalog(() => service.getPopularCards())

		expect(result).toHaveLength(1)
		expect(repo.findPopularCards).toHaveBeenCalledWith('catalog-1', false)
		expect(repo.findVariantSummaries).toHaveBeenCalledWith(['product-1'])
		expect(repo.findVariantPickerOptions).toHaveBeenCalledWith(['product-1'])
		expect(repo.findPopular).not.toHaveBeenCalled()
		expect(result[0]).toHaveProperty('productAttributes', [])
		expect(result[0]).toHaveProperty('variantSummary', {
			minPrice: '100.00',
			maxPrice: '150.00',
			activeCount: 2,
			totalStock: 7,
			singleVariantId: null
		})
		expect(result[0]).toHaveProperty('variantPickerOptions', [
			{
				id: 'variant-1',
				label: 'M',
				price: '150.00',
				stock: 7,
				status: 'ACTIVE',
				isAvailable: true,
				saleUnitId: null,
				saleUnitPrice: null,
				maxQuantity: 7
			}
		])
		expect(result[0]).not.toHaveProperty('variants')
		expect(cache.setJson).toHaveBeenCalled()
	})

	it('returns popular products with product attributes, default variant summary and without variants in bulk read', async () => {
		repo.findPopular.mockResolvedValue([
			{
				id: 'product-1',
				media: [],
				categoryProducts: [],
				integrationLinks: [],
				productAttributes: [],
				isPopular: true
			}
		] as any)

		const result = await runWithCatalog(() => service.getPopular())

		expect(repo.findPopular).toHaveBeenCalledWith('catalog-1', false)
		expect(result[0]).toHaveProperty('productAttributes', [])
		expect(result[0]).toHaveProperty('variantSummary', {
			minPrice: null,
			maxPrice: null,
			activeCount: 0,
			totalStock: 0,
			singleVariantId: null
		})
		expect(result[0]).toHaveProperty('variantPickerOptions', [])
		expect(repo.findVariantPickerOptions).not.toHaveBeenCalled()
		expect(result[0]).not.toHaveProperty('variants')
	})

	it('hides variant summary and picker when product variants capability is disabled', async () => {
		serviceState.cacheTtlSec = 120
		capabilities.getCurrentFeatures.mockResolvedValueOnce({
			canUseProductTypes: true,
			canUseProductVariants: false,
			canUseCatalogSaleUnits: true,
			canUseInternalInventory: false,
			canUseMoySkladIntegration: true
		})
		repo.findPopularCards.mockResolvedValue([
			{
				id: 'product-1',
				media: [],
				categoryProducts: [],
				integrationLinks: [],
				isPopular: true,
				productType: { id: 'product-type-1' },
				productAttributes: []
			}
		] as any)

		const result = await runWithCatalog(() => service.getPopularCards())

		expect(repo.findVariantSummaries).not.toHaveBeenCalled()
		expect(repo.findVariantPickerOptions).not.toHaveBeenCalled()
		expect(result[0]).toHaveProperty('variantSummary', {
			minPrice: null,
			maxPrice: null,
			activeCount: 0,
			totalStock: 0,
			singleVariantId: null
		})
		expect(result[0]).toHaveProperty('variantPickerOptions', [])
		expect(cache.buildKey).toHaveBeenCalledWith(
			expect.arrayContaining([expect.stringContaining('variants-off')])
		)
	})

	it('strips beta product data from details when capabilities are disabled', async () => {
		capabilities.getCurrentFeatures.mockResolvedValueOnce({
			canUseProductTypes: false,
			canUseProductVariants: false,
			canUseCatalogSaleUnits: false,
			canUseInternalInventory: false,
			canUseMoySkladIntegration: false
		})
		repo.findPublicById.mockResolvedValue({
			id: 'product-1',
			media: [],
			productType: { id: 'product-type-1', code: 'clothes', name: 'Clothes' },
			productAttributes: [
				{
					id: 'attribute-value-public',
					attribute: {
						id: 'subtitle-attribute',
						key: 'subtitle',
						displayName: 'Subtitle',
						isHidden: false,
						isVariantAttribute: false
					}
				},
				{
					id: 'attribute-value-hidden',
					attribute: {
						id: 'hidden-attribute',
						key: 'internal',
						displayName: 'Internal',
						isHidden: true,
						isVariantAttribute: false
					}
				},
				{
					id: 'attribute-value-variant',
					attribute: {
						id: 'size-attribute',
						key: 'size',
						displayName: 'Size',
						isHidden: false,
						isVariantAttribute: true
					}
				}
			],
			variants: [
				{
					id: 'variant-1',
					sku: 'SKU-XL',
					variantKey: 'size=xl',
					stock: 5,
					price: 2499,
					status: 'ACTIVE',
					isAvailable: true,
					createdAt: new Date('2026-03-23T15:00:00.000Z'),
					updatedAt: new Date('2026-03-23T15:00:00.000Z'),
					attributes: [],
					saleUnits: [{ id: 'sale-unit-1' }]
				}
			],
			categoryProducts: [],
			integrationLinks: [
				{
					externalId: 'ms-123',
					externalCode: 'code-123',
					lastSyncedAt: new Date('2026-03-23T15:37:00.336Z'),
					integration: { provider: 'MOYSKLAD' }
				}
			]
		} as any)

		const result = await runWithCatalog(() => service.getById('product-1'))

		expect(result).toMatchObject({
			id: 'product-1',
			productType: null,
			productAttributes: [
				{
					id: 'attribute-value-public'
				}
			],
			variantSummary: {
				minPrice: null,
				maxPrice: null,
				activeCount: 0,
				totalStock: 0,
				singleVariantId: null
			},
			variantPickerOptions: [],
			variants: [],
			integration: null
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

	it('creates default variant when variants are not passed', async () => {
		repo.existsSlug.mockResolvedValue(false)
		repo.existsName.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.existsVariantSku.mockResolvedValue(false)
		repo.create.mockResolvedValue({
			id: 'product-1',
			slug: 'simple-product'
		} as any)
		repo.findById.mockResolvedValue({
			id: 'product-1',
			slug: 'simple-product',
			media: [],
			productAttributes: [],
			variants: [{ id: 'variant-1', variantKey: 'default', attributes: [] }],
			categoryProducts: []
		} as any)
		attributeBuilder.buildForCreate.mockResolvedValue([])

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'Simple Product',
					price: 100
				})
			)
		).resolves.toMatchObject({ ok: true, id: 'product-1' })

		expect(variantBuilder.build).not.toHaveBeenCalled()
		expect(repo.create).toHaveBeenCalledWith(
			'catalog-1',
			expect.any(Object),
			[],
			[
				expect.objectContaining({
					sku: 'SIMPLE-PRODUCT',
					variantKey: 'default',
					price: 100,
					stock: 0,
					status: 'OUT_OF_STOCK',
					attributes: []
				})
			]
		)
	})

	it('creates default variant when variants array is empty', async () => {
		repo.existsSlug.mockResolvedValue(false)
		repo.existsName.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.existsVariantSku.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
		repo.create.mockResolvedValue({
			id: 'product-1',
			slug: 'empty-variants-product'
		} as any)
		repo.findById.mockResolvedValue({
			id: 'product-1',
			slug: 'empty-variants-product',
			media: [],
			productAttributes: [],
			variants: [{ id: 'variant-1', variantKey: 'default', attributes: [] }],
			categoryProducts: []
		} as any)
		attributeBuilder.buildForCreate.mockResolvedValue([])

		await runWithCatalog(() =>
			service.create({
				name: 'Empty Variants Product',
				price: 125,
				variants: []
			})
		)

		expect(variantBuilder.build).not.toHaveBeenCalled()
		expect(repo.create).toHaveBeenCalledWith(
			'catalog-1',
			expect.any(Object),
			[],
			[
				expect.objectContaining({
					sku: 'EMPTY-VARIANTS-PRODUCT-DEFAULT',
					variantKey: 'default',
					price: 125
				})
			]
		)
	})

	it('creates product with variants when they are passed', async () => {
		repo.existsSlug.mockResolvedValue(false)
		repo.existsName.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.create.mockResolvedValue({
			id: 'product-1',
			slug: 'with-variants'
		} as any)
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
			{ catalogTypeId: 'type-1', catalogId: 'catalog-1', productTypeId: null },
			expect.any(Array),
			expect.any(String),
			{ defaultPrice: 100 }
		)
		expect(repo.create).toHaveBeenCalledWith(
			'catalog-1',
			expect.any(Object),
			expect.any(Array),
			builtVariants
		)
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATALOG_TYPE_CACHE_VERSION,
			'type-1'
		])
	})

	it('connects catalog product type on product creation', async () => {
		repo.existsSlug.mockResolvedValue(false)
		repo.existsName.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.create.mockResolvedValue({
			id: 'product-1',
			slug: 'typed-product'
		} as any)
		repo.findById.mockResolvedValue({
			id: 'product-1',
			slug: 'typed-product',
			media: [],
			productAttributes: [],
			variants: [{ id: 'variant-1', variantKey: 'default', attributes: [] }],
			categoryProducts: [],
			productType: { id: 'product-type-1', code: 'shoes', name: 'Shoes' }
		} as any)
		attributeBuilder.buildForCreate.mockResolvedValue([])

		await runWithCatalog(() =>
			service.create({
				name: 'Typed Product',
				price: 100,
				productTypeId: 'product-type-1'
			})
		)

		expect(repo.findProductTypeValidationSchemaById).toHaveBeenCalledWith(
			'product-type-1',
			'catalog-1'
		)
		expect(repo.create).toHaveBeenCalledWith(
			'catalog-1',
			expect.objectContaining({
				productType: { connect: { id: 'product-type-1' } }
			}),
			expect.any(Array),
			expect.any(Array)
		)
	})

	it('rejects typed product creation without required variant matrix', async () => {
		repo.existsSlug.mockResolvedValue(false)
		repo.existsName.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.findProductTypeValidationSchemaById.mockResolvedValue({
			id: 'product-type-1',
			catalogId: 'catalog-1',
			attributes: [
				{
					attributeId: 'size-attribute',
					isVariant: true,
					isRequired: true,
					displayOrder: 0,
					attribute: {
						id: 'size-attribute',
						key: 'size',
						dataType: 'ENUM'
					}
				}
			]
		} as any)

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'Typed Product',
					price: 100,
					productTypeId: 'product-type-1'
				})
			)
		).rejects.toThrow('Product type variant attributes require explicit variants')

		expect(repo.create).not.toHaveBeenCalled()
	})

	it('rejects default-only variant for typed product with variant attributes', async () => {
		repo.existsSlug.mockResolvedValue(false)
		repo.existsName.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.findProductTypeValidationSchemaById.mockResolvedValue({
			id: 'product-type-1',
			catalogId: 'catalog-1',
			attributes: [
				{
					attributeId: 'size-attribute',
					isVariant: true,
					isRequired: true,
					displayOrder: 0,
					attribute: {
						id: 'size-attribute',
						key: 'size',
						dataType: 'ENUM'
					}
				}
			]
		} as any)

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'Typed Product',
					price: 100,
					productTypeId: 'product-type-1',
					variants: [{ price: 100 }]
				})
			)
		).rejects.toThrow('Product type variant attributes require explicit variants')

		expect(repo.create).not.toHaveBeenCalled()
	})

	it('uses product type scope when creating typed product variants', async () => {
		repo.findProductTypeValidationSchemaById.mockResolvedValue({
			id: 'product-type-1',
			catalogId: 'catalog-1',
			attributes: [
				{
					attributeId: 'attribute-1',
					isVariant: true,
					isRequired: true,
					displayOrder: 0,
					attribute: {
						id: 'attribute-1',
						key: 'size',
						dataType: 'ENUM'
					}
				}
			]
		} as any)
		repo.existsSlug.mockResolvedValue(false)
		repo.existsName.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.create.mockResolvedValue({
			id: 'product-1',
			slug: 'typed-product'
		} as any)
		repo.findById.mockResolvedValue({
			id: 'product-1',
			slug: 'typed-product',
			media: [],
			productAttributes: [],
			variants: [{ id: 'variant-1', attributes: [] }],
			categoryProducts: [],
			productType: { id: 'product-type-1', code: 'shoes', name: 'Shoes' }
		} as any)
		attributeBuilder.buildForCreate.mockResolvedValue([])
		const builtVariants = [
			{
				sku: 'TYPED-PRODUCT-S',
				variantKey: 'size=s',
				price: 100,
				stock: 1,
				status: 'ACTIVE',
				attributes: [
					{
						attributeId: 'attribute-1',
						enumValueId: 'enum-1'
					}
				]
			}
		] as any
		variantBuilder.build.mockResolvedValue(builtVariants)

		await runWithCatalog(() =>
			service.create({
				name: 'Typed Product',
				price: 100,
				productTypeId: 'product-type-1',
				variants: [
					{
						price: 100,
						stock: 1,
						attributes: [
							{
								attributeId: 'attribute-1',
								enumValueId: 'enum-1'
							}
						]
					}
				]
			})
		)

		expect(attributeBuilder.buildForCreate).toHaveBeenCalledWith(
			{
				catalogTypeId: 'type-1',
				catalogId: 'catalog-1',
				productTypeId: 'product-type-1'
			},
			undefined
		)
		expect(variantBuilder.build).toHaveBeenCalledWith(
			{
				catalogTypeId: 'type-1',
				catalogId: 'catalog-1',
				productTypeId: 'product-type-1'
			},
			expect.any(Array),
			expect.any(String),
			{ defaultPrice: 100 }
		)
	})

	it('rejects duplicate ProductType variant combinations on product creation', async () => {
		repo.findProductTypeValidationSchemaById.mockResolvedValue({
			id: 'product-type-1',
			catalogId: 'catalog-1',
			attributes: [
				{
					attributeId: 'size-attribute',
					isVariant: true,
					isRequired: true,
					displayOrder: 0,
					attribute: {
						id: 'size-attribute',
						key: 'size',
						dataType: 'ENUM'
					}
				},
				{
					attributeId: 'color-attribute',
					isVariant: true,
					isRequired: false,
					displayOrder: 1,
					attribute: {
						id: 'color-attribute',
						key: 'color',
						dataType: 'ENUM'
					}
				}
			]
		} as any)
		repo.existsSlug.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'Duplicate Variant Product',
					price: 100,
					productTypeId: 'product-type-1',
					variants: [
						{
							price: 100,
							stock: 1,
							attributes: [
								{ attributeId: 'size-attribute', enumValueId: 'size-s' },
								{ attributeId: 'color-attribute', enumValueId: 'color-red' }
							]
						},
						{
							price: 100,
							stock: 1,
							attributes: [
								{ attributeId: 'color-attribute', enumValueId: 'color-red' },
								{ attributeId: 'size-attribute', enumValueId: 'size-s' }
							]
						}
					]
				})
			)
		).rejects.toThrow('Duplicate variant attribute combination')

		expect(variantBuilder.build).not.toHaveBeenCalled()
		expect(attributeBuilder.buildForCreate).not.toHaveBeenCalled()
		expect(repo.create).not.toHaveBeenCalled()
	})

	it('rejects product type from another catalog on product creation', async () => {
		repo.existsSlug.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.findProductTypeValidationSchemaById.mockResolvedValue(null)

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'Wrong Type Product',
					price: 100,
					productTypeId: 'product-type-other'
				})
			)
		).rejects.toThrow(
			'Product type product-type-other is not available for this catalog'
		)
		expect(repo.create).not.toHaveBeenCalled()
	})

	it('rejects archived or unavailable product type on product creation', async () => {
		repo.existsSlug.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.findProductTypeValidationSchemaById.mockResolvedValue(null)

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'Archived Type Product',
					price: 100,
					productTypeId: 'archived-product-type'
				})
			)
		).rejects.toThrow(
			'Product type archived-product-type is not available for this catalog'
		)

		expect(repo.findProductTypeValidationSchemaById).toHaveBeenCalledWith(
			'archived-product-type',
			'catalog-1'
		)
		expect(attributeBuilder.buildForCreate).not.toHaveBeenCalled()
		expect(variantBuilder.build).not.toHaveBeenCalled()
		expect(repo.create).not.toHaveBeenCalled()
	})

	it('syncs SEO after product creation', async () => {
		repo.existsSlug.mockResolvedValue(false)
		repo.existsName.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.create.mockResolvedValue({ id: 'product-1', slug: 'seo-product' } as any)
		repo.findById.mockResolvedValue({
			id: 'product-1',
			slug: 'seo-product',
			name: 'SEO Product',
			price: 100,
			status: 'ACTIVE',
			brand: null,
			media: [],
			productAttributes: [],
			variants: [],
			categoryProducts: []
		} as any)
		attributeBuilder.buildForCreate.mockResolvedValue([])

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'SEO Product',
					price: 100
				})
			)
		).resolves.toMatchObject({ ok: true, id: 'product-1' })

		expect(productSeoSync.syncProduct).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'product-1',
				slug: 'seo-product'
			}),
			'catalog-1'
		)
	})

	it('uses product type scope when applying variant matrix', async () => {
		const dto = {
			items: [
				{
					price: 130,
					stock: 3,
					attributes: [
						{
							attributeId: 'size-attribute',
							enumValueId: 'size-s'
						}
					]
				}
			]
		}
		const builtVariants = [
			{
				sku: 'TYPED-PRODUCT-S',
				variantKey: 'size=s',
				price: 130,
				stock: 3,
				status: 'ACTIVE',
				attributes: [
					{
						attributeId: 'size-attribute',
						enumValueId: 'size-s'
					}
				]
			}
		] as any
		const updatedProduct = {
			id: 'product-1',
			slug: 'typed-product',
			name: 'Typed Product',
			price: 120,
			status: 'ACTIVE',
			brand: null,
			media: [],
			productAttributes: [],
			variants: builtVariants,
			categoryProducts: []
		} as any
		repo.findSkuById.mockResolvedValue({
			id: 'product-1',
			sku: 'TYPED-PRODUCT',
			price: 120,
			productTypeId: 'product-type-1'
		} as any)
		repo.findProductTypeValidationSchemaById.mockResolvedValue({
			id: 'product-type-1',
			catalogId: 'catalog-1',
			attributes: [
				{
					attributeId: 'size-attribute',
					isVariant: true,
					isRequired: true,
					displayOrder: 0,
					attribute: {
						id: 'size-attribute',
						key: 'size',
						dataType: 'ENUM'
					}
				}
			]
		} as any)
		variantBuilder.build.mockResolvedValue(builtVariants)
		repo.setVariants.mockResolvedValue(updatedProduct)

		const result = await runWithCatalog(() =>
			service.setVariantMatrix('product-1', dto)
		)

		expect(repo.findProductTypeValidationSchemaById).toHaveBeenCalledWith(
			'product-type-1',
			'catalog-1',
			{ includeArchived: true }
		)
		expect(variantBuilder.build).toHaveBeenCalledWith(
			{
				catalogTypeId: 'type-1',
				catalogId: 'catalog-1',
				productTypeId: 'product-type-1'
			},
			dto.items,
			'TYPED-PRODUCT',
			{ defaultPrice: 120 }
		)
		expect(repo.setVariants).toHaveBeenCalledWith(
			'product-1',
			'catalog-1',
			builtVariants
		)
		expect(productSeoSync.syncProduct).toHaveBeenCalledWith(
			updatedProduct,
			'catalog-1'
		)
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_LIST_CACHE_VERSION,
			'catalog-1'
		])
		expect(result).toMatchObject({ ok: true, id: 'product-1' })
	})

	it('rejects custom variant matrix for legacy product without product type', async () => {
		const dto = {
			items: [
				{
					stock: 2,
					attributes: [
						{
							attributeId: 'size-attribute',
							enumValueId: 'size-m'
						}
					]
				}
			]
		}
		repo.findSkuById.mockResolvedValue({
			id: 'product-1',
			sku: 'LEGACY-PRODUCT',
			price: 90,
			productTypeId: null
		} as any)

		await expect(
			runWithCatalog(() => service.setVariantMatrix('product-1', dto))
		).rejects.toThrow('Product type is required to manage product variants')

		expect(repo.findProductTypeValidationSchemaById).not.toHaveBeenCalled()
		expect(variantBuilder.build).not.toHaveBeenCalled()
		expect(repo.setVariants).not.toHaveBeenCalled()
	})

	it('rejects duplicate ProductType variant combinations when applying variant matrix', async () => {
		repo.findSkuById.mockResolvedValue({
			id: 'product-1',
			sku: 'TYPED-PRODUCT',
			price: 120,
			productTypeId: 'product-type-1'
		} as any)
		repo.findProductTypeValidationSchemaById.mockResolvedValue({
			id: 'product-type-1',
			catalogId: 'catalog-1',
			attributes: [
				{
					attributeId: 'size-attribute',
					isVariant: true,
					isRequired: true,
					displayOrder: 0,
					attribute: {
						id: 'size-attribute',
						key: 'size',
						dataType: 'ENUM'
					}
				},
				{
					attributeId: 'color-attribute',
					isVariant: true,
					isRequired: false,
					displayOrder: 1,
					attribute: {
						id: 'color-attribute',
						key: 'color',
						dataType: 'ENUM'
					}
				}
			]
		} as any)

		await expect(
			runWithCatalog(() =>
				service.setVariantMatrix('product-1', {
					items: [
						{
							price: 120,
							stock: 1,
							attributes: [
								{ attributeId: 'size-attribute', enumValueId: 'size-s' },
								{ attributeId: 'color-attribute', enumValueId: 'color-red' }
							]
						},
						{
							price: 120,
							stock: 1,
							attributes: [
								{ attributeId: 'color-attribute', enumValueId: 'color-red' },
								{ attributeId: 'size-attribute', enumValueId: 'size-s' }
							]
						}
					]
				})
			)
		).rejects.toThrow('Duplicate variant attribute combination')

		expect(variantBuilder.build).not.toHaveBeenCalled()
		expect(repo.setVariants).not.toHaveBeenCalled()
	})

	it('updates product type relation', async () => {
		repo.update.mockResolvedValue({
			id: 'product-1',
			slug: 'typed-product',
			media: [],
			productAttributes: [],
			variants: [],
			categoryProducts: [],
			productType: { id: 'product-type-1', code: 'shoes', name: 'Shoes' }
		} as any)

		await runWithCatalog(() =>
			service.update('product-1', {
				productTypeId: 'product-type-1'
			})
		)

		expect(repo.findProductTypeValidationSchemaById).toHaveBeenCalledWith(
			'product-type-1',
			'catalog-1'
		)
		expect(repo.update).toHaveBeenCalledWith(
			'product-1',
			expect.objectContaining({
				productType: { connect: { id: 'product-type-1' } }
			}),
			'catalog-1',
			undefined,
			undefined,
			undefined,
			undefined
		)
	})

	it('clears product type relation', async () => {
		repo.update.mockResolvedValue({
			id: 'product-1',
			slug: 'typed-product',
			media: [],
			productAttributes: [],
			variants: [],
			categoryProducts: [],
			productType: null
		} as any)

		await runWithCatalog(() =>
			service.update('product-1', {
				productTypeId: null
			})
		)

		expect(repo.findProductTypeValidationSchemaById).not.toHaveBeenCalled()
		expect(repo.update).toHaveBeenCalledWith(
			'product-1',
			expect.objectContaining({
				productType: { disconnect: true }
			}),
			'catalog-1',
			undefined,
			undefined,
			undefined,
			undefined
		)
	})

	it('removes old product type values when product type relation is cleared', async () => {
		repo.findProductValidationRef.mockResolvedValue({
			id: 'product-1',
			productTypeId: 'product-type-old',
			productAttributes: [{ attributeId: 'material' }],
			variants: [
				{
					variantKey: 'size:s',
					attributes: [
						{ attributeId: 'size', enumValueId: 'size-s' },
						{ attributeId: 'color', enumValueId: 'color-red' }
					]
				}
			]
		} as any)
		attributeBuilder.prepareRemovedAttributeIdsForUpdate.mockResolvedValue([
			'material'
		])
		repo.update.mockResolvedValue({
			id: 'product-1',
			slug: 'typed-product',
			media: [],
			productAttributes: [],
			variants: [],
			categoryProducts: [],
			productType: null
		} as any)

		await runWithCatalog(() =>
			service.update('product-1', {
				productTypeId: null,
				removeAttributeIds: ['material']
			})
		)

		expect(
			attributeBuilder.prepareRemovedAttributeIdsForUpdate
		).toHaveBeenCalledWith(
			{
				catalogTypeId: 'type-1',
				catalogId: 'catalog-1',
				productTypeId: 'product-type-old'
			},
			['material'],
			{ allowRequired: true }
		)
		expect(repo.update).toHaveBeenCalledWith(
			'product-1',
			expect.objectContaining({
				productType: { disconnect: true }
			}),
			'catalog-1',
			undefined,
			['material'],
			undefined,
			undefined,
			['size', 'color']
		)
	})

	it('allows product type change when product has existing scoped data', async () => {
		repo.findProductValidationRef.mockResolvedValue({
			id: 'product-1',
			productTypeId: 'product-type-old',
			productAttributes: [{ attributeId: 'attribute-1' }],
			variants: []
		} as any)
		repo.update.mockResolvedValue({
			id: 'product-1',
			slug: 'typed-product',
			media: [],
			productAttributes: [],
			variants: [],
			categoryProducts: [],
			productType: { id: 'product-type-1', code: 'shoes', name: 'Shoes' }
		} as any)

		await expect(
			runWithCatalog(() =>
				service.update('product-1', {
					productTypeId: 'product-type-1'
				})
			)
		).resolves.toMatchObject({ ok: true, id: 'product-1' })

		expect(repo.update).toHaveBeenCalledWith(
			'product-1',
			expect.objectContaining({
				productType: { connect: { id: 'product-type-1' } }
			}),
			'catalog-1',
			undefined,
			undefined,
			undefined,
			undefined
		)
	})

	it('allows assigning product type with variant attributes without immediate matrix replacement', async () => {
		repo.findProductTypeValidationSchemaById.mockResolvedValue({
			id: 'product-type-1',
			catalogId: 'catalog-1',
			attributes: [
				{
					attributeId: 'size-attribute',
					isVariant: true,
					isRequired: true,
					displayOrder: 0,
					attribute: {
						id: 'size-attribute',
						key: 'size',
						dataType: 'ENUM'
					}
				}
			]
		} as any)
		repo.update.mockResolvedValue({
			id: 'product-1',
			slug: 'typed-product',
			media: [],
			productAttributes: [],
			variants: [],
			categoryProducts: [],
			productType: { id: 'product-type-1', code: 'shoes', name: 'Shoes' }
		} as any)

		await expect(
			runWithCatalog(() =>
				service.update('product-1', {
					productTypeId: 'product-type-1'
				})
			)
		).resolves.toMatchObject({ ok: true, id: 'product-1' })

		expect(repo.update).toHaveBeenCalledWith(
			'product-1',
			expect.objectContaining({
				productType: { connect: { id: 'product-type-1' } }
			}),
			'catalog-1',
			undefined,
			undefined,
			undefined,
			undefined
		)
		expect(capabilities.assertCanUseProductVariants).not.toHaveBeenCalled()
	})

	it('previews product type change conflicts without updating product', async () => {
		repo.findProductTypeCompatibilityPreviewRef.mockResolvedValue({
			id: 'product-1',
			productTypeId: 'product-type-old',
			productAttributes: [
				{
					attributeId: 'material-attribute',
					attribute: {
						id: 'material-attribute',
						key: 'material',
						displayName: 'Material',
						dataType: 'STRING'
					}
				}
			],
			variants: [
				{
					variantKey: 'size-s-red',
					attributes: [
						{
							attributeId: 'color-attribute',
							attribute: {
								id: 'color-attribute',
								key: 'color',
								displayName: 'Color',
								dataType: 'ENUM'
							}
						},
						{
							attributeId: 'size-attribute',
							attribute: {
								id: 'size-attribute',
								key: 'size',
								displayName: 'Size',
								dataType: 'ENUM'
							}
						}
					]
				}
			]
		} as any)
		repo.findProductTypeValidationSchemaById.mockResolvedValue({
			id: 'product-type-new',
			catalogId: 'catalog-1',
			attributes: [
				{
					attributeId: 'material-attribute',
					isVariant: true,
					isRequired: false,
					displayOrder: 1,
					attribute: {
						id: 'material-attribute',
						key: 'material',
						dataType: 'STRING'
					}
				},
				{
					attributeId: 'color-attribute',
					isVariant: false,
					isRequired: false,
					displayOrder: 2,
					attribute: {
						id: 'color-attribute',
						key: 'color',
						dataType: 'ENUM'
					}
				},
				{
					attributeId: 'size-attribute',
					isVariant: true,
					isRequired: true,
					displayOrder: 3,
					attribute: {
						id: 'size-attribute',
						key: 'size',
						dataType: 'ENUM'
					}
				}
			]
		} as any)

		const result = await runWithCatalog(() =>
			service.previewProductTypeCompatibility('product-1', {
				productTypeId: 'product-type-new'
			})
		)

		expect(result).toEqual({
			productId: 'product-1',
			currentProductTypeId: 'product-type-old',
			requestedProductTypeId: 'product-type-new',
			sameProductType: false,
			hasScopedData: true,
			canChangeNow: false,
			compatible: false,
			requiresUserDecision: true,
			blockingReason: 'STRICT_POLICY_BLOCK',
			productAttributeCount: 1,
			variantAttributeCount: 2,
			productAttributeConflicts: [
				expect.objectContaining({
					attributeId: 'material-attribute',
					key: 'material',
					reason: 'SCOPE_MISMATCH',
					targetIsVariant: true
				})
			],
			variantAttributeConflicts: [
				expect.objectContaining({
					attributeId: 'color-attribute',
					key: 'color',
					variantKeys: ['size-s-red'],
					reason: 'SCOPE_MISMATCH',
					targetIsVariant: false
				})
			]
		})
		expect(repo.update).not.toHaveBeenCalled()
	})

	it('allows ordinary catalog product attributes when changing product type', async () => {
		repo.findProductTypeCompatibilityPreviewRef.mockResolvedValue({
			id: 'product-1',
			productTypeId: null,
			catalog: { typeId: 'type-1' },
			productAttributes: [
				{
					attributeId: 'subtitle-attribute',
					attribute: {
						id: 'subtitle-attribute',
						key: 'subtitle',
						displayName: 'Subtitle',
						dataType: 'STRING',
						isHidden: false,
						isVariantAttribute: false,
						types: [{ id: 'type-1' }]
					}
				},
				{
					attributeId: 'description-attribute',
					attribute: {
						id: 'description-attribute',
						key: 'description',
						displayName: 'Description',
						dataType: 'STRING',
						isHidden: false,
						isVariantAttribute: false,
						types: [{ id: 'type-1' }]
					}
				}
			],
			variants: []
		} as any)
		repo.findProductTypeValidationSchemaById.mockResolvedValue({
			id: 'product-type-1',
			catalogId: 'catalog-1',
			attributes: [
				{
					attributeId: 'size-attribute',
					isVariant: true,
					isRequired: true,
					displayOrder: 1,
					attribute: {
						id: 'size-attribute',
						key: 'size',
						dataType: 'ENUM'
					}
				}
			]
		} as any)

		const result = await runWithCatalog(() =>
			service.previewProductTypeCompatibility('product-1', {
				productTypeId: 'product-type-1'
			})
		)

		expect(result).toEqual(
			expect.objectContaining({
				currentProductTypeId: null,
				requestedProductTypeId: 'product-type-1',
				hasScopedData: true,
				canChangeNow: true,
				compatible: true,
				requiresUserDecision: false,
				blockingReason: null,
				productAttributeConflicts: [],
				variantAttributeConflicts: []
			})
		)
	})

	it('previews clearing product type as incompatible when scoped data exists', async () => {
		repo.findProductTypeCompatibilityPreviewRef.mockResolvedValue({
			id: 'product-1',
			productTypeId: 'product-type-old',
			productAttributes: [
				{
					attributeId: 'material-attribute',
					attribute: {
						id: 'material-attribute',
						key: 'material',
						displayName: 'Material',
						dataType: 'STRING'
					}
				}
			],
			variants: [
				{
					variantKey: 'default',
					attributes: [
						{
							attributeId: 'size-attribute',
							attribute: {
								id: 'size-attribute',
								key: 'size',
								displayName: 'Size',
								dataType: 'ENUM'
							}
						}
					]
				}
			]
		} as any)

		const result = await runWithCatalog(() =>
			service.previewProductTypeCompatibility('product-1', {
				productTypeId: null
			})
		)

		expect(repo.findProductTypeValidationSchemaById).not.toHaveBeenCalled()
		expect(result.requestedProductTypeId).toBeNull()
		expect(result.canChangeNow).toBe(false)
		expect(result.compatible).toBe(false)
		expect(result.productAttributeConflicts[0]).toEqual(
			expect.objectContaining({
				attributeId: 'material-attribute',
				reason: 'TARGET_TYPE_EMPTY',
				targetIsVariant: null
			})
		)
		expect(result.variantAttributeConflicts[0]).toEqual(
			expect.objectContaining({
				attributeId: 'size-attribute',
				variantKeys: ['default'],
				reason: 'TARGET_TYPE_EMPTY',
				targetIsVariant: null
			})
		)
		expect(repo.update).not.toHaveBeenCalled()
	})

	it('allows compatibility preview for clean product', async () => {
		repo.findProductTypeCompatibilityPreviewRef.mockResolvedValue({
			id: 'product-1',
			productTypeId: null,
			productAttributes: [],
			variants: []
		} as any)

		const result = await runWithCatalog(() =>
			service.previewProductTypeCompatibility('product-1', {
				productTypeId: 'product-type-1'
			})
		)

		expect(result).toEqual(
			expect.objectContaining({
				productId: 'product-1',
				currentProductTypeId: null,
				requestedProductTypeId: 'product-type-1',
				hasScopedData: false,
				canChangeNow: true,
				compatible: true,
				requiresUserDecision: false,
				blockingReason: null,
				productAttributeConflicts: [],
				variantAttributeConflicts: []
			})
		)
		expect(repo.update).not.toHaveBeenCalled()
	})

	it('requires productTypeId for compatibility preview', async () => {
		await expect(
			runWithCatalog(() =>
				service.previewProductTypeCompatibility('product-1', {} as any)
			)
		).rejects.toThrow('productTypeId is required')

		expect(repo.findProductTypeCompatibilityPreviewRef).not.toHaveBeenCalled()
		expect(repo.update).not.toHaveBeenCalled()
	})

	it('applies confirmed product type change when existing scoped data is compatible', async () => {
		repo.findProductTypeCompatibilityPreviewRef.mockResolvedValue({
			id: 'product-1',
			productTypeId: 'product-type-old',
			productAttributes: [
				{
					attributeId: 'material-attribute',
					attribute: {
						id: 'material-attribute',
						key: 'material',
						displayName: 'Material',
						dataType: 'STRING'
					}
				}
			],
			variants: []
		} as any)
		repo.findProductTypeValidationSchemaById.mockResolvedValue({
			id: 'product-type-1',
			catalogId: 'catalog-1',
			attributes: [
				{
					attributeId: 'material-attribute',
					isVariant: false,
					isRequired: false,
					displayOrder: 1,
					attribute: {
						id: 'material-attribute',
						key: 'material',
						dataType: 'STRING'
					}
				}
			]
		} as any)

		await runWithCatalog(() =>
			service.applyProductTypeChange('product-1', {
				productTypeId: 'product-type-1',
				expectedCurrentProductTypeId: 'product-type-old',
				confirm: true
			})
		)

		expect(repo.applyProductTypeChange).toHaveBeenCalledWith(
			'product-1',
			'catalog-1',
			{ productType: { connect: { id: 'product-type-1' } } },
			[],
			undefined,
			undefined
		)
		expect(repo.update).not.toHaveBeenCalled()
		expect(productSeoSync.syncProduct).toHaveBeenCalled()
	})

	it('requires explicit removal for incompatible product attributes', async () => {
		repo.findProductTypeCompatibilityPreviewRef.mockResolvedValue({
			id: 'product-1',
			productTypeId: 'product-type-old',
			productAttributes: [
				{
					attributeId: 'material-attribute',
					attribute: {
						id: 'material-attribute',
						key: 'material',
						displayName: 'Material',
						dataType: 'STRING'
					}
				}
			],
			variants: []
		} as any)
		repo.findProductTypeValidationSchemaById.mockResolvedValue({
			id: 'product-type-1',
			catalogId: 'catalog-1',
			attributes: []
		} as any)

		await expect(
			runWithCatalog(() =>
				service.applyProductTypeChange('product-1', {
					productTypeId: 'product-type-1',
					confirm: true
				})
			)
		).rejects.toThrow('Incompatible product attributes require explicit removal')

		expect(repo.applyProductTypeChange).not.toHaveBeenCalled()

		await runWithCatalog(() =>
			service.applyProductTypeChange('product-1', {
				productTypeId: 'product-type-1',
				confirm: true,
				removeAttributeIds: ['material-attribute']
			})
		)

		expect(repo.applyProductTypeChange).toHaveBeenCalledWith(
			'product-1',
			'catalog-1',
			{ productType: { connect: { id: 'product-type-1' } } },
			['material-attribute'],
			undefined,
			undefined
		)
	})

	it('requires a full variant matrix when variant attributes conflict', async () => {
		repo.findProductTypeCompatibilityPreviewRef.mockResolvedValue({
			id: 'product-1',
			productTypeId: 'product-type-old',
			productAttributes: [],
			variants: [
				{
					variantKey: 'red',
					attributes: [
						{
							attributeId: 'color-attribute',
							attribute: {
								id: 'color-attribute',
								key: 'color',
								displayName: 'Color',
								dataType: 'ENUM'
							}
						}
					]
				}
			]
		} as any)
		repo.findProductTypeValidationSchemaById.mockResolvedValue({
			id: 'product-type-1',
			catalogId: 'catalog-1',
			attributes: [
				{
					attributeId: 'color-attribute',
					isVariant: false,
					isRequired: false,
					displayOrder: 1,
					attribute: {
						id: 'color-attribute',
						key: 'color',
						dataType: 'ENUM'
					}
				}
			]
		} as any)

		await expect(
			runWithCatalog(() =>
				service.applyProductTypeChange('product-1', {
					productTypeId: 'product-type-1',
					confirm: true
				})
			)
		).rejects.toThrow(
			'Incompatible variant attributes require full variant matrix replacement'
		)

		expect(repo.applyProductTypeChange).not.toHaveBeenCalled()
	})

	it('applies product type change and full target variant matrix atomically', async () => {
		const builtVariants = [
			{
				sku: 'SKU-S',
				variantKey: 'size:size-s',
				price: 120,
				stock: 2,
				status: 'ACTIVE',
				attributes: [
					{
						attributeId: 'size-attribute',
						enumValueId: 'size-s'
					}
				]
			}
		]
		repo.findProductTypeCompatibilityPreviewRef.mockResolvedValue({
			id: 'product-1',
			productTypeId: 'product-type-old',
			productAttributes: [],
			variants: [
				{
					variantKey: 'color:red',
					attributes: [
						{
							attributeId: 'color-attribute',
							attribute: {
								id: 'color-attribute',
								key: 'color',
								displayName: 'Color',
								dataType: 'ENUM'
							}
						}
					]
				}
			]
		} as any)
		repo.findProductTypeValidationSchemaById.mockResolvedValue({
			id: 'product-type-1',
			catalogId: 'catalog-1',
			attributes: [
				{
					attributeId: 'size-attribute',
					isVariant: true,
					isRequired: true,
					displayOrder: 1,
					attribute: {
						id: 'size-attribute',
						key: 'size',
						dataType: 'ENUM'
					}
				}
			]
		} as any)
		repo.findSkuById.mockResolvedValue({
			id: 'product-1',
			sku: 'SKU',
			price: 100,
			productTypeId: 'product-type-old'
		} as any)
		variantBuilder.build.mockResolvedValue(builtVariants as any)

		await runWithCatalog(() =>
			service.applyProductTypeChange('product-1', {
				productTypeId: 'product-type-1',
				confirm: true,
				items: [
					{
						price: 120,
						stock: 2,
						attributes: [
							{
								attributeId: 'size-attribute',
								enumValueId: 'size-s'
							}
						]
					}
				]
			})
		)

		expect(variantBuilder.build).toHaveBeenCalledWith(
			{
				catalogTypeId: 'type-1',
				catalogId: 'catalog-1',
				productTypeId: 'product-type-1'
			},
			expect.any(Array),
			'SKU',
			{ defaultPrice: 100 }
		)
		expect(repo.applyProductTypeChange).toHaveBeenCalledWith(
			'product-1',
			'catalog-1',
			{ productType: { connect: { id: 'product-type-1' } } },
			[],
			undefined,
			builtVariants
		)
	})

	it('rejects stale product type apply after preview', async () => {
		repo.findProductTypeCompatibilityPreviewRef.mockResolvedValue({
			id: 'product-1',
			productTypeId: 'product-type-current',
			productAttributes: [],
			variants: []
		} as any)

		await expect(
			runWithCatalog(() =>
				service.applyProductTypeChange('product-1', {
					productTypeId: 'product-type-1',
					expectedCurrentProductTypeId: 'product-type-old',
					confirm: true
				})
			)
		).rejects.toThrow('Product type changed after preview')

		expect(repo.applyProductTypeChange).not.toHaveBeenCalled()
	})

	it('duplicates product with source status and copied relations', async () => {
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
				productType: { id: 'product-type-1', code: 'shoes', name: 'Shoes' },
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
				status: 'ACTIVE',
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
			status: 'ACTIVE'
		})

		expect(variantBuilder.build).toHaveBeenCalledWith(
			{
				catalogTypeId: 'type-1',
				catalogId: 'catalog-1',
				productTypeId: 'product-type-1'
			},
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
			'catalog-1',
			expect.objectContaining({
				name: 'Source Product (копия)',
				status: 'ACTIVE',
				position: 7,
				brand: { connect: { id: 'brand-1' } },
				productType: { connect: { id: 'product-type-1' } },
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
		expect(repo.prependProductToCategories).toHaveBeenCalledWith(
			'product-2',
			'catalog-1',
			['category-1', 'category-2']
		)
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_LIST_CACHE_VERSION,
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

	it('allows duplicate product name in catalog', async () => {
		repo.existsName.mockResolvedValue(true)
		repo.existsSlug.mockResolvedValue(false)
		repo.existsSku.mockResolvedValue(false)
		repo.findById.mockResolvedValue({
			id: 'product-1',
			slug: 'duplicate-product',
			media: [],
			productAttributes: [],
			variants: [],
			categoryProducts: []
		} as any)
		repo.create.mockResolvedValue({
			id: 'product-1',
			slug: 'duplicate-product'
		} as any)
		attributeBuilder.buildForCreate.mockResolvedValue([])

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'Duplicate Product',
					price: 100
				})
			)
		).resolves.toMatchObject({
			ok: true,
			id: 'product-1',
			slug: 'duplicate-product'
		})
		expect(repo.existsName).not.toHaveBeenCalled()
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

		expect(repo.prependProductToCategories).toHaveBeenCalledWith(
			'product-1',
			'catalog-1',
			['category-1', 'category-2']
		)
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_LIST_CACHE_VERSION,
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
		repo.findById.mockResolvedValue({ id: 'product-1', media: [] } as any)

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
			CATEGORY_LIST_CACHE_VERSION,
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
		repo.findById.mockResolvedValue({ id: 'product-1', media: [] } as any)

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

	it('unlinks all categories when update receives an empty categories array', async () => {
		repo.update.mockResolvedValue({ id: 'product-1', media: [] } as any)
		repo.findById.mockResolvedValue({
			id: 'product-1',
			media: [],
			categoryProducts: []
		} as any)

		await expect(
			runWithCatalog(() =>
				service.update('product-1', {
					categories: []
				})
			)
		).resolves.toMatchObject({ ok: true, id: 'product-1' })

		expect(repo.findCategoriesByIds).not.toHaveBeenCalled()
		expect(repo.syncProductCategories).toHaveBeenCalledWith(
			'product-1',
			'catalog-1',
			[]
		)
	})

	it('syncs SEO after product update using final product state', async () => {
		repo.update.mockResolvedValue({
			id: 'product-1',
			slug: 'updated-product',
			name: 'Updated Product',
			price: 120,
			status: 'ACTIVE',
			brand: null,
			media: [],
			productAttributes: [],
			variants: [],
			categoryProducts: []
		} as any)

		await expect(
			runWithCatalog(() =>
				service.update('product-1', {
					name: 'Updated Product'
				})
			)
		).resolves.toMatchObject({ ok: true, id: 'product-1' })

		expect(productSeoSync.syncProduct).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'product-1',
				slug: 'updated-product'
			}),
			'catalog-1'
		)
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
		expect(productSeoSync.syncProduct).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'product-1',
				status: 'HIDDEN'
			}),
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

	it('delegates category position update to generic product update flow', async () => {
		const updateSpy = jest.spyOn(service, 'update').mockResolvedValue({
			ok: true,
			id: 'product-1'
		} as any)

		await expect(
			runWithCatalog(() =>
				service.updateCategoryPosition('product-1', {
					categoryId: 'category-1',
					position: 4
				})
			)
		).resolves.toMatchObject({
			ok: true,
			id: 'product-1'
		})

		expect(updateSpy).toHaveBeenCalledWith('product-1', {
			categoryId: 'category-1',
			categoryPosition: 4
		})
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
		expect(productSeoSync.removeProduct).toHaveBeenCalledWith(
			'product-1',
			'catalog-1'
		)
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_LIST_CACHE_VERSION,
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

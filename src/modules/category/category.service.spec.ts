import { ProductVariantStatus } from '@generated/enums'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { CAPABILITY_READER_PORT } from '@/modules/capability/contracts'
import { CatalogPriceListResolverService } from '@/modules/catalog-price-list/public'
import {
	PRODUCT_COMMAND_PORT,
	PRODUCT_SELLABLE_READER_PORT,
	type ProductCommandPort,
	type ProductSellableProjection,
	type ProductSellableReader,
	ProductVariantCardProjectionService
} from '@/modules/product/public'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATEGORY_LIST_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { ProductMediaMapper } from '@/shared/media/product-media.mapper'

import { RequestContext } from '../../shared/tenancy/request-context'

import { CategoryRepository } from './category.repository'
import { CategoryService } from './category.service'

describe('CategoryService', () => {
	let service: CategoryService
	let serviceState: {
		listCacheTtlSec: number
		firstPageCacheTtlSec: number
		nextPageCacheTtlSec: number
	}
	let repo: jest.Mocked<CategoryRepository>
	let cache: jest.Mocked<CacheService>
	let productCommands: jest.Mocked<ProductCommandPort>
	let sellableReader: jest.Mocked<ProductSellableReader>
	let variantProjection: jest.Mocked<ProductVariantCardProjectionService>
	let priceLists: jest.Mocked<CatalogPriceListResolverService>
	let capabilities: {
		canUseCatalogPriceLists: jest.Mock
		canUseCatalogSaleUnits: jest.Mock
	}

	const runWithCatalog = <T>(fn: () => Promise<T>) =>
		RequestContext.run(
			{
				requestId: 'req-1',
				host: 'example.test',
				catalogId: 'catalog-1'
			},
			fn
		)

	const runWithChildCatalog = <T>(fn: () => Promise<T>) =>
		RequestContext.run(
			{
				requestId: 'req-1',
				host: 'child.example.test',
				catalogId: 'child-catalog-1',
				parentId: 'catalog-1'
			},
			fn
		)

	const createSellableProjection = (
		overrides: Partial<ProductSellableProjection> = {}
	): ProductSellableProjection => ({
		catalogId: 'catalog-1',
		productId: 'product-1',
		mode: 'SIMPLE',
		variantId: null,
		defaultVariantId: null,
		requiresVariantSelection: false,
		priceState: 'UNKNOWN',
		displayPrice: null,
		minPrice: null,
		maxPrice: null,
		availabilityState: 'AVAILABLE',
		stock: null,
		usesPriceList: false,
		priceListId: null,
		priceListCode: null,
		priceListName: null,
		...overrides
	})

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CategoryService,
				ProductMediaMapper,
				{
					provide: CategoryRepository,
					useValue: {
						findAll: jest.fn(),
						findById: jest.fn(),
						create: jest.fn(),
						update: jest.fn(),
						updatePositions: jest.fn(),
						softDelete: jest.fn(),
						findProductsByIds: jest.fn(),
						findProductIdsByCategory: jest.fn(),
						findCategoryProductRefs: jest.fn(),
						findCategoryProductPositions: jest.fn(),
						findCategoryProductsPage: jest.fn(),
						findCategoryProductCardsPage: jest.fn()
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
					provide: PRODUCT_COMMAND_PORT,
					useValue: {
						create: jest.fn(),
						update: jest.fn(),
						remove: jest.fn()
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
				},
				{
					provide: ProductVariantCardProjectionService,
					useValue: {
						resolveForProductIds: jest.fn().mockResolvedValue(new Map())
					}
				},
				{
					provide: CatalogPriceListResolverService,
					useValue: {
						resolveProductPriceContext: jest.fn().mockResolvedValue({
							priceList: null,
							productPrices: new Map(),
							variantPrices: new Map(),
							saleUnitPrices: new Map()
						})
					}
				},
				{
					provide: CAPABILITY_READER_PORT,
					useValue: {
						canUseCatalogPriceLists: jest.fn().mockResolvedValue(false),
						canUseCatalogSaleUnits: jest.fn().mockResolvedValue(true)
					}
				},
				{
					provide: PRODUCT_SELLABLE_READER_PORT,
					useValue: {
						resolveProductSellable: jest
							.fn()
							.mockImplementation((catalogId: string, productId: string) =>
								createSellableProjection({ catalogId, productId })
							),
						resolveProductsSellable: jest.fn(
							async (catalogId: string, productIds: string[]) =>
								new Map(
									productIds.map(productId => [
										productId,
										createSellableProjection({ catalogId, productId })
									])
								)
						),
						resolveVariantSellable: jest.fn()
					}
				}
			]
		}).compile()

		service = module.get<CategoryService>(CategoryService)
		serviceState = service as unknown as {
			listCacheTtlSec: number
			firstPageCacheTtlSec: number
			nextPageCacheTtlSec: number
		}
		repo = module.get(CategoryRepository)
		cache = module.get(CacheService)
		productCommands = module.get(PRODUCT_COMMAND_PORT)
		sellableReader = module.get(PRODUCT_SELLABLE_READER_PORT)
		variantProjection = module.get(ProductVariantCardProjectionService)
		priceLists = module.get(CatalogPriceListResolverService)
		capabilities = module.get(CAPABILITY_READER_PORT)

		cache.buildKey.mockImplementation(parts =>
			parts
				.filter(part => part !== undefined && part !== null && part !== '')
				.map(part => String(part))
				.join(':')
		)
		cache.getVersion.mockResolvedValue(0)
		cache.getJson.mockResolvedValue(null)
		cache.setJson.mockResolvedValue(undefined)
		serviceState.listCacheTtlSec = 0
		serviceState.firstPageCacheTtlSec = 0
		serviceState.nextPageCacheTtlSec = 0
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	it('returns categories ordered by normalized global position without writes', async () => {
		repo.findAll.mockResolvedValue([
			{ id: 'cat-1', parentId: null, position: 0, name: 'First' },
			{ id: 'cat-2', parentId: 'parent-1', position: 0, name: 'Jeans' },
			{ id: 'cat-3', parentId: null, position: 2, name: 'Third' }
		] as any)

		const result = await runWithCatalog(() => service.getAll())

		expect(repo.updatePositions).not.toHaveBeenCalled()
		expect(result.map(category => [category.id, category.position])).toEqual([
			['cat-1', 0],
			['cat-2', 1],
			['cat-3', 2]
		])
	})

	it('can return only categories with active products for storefront lists', async () => {
		repo.findAll.mockResolvedValue([
			{
				id: 'parent-empty',
				parentId: null,
				position: 0,
				name: 'Shoes',
				_count: { categoryProducts: 0 },
				imageMedia: null
			},
			{
				id: 'child-filled',
				parentId: 'parent-empty',
				position: 1,
				name: 'Sneakers',
				_count: { categoryProducts: 3 },
				imageMedia: null
			},
			{
				id: 'child-empty',
				parentId: 'parent-empty',
				position: 2,
				name: 'Boots',
				_count: { categoryProducts: 0 },
				imageMedia: null
			}
		] as any)

		const result = await runWithCatalog(() =>
			service.getAll({ includeEmpty: false })
		)

		expect(result.map(category => category.id)).toEqual(['child-filled'])
	})

	it('counts only products visible in active price list for storefront category lists', async () => {
		repo.findAll.mockResolvedValue([
			{
				id: 'only-hidden',
				parentId: null,
				position: 0,
				name: 'Only hidden',
				_count: { categoryProducts: 2 },
				imageMedia: null
			},
			{
				id: 'has-visible',
				parentId: null,
				position: 1,
				name: 'Has visible',
				_count: { categoryProducts: 2 },
				imageMedia: null
			}
		] as any)
		priceLists.resolveProductPriceContext.mockResolvedValueOnce({
			priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
			productPrices: new Map(),
			variantPrices: new Map(),
			saleUnitPrices: new Map()
		})
		repo.findCategoryProductRefs.mockResolvedValue([
			{ categoryId: 'only-hidden', productId: 'hidden-1' },
			{ categoryId: 'only-hidden', productId: 'hidden-2' },
			{ categoryId: 'has-visible', productId: 'hidden-2' },
			{ categoryId: 'has-visible', productId: 'visible-1' }
		])
		sellableReader.resolveProductsSellable.mockResolvedValueOnce(
			new Map([
				[
					'hidden-1',
					createSellableProjection({
						productId: 'hidden-1',
						usesPriceList: true,
						priceState: 'UNKNOWN'
					})
				],
				[
					'hidden-2',
					createSellableProjection({
						productId: 'hidden-2',
						usesPriceList: true,
						priceState: 'UNKNOWN'
					})
				],
				[
					'visible-1',
					createSellableProjection({
						productId: 'visible-1',
						usesPriceList: true,
						priceState: 'KNOWN',
						displayPrice: '900.00',
						minPrice: '900.00',
						maxPrice: '900.00'
					})
				]
			])
		)

		const result = await runWithCatalog(() =>
			service.getAll({ includeEmpty: false })
		)

		expect(repo.findCategoryProductRefs).toHaveBeenCalledWith(
			'catalog-1',
			['only-hidden', 'has-visible'],
			{ includeInactive: false }
		)
		expect(result.map(category => [category.id, category.productCount])).toEqual([
			['has-visible', 1]
		])
	})

	it('returns cached categories list when cache is warm', async () => {
		serviceState.listCacheTtlSec = 120

		const cached = [
			{ id: 'cat-1', name: 'First', position: 0, imageMedia: null }
		] as any
		cache.getJson.mockResolvedValue(cached)

		const result = await runWithCatalog(() => service.getAll())

		expect(result).toEqual(cached)
		expect(repo.findAll).not.toHaveBeenCalled()
		expect(cache.getJson).toHaveBeenCalled()
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

	it('returns category product cards with product attributes and variant picker options', async () => {
		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)
		repo.findCategoryProductCardsPage.mockResolvedValue([
			{
				productId: 'p1',
				position: 0,
				product: {
					id: 'p1',
					media: [],
					integrationLinks: [],
					productAttributes: [],
					variants: [
						{
							id: 'default-variant',
							variantKey: 'default',
							kind: 'DEFAULT',
							saleUnits: [
								{
									id: 'sale-unit-piece',
									catalogSaleUnitId: 'catalog-sale-unit-piece',
									code: 'piece',
									name: 'Piece',
									baseQuantity: '1.0000',
									price: '690.00',
									barcode: null,
									isDefault: true,
									isActive: true,
									displayOrder: 0,
									createdAt: new Date('2026-03-23T15:00:00.000Z'),
									updatedAt: new Date('2026-03-23T15:00:00.000Z'),
									catalogSaleUnit: null
								}
							]
						}
					]
				}
			},
			{
				productId: 'p2',
				position: 1,
				product: {
					id: 'p2',
					media: [],
					integrationLinks: [],
					productAttributes: []
				}
			},
			{
				productId: 'p3',
				position: 2,
				product: {
					id: 'p3',
					media: [],
					integrationLinks: [],
					productAttributes: []
				}
			}
		] as any)
		variantProjection.resolveForProductIds.mockResolvedValueOnce(
			new Map([
				[
					'p1',
					{
						variantSummary: {
							minPrice: '690.00',
							maxPrice: '790.00',
							activeCount: 2,
							totalStock: 7,
							singleVariantId: null
						},
						variantPickerOptions: [
							{
								id: 'variant-1',
								label: 'S, Черный',
								price: '690.00',
								stock: 4,
								status: ProductVariantStatus.ACTIVE,
								isAvailable: true,
								saleUnitId: null,
								saleUnitPrice: null,
								maxQuantity: 4
							}
						]
					}
				]
			])
		)

		const result = await runWithCatalog(() =>
			service.getProductCardsByCategory('cat-1', { limit: 2 })
		)

		expect(result.items.map(item => item.productId)).toEqual(['p1', 'p2'])
		expect(repo.findCategoryProductCardsPage).toHaveBeenCalledWith(
			'cat-1',
			'catalog-1',
			{ cursor: undefined, take: 3, includeInactive: false }
		)
		expect(repo.findCategoryProductsPage).not.toHaveBeenCalled()
		expect(variantProjection.resolveForProductIds).toHaveBeenCalledWith(
			['p1', 'p2', 'p3'],
			expect.objectContaining({ priceList: null }),
			{ filterUnavailable: true }
		)
		expect(result.items[0]?.product).toHaveProperty('productAttributes', [])
		expect(result.items[0]?.product).not.toHaveProperty('variants')
		expect(result.items[0]?.product).toHaveProperty('saleUnits', [
			expect.objectContaining({
				id: 'sale-unit-piece',
				name: 'Piece',
				baseQuantity: '1.0000'
			})
		])
		expect(result.items[0]?.product).toMatchObject({
			variantSummary: {
				minPrice: '690.00',
				maxPrice: '790.00',
				activeCount: 2
			},
			variantPickerOptions: [
				{
					id: 'variant-1',
					label: 'S, Черный'
				}
			]
		})
	})

	it('does not expose sale units in category product cards when the feature is disabled', async () => {
		capabilities.canUseCatalogSaleUnits.mockResolvedValueOnce(false)
		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)
		repo.findCategoryProductCardsPage.mockResolvedValue([
			{
				productId: 'p1',
				position: 0,
				product: {
					id: 'p1',
					media: [],
					integrationLinks: [],
					productAttributes: [],
					variants: [
						{
							id: 'default-variant',
							variantKey: 'default',
							kind: 'DEFAULT',
							saleUnits: [
								{
									id: 'sale-unit-piece',
									name: 'Piece',
									price: '690.00',
									baseQuantity: '1.0000',
									isDefault: true,
									displayOrder: 0
								}
							]
						}
					]
				}
			}
		] as any)

		const result = await runWithCatalog(() =>
			service.getProductCardsByCategory('cat-1', { limit: 2 })
		)

		expect(result.items[0]?.product).toHaveProperty('saleUnits', [])
		expect(variantProjection.resolveForProductIds).toHaveBeenCalledWith(
			['p1'],
			expect.objectContaining({ priceList: null }),
			{ filterUnavailable: true, canUseCatalogSaleUnits: false }
		)
	})

	it('adds commercial projection fields to category product cards', async () => {
		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)
		repo.findCategoryProductCardsPage.mockResolvedValue([
			{
				productId: 'p1',
				position: 0,
				product: {
					id: 'p1',
					price: null,
					media: [],
					integrationLinks: [],
					productAttributes: []
				}
			}
		] as any)
		sellableReader.resolveProductsSellable.mockResolvedValueOnce(
			new Map([
				[
					'p1',
					createSellableProjection({
						catalogId: 'catalog-1',
						productId: 'p1',
						mode: 'SIMPLE',
						variantId: 'variant-1',
						defaultVariantId: 'variant-1',
						requiresVariantSelection: false,
						priceState: 'KNOWN',
						displayPrice: '1500.00',
						minPrice: '1500.00',
						maxPrice: '1500.00',
						availabilityState: 'AVAILABLE',
						stock: 7
					})
				]
			])
		)

		const result = await runWithCatalog(() =>
			service.getProductCardsByCategory('cat-1', { limit: 2 })
		)

		expect(sellableReader.resolveProductsSellable).toHaveBeenCalledWith(
			'catalog-1',
			['p1'],
			{ buyerCatalogId: 'catalog-1' }
		)
		expect(result.items[0]?.product).toMatchObject({
			id: 'p1',
			price: '1500.00',
			priceState: 'KNOWN',
			displayPrice: '1500.00',
			minPrice: '1500.00',
			maxPrice: '1500.00',
			availabilityState: 'AVAILABLE',
			stock: 7,
			defaultVariantId: 'variant-1',
			requiresVariantSelection: false
		})
	})

	it('hides category products without active price-list price', async () => {
		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)
		repo.findCategoryProductCardsPage.mockResolvedValue([
			{
				productId: 'legacy-product',
				position: 0,
				product: {
					id: 'legacy-product',
					price: null,
					media: [],
					integrationLinks: [],
					productAttributes: []
				}
			},
			{
				productId: 'priced-product',
				position: 1,
				product: {
					id: 'priced-product',
					price: null,
					media: [],
					integrationLinks: [],
					productAttributes: []
				}
			}
		] as any)
		sellableReader.resolveProductsSellable.mockResolvedValueOnce(
			new Map([
				[
					'legacy-product',
					createSellableProjection({
						productId: 'legacy-product',
						priceState: 'UNKNOWN',
						displayPrice: null,
						minPrice: null,
						maxPrice: null,
						availabilityState: 'AVAILABLE',
						stock: null,
						defaultVariantId: null,
						requiresVariantSelection: false,
						usesPriceList: true
					})
				],
				[
					'priced-product',
					createSellableProjection({
						productId: 'priced-product',
						priceState: 'KNOWN',
						displayPrice: '1200.00',
						minPrice: '1200.00',
						maxPrice: '1200.00',
						availabilityState: 'AVAILABLE',
						stock: 4,
						defaultVariantId: 'variant-1',
						requiresVariantSelection: false,
						usesPriceList: true
					})
				]
			])
		)

		const result = await runWithCatalog(() =>
			service.getProductCardsByCategory('cat-1', { limit: 2 })
		)

		expect(result.items.map(item => item.productId)).toEqual(['priced-product'])
		expect(result.items[0]?.product).toMatchObject({
			id: 'priced-product',
			price: '1200.00'
		})
	})

	it('continues category pagination past products hidden by active price list', async () => {
		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)
		repo.findCategoryProductCardsPage
			.mockResolvedValueOnce([
				{
					productId: 'hidden-1',
					position: 0,
					product: {
						id: 'hidden-1',
						price: null,
						media: [],
						integrationLinks: [],
						productAttributes: []
					}
				},
				{
					productId: 'hidden-2',
					position: 1,
					product: {
						id: 'hidden-2',
						price: null,
						media: [],
						integrationLinks: [],
						productAttributes: []
					}
				},
				{
					productId: 'hidden-3',
					position: 2,
					product: {
						id: 'hidden-3',
						price: null,
						media: [],
						integrationLinks: [],
						productAttributes: []
					}
				}
			] as any)
			.mockResolvedValueOnce([
				{
					productId: 'priced-product',
					position: 3,
					product: {
						id: 'priced-product',
						price: null,
						media: [],
						integrationLinks: [],
						productAttributes: []
					}
				}
			] as any)
		sellableReader.resolveProductsSellable
			.mockResolvedValueOnce(
				new Map(
					['hidden-1', 'hidden-2', 'hidden-3'].map(productId => [
						productId,
						createSellableProjection({
							productId,
							priceState: 'UNKNOWN',
							displayPrice: null,
							minPrice: null,
							maxPrice: null,
							availabilityState: 'AVAILABLE',
							stock: null,
							defaultVariantId: null,
							requiresVariantSelection: false,
							usesPriceList: true
						})
					])
				)
			)
			.mockResolvedValueOnce(
				new Map([
					[
						'priced-product',
						createSellableProjection({
							productId: 'priced-product',
							priceState: 'KNOWN',
							displayPrice: '1200.00',
							minPrice: '1200.00',
							maxPrice: '1200.00',
							availabilityState: 'AVAILABLE',
							stock: 4,
							defaultVariantId: 'variant-1',
							requiresVariantSelection: false,
							usesPriceList: true
						})
					]
				])
			)

		const result = await runWithCatalog(() =>
			service.getProductCardsByCategory('cat-1', { limit: 2 })
		)

		const nextCursor = Buffer.from(
			JSON.stringify({ position: 2, productId: 'hidden-3' })
		).toString('base64')
		expect(repo.findCategoryProductCardsPage.mock.calls).toContainEqual([
			'cat-1',
			'catalog-1',
			{ cursor: undefined, take: 3, includeInactive: false }
		])
		expect(repo.findCategoryProductCardsPage.mock.calls).toContainEqual([
			'cat-1',
			'catalog-1',
			{ cursor: nextCursor, take: 3, includeInactive: false }
		])
		expect(result.items.map(item => item.productId)).toEqual(['priced-product'])
		expect(result.nextCursor).toBeNull()
	})

	it('applies active price-list sale unit prices to category products', async () => {
		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)
		repo.findCategoryProductCardsPage.mockResolvedValue([
			{
				productId: 'p1',
				position: 0,
				product: {
					id: 'p1',
					price: '1200.00',
					media: [],
					integrationLinks: [],
					productAttributes: [],
					variants: [
						{
							id: 'variant-default',
							kind: 'DEFAULT',
							variantKey: 'default',
							price: '1200.00',
							attributes: [],
							saleUnits: [
								{
									id: 'sale-unit-piece',
									name: 'шт',
									price: '1200.00',
									baseQuantity: '1.0000',
									isDefault: true,
									displayOrder: 0
								}
							]
						}
					]
				}
			}
		] as any)
		priceLists.resolveProductPriceContext.mockResolvedValueOnce({
			priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' },
			productPrices: new Map(),
			variantPrices: new Map(),
			saleUnitPrices: new Map([['sale-unit-piece', '250.00']])
		})
		sellableReader.resolveProductsSellable.mockResolvedValueOnce(
			new Map([
				[
					'p1',
					createSellableProjection({
						productId: 'p1',
						priceState: 'KNOWN',
						displayPrice: '250.00',
						minPrice: '250.00',
						maxPrice: '250.00',
						availabilityState: 'AVAILABLE',
						stock: null,
						defaultVariantId: 'variant-default',
						requiresVariantSelection: false,
						usesPriceList: true
					})
				]
			])
		)

		const result = await runWithCatalog(() =>
			service.getProductCardsByCategory('cat-1', { limit: 2 })
		)

		expect(result.items[0]?.product).toMatchObject({
			id: 'p1',
			price: '250.00',
			displayPrice: '250.00',
			saleUnits: [
				expect.objectContaining({
					id: 'sale-unit-piece',
					price: '250.00'
				})
			]
		})
		expect(variantProjection.resolveForProductIds).toHaveBeenCalledWith(
			['p1'],
			expect.objectContaining({
				priceList: { id: 'price-list-1', code: 'retail', name: 'Retail' }
			}),
			{ filterUnavailable: true }
		)
	})

	it('does not apply price-list visibility in includeInactive category reads', async () => {
		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)
		repo.findCategoryProductsPage.mockResolvedValue([
			{
				productId: 'legacy-product',
				position: 0,
				product: {
					id: 'legacy-product',
					price: null,
					media: [],
					integrationLinks: [],
					productAttributes: []
				}
			}
		] as any)
		sellableReader.resolveProductsSellable.mockResolvedValueOnce(
			new Map([
				[
					'legacy-product',
					createSellableProjection({
						productId: 'legacy-product',
						priceState: 'UNKNOWN',
						displayPrice: null,
						minPrice: null,
						maxPrice: null,
						availabilityState: 'AVAILABLE',
						stock: null,
						defaultVariantId: null,
						requiresVariantSelection: false,
						usesPriceList: true
					})
				]
			])
		)

		const result = await runWithCatalog(() =>
			service.getProductsByCategory('cat-1', {
				limit: 2,
				includeInactive: true
			})
		)

		expect(sellableReader.resolveProductsSellable).toHaveBeenCalledWith(
			'catalog-1',
			['legacy-product'],
			{ buyerCatalogId: 'catalog-1' }
		)
		expect(variantProjection.resolveForProductIds).toHaveBeenCalledWith(
			['legacy-product'],
			expect.objectContaining({ priceList: null }),
			{ filterUnavailable: false }
		)
		expect(result.items.map(item => item.productId)).toEqual(['legacy-product'])
	})

	it('applies price-list visibility in includeInactive child category reads', async () => {
		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)
		repo.findCategoryProductsPage.mockResolvedValue([
			{
				productId: 'legacy-product',
				position: 0,
				product: {
					id: 'legacy-product',
					price: null,
					media: [],
					integrationLinks: [],
					productAttributes: []
				}
			}
		] as any)
		sellableReader.resolveProductsSellable.mockResolvedValueOnce(
			new Map([
				[
					'legacy-product',
					createSellableProjection({
						productId: 'legacy-product',
						priceState: 'UNKNOWN',
						displayPrice: null,
						minPrice: null,
						maxPrice: null,
						availabilityState: 'AVAILABLE',
						stock: null,
						defaultVariantId: null,
						requiresVariantSelection: false,
						usesPriceList: true
					})
				]
			])
		)

		const result = await runWithChildCatalog(() =>
			service.getProductsByCategory('cat-1', {
				limit: 2,
				includeInactive: true
			})
		)

		expect(sellableReader.resolveProductsSellable).toHaveBeenCalledWith(
			'catalog-1',
			['legacy-product'],
			{ buyerCatalogId: 'child-catalog-1' }
		)
		expect(variantProjection.resolveForProductIds).toHaveBeenCalledWith(
			['legacy-product'],
			expect.objectContaining({ priceList: null }),
			{ filterUnavailable: true }
		)
		expect(result.items).toEqual([])
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
		cache.getJson.mockResolvedValue(cached)

		const result = await runWithCatalog(() =>
			service.getProductsByCategory('cat-1', { limit: 2 })
		)

		expect(result).toEqual(cached)
		expect(repo.findCategoryProductsPage.mock.calls).toHaveLength(0)
		expect(cache.getJson.mock.calls.length).toBeGreaterThan(0)
	})

	it('separates category product cache by read mode', async () => {
		serviceState.firstPageCacheTtlSec = 120

		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)
		repo.findCategoryProductsPage.mockResolvedValue([])
		capabilities.canUseCatalogSaleUnits.mockResolvedValueOnce(false)

		await runWithCatalog(() =>
			service.getProductsByCategory('cat-1', { limit: 2 })
		)

		const cacheKey = cache.getJson.mock.calls[0]?.[0] as string
		expect(cacheKey).toContain('price-lists-off')
		expect(cacheKey).toContain('price-list-apply-on')
		expect(cacheKey).toContain('price-filter-on')
		expect(cacheKey).toContain('sale-units-off')
	})

	it('separates category list cache by read mode', async () => {
		serviceState.listCacheTtlSec = 120

		repo.findAll.mockResolvedValue([])
		capabilities.canUseCatalogSaleUnits.mockResolvedValueOnce(false)

		await runWithCatalog(() => service.getAll())

		const cacheKey = cache.getJson.mock.calls[0]?.[0] as string
		expect(cacheKey).toContain('price-lists-off')
		expect(cacheKey).toContain('price-list-apply-on')
		expect(cacheKey).toContain('price-filter-on')
		expect(cacheKey).toContain('sale-units-off')
	})

	it('skips category products cache in includeInactive mode', async () => {
		serviceState.firstPageCacheTtlSec = 120

		repo.findById.mockResolvedValue({
			id: 'cat-1',
			catalogId: 'catalog-1'
		} as any)
		repo.findCategoryProductsPage.mockResolvedValue([])

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
		repo.findById.mockResolvedValue({
			id: 'cat-1',
			parentId: null,
			position: 0,
			name: 'Test category'
		} as any)
		repo.findProductsByIds.mockResolvedValue([
			{ id: 'p1' },
			{ id: 'p2' },
			{ id: 'p3' },
			{ id: 'p4' }
		])
		repo.findCategoryProductPositions.mockResolvedValue([
			{ productId: 'p1', position: 10 },
			{ productId: 'p2', position: 12 }
		])
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
		])
		repo.findAll.mockResolvedValue([
			{ id: 'cat-1', parentId: null, position: 0, name: 'Test category' }
		] as any)
		repo.findById.mockResolvedValue({
			id: 'cat-1',
			parentId: null,
			position: 0,
			name: 'Test category',
			catalogId: 'catalog-1'
		} as any)
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

	it('rejects category creation from child catalog', async () => {
		await expect(
			runWithChildCatalog(() =>
				service.create({
					name: 'Child category'
				})
			)
		).rejects.toThrow(
			'Дочерний каталог не может управлять товарами, категориями, брендами и справочниками каталога'
		)

		expect(repo.create).not.toHaveBeenCalled()
	})

	it('rebuilds global positions when category position changes', async () => {
		repo.findById
			.mockResolvedValueOnce({
				id: 'cat-jeans',
				parentId: 'parent-1',
				position: 2,
				name: 'Jeans'
			} as any)
			.mockResolvedValueOnce({
				id: 'cat-jeans',
				parentId: 'parent-1',
				position: 0,
				name: 'Jeans',
				imageMedia: null,
				children: []
			} as any)
		repo.findAll.mockResolvedValue([
			{ id: 'cat-root', parentId: null, position: 0, name: 'Root' },
			{ id: 'cat-shirts', parentId: 'parent-1', position: 1, name: 'Shirts' },
			{ id: 'cat-jeans', parentId: 'parent-1', position: 2, name: 'Jeans' }
		] as any)

		await runWithCatalog(() =>
			service.updatePosition('cat-jeans', { position: 0 })
		)

		expect(repo.update).not.toHaveBeenCalled()
		expect(repo.updatePositions).toHaveBeenCalledWith([
			{ id: 'cat-jeans', position: 0 },
			{ id: 'cat-root', position: 1 },
			{ id: 'cat-shirts', position: 2 }
		])
	})

	it('saves final category order in one absolute position update', async () => {
		repo.findAll
			.mockResolvedValueOnce([
				{ id: 'cat-a', parentId: null, position: 0, name: 'A' },
				{ id: 'cat-b', parentId: null, position: 1, name: 'B' },
				{ id: 'cat-c', parentId: null, position: 2, name: 'C' }
			] as any)
			.mockResolvedValueOnce([
				{ id: 'cat-b', parentId: null, position: 0, name: 'B' },
				{ id: 'cat-c', parentId: null, position: 1, name: 'C' },
				{ id: 'cat-a', parentId: null, position: 2, name: 'A' }
			] as any)

		const result = await runWithCatalog(() =>
			service.updatePositions({
				categories: [
					{ id: 'cat-b', position: 0 },
					{ id: 'cat-c', position: 1 },
					{ id: 'cat-a', position: 2 }
				]
			})
		)

		expect(repo.updatePositions).toHaveBeenCalledWith([
			{ id: 'cat-b', position: 0 },
			{ id: 'cat-c', position: 1 },
			{ id: 'cat-a', position: 2 }
		])
		expect(result.map(category => [category.id, category.position])).toEqual([
			['cat-b', 0],
			['cat-c', 1],
			['cat-a', 2]
		])
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			CATEGORY_LIST_CACHE_VERSION,
			'catalog-1'
		)
	})

	it('rejects unknown category ids when saving final order', async () => {
		repo.findAll.mockResolvedValue([
			{ id: 'cat-a', parentId: null, position: 0, name: 'A' }
		] as any)

		await expect(
			runWithCatalog(() =>
				service.updatePositions({
					categories: [{ id: 'cat-x', position: 0 }]
				})
			)
		).rejects.toBeInstanceOf(BadRequestException)
		expect(repo.updatePositions).not.toHaveBeenCalled()
	})

	it('rebuilds global positions after category removal', async () => {
		repo.findById.mockResolvedValue({
			id: 'cat-2',
			parentId: null,
			position: 1,
			name: 'Second'
		} as any)
		repo.softDelete.mockResolvedValue({
			id: 'cat-2'
		} as any)
		repo.findAll.mockResolvedValue([
			{ id: 'cat-1', parentId: null, position: 0, name: 'First' },
			{ id: 'cat-3', parentId: null, position: 2, name: 'Third' }
		] as any)

		await runWithCatalog(() => service.remove('cat-2'))

		expect(repo.updatePositions).toHaveBeenCalledWith([
			{ id: 'cat-3', position: 1 }
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_LIST_CACHE_VERSION,
			'catalog-1'
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		])
	})

	it('soft deletes category products before category removal when requested', async () => {
		repo.findById.mockResolvedValue({
			id: 'cat-2',
			parentId: null,
			position: 1,
			name: 'Second'
		} as any)
		repo.findProductIdsByCategory.mockResolvedValue(['product-1', 'product-2'])
		repo.softDelete.mockResolvedValue({
			id: 'cat-2'
		} as any)
		repo.findAll.mockResolvedValue([
			{ id: 'cat-1', parentId: null, position: 0, name: 'First' }
		] as any)

		await runWithCatalog(() => service.remove('cat-2', { deleteProducts: true }))

		expect(repo.findProductIdsByCategory).toHaveBeenCalledWith(
			'cat-2',
			'catalog-1'
		)
		expect(productCommands.remove).toHaveBeenNthCalledWith(1, 'product-1')
		expect(productCommands.remove).toHaveBeenNthCalledWith(2, 'product-2')
		expect(repo.softDelete).toHaveBeenCalledWith('cat-2', 'catalog-1')
	})
})

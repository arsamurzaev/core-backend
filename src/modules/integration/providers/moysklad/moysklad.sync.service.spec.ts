import { ProductStatus } from '@generated/enums'
import { Test, TestingModule } from '@nestjs/testing'

import { S3Service } from '@/modules/s3/s3.service'
import { CacheService } from '@/shared/cache/cache.service'
import { MediaRepository } from '@/shared/media/media.repository'

import { IntegrationRepository } from '../../integration.repository'

import { MoySkladClient } from './moysklad.client'
import { MoySkladMetadataCryptoService } from './moysklad.metadata'
import { MoySkladSyncService } from './moysklad.sync.service'

describe('MoySkladSyncService', () => {
	let service: MoySkladSyncService
	let repo: jest.Mocked<IntegrationRepository>
	let cache: jest.Mocked<CacheService>
	let s3: jest.Mocked<S3Service>
	let mediaRepo: jest.Mocked<MediaRepository>
	let metadataCrypto: jest.Mocked<MoySkladMetadataCryptoService>
	const testProductFolder = {
		id: 'folder-1',
		meta: {
			href: 'https://api.moysklad.ru/api/remap/1.2/entity/productfolder/folder-1'
		}
	}

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				MoySkladSyncService,
				{
					provide: IntegrationRepository,
					useValue: {
						beginMoySkladSync: jest.fn(),
						findMoySklad: jest.fn(),
						findProductLinkByExternalId: jest.fn(),
						findProductLinkByProductId: jest.fn(),
						findProductById: jest.fn(),
						findProductByCatalogAndSku: jest.fn(),
						existsProductSlug: jest.fn(),
						existsProductSku: jest.fn(),
						createProduct: jest.fn(),
						updateProduct: jest.fn(),
						findProductMediaIds: jest.fn(),
						replaceProductMedia: jest.fn(),
						upsertProductLink: jest.fn(),
						findProductLinksByIntegration: jest.fn(),
						findCategoryByName: jest.fn(),
						findCategoriesByName: jest.fn(),
						createCategory: jest.fn(),
						updateCategory: jest.fn(),
						findCategoryLinkByExternalId: jest.fn(),
						findCategoryLinkByCategoryId: jest.fn(),
						upsertCategoryLink: jest.fn(),
						syncManagedProductCategories: jest.fn(),
						finishMoySkladSync: jest.fn(),
						failMoySkladSync: jest.fn()
					}
				},
				{
					provide: CacheService,
					useValue: {
						bumpVersion: jest.fn()
					}
				},
				{
					provide: S3Service,
					useValue: {
						uploadImage: jest.fn(),
						deleteObjectsByKeys: jest.fn()
					}
				},
				{
					provide: MediaRepository,
					useValue: {
						findOrphanedByIds: jest.fn(),
						deleteOrphanedByIds: jest.fn()
					}
				},
				{
					provide: MoySkladMetadataCryptoService,
					useValue: {
						parseStoredMetadata: jest.fn().mockReturnValue({
							token: 'token',
							priceTypeName: 'Retail',
							importImages: true,
							syncStock: true
						})
					}
				}
			]
		}).compile()

		service = module.get(MoySkladSyncService)
		repo = module.get(IntegrationRepository)
		cache = module.get(CacheService)
		s3 = module.get(S3Service)
		mediaRepo = module.get(MediaRepository)
		metadataCrypto = module.get(MoySkladMetadataCryptoService)
		repo.findCategoriesByName.mockResolvedValue([])
		repo.findCategoryLinkByExternalId.mockResolvedValue(null)
		repo.findCategoryLinkByCategoryId.mockResolvedValue(null)
		repo.syncManagedProductCategories.mockResolvedValue({
			added: 0,
			removed: 0
		})
		jest
			.spyOn(MoySkladClient.prototype, 'getProductFolderChain')
			.mockResolvedValue([])
	})

	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('is defined', () => {
		expect(service).toBeDefined()
	})

	it('syncs catalog products without a long-lived interactive transaction', async () => {
		const catalogId = 'catalog-1'
		const lastSyncAt = new Date('2026-03-23T15:37:00.336Z')
		const integration = {
			id: 'integration-1',
			catalogId,
			metadata: {},
			isActive: true,
			lastSyncAt
		}
		const product = {
			id: 'external-1',
			externalCode: 'external-key-1',
			meta: { type: 'product' },
			name: 'Product 1',
			code: 'MSK-1',
			updated: '2026-03-23 14:00:00',
			archived: false,
			stock: 5,
			productFolder: testProductFolder,
			salePrices: [
				{
					value: 12500,
					priceType: {
						name: 'Retail'
					}
				}
			],
			images: {
				rows: [
					{
						meta: {
							downloadHref: 'https://example.test/image-1.jpg'
						}
					}
				]
			}
		}

		repo.beginMoySkladSync.mockResolvedValue(integration as any)
		repo.findMoySklad.mockResolvedValue(integration as any)
		repo.findProductLinkByExternalId.mockResolvedValue(null)
		repo.findProductByCatalogAndSku.mockResolvedValue(null)
		repo.existsProductSlug.mockResolvedValue(false)
		repo.existsProductSku.mockResolvedValue(false)
		repo.createProduct.mockResolvedValue({
			id: 'local-1',
			catalogId,
			name: 'Product 1',
			sku: 'MSK-1',
			slug: 'product-1',
			price: 125,
			status: ProductStatus.ACTIVE,
			deleteAt: null
		} as any)
		repo.findProductMediaIds.mockResolvedValue([])
		repo.replaceProductMedia.mockResolvedValue(true)
		repo.upsertProductLink.mockResolvedValue({ id: 'link-1' } as any)
		repo.findProductLinksByIntegration.mockResolvedValue([])
		repo.finishMoySkladSync.mockResolvedValue(integration as any)
		s3.uploadImage.mockResolvedValue({
			mediaId: 'media-1',
			key: 'integrations/moysklad/products/image-1.jpg'
		} as any)

		jest
			.spyOn(MoySkladClient.prototype, 'getAllAssortment')
			.mockResolvedValue([product] as any)
		jest.spyOn(MoySkladClient.prototype, 'downloadImage').mockResolvedValue({
			buffer: Buffer.from('image'),
			contentType: 'image/jpeg'
		})

		const result = await service.syncCatalog(catalogId)

		expect(result.ok).toBe(true)
		expect(metadataCrypto.parseStoredMetadata).toHaveBeenCalledWith(
			integration.metadata
		)
		expect(MoySkladClient.prototype.getAllAssortment).toHaveBeenCalledWith(
			undefined
		)
		expect(repo.existsProductSlug).toHaveBeenCalledWith(
			catalogId,
			'product-1',
			undefined,
			undefined
		)
		expect(repo.existsProductSku).toHaveBeenCalledWith(
			'MSK-1',
			undefined,
			undefined
		)
		expect(repo.createProduct).toHaveBeenCalledWith(
			expect.objectContaining({
				catalogId,
				name: 'Product 1',
				sku: 'MSK-1',
				slug: 'product-1',
				price: 125,
				status: ProductStatus.ACTIVE
			}),
			undefined
		)
		expect(repo.findProductMediaIds).toHaveBeenCalledWith(
			'local-1',
			catalogId,
			undefined
		)
		expect(repo.replaceProductMedia).toHaveBeenCalledWith(
			'local-1',
			catalogId,
			['media-1'],
			undefined
		)
		expect(repo.upsertProductLink).toHaveBeenCalledWith(
			expect.objectContaining({
				integrationId: integration.id,
				productId: 'local-1',
				externalId: 'external-key-1'
			}),
			undefined
		)
		expect(repo.finishMoySkladSync).toHaveBeenCalled()
		expect(cache.bumpVersion).toHaveBeenCalledTimes(2)
		expect(mediaRepo.findOrphanedByIds).not.toHaveBeenCalled()
	})

	it('syncs supported assortment item types and skips variants', async () => {
		const catalogId = 'catalog-1'
		const integration = {
			id: 'integration-1',
			catalogId,
			metadata: {},
			isActive: true,
			lastSyncAt: null
		}
		const assortment = [
			{
				id: 'external-product',
				externalCode: 'external-key-product',
				meta: { type: 'product' },
				name: 'Product 1',
				code: 'MSK-1',
				updated: '2026-03-23 14:00:00',
				archived: false,
				stock: 5,
				productFolder: testProductFolder,
				salePrices: [{ value: 12500, priceType: { name: 'Retail' } }],
				images: { rows: [] }
			},
			{
				id: 'external-service',
				externalCode: 'external-key-service',
				meta: { type: 'service' },
				name: 'Service 1',
				code: 'MSK-2',
				updated: '2026-03-23 14:01:00',
				archived: false,
				productFolder: testProductFolder,
				salePrices: [{ value: 5000, priceType: { name: 'Retail' } }],
				images: { rows: [] }
			},
			{
				id: 'external-bundle',
				externalCode: 'external-key-bundle',
				meta: { type: 'bundle' },
				name: 'Bundle 1',
				code: 'MSK-3',
				updated: '2026-03-23 14:02:00',
				archived: false,
				stock: 2,
				productFolder: testProductFolder,
				salePrices: [{ value: 25900, priceType: { name: 'Retail' } }],
				images: { rows: [] }
			},
			{
				id: 'external-no-folder',
				externalCode: 'external-key-no-folder',
				meta: { type: 'product' },
				name: 'No Folder',
				code: 'MSK-5',
				updated: '2026-03-23 14:02:30',
				archived: false,
				stock: 1,
				salePrices: [{ value: 1000, priceType: { name: 'Retail' } }],
				images: { rows: [] }
			},
			{
				id: 'external-variant',
				externalCode: 'external-key-variant',
				meta: { type: 'variant' },
				name: 'Variant 1',
				code: 'MSK-4',
				updated: '2026-03-23 14:03:00',
				archived: false,
				stock: 3,
				salePrices: [{ value: 9900, priceType: { name: 'Retail' } }],
				images: { rows: [] }
			}
		]

		repo.beginMoySkladSync.mockResolvedValue(integration as any)
		repo.findMoySklad.mockResolvedValue(integration as any)
		repo.findProductLinkByExternalId.mockResolvedValue(null)
		repo.findProductByCatalogAndSku.mockResolvedValue(null)
		repo.existsProductSlug.mockResolvedValue(false)
		repo.existsProductSku.mockResolvedValue(false)
		repo.findProductMediaIds.mockResolvedValue([])
		repo.replaceProductMedia.mockResolvedValue(true)
		repo.createProduct
			.mockResolvedValueOnce({
				id: 'local-product',
				catalogId,
				name: 'Product 1',
				sku: 'MSK-1',
				slug: 'product-1',
				price: 125,
				status: ProductStatus.ACTIVE,
				deleteAt: null
			} as any)
			.mockResolvedValueOnce({
				id: 'local-service',
				catalogId,
				name: 'Service 1',
				sku: 'MSK-2',
				slug: 'service-1',
				price: 50,
				status: ProductStatus.ACTIVE,
				deleteAt: null
			} as any)
			.mockResolvedValueOnce({
				id: 'local-bundle',
				catalogId,
				name: 'Bundle 1',
				sku: 'MSK-3',
				slug: 'bundle-1',
				price: 259,
				status: ProductStatus.ACTIVE,
				deleteAt: null
			} as any)
		repo.upsertProductLink.mockResolvedValue({ id: 'link-1' } as any)
		repo.findProductLinksByIntegration.mockResolvedValue([] as any)
		repo.finishMoySkladSync.mockResolvedValue(integration as any)

		jest
			.spyOn(MoySkladClient.prototype, 'getAllAssortment')
			.mockResolvedValue(assortment as any)
		jest.spyOn(MoySkladClient.prototype, 'getEntityImages').mockResolvedValue([])

		const result = await service.syncCatalog(catalogId)

		expect(result.ok).toBe(true)
		expect(result.total).toBe(3)
		expect(result.created).toBe(3)
		expect(repo.createProduct).toHaveBeenCalledTimes(3)
		expect(repo.createProduct.mock.calls.map(call => call[0].name)).toEqual([
			'Product 1',
			'Service 1',
			'Bundle 1'
		])
	})

	it('skips missing-product archival during incremental catalog sync', async () => {
		const catalogId = 'catalog-1'
		const lastSyncAt = new Date('2026-03-23T15:37:00.336Z')
		const integration = {
			id: 'integration-1',
			catalogId,
			metadata: {},
			isActive: true,
			lastSyncAt
		}

		repo.beginMoySkladSync.mockResolvedValue(integration as any)
		repo.findMoySklad.mockResolvedValue(integration as any)
		repo.finishMoySkladSync.mockResolvedValue(integration as any)

		jest.spyOn(MoySkladClient.prototype, 'getAllAssortment').mockResolvedValue([])

		const result = await service.syncCatalog(catalogId, {
			updatedFrom: lastSyncAt
		})

		expect(result.ok).toBe(true)
		expect(MoySkladClient.prototype.getAllAssortment).toHaveBeenCalledWith(
			lastSyncAt
		)
		expect(repo.findProductLinksByIntegration).not.toHaveBeenCalled()
		expect(repo.finishMoySkladSync).toHaveBeenCalledWith(
			catalogId,
			expect.objectContaining({
				totalProducts: 0,
				deletedProducts: 0
			})
		)
	})

	it('creates only root and leaf categories for nested MoySklad product folders and links product to leaf category', async () => {
		const catalogId = 'catalog-1'
		const integration = {
			id: 'integration-1',
			catalogId,
			metadata: {},
			isActive: true,
			lastSyncAt: null
		}
		const product = {
			id: 'external-1',
			externalCode: 'external-key-1',
			meta: { type: 'product' },
			name: 'Product 1',
			code: 'MSK-1',
			updated: '2026-03-23 14:00:00',
			archived: false,
			stock: 5,
			productFolder: {
				id: 'folder-child',
				name: 'Sneakers',
				meta: {
					href:
						'https://api.moysklad.ru/api/remap/1.2/entity/productfolder/folder-child'
				}
			},
			salePrices: [
				{
					value: 12500,
					priceType: {
						name: 'Retail'
					}
				}
			],
			images: {
				rows: []
			}
		}

		repo.beginMoySkladSync.mockResolvedValue(integration as any)
		repo.findMoySklad.mockResolvedValue(integration as any)
		repo.findProductLinkByExternalId.mockResolvedValue(null)
		repo.findProductByCatalogAndSku.mockResolvedValue(null)
		repo.existsProductSlug.mockResolvedValue(false)
		repo.existsProductSku.mockResolvedValue(false)
		repo.createProduct.mockResolvedValue({
			id: 'local-1',
			catalogId,
			name: 'Product 1',
			sku: 'MSK-1',
			slug: 'product-1',
			price: 125,
			status: ProductStatus.ACTIVE,
			deleteAt: null
		} as any)
		repo.findProductMediaIds.mockResolvedValue([])
		repo.replaceProductMedia.mockResolvedValue(true)
		repo.upsertProductLink.mockResolvedValue({ id: 'link-1' } as any)
		repo.createCategory
			.mockResolvedValueOnce({
				id: 'category-root',
				name: 'Shoes',
				parentId: null
			} as any)
			.mockResolvedValueOnce({
				id: 'category-child',
				name: 'Sneakers',
				parentId: 'category-root'
			} as any)
		repo.upsertCategoryLink.mockResolvedValue({ id: 'category-link-1' } as any)
		repo.syncManagedProductCategories.mockResolvedValue({
			added: 1,
			removed: 0
		})
		repo.findProductLinksByIntegration.mockResolvedValue([] as any)
		repo.finishMoySkladSync.mockResolvedValue(integration as any)

		jest
			.spyOn(MoySkladClient.prototype, 'getAllAssortment')
			.mockResolvedValue([product] as any)
		jest
			.spyOn(MoySkladClient.prototype, 'getProductFolderChain')
			.mockResolvedValue([
				{
					id: 'folder-root',
					name: 'Shoes',
					meta: {
						href:
							'https://api.moysklad.ru/api/remap/1.2/entity/productfolder/folder-root'
					}
				},
				{
					id: 'folder-middle',
					name: 'Men',
					meta: {
						href:
							'https://api.moysklad.ru/api/remap/1.2/entity/productfolder/folder-middle'
					},
					productFolder: {
						id: 'folder-root',
						name: 'Shoes',
						meta: {
							href:
								'https://api.moysklad.ru/api/remap/1.2/entity/productfolder/folder-root'
						}
					}
				},
				{
					id: 'folder-child',
					name: 'Sneakers',
					meta: {
						href:
							'https://api.moysklad.ru/api/remap/1.2/entity/productfolder/folder-child'
					},
					productFolder: {
						id: 'folder-middle',
						name: 'Men',
						meta: {
							href:
								'https://api.moysklad.ru/api/remap/1.2/entity/productfolder/folder-middle'
						}
					}
				}
			] as any)
		jest.spyOn(MoySkladClient.prototype, 'getEntityImages').mockResolvedValue([])

		const result = await service.syncCatalog(catalogId)

		expect(result.ok).toBe(true)
		expect(repo.createCategory.mock.calls).toEqual([
			[catalogId, 'Shoes', undefined, undefined],
			[catalogId, 'Sneakers', 'category-root', undefined]
		])
		expect(repo.upsertCategoryLink.mock.calls).toEqual([
			[
				expect.objectContaining({
					integrationId: integration.id,
					categoryId: 'category-root',
					externalId: 'folder-root',
					externalParentId: null
				}),
				undefined
			],
			[
				expect.objectContaining({
					integrationId: integration.id,
					categoryId: 'category-child',
					externalId: 'folder-child',
					externalParentId: 'folder-middle'
				}),
				undefined
			]
		])
		expect(repo.syncManagedProductCategories).toHaveBeenCalledWith(
			'local-1',
			catalogId,
			integration.id,
			['category-child'],
			undefined
		)
	})

	it('converts previously archived MoySklad product back to active when stock is positive', async () => {
		const catalogId = 'catalog-1'
		const integration = {
			id: 'integration-1',
			catalogId,
			metadata: {},
			isActive: true,
			lastSyncAt: null
		}
		const product = {
			id: 'external-1',
			externalCode: 'external-key-1',
			meta: { type: 'product' },
			name: 'Product 1',
			code: 'MSK-1',
			updated: '2026-03-23 14:00:00',
			archived: false,
			stock: 5,
			productFolder: testProductFolder,
			salePrices: [
				{
					value: 12500,
					priceType: {
						name: 'Retail'
					}
				}
			],
			images: {
				rows: []
			}
		}

		repo.beginMoySkladSync.mockResolvedValue(integration as any)
		repo.findMoySklad.mockResolvedValue(integration as any)
		repo.findProductLinkByExternalId.mockResolvedValue({
			id: 'link-1',
			productId: 'local-1',
			externalId: 'external-key-1',
			externalUpdatedAt: new Date('2026-03-22T10:00:00.000Z')
		} as any)
		repo.findProductById.mockResolvedValue({
			id: 'local-1',
			catalogId,
			name: 'Product 1',
			sku: 'MSK-1',
			slug: 'product-1',
			price: 125,
			status: ProductStatus.ARCHIVED,
			deleteAt: null
		} as any)
		repo.updateProduct.mockResolvedValue({
			id: 'local-1',
			catalogId,
			name: 'Product 1',
			sku: 'MSK-1',
			slug: 'product-1',
			price: 125,
			status: ProductStatus.ACTIVE,
			deleteAt: null
		} as any)
		repo.findProductMediaIds.mockResolvedValue([])
		repo.upsertProductLink.mockResolvedValue({ id: 'link-1' } as any)
		repo.findProductLinksByIntegration.mockResolvedValue([
			{ externalId: 'external-key-1', productId: 'local-1' }
		] as any)
		repo.finishMoySkladSync.mockResolvedValue(integration as any)

		jest
			.spyOn(MoySkladClient.prototype, 'getAllAssortment')
			.mockResolvedValue([product] as any)
		jest.spyOn(MoySkladClient.prototype, 'getEntityImages').mockResolvedValue([])

		const result = await service.syncCatalog(catalogId)

		expect(result.ok).toBe(true)
		expect(repo.updateProduct).toHaveBeenCalledWith(
			{
				productId: 'local-1',
				catalogId,
				data: { status: ProductStatus.ACTIVE }
			},
			undefined
		)
	})

	it('hides missing products on full sync instead of archiving them', async () => {
		const catalogId = 'catalog-1'
		const integration = {
			id: 'integration-1',
			catalogId,
			metadata: {},
			isActive: true,
			lastSyncAt: null
		}

		repo.beginMoySkladSync.mockResolvedValue(integration as any)
		repo.findMoySklad.mockResolvedValue(integration as any)
		repo.findProductLinksByIntegration.mockResolvedValue([
			{
				externalId: 'external-missing',
				productId: 'local-1'
			}
		] as any)
		repo.findProductById.mockResolvedValue({
			id: 'local-1',
			catalogId,
			name: 'Product 1',
			sku: 'MSK-1',
			slug: 'product-1',
			price: 125,
			status: ProductStatus.ACTIVE,
			deleteAt: null
		} as any)
		repo.updateProduct.mockResolvedValue({
			id: 'local-1',
			catalogId,
			name: 'Product 1',
			sku: 'MSK-1',
			slug: 'product-1',
			price: 125,
			status: ProductStatus.HIDDEN,
			deleteAt: null
		} as any)
		repo.finishMoySkladSync.mockResolvedValue(integration as any)

		jest.spyOn(MoySkladClient.prototype, 'getAllAssortment').mockResolvedValue([])

		const result = await service.syncCatalog(catalogId)

		expect(result.ok).toBe(true)
		expect(repo.updateProduct).toHaveBeenCalledWith({
			productId: 'local-1',
			catalogId,
			data: { status: ProductStatus.HIDDEN }
		})
		expect(repo.finishMoySkladSync).toHaveBeenCalledWith(
			catalogId,
			expect.objectContaining({
				deletedProducts: 1
			})
		)
	})

	it('does not refresh images for an existing product during catalog sync', async () => {
		const catalogId = 'catalog-1'
		const integration = {
			id: 'integration-1',
			catalogId,
			metadata: {},
			isActive: true,
			lastSyncAt: null
		}
		const localProduct = {
			id: 'local-1',
			catalogId,
			name: 'Product 1',
			sku: 'MSK-1',
			slug: 'product-1',
			price: 125,
			status: ProductStatus.ACTIVE,
			deleteAt: null
		}
		const externalProduct = {
			id: 'external-1',
			externalCode: 'external-key-1',
			meta: { type: 'product' },
			name: 'Product 1',
			code: 'MSK-1',
			updated: '2026-03-23 14:00:00',
			archived: false,
			stock: 5,
			productFolder: testProductFolder,
			salePrices: [
				{
					value: 12500,
					priceType: {
						name: 'Retail'
					}
				}
			],
			images: {
				rows: [
					{
						meta: {
							downloadHref: 'https://example.test/image-1.jpg'
						}
					}
				]
			}
		}

		repo.beginMoySkladSync.mockResolvedValue(integration as any)
		repo.findMoySklad.mockResolvedValue(integration as any)
		repo.findProductLinkByExternalId.mockResolvedValue({
			id: 'link-1',
			productId: 'local-1',
			externalId: 'external-key-1',
			externalUpdatedAt: new Date('2026-03-22T10:00:00.000Z')
		} as any)
		repo.findProductById.mockResolvedValue(localProduct as any)
		repo.upsertProductLink.mockResolvedValue({ id: 'link-1' } as any)
		repo.findProductLinksByIntegration.mockResolvedValue([
			{
				externalId: 'external-key-1',
				productId: 'local-1'
			}
		] as any)
		repo.finishMoySkladSync.mockResolvedValue(integration as any)

		jest
			.spyOn(MoySkladClient.prototype, 'getAllAssortment')
			.mockResolvedValue([externalProduct] as any)
		const downloadImageSpy = jest
			.spyOn(MoySkladClient.prototype, 'downloadImage')
			.mockResolvedValue({
				buffer: Buffer.from('image'),
				contentType: 'image/jpeg'
			})

		const result = await service.syncCatalog(catalogId)

		expect(result.ok).toBe(true)
		expect(result.updated).toBe(0)
		expect(repo.findProductMediaIds).not.toHaveBeenCalled()
		expect(repo.replaceProductMedia).not.toHaveBeenCalled()
		expect(downloadImageSpy).not.toHaveBeenCalled()
	})

	it('refreshes images for an existing product during product sync', async () => {
		const catalogId = 'catalog-1'
		const productId = 'local-1'
		const integration = {
			id: 'integration-1',
			catalogId,
			metadata: {},
			isActive: true,
			lastSyncAt: null
		}
		const localProduct = {
			id: productId,
			catalogId,
			name: 'Updated Product',
			sku: 'MSK-1',
			slug: 'updated-product',
			price: 130,
			status: ProductStatus.ACTIVE,
			deleteAt: null
		}
		const externalProduct = {
			id: 'external-1',
			externalCode: 'external-key-1',
			meta: { type: 'product' },
			name: 'Updated Product',
			code: 'MSK-1',
			updated: '2026-03-23 14:00:00',
			archived: false,
			stock: 5,
			productFolder: testProductFolder,
			salePrices: [
				{
					value: 13000,
					priceType: {
						name: 'Retail'
					}
				}
			],
			images: {
				rows: [
					{
						meta: {
							downloadHref: 'https://example.test/image-1.jpg'
						}
					}
				]
			}
		}

		repo.beginMoySkladSync.mockResolvedValue(integration as any)
		repo.findMoySklad.mockResolvedValue(integration as any)
		repo.findProductById.mockResolvedValue(localProduct as any)
		repo.findProductLinkByProductId.mockResolvedValue({
			id: 'link-1',
			productId,
			externalId: 'external-key-1',
			externalUpdatedAt: new Date('2026-03-22T10:00:00.000Z')
		} as any)
		repo.findProductLinkByExternalId.mockResolvedValue({
			id: 'link-1',
			productId,
			externalId: 'external-key-1',
			externalUpdatedAt: new Date('2026-03-22T10:00:00.000Z')
		} as any)
		repo.findProductMediaIds.mockResolvedValue([])
		repo.replaceProductMedia.mockResolvedValue(true)
		repo.upsertProductLink.mockResolvedValue({ id: 'link-1' } as any)
		repo.finishMoySkladSync.mockResolvedValue(integration as any)
		s3.uploadImage.mockResolvedValue({
			mediaId: 'media-1',
			key: 'integrations/moysklad/products/image-1.jpg'
		} as any)

		jest
			.spyOn(MoySkladClient.prototype, 'getAssortmentItemByExternalCode')
			.mockResolvedValue(externalProduct as any)
		const downloadImageSpy = jest
			.spyOn(MoySkladClient.prototype, 'downloadImage')
			.mockResolvedValue({
				buffer: Buffer.from('image'),
				contentType: 'image/jpeg'
			})

		const result = await service.syncProduct(catalogId, productId)

		expect(result.ok).toBe(true)
		expect(
			MoySkladClient.prototype.getAssortmentItemByExternalCode
		).toHaveBeenCalledWith('external-key-1')
		expect(result.updated).toBe(true)
		expect(result.imagesImported).toBe(1)
		expect(repo.updateProduct).not.toHaveBeenCalled()
		expect(repo.findProductMediaIds).toHaveBeenCalledWith(
			productId,
			catalogId,
			undefined
		)
		expect(repo.replaceProductMedia).toHaveBeenCalledWith(
			productId,
			catalogId,
			['media-1'],
			undefined
		)
		expect(downloadImageSpy).toHaveBeenCalledWith(
			'https://example.test/image-1.jpg'
		)
	})
})

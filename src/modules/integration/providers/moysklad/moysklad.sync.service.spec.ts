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
						createCategory: jest.fn(),
						syncProductCategories: jest.fn(),
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
			name: 'Product 1',
			code: 'MSK-1',
			updated: '2026-03-23 14:00:00',
			archived: false,
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
			.spyOn(MoySkladClient.prototype, 'getStockAll')
			.mockResolvedValue(new Map([['external-1', 5]]))
		jest
			.spyOn(MoySkladClient.prototype, 'getAllProducts')
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
		expect(MoySkladClient.prototype.getAllProducts).toHaveBeenCalledWith(undefined)
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
				externalId: 'external-1'
			}),
			undefined
		)
		expect(repo.finishMoySkladSync).toHaveBeenCalled()
		expect(cache.bumpVersion).toHaveBeenCalledTimes(2)
		expect(mediaRepo.findOrphanedByIds).not.toHaveBeenCalled()
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

		jest
			.spyOn(MoySkladClient.prototype, 'getStockAll')
			.mockResolvedValue(new Map())
		jest.spyOn(MoySkladClient.prototype, 'getAllProducts').mockResolvedValue([])

		const result = await service.syncCatalog(catalogId, {
			updatedFrom: lastSyncAt
		})

		expect(result.ok).toBe(true)
		expect(MoySkladClient.prototype.getAllProducts).toHaveBeenCalledWith(lastSyncAt)
		expect(repo.findProductLinksByIntegration).not.toHaveBeenCalled()
		expect(repo.finishMoySkladSync).toHaveBeenCalledWith(
			catalogId,
			expect.objectContaining({
				totalProducts: 0,
				deletedProducts: 0
			})
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
			name: 'Product 1',
			code: 'MSK-1',
			updated: '2026-03-23 14:00:00',
			archived: false,
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
			externalId: 'external-1',
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
			{ externalId: 'external-1', productId: 'local-1' }
		] as any)
		repo.finishMoySkladSync.mockResolvedValue(integration as any)

		jest
			.spyOn(MoySkladClient.prototype, 'getStockAll')
			.mockResolvedValue(new Map([['external-1', 5]]))
		jest
			.spyOn(MoySkladClient.prototype, 'getAllProducts')
			.mockResolvedValue([product] as any)
		jest.spyOn(MoySkladClient.prototype, 'getProductImages').mockResolvedValue([])

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

		jest
			.spyOn(MoySkladClient.prototype, 'getStockAll')
			.mockResolvedValue(new Map())
		jest.spyOn(MoySkladClient.prototype, 'getAllProducts').mockResolvedValue([])

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
			name: 'Product 1',
			code: 'MSK-1',
			updated: '2026-03-23 14:00:00',
			archived: false,
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
			externalId: 'external-1',
			externalUpdatedAt: new Date('2026-03-22T10:00:00.000Z')
		} as any)
		repo.findProductById.mockResolvedValue(localProduct as any)
		repo.upsertProductLink.mockResolvedValue({ id: 'link-1' } as any)
		repo.findProductLinksByIntegration.mockResolvedValue([
			{
				externalId: 'external-1',
				productId: 'local-1'
			}
		] as any)
		repo.finishMoySkladSync.mockResolvedValue(integration as any)

		jest
			.spyOn(MoySkladClient.prototype, 'getStockAll')
			.mockResolvedValue(new Map([['external-1', 5]]))
		jest
			.spyOn(MoySkladClient.prototype, 'getAllProducts')
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
			name: 'Updated Product',
			code: 'MSK-1',
			updated: '2026-03-23 14:00:00',
			archived: false,
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
			externalId: 'external-1',
			externalUpdatedAt: new Date('2026-03-22T10:00:00.000Z')
		} as any)
		repo.findProductLinkByExternalId.mockResolvedValue({
			id: 'link-1',
			productId,
			externalId: 'external-1',
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
			.spyOn(MoySkladClient.prototype, 'getStockAll')
			.mockResolvedValue(new Map([['external-1', 5]]))
		jest
			.spyOn(MoySkladClient.prototype, 'getProduct')
			.mockResolvedValue(externalProduct as any)
		const downloadImageSpy = jest
			.spyOn(MoySkladClient.prototype, 'downloadImage')
			.mockResolvedValue({
				buffer: Buffer.from('image'),
				contentType: 'image/jpeg'
			})

		const result = await service.syncProduct(catalogId, productId)

		expect(result.ok).toBe(true)
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

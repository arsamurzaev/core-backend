import { ProductStatus } from '@generated/enums'
import { Test, TestingModule } from '@nestjs/testing'

import { CapabilityService } from '@/modules/capability/capability.service'
import { S3Service } from '@/modules/s3/s3.service'
import { CacheService } from '@/shared/cache/cache.service'
import { MediaRepository } from '@/shared/media/media.repository'

import { IntegrationRepository } from '../../integration.repository'

import { MoySkladClient } from './moysklad.client'
import { MoySkladImageImportService } from './moysklad.image-import.service'
import { MoySkladMetadataCryptoService } from './moysklad.metadata'
import { MoySkladMissingProductSyncService } from './moysklad.missing-product-sync.service'
import { MoySkladProductFolderSyncService } from './moysklad.product-folder-sync.service'
import { MoySkladProductSyncService } from './moysklad.product-sync.service'
import { MoySkladStockSyncService } from './moysklad.stock-sync.service'
import { MoySkladSyncService } from './moysklad.sync.service'
import { MoySkladVariantAttributeResolverService } from './moysklad.variant-attribute-resolver.service'
import { MoySkladVariantSyncService } from './moysklad.variant-sync.service'

describe('MoySkladSyncService', () => {
	let service: MoySkladSyncService
	let repo: jest.Mocked<IntegrationRepository>
	let cache: jest.Mocked<CacheService>
	let s3: jest.Mocked<S3Service>
	let mediaRepo: jest.Mocked<MediaRepository>
	let metadataCrypto: jest.Mocked<MoySkladMetadataCryptoService>
	let productSync: MoySkladProductSyncService
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
				MoySkladImageImportService,
				MoySkladMissingProductSyncService,
				MoySkladProductFolderSyncService,
				MoySkladProductSyncService,
				MoySkladStockSyncService,
				MoySkladVariantAttributeResolverService,
				MoySkladVariantSyncService,
				{
					provide: IntegrationRepository,
					useValue: {
						beginMoySkladSync: jest.fn(),
						findMoySklad: jest.fn(),
						findCatalogInventoryMode: jest.fn(),
						findProductLinkByExternalId: jest.fn(),
						findProductLinkByProductId: jest.fn(),
						findProductById: jest.fn(),
						findProductByCatalogAndSku: jest.fn(),
						upsertMoySkladVariantAttribute: jest.fn(),
						ensureMoySkladProductTypeForVariantAttributes: jest.fn(),
						upsertIntegratedProductVariant: jest.fn(),
						ensureDefaultVariantForProduct: jest.fn(),
						archiveMissingIntegratedProductVariants: jest.fn(),
						findVariantLinksByIntegration: jest.fn(),
						findProductIdsWithVariantLinks: jest.fn(),
						updateLinkedProductStock: jest.fn(),
						updateLinkedVariantStock: jest.fn(),
						recomputeProductStatusFromVariants: jest.fn(),
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
						updateSyncRunProgress: jest.fn(),
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
				},
				{
					provide: CapabilityService,
					useValue: {
						assertCanUseMoySkladIntegration: jest.fn().mockResolvedValue(undefined),
						getCurrentFeatures: jest.fn().mockResolvedValue({
							canUseProductTypes: true,
							canUseProductVariants: true,
							canUseCatalogSaleUnits: true,
							canUseInternalInventory: false,
							canUseMoySkladIntegration: true
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
		productSync = module.get(MoySkladProductSyncService)
		repo.findCategoriesByName.mockResolvedValue([])
		repo.findCategoryLinkByExternalId.mockResolvedValue(null)
		repo.findCategoryLinkByCategoryId.mockResolvedValue(null)
		repo.ensureDefaultVariantForProduct.mockResolvedValue({
			variant: null,
			created: false,
			updated: false,
			skipped: false
		} as any)
		repo.ensureMoySkladProductTypeForVariantAttributes.mockResolvedValue({
			productTypeId: 'moysklad-product-type',
			created: false,
			assigned: false,
			changed: false
		} as any)
		repo.archiveMissingIntegratedProductVariants.mockResolvedValue(0)
		repo.findCatalogInventoryMode.mockResolvedValue('EXTERNAL' as any)
		repo.syncManagedProductCategories.mockResolvedValue({
			added: 0,
			removed: 0
		})
		jest
			.spyOn(MoySkladClient.prototype, 'getProductFolderChain')
			.mockResolvedValue([])
		jest
			.spyOn(MoySkladClient.prototype, 'getVariantsByProduct')
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
		expect(repo.ensureDefaultVariantForProduct).toHaveBeenCalledWith(
			expect.objectContaining({
				integrationId: integration.id,
				productId: 'local-1',
				sku: 'MSK-1',
				price: 125,
				stock: 5,
				status: 'ACTIVE'
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

	it('continues catalog sync when one MoySklad product item fails', async () => {
		const catalogId = 'catalog-1'
		const integration = {
			id: 'integration-1',
			catalogId,
			metadata: {},
			isActive: true,
			lastSyncAt: null
		}
		const failedProduct = {
			id: 'external-raw-failed',
			externalCode: 'external-key-failed',
			meta: { type: 'product' },
			name: 'Broken Product',
			code: 'MSK-BROKEN',
			archived: false,
			stock: 1,
			productFolder: testProductFolder,
			salePrices: [{ value: 9900, priceType: { name: 'Retail' } }],
			images: { rows: [] }
		}
		const successfulProduct = {
			id: 'external-raw-ok',
			externalCode: 'external-key-ok',
			meta: { type: 'product' },
			name: 'Good Product',
			code: 'MSK-OK',
			archived: false,
			stock: 2,
			productFolder: testProductFolder,
			salePrices: [{ value: 12900, priceType: { name: 'Retail' } }],
			images: { rows: [] }
		}
		const loggerErrorSpy = jest
			.spyOn((service as any).logger, 'error')
			.mockImplementation(() => undefined)

		repo.beginMoySkladSync.mockResolvedValue(integration as any)
		repo.findMoySklad.mockResolvedValue(integration as any)
		repo.findProductLinksByIntegration.mockResolvedValue([] as any)
		repo.finishMoySkladSync.mockResolvedValue(integration as any)
		jest
			.spyOn(MoySkladClient.prototype, 'getAllAssortment')
			.mockResolvedValue([failedProduct, successfulProduct] as any)
		jest
			.spyOn(productSync, 'syncExternalProduct')
			.mockRejectedValueOnce(new Error('single item failed'))
			.mockResolvedValueOnce({
				productId: 'local-ok',
				externalId: successfulProduct.externalCode,
				created: true,
				updated: false,
				imagesImported: 0
			})

		const result = await service.syncCatalog(catalogId)

		expect(result.ok).toBe(true)
		expect(result.total).toBe(2)
		expect(result.created).toBe(1)
		expect(result.errors).toEqual([
			expect.objectContaining({
				code: 'MOYSKLAD_PRODUCT_SYNC_FAILED',
				externalId: 'external-key-failed',
				message: 'single item failed'
			})
		])
		expect(loggerErrorSpy).toHaveBeenCalledWith(
			'MoySklad product sync item failed',
			expect.objectContaining({
				externalId: 'external-key-failed',
				error: 'single item failed'
			})
		)
		expect(repo.failMoySkladSync).not.toHaveBeenCalled()
		expect(repo.finishMoySkladSync).toHaveBeenCalled()
	})

	it('imports MoySklad variants as product variants linked to the parent product', async () => {
		const catalogId = 'catalog-1'
		const integration = {
			id: 'integration-1',
			catalogId,
			metadata: {},
			isActive: true,
			lastSyncAt: null
		}
		const parent = {
			id: 'external-product-raw-id',
			externalCode: 'external-key-product',
			meta: { type: 'product' },
			name: 'Sneaker',
			code: 'MSK-1',
			updated: '2026-03-23 14:00:00',
			archived: false,
			stock: 5,
			productFolder: testProductFolder,
			salePrices: [{ value: 10000, priceType: { name: 'Retail' } }],
			images: { rows: [] }
		}
		const variant = {
			id: 'external-variant-raw-id',
			externalCode: 'external-key-variant',
			meta: { type: 'variant' },
			name: 'Sneaker / 42 / Black',
			code: 'SKU-42-BLK',
			updated: '2026-03-23 14:01:00',
			archived: false,
			stock: 7,
			barcodes: [
				{
					ean13: '4607000000001',
					code128: 'SKU-42-BLK'
				}
			],
			product: {
				id: parent.id,
				name: parent.name,
				meta: {
					href: `https://api.moysklad.ru/api/remap/1.2/entity/product/${parent.id}`,
					type: 'product'
				}
			},
			characteristics: [
				{ id: 'size-id', name: 'Size', value: '42' },
				{ id: 'color-id', name: 'Color', value: 'Black' }
			],
			salePrices: [{ value: 15000, priceType: { name: 'Retail' } }],
			images: { rows: [] }
		}

		metadataCrypto.parseStoredMetadata.mockReturnValue({
			token: 'token',
			priceTypeName: 'Retail',
			importImages: false,
			syncStock: true
		} as any)
		repo.beginMoySkladSync.mockResolvedValue(integration as any)
		repo.findMoySklad.mockResolvedValue(integration as any)
		repo.findProductLinkByExternalId.mockResolvedValue(null)
		repo.findProductByCatalogAndSku.mockResolvedValue(null)
		repo.existsProductSlug.mockResolvedValue(false)
		repo.existsProductSku.mockResolvedValue(false)
		repo.createProduct.mockResolvedValue({
			id: 'local-product',
			catalogId,
			name: parent.name,
			sku: 'MSK-1',
			slug: 'sneaker',
			price: 100,
			status: ProductStatus.ACTIVE,
			deleteAt: null
		} as any)
		repo.upsertProductLink.mockResolvedValue({ id: 'product-link' } as any)
		repo.findProductLinksByIntegration.mockResolvedValue([] as any)
		repo.findProductById.mockResolvedValue({
			id: 'local-product',
			catalogId,
			name: parent.name,
			sku: 'MSK-1',
			slug: 'sneaker',
			price: 100,
			status: ProductStatus.ACTIVE,
			deleteAt: null
		} as any)
		repo.upsertMoySkladVariantAttribute
			.mockResolvedValueOnce({
				id: 'attr-size',
				key: 'moysklad_size',
				displayName: 'Size',
				displayOrder: 1
			} as any)
			.mockResolvedValueOnce({
				id: 'attr-color',
				key: 'moysklad_color',
				displayName: 'Color',
				displayOrder: 2
			} as any)
		repo.upsertIntegratedProductVariant.mockResolvedValue({
			variant: {
				id: 'local-variant',
				productId: 'local-product',
				sku: 'SKU-42-BLK-6B1ED3FC',
				variantKey: 'moysklad_size=42;moysklad_color=black',
				price: 150,
				stock: 7
			},
			link: { id: 'variant-link' },
			created: true,
			updated: false
		} as any)
		repo.finishMoySkladSync.mockResolvedValue(integration as any)

		jest
			.spyOn(MoySkladClient.prototype, 'getAllAssortment')
			.mockResolvedValue([parent, variant] as any)

		const result = await service.syncCatalog(catalogId)

		expect(result.ok).toBe(true)
		expect(result.total).toBe(2)
		expect(result.created).toBe(2)
		expect(repo.createProduct).toHaveBeenCalledTimes(1)
		expect(repo.ensureDefaultVariantForProduct).not.toHaveBeenCalled()
		expect(repo.upsertMoySkladVariantAttribute).toHaveBeenCalledTimes(2)
		expect(
			repo.ensureMoySkladProductTypeForVariantAttributes
		).toHaveBeenCalledWith(
			{
				catalogId,
				productId: 'local-product',
				attributes: [
					expect.objectContaining({
						attributeId: 'attr-size',
						key: 'moysklad_size',
						attributeDisplayName: 'Size',
						displayName: '42'
					}),
					expect.objectContaining({
						attributeId: 'attr-color',
						key: 'moysklad_color',
						attributeDisplayName: 'Color',
						displayName: 'Black'
					})
				]
			},
			undefined
		)
		expect(repo.upsertIntegratedProductVariant).toHaveBeenCalledWith(
			expect.objectContaining({
				catalogId,
				integrationId: integration.id,
				productId: 'local-product',
				externalId: variant.id,
				externalCode: variant.code,
				sku: expect.stringMatching(/^SKU-42-BLK-[A-F0-9]{8}$/),
				variantKey: 'moysklad_size=42;moysklad_color=black',
				price: 150,
				stock: 7,
				status: 'ACTIVE',
				attributes: [
					{
						attributeId: 'attr-size',
						value: '42',
						displayName: '42'
					},
					{
						attributeId: 'attr-color',
						value: 'black',
						displayName: 'Black'
					}
				],
				rawMeta: expect.objectContaining({
					id: variant.id,
					type: 'variant',
					product: expect.objectContaining({ id: parent.id }),
					barcodes: [
						expect.objectContaining({
							ean13: '4607000000001',
							code128: 'SKU-42-BLK'
						})
					],
					characteristics: expect.any(Array)
				})
			}),
			undefined
		)
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

	it('syncs MoySklad stock for linked products and variants', async () => {
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
				id: 'product-link-simple',
				integrationId: integration.id,
				productId: 'product-simple',
				externalId: 'simple-external-code',
				rawMeta: { id: 'simple-raw-id' }
			},
			{
				id: 'product-link-parent',
				integrationId: integration.id,
				productId: 'product-with-variants',
				externalId: 'parent-external-code',
				rawMeta: { id: 'parent-raw-id' }
			}
		] as any)
		repo.findVariantLinksByIntegration.mockResolvedValue([
			{
				id: 'variant-link',
				integrationId: integration.id,
				variantId: 'variant-1',
				externalId: 'variant-raw-id',
				rawMeta: { id: 'variant-raw-id' }
			}
		] as any)
		repo.findProductIdsWithVariantLinks.mockResolvedValue([
			'product-with-variants'
		])
		repo.updateLinkedVariantStock.mockResolvedValue({
			changed: true,
			productId: 'product-with-variants'
		})
		repo.recomputeProductStatusFromVariants.mockResolvedValue(true)
		repo.updateLinkedProductStock.mockResolvedValue(true)
		repo.finishMoySkladSync.mockResolvedValue(integration as any)

		jest.spyOn(MoySkladClient.prototype, 'getStockAll').mockResolvedValue(
			new Map([
				['simple-raw-id', 5],
				['parent-raw-id', 12],
				['variant-raw-id', 3]
			])
		)

		const result = await service.syncStock(catalogId)

		expect(result).toEqual(
			expect.objectContaining({
				ok: true,
				total: 3,
				updated: 3,
				updatedProducts: 2,
				updatedVariants: 1,
				skipped: 1
			})
		)
		expect(repo.updateLinkedVariantStock).toHaveBeenCalledWith('variant-1', 3)
		expect(repo.recomputeProductStatusFromVariants).toHaveBeenCalledWith(
			catalogId,
			'product-with-variants'
		)
		expect(repo.updateLinkedProductStock).toHaveBeenCalledWith(
			catalogId,
			'product-simple',
			5
		)
		expect(repo.updateLinkedProductStock).not.toHaveBeenCalledWith(
			catalogId,
			'product-with-variants',
			expect.any(Number)
		)
		expect(repo.finishMoySkladSync).toHaveBeenCalledWith(
			catalogId,
			expect.objectContaining({
				totalProducts: 3,
				createdProducts: 0,
				updatedProducts: 3,
				deletedProducts: 0,
				lastStockSyncedAt: result.syncedAt
			})
		)
		expect(cache.bumpVersion).toHaveBeenCalledTimes(2)
	})

	it('keeps external stock as reconciliation-only for INTERNAL inventory catalogs', async () => {
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
		repo.findCatalogInventoryMode.mockResolvedValue('INTERNAL' as any)
		repo.finishMoySkladSync.mockResolvedValue(integration as any)

		const stockSpy = jest
			.spyOn(MoySkladClient.prototype, 'getStockAll')
			.mockResolvedValue(
				new Map([
					['simple-raw-id', 5],
					['variant-raw-id', 3]
				])
			)

		const result = await service.syncStock(catalogId)

		expect(result).toEqual(
			expect.objectContaining({
				ok: true,
				total: 0,
				updated: 0,
				updatedProducts: 0,
				updatedVariants: 0,
				skipped: 0
			})
		)
		expect(stockSpy).not.toHaveBeenCalled()
		expect(repo.findProductLinksByIntegration).not.toHaveBeenCalled()
		expect(repo.findVariantLinksByIntegration).not.toHaveBeenCalled()
		expect(repo.updateLinkedVariantStock).not.toHaveBeenCalled()
		expect(repo.updateLinkedProductStock).not.toHaveBeenCalled()
		expect(repo.finishMoySkladSync).toHaveBeenCalledWith(
			catalogId,
			expect.objectContaining({
				totalProducts: 0,
				updatedProducts: 0,
				lastStockSyncedAt: result.syncedAt
			})
		)
		expect(cache.bumpVersion).not.toHaveBeenCalled()
	})

	it('rejects stock sync when stock import is disabled', async () => {
		const catalogId = 'catalog-1'
		const integration = {
			id: 'integration-1',
			catalogId,
			metadata: {},
			isActive: true,
			lastSyncAt: null
		}

		metadataCrypto.parseStoredMetadata.mockReturnValue({
			token: 'token',
			priceTypeName: 'Retail',
			importImages: false,
			syncStock: false
		} as any)
		repo.beginMoySkladSync.mockResolvedValue(integration as any)
		repo.findMoySklad.mockResolvedValue(integration as any)
		const stockSpy = jest
			.spyOn(MoySkladClient.prototype, 'getStockAll')
			.mockResolvedValue(new Map())

		await expect(service.syncStock(catalogId)).rejects.toThrow(
			'MoySklad stock sync is disabled'
		)
		expect(repo.failMoySkladSync).toHaveBeenCalledWith(
			catalogId,
			'MoySklad stock sync is disabled in integration settings'
		)
		expect(stockSpy).not.toHaveBeenCalled()
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
		const presentProduct = {
			id: 'external-present-id',
			externalCode: 'external-present',
			meta: { type: 'product' },
			name: 'Present Product',
			code: 'MSK-PRESENT',
			updated: '2026-03-23 14:00:00',
			archived: false,
			stock: 5,
			productFolder: testProductFolder,
			salePrices: [],
			images: { rows: [] }
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

		jest.spyOn(productSync, 'syncExternalProduct').mockResolvedValue({
			productId: 'local-present',
			externalId: 'external-present',
			created: false,
			updated: false,
			imagesImported: 0
		} as any)
		jest
			.spyOn(MoySkladClient.prototype, 'getAllAssortment')
			.mockResolvedValue([presentProduct] as any)

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

	it('does not hide missing products when MoySklad returns an empty product snapshot', async () => {
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
		repo.finishMoySkladSync.mockResolvedValue(integration as any)

		jest.spyOn(MoySkladClient.prototype, 'getAllAssortment').mockResolvedValue([])

		const result = await service.syncCatalog(catalogId)

		expect(result.ok).toBe(true)
		expect(repo.updateProduct).not.toHaveBeenCalled()
		expect(repo.finishMoySkladSync).toHaveBeenCalledWith(
			catalogId,
			expect.objectContaining({
				deletedProducts: 0
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

	it('syncs product variants and their stock during product sync', async () => {
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
			name: 'Sneaker',
			sku: 'MSK-1',
			slug: 'sneaker',
			price: 200,
			status: ProductStatus.ACTIVE,
			deleteAt: null
		}
		const externalProduct = {
			id: 'external-product-1',
			externalCode: 'external-key-1',
			meta: { type: 'product' },
			name: 'Sneaker',
			code: 'MSK-1',
			updated: '2026-03-23 14:00:00',
			archived: false,
			stock: 8,
			productFolder: testProductFolder,
			salePrices: [{ value: 20000, priceType: { name: 'Retail' } }],
			images: { rows: [] }
		}
		const variants = [
			{
				id: 'variant-1',
				meta: { type: 'variant' },
				name: 'Sneaker / 42',
				code: 'SKU-42',
				updated: '2026-03-23 14:01:00',
				archived: false,
				stock: 99,
				product: {
					id: externalProduct.id,
					meta: {
						href: `https://api.moysklad.ru/api/remap/1.2/entity/product/${externalProduct.id}`,
						type: 'product'
					}
				},
				characteristics: [{ id: 'size-id', name: 'Size', value: '42' }],
				salePrices: [{ value: 21000, priceType: { name: 'Retail' } }]
			},
			{
				id: 'variant-2',
				meta: { type: 'variant' },
				name: 'Sneaker / 43',
				code: 'SKU-43',
				updated: '2026-03-23 14:02:00',
				archived: false,
				stock: 99,
				product: {
					id: externalProduct.id,
					meta: {
						href: `https://api.moysklad.ru/api/remap/1.2/entity/product/${externalProduct.id}`,
						type: 'product'
					}
				},
				characteristics: [{ id: 'size-id', name: 'Size', value: '43' }],
				salePrices: [{ value: 22000, priceType: { name: 'Retail' } }]
			}
		]

		metadataCrypto.parseStoredMetadata.mockReturnValue({
			token: 'token',
			priceTypeName: 'Retail',
			importImages: false,
			syncStock: true
		} as any)
		repo.beginMoySkladSync.mockResolvedValue(integration as any)
		repo.findMoySklad.mockResolvedValue(integration as any)
		repo.findProductById.mockResolvedValue(localProduct as any)
		repo.findProductLinkByProductId.mockResolvedValue({
			id: 'link-1',
			productId,
			externalId: 'external-key-1',
			rawMeta: { id: externalProduct.id },
			externalUpdatedAt: new Date('2026-03-22T10:00:00.000Z')
		} as any)
		repo.findProductLinkByExternalId.mockResolvedValue({
			id: 'link-1',
			productId,
			externalId: 'external-key-1',
			rawMeta: { id: externalProduct.id },
			externalUpdatedAt: new Date('2026-03-22T10:00:00.000Z')
		} as any)
		repo.archiveMissingIntegratedProductVariants.mockResolvedValue(1)
		repo.upsertProductLink.mockResolvedValue({ id: 'link-1' } as any)
		repo.upsertMoySkladVariantAttribute.mockResolvedValue({
			id: 'attr-size',
			key: 'moysklad_size',
			displayName: 'Size',
			displayOrder: 1
		} as any)
		repo.upsertIntegratedProductVariant
			.mockResolvedValueOnce({
				variant: {
					id: 'local-variant-1',
					productId,
					sku: 'SKU-42',
					variantKey: 'moysklad_size=42',
					price: 210,
					stock: 4
				},
				link: { id: 'variant-link-1' },
				created: true,
				updated: false
			} as any)
			.mockResolvedValueOnce({
				variant: {
					id: 'local-variant-2',
					productId,
					sku: 'SKU-43',
					variantKey: 'moysklad_size=43',
					price: 220,
					stock: 0
				},
				link: { id: 'variant-link-2' },
				created: false,
				updated: true
			} as any)
		repo.recomputeProductStatusFromVariants.mockResolvedValue(true)
		repo.finishMoySkladSync.mockResolvedValue(integration as any)

		jest
			.spyOn(MoySkladClient.prototype, 'getAssortmentItemByExternalCode')
			.mockResolvedValue(externalProduct as any)
		jest
			.spyOn(MoySkladClient.prototype, 'getVariantsByProduct')
			.mockResolvedValue(variants as any)
		jest.spyOn(MoySkladClient.prototype, 'getStockAll').mockResolvedValue(
			new Map([
				['variant-1', 4],
				['variant-2', 0]
			])
		)

		const result = await service.syncProduct(catalogId, productId)

		expect(result.ok).toBe(true)
		expect(result.totalVariants).toBe(2)
		expect(result.createdVariants).toBe(1)
		expect(result.updatedVariants).toBe(1)
		expect(result.deletedVariants).toBe(1)
		expect(result.updated).toBe(true)
		expect(MoySkladClient.prototype.getVariantsByProduct).toHaveBeenCalledWith(
			externalProduct.id
		)
		expect(MoySkladClient.prototype.getStockAll).toHaveBeenCalledWith({
			assortmentId: ['variant-1', 'variant-2']
		})
		expect(repo.archiveMissingIntegratedProductVariants).toHaveBeenCalledWith({
			integrationId: integration.id,
			productId,
			externalIds: ['variant-1', 'variant-2']
		})
		expect(repo.ensureDefaultVariantForProduct).not.toHaveBeenCalled()
		expect(repo.upsertIntegratedProductVariant).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				productId,
				externalId: 'variant-1',
				stock: 4,
				status: 'ACTIVE'
			}),
			undefined
		)
		expect(repo.upsertIntegratedProductVariant).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				productId,
				externalId: 'variant-2',
				stock: 0,
				status: 'OUT_OF_STOCK'
			}),
			undefined
		)
		expect(repo.recomputeProductStatusFromVariants).toHaveBeenCalledWith(
			catalogId,
			productId
		)
		expect(repo.finishMoySkladSync).toHaveBeenCalledWith(
			catalogId,
			expect.objectContaining({
				totalProducts: 3,
				createdProducts: 1,
				updatedProducts: 2,
				deletedProducts: 1
			})
		)
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

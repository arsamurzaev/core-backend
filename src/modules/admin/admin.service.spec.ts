import { CatalogStatus, SeoEntityType } from '@generated/enums'
import { NotFoundException } from '@nestjs/common'

import {
	CATALOG_CACHE_VERSION,
	CATEGORY_LIST_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'

import { AdminService } from './admin.service'

function createBatchPayload(count: number) {
	return { count }
}

function createTransactionMock() {
	return {
		productMedia: {
			deleteMany: jest.fn().mockResolvedValue(createBatchPayload(2))
		},
		categoryProduct: {
			deleteMany: jest.fn().mockResolvedValue(createBatchPayload(3))
		},
		integrationProductLink: {
			deleteMany: jest.fn().mockResolvedValue(createBatchPayload(4))
		},
		integrationCategoryLink: {
			deleteMany: jest.fn().mockResolvedValue(createBatchPayload(5))
		},
		variantAttribute: {
			updateMany: jest.fn().mockResolvedValue(createBatchPayload(6))
		},
		productVariant: {
			updateMany: jest.fn().mockResolvedValue(createBatchPayload(7))
		},
		productAttribute: {
			updateMany: jest.fn().mockResolvedValue(createBatchPayload(8))
		},
		product: {
			updateMany: jest.fn().mockResolvedValue(createBatchPayload(9))
		},
		category: {
			updateMany: jest.fn().mockResolvedValue(createBatchPayload(10))
		},
		brand: {
			updateMany: jest.fn().mockResolvedValue(createBatchPayload(11))
		},
		seoSetting: {
			updateMany: jest.fn().mockResolvedValue(createBatchPayload(12))
		},
		catalog: {
			update: jest.fn()
		},
		catalogConfig: {
			updateMany: jest.fn()
		},
		catalogSettings: {
			updateMany: jest.fn()
		},
		cart: {
			updateMany: jest.fn()
		},
		order: {
			updateMany: jest.fn()
		},
		payment: {
			updateMany: jest.fn()
		}
	}
}

function createService(tx = createTransactionMock()) {
	const prisma = {
		catalog: {
			findMany: jest.fn().mockResolvedValue([]),
			findUnique: jest.fn().mockResolvedValue({ id: 'catalog-1' }),
			findFirst: jest.fn().mockResolvedValue(null)
		},
		user: {
			findUnique: jest.fn().mockResolvedValue(null)
		},
		integration: {
			findUnique: jest.fn()
		},
		integrationSyncRun: {
			findFirst: jest.fn()
		},
		integrationProductLink: {
			count: jest.fn(),
			groupBy: jest.fn().mockResolvedValue([])
		},
		integrationVariantLink: {
			count: jest.fn(),
			groupBy: jest.fn().mockResolvedValue([])
		},
		$transaction: jest.fn(async callback => callback(tx))
	}
	const cache = {
		bumpVersion: jest.fn().mockResolvedValue(undefined)
	}
	const capabilities = {
		getCatalogCapabilities: jest.fn().mockResolvedValue({
			raw: {},
			effective: {},
			flags: {},
			definitions: [],
			items: []
		})
	}
	const productMaintenance = {
		diagnoseDefaultVariantsForCatalog: jest.fn(),
		expireScheduledDiscounts: jest.fn(),
		repairDefaultVariantPriceMismatchesForCatalog: jest.fn(),
		repairMissingDefaultVariantsForCatalog: jest.fn()
	}
	const s3 = {
		copyObjectToCatalog: jest.fn(),
		deleteObjectsByKeys: jest.fn().mockResolvedValue(undefined),
		uploadProofFile: jest.fn()
	}
	const service = new AdminService(
		prisma as any,
		{} as any,
		s3 as any,
		cache as any,
		capabilities as any,
		productMaintenance as any
	)

	return { cache, capabilities, prisma, productMaintenance, s3, service, tx }
}

function createDuplicateTransactionMock() {
	return {
		user: {
			create: jest.fn().mockResolvedValue({
				id: 'user-copy',
				name: 'Catalog Copy',
				login: 'catalog-copy'
			})
		},
		catalog: {
			create: jest.fn().mockResolvedValue({ id: 'catalog-copy' }),
			findUniqueOrThrow: jest.fn().mockResolvedValue({
				id: 'catalog-copy',
				slug: 'catalog-copy',
				domain: null,
				name: 'Catalog Copy',
				typeId: 'type-1',
				parentId: null,
				userId: 'user-copy',
				promoCodeId: null,
				subscriptionEndsAt: null,
				metrics: [],
				payments: [],
				deleteAt: null,
				createdAt: new Date('2026-05-10T00:00:00.000Z'),
				updatedAt: new Date('2026-05-10T00:00:00.000Z'),
				config: {
					status: CatalogStatus.OPERATIONAL,
					logoMedia: null
				},
				settings: {
					inventoryMode: 'NONE'
				},
				featureEntitlements: [],
				type: {
					id: 'type-1',
					code: 'shop',
					name: 'Shop',
					deleteAt: null,
					createdAt: new Date('2026-05-10T00:00:00.000Z'),
					updatedAt: new Date('2026-05-10T00:00:00.000Z')
				},
				promoCode: null,
				children: []
			})
		},
		media: {
			create: jest.fn().mockResolvedValue({ id: 'media-copy' })
		},
		catalogConfig: {
			update: jest.fn().mockResolvedValue({}),
			updateMany: jest.fn()
		},
		catalogSettings: {
			update: jest.fn().mockResolvedValue({}),
			updateMany: jest.fn()
		},
		catalogContact: {
			createMany: jest.fn()
		},
		brand: {
			create: jest.fn()
		},
		category: {
			create: jest.fn()
		},
		product: {
			create: jest.fn()
		},
		productAttribute: {
			createMany: jest.fn()
		},
		productVariant: {
			create: jest.fn()
		},
		variantAttribute: {
			createMany: jest.fn()
		},
		productMedia: {
			createMany: jest.fn()
		},
		categoryProduct: {
			createMany: jest.fn()
		},
		seoSetting: {
			create: jest.fn()
		}
	}
}

function createDuplicateSourceCatalog() {
	return {
		id: 'catalog-source',
		parentId: null,
		activity: [],
		region: [],
		config: {
			about: null,
			description: null,
			currency: 'RUB',
			logoMediaId: null,
			bgMediaId: null,
			note: null,
			deleteAt: null
		},
		settings: {
			isActive: true,
			defaultMode: null,
			allowedModes: [],
			googleVerification: null,
			yandexVerification: null,
			deleteAt: null
		},
		contacts: [],
		media: [
			{
				id: 'media-source',
				originalName: 'photo.jpg',
				mimeType: 'image/jpeg',
				size: 1200,
				width: 100,
				height: 100,
				path: 'products',
				entityId: 'product-source',
				storage: 's3',
				key: 'catalogs/catalog-source/products/product-source/2026/05/18/raw/photo.jpg',
				checksum: 'checksum-1',
				status: 'READY',
				variants: [
					{
						kind: 'thumb-avif',
						mimeType: 'image/avif',
						size: 500,
						width: 100,
						height: 100,
						storage: 's3',
						key: 'catalogs/catalog-source/products/product-source/2026/05/18/photo-thumb.avif'
					}
				]
			}
		],
		brands: [],
		category: [],
		products: [
			{
				id: 'product-source',
				brandId: null,
				sku: 'SKU-1',
				name: 'Product',
				slug: 'product',
				price: null,
				isPopular: false,
				status: 'ACTIVE',
				position: 0,
				deleteAt: null,
				productAttributes: [],
				variants: [],
				media: [{ mediaId: 'media-source', position: 0, kind: 'image' }],
				categoryProducts: []
			}
		],
		seoSettings: []
	}
}

describe('AdminService', () => {
	it('throws NotFoundException when catalog does not exist', async () => {
		const { prisma, service } = createService()
		prisma.catalog.findUnique.mockResolvedValue(null)

		await expect(service.deleteCatalogContent('missing-catalog')).rejects.toThrow(
			NotFoundException
		)

		expect(prisma.$transaction).not.toHaveBeenCalled()
	})

	it('exposes inventory mode and entitlement in admin catalog config', async () => {
		const { prisma, service } = createService()
		prisma.catalog.findMany.mockResolvedValue([
			{
				id: 'catalog-1',
				slug: 'catalog-one',
				domain: null,
				name: 'Catalog One',
				typeId: 'type-1',
				parentId: null,
				userId: 'user-1',
				promoCodeId: null,
				subscriptionEndsAt: null,
				metrics: [],
				payments: [],
				deleteAt: null,
				createdAt: new Date('2026-05-10T00:00:00.000Z'),
				updatedAt: new Date('2026-05-10T00:00:00.000Z'),
				config: {
					status: CatalogStatus.OPERATIONAL,
					logoMedia: null
				},
				settings: {
					inventoryMode: 'INTERNAL'
				},
				featureEntitlements: [
					{
						feature: 'inventory.internal',
						enabled: true,
						expiresAt: new Date('2099-01-01T00:00:00.000Z')
					}
				],
				type: {
					id: 'type-1',
					code: 'shop',
					name: 'Shop',
					deleteAt: null,
					createdAt: new Date('2026-05-10T00:00:00.000Z'),
					updatedAt: new Date('2026-05-10T00:00:00.000Z')
				},
				promoCode: null,
				children: []
			}
		])

		const [catalog] = await service.getCatalogs()

		expect(catalog.config).toMatchObject({
			status: CatalogStatus.OPERATIONAL,
			inventoryMode: 'INTERNAL',
			canUseInternalInventory: true
		})
	})

	it('returns MoySklad stock diagnostics without leaking provider secrets', async () => {
		const { prisma, service } = createService()
		prisma.integration.findUnique.mockResolvedValue({
			id: 'integration-1',
			isActive: true,
			metadata: {
				token: 'moysklad-secret-token',
				syncStock: true,
				fieldOwnership: { stock: 'external' },
				stockWebhookEnabled: true,
				stockWebhook: { externalId: 'webhook-1', secretHash: 'secret-hash' },
				lastStockSyncedAt: '2026-05-17T08:00:00.000Z'
			}
		})
		prisma.integrationSyncRun.findFirst.mockResolvedValue({
			id: 'run-1',
			trigger: 'WEBHOOK',
			status: 'SUCCESS',
			snapshotCompleteness: 'WEBHOOK_DELTA',
			error: 'Authorization: Bearer moysklad-secret-token',
			metadata: {
				stockRows: {
					total: 5,
					applied: 4,
					skipped: 1,
					diagnostics: {
						source: 'WEBHOOK',
						stockRows: 5,
						matchedStockRows: 4,
						unmatchedStockRows: 1,
						productLinks: 2,
						variantLinks: 3,
						ignoredVariantLinks: 0,
						appliedProductLinks: 1,
						appliedVariantLinks: 3,
						skippedReasons: {
							missingStock: 0,
							productHasVariantLinks: 1,
							variantsCapabilityDisabled: 0,
							stockRowWithoutLocalLink: 1
						}
					}
				}
			},
			totalProducts: 5,
			updatedProducts: 4,
			requestedAt: new Date('2026-05-17T08:00:00.000Z'),
			startedAt: new Date('2026-05-17T08:00:01.000Z'),
			finishedAt: new Date('2026-05-17T08:00:02.000Z')
		})
		prisma.integrationProductLink.count
			.mockResolvedValueOnce(2)
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce(0)
			.mockResolvedValueOnce(0)
		prisma.integrationVariantLink.count
			.mockResolvedValueOnce(3)
			.mockResolvedValueOnce(3)
			.mockResolvedValueOnce(0)
			.mockResolvedValueOnce(1)
		prisma.integrationProductLink.groupBy.mockResolvedValue([
			{
				skippedReason: 'stock_owned_by_variant_links',
				_count: { skippedReason: 2 }
			}
		])
		prisma.integrationVariantLink.groupBy.mockResolvedValue([
			{
				skippedReason: 'stock_missing_in_external_report',
				_count: { skippedReason: 1 }
			}
		])

		const result = await service.getCatalogMoySkladStockDiagnostics('catalog-1')

		expect(result).toMatchObject({
			catalogId: 'catalog-1',
			integrationId: 'integration-1',
			hasIntegration: true,
			integrationActive: true,
			syncStockEnabled: true,
			stockFieldOwnedByMoySklad: true,
			stockWebhookEnabled: true,
			stockWebhookRegistered: true,
			lastStockSyncedAt: '2026-05-17T08:00:00.000Z',
			links: {
				productLinks: 2,
				variantLinks: 3,
				productLinksWithStockSync: 1,
				variantLinksWithStockSync: 3,
				productLinksMissing: 0,
				variantLinksMissing: 0,
				productLinksWithErrors: 0,
				variantLinksWithErrors: 1,
				productSkippedReasons: [
					{ reason: 'stock_owned_by_variant_links', count: 2 }
				],
				variantSkippedReasons: [
					{ reason: 'stock_missing_in_external_report', count: 1 }
				]
			},
			latestRun: {
				id: 'run-1',
				totalRows: 5,
				appliedRows: 4,
				skippedRows: 1,
				diagnostics: {
					source: 'WEBHOOK',
					unmatchedStockRows: 1,
					skippedReasons: {
						productHasVariantLinks: 1,
						stockRowWithoutLocalLink: 1
					}
				},
				error: expect.stringContaining('[redacted]')
			}
		})
		expect(JSON.stringify(result)).not.toContain('moysklad-secret-token')
		expect(JSON.stringify(result)).not.toContain('secret-hash')
	})

	it('delegates default variant diagnostics after catalog existence check', async () => {
		const { prisma, productMaintenance, service } = createService()
		const result = {
			catalogId: 'catalog-1',
			sampleLimit: 10,
			checks: [],
			warnCount: 0,
			failCount: 0,
			ok: true
		}
		productMaintenance.diagnoseDefaultVariantsForCatalog.mockResolvedValue(result)

		await expect(
			service.diagnoseCatalogDefaultVariants('catalog-1', 10)
		).resolves.toBe(result)
		expect(prisma.catalog.findUnique).toHaveBeenCalledWith({
			where: { id: 'catalog-1' },
			select: { id: true }
		})
		expect(
			productMaintenance.diagnoseDefaultVariantsForCatalog
		).toHaveBeenCalledWith('catalog-1', 10)
	})

	it('delegates missing default variant repair after catalog existence check', async () => {
		const { productMaintenance, service } = createService()
		const result = {
			checkedProducts: 2,
			repairedProducts: 1,
			affectedCatalogs: 1
		}
		productMaintenance.repairMissingDefaultVariantsForCatalog.mockResolvedValue(
			result
		)

		await expect(
			service.repairCatalogMissingDefaultVariants('catalog-1')
		).resolves.toBe(result)
		expect(
			productMaintenance.repairMissingDefaultVariantsForCatalog
		).toHaveBeenCalledWith('catalog-1')
	})

	it('delegates default variant price mismatch repair after catalog existence check', async () => {
		const { productMaintenance, service } = createService()
		const options = { apply: false, batchSize: 25, sampleLimit: 5 }
		const result = {
			catalogId: 'catalog-1',
			dryRun: true,
			checkedProducts: 3,
			repairableProducts: 3,
			updatedProducts: 0,
			affectedCatalogs: 0,
			batchSize: 25,
			sampleLimit: 5,
			samples: []
		}
		productMaintenance.repairDefaultVariantPriceMismatchesForCatalog.mockResolvedValue(
			result
		)

		await expect(
			service.repairCatalogDefaultVariantPriceMismatches('catalog-1', options)
		).resolves.toBe(result)
		expect(
			productMaintenance.repairDefaultVariantPriceMismatchesForCatalog
		).toHaveBeenCalledWith('catalog-1', options)
	})

	it('duplicates catalog product media with independent S3 keys', async () => {
		const tx = createDuplicateTransactionMock()
		const { prisma, s3, service } = createService(tx as any)
		prisma.catalog.findUnique.mockResolvedValueOnce(
			createDuplicateSourceCatalog() as any
		)
		s3.copyObjectToCatalog
			.mockResolvedValueOnce({
				ok: true,
				key: 'catalogs/catalog-copy/products/product-source/2026/05/18/raw/photo-copy.jpg',
				url: 'https://cdn.example.test/photo-copy.jpg'
			})
			.mockResolvedValueOnce({
				ok: true,
				key: 'catalogs/catalog-copy/products/product-source/2026/05/18/photo-copy-thumb.avif',
				url: 'https://cdn.example.test/photo-copy-thumb.avif'
			})

		await service.duplicateCatalog('catalog-source', {
			name: 'Catalog Copy',
			slug: 'catalog-copy',
			typeId: 'type-1',
			status: CatalogStatus.OPERATIONAL
		})

		expect(s3.copyObjectToCatalog).toHaveBeenCalledWith({
			sourceKey:
				'catalogs/catalog-source/products/product-source/2026/05/18/raw/photo.jpg',
			targetCatalogId: 'catalog-copy',
			path: 'products',
			entityId: 'product-source'
		})
		expect(s3.copyObjectToCatalog).toHaveBeenCalledWith({
			sourceKey:
				'catalogs/catalog-source/products/product-source/2026/05/18/photo-thumb.avif',
			targetCatalogId: 'catalog-copy',
			path: 'products',
			entityId: 'product-source'
		})
		expect(tx.media.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				catalogId: 'catalog-copy',
				key: 'catalogs/catalog-copy/products/product-source/2026/05/18/raw/photo-copy.jpg',
				variants: {
					create: [
						expect.objectContaining({
							key: 'catalogs/catalog-copy/products/product-source/2026/05/18/photo-copy-thumb.avif'
						})
					]
				}
			})
		})
		expect(tx.productMedia.createMany).toHaveBeenCalledWith({
			data: [
				expect.objectContaining({
					productId: expect.any(String),
					mediaId: expect.not.stringMatching(/^media-source$/)
				})
			]
		})
	})

	it('returns the default owner password when duplicating catalog', async () => {
		const tx = createDuplicateTransactionMock()
		const { prisma, service } = createService(tx as any)
		prisma.catalog.findUnique.mockResolvedValueOnce({
			...createDuplicateSourceCatalog(),
			media: []
		} as any)

		const result = await service.duplicateCatalog('catalog-source', {
			name: 'Catalog Copy',
			slug: 'catalog-copy',
			typeId: 'type-1',
			status: CatalogStatus.OPERATIONAL
		})

		expect(result.owner.password).toBe('00000000')
		expect(tx.user.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				password: expect.any(String)
			}),
			select: {
				id: true,
				name: true,
				login: true
			}
		})
	})

	it('duplicates media variants when the raw S3 object is missing', async () => {
		const tx = createDuplicateTransactionMock()
		const { prisma, s3, service } = createService(tx as any)
		prisma.catalog.findUnique.mockResolvedValueOnce(
			createDuplicateSourceCatalog() as any
		)
		s3.copyObjectToCatalog
			.mockRejectedValueOnce(
				Object.assign(new Error('source object is missing'), {
					name: 'NoSuchKey',
					$metadata: { httpStatusCode: 404 }
				})
			)
			.mockResolvedValueOnce({
				ok: true,
				key: 'catalogs/catalog-copy/products/product-source/2026/05/18/photo-copy-thumb.avif',
				url: 'https://cdn.example.test/photo-copy-thumb.avif'
			})

		await service.duplicateCatalog('catalog-source', {
			name: 'Catalog Copy',
			slug: 'catalog-copy',
			typeId: 'type-1',
			status: CatalogStatus.OPERATIONAL
		})

		expect(s3.copyObjectToCatalog).toHaveBeenCalledTimes(2)
		expect(tx.media.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				catalogId: 'catalog-copy',
				key: 'catalogs/catalog-copy/products/product-source/2026/05/18/photo-copy-thumb.avif',
				variants: {
					create: [
						expect.objectContaining({
							key: 'catalogs/catalog-copy/products/product-source/2026/05/18/photo-copy-thumb.avif'
						})
					]
				}
			})
		})
		expect(tx.productMedia.createMany).toHaveBeenCalledWith({
			data: [
				expect.objectContaining({
					productId: expect.any(String),
					mediaId: expect.not.stringMatching(/^media-source$/)
				})
			]
		})
	})

	it('skips missing S3 media while duplicating catalog', async () => {
		const tx = createDuplicateTransactionMock()
		const { prisma, s3, service } = createService(tx as any)
		const source = createDuplicateSourceCatalog()
		source.media[0].variants = []
		prisma.catalog.findUnique.mockResolvedValueOnce(source as any)
		s3.copyObjectToCatalog.mockRejectedValueOnce(
			Object.assign(new Error('source object is missing'), {
				name: 'NoSuchKey',
				$metadata: { httpStatusCode: 404 }
			})
		)

		await expect(
			service.duplicateCatalog('catalog-source', {
				name: 'Catalog Copy',
				slug: 'catalog-copy',
				typeId: 'type-1',
				status: CatalogStatus.OPERATIONAL
			})
		).resolves.toMatchObject({
			catalog: expect.objectContaining({ id: 'catalog-copy' })
		})

		expect(s3.copyObjectToCatalog).toHaveBeenCalledTimes(1)
		expect(tx.media.create).not.toHaveBeenCalled()
		expect(tx.productMedia.createMany).not.toHaveBeenCalled()
		expect(s3.deleteObjectsByKeys).not.toHaveBeenCalled()
	})

	it('soft-deletes catalog content and keeps catalog-level data intact', async () => {
		const { cache, service, tx } = createService()

		const result = await service.deleteCatalogContent('catalog-1')

		expect(result).toEqual({
			ok: true,
			catalogId: 'catalog-1',
			deletedAt: expect.any(Date),
			counts: {
				products: 9,
				productVariants: 7,
				productAttributes: 8,
				variantAttributes: 6,
				categories: 10,
				brands: 11,
				seoSettings: 12,
				productMediaLinks: 2,
				categoryProductLinks: 3,
				integrationProductLinks: 4,
				integrationCategoryLinks: 5
			}
		})
		expect(tx.product.updateMany).toHaveBeenCalledWith({
			where: { catalogId: 'catalog-1', deleteAt: null },
			data: { deleteAt: result.deletedAt, brandId: null }
		})
		expect(tx.category.updateMany).toHaveBeenCalledWith({
			where: { catalogId: 'catalog-1', deleteAt: null },
			data: { deleteAt: result.deletedAt }
		})
		expect(tx.brand.updateMany).toHaveBeenCalledWith({
			where: { catalogId: 'catalog-1', deleteAt: null },
			data: { deleteAt: result.deletedAt }
		})
		expect(tx.seoSetting.updateMany).toHaveBeenCalledWith({
			where: {
				catalogId: 'catalog-1',
				deleteAt: null,
				entityType: { not: SeoEntityType.CATALOG }
			},
			data: { deleteAt: result.deletedAt }
		})
		expect(tx.catalog.update).not.toHaveBeenCalled()
		expect(tx.catalogConfig.updateMany).not.toHaveBeenCalled()
		expect(tx.catalogSettings.updateMany).not.toHaveBeenCalled()
		expect(tx.cart.updateMany).not.toHaveBeenCalled()
		expect(tx.order.updateMany).not.toHaveBeenCalled()
		expect(tx.payment.updateMany).not.toHaveBeenCalled()
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			CATALOG_CACHE_VERSION,
			'catalog-1'
		)
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			PRODUCTS_CACHE_VERSION,
			'catalog-1'
		)
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		)
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			CATEGORY_LIST_CACHE_VERSION,
			'catalog-1'
		)
	})

	it('removes only content link tables that cannot be soft-deleted', async () => {
		const { service, tx } = createService()

		await service.deleteCatalogContent('catalog-1')

		expect(tx.productMedia.deleteMany).toHaveBeenCalledWith({
			where: { product: { catalogId: 'catalog-1' } }
		})
		expect(tx.categoryProduct.deleteMany).toHaveBeenCalledWith({
			where: {
				OR: [
					{ category: { catalogId: 'catalog-1' } },
					{ product: { catalogId: 'catalog-1' } }
				]
			}
		})
		expect(tx.integrationProductLink.deleteMany).toHaveBeenCalledWith({
			where: {
				OR: [
					{ integration: { catalogId: 'catalog-1' } },
					{ product: { catalogId: 'catalog-1' } }
				]
			}
		})
		expect(tx.integrationCategoryLink.deleteMany).toHaveBeenCalledWith({
			where: {
				OR: [
					{ integration: { catalogId: 'catalog-1' } },
					{ category: { catalogId: 'catalog-1' } }
				]
			}
		})
	})

	it('is idempotent for an already cleaned catalog', async () => {
		const tx = createTransactionMock()
		for (const model of [
			tx.productMedia,
			tx.categoryProduct,
			tx.integrationProductLink,
			tx.integrationCategoryLink,
			tx.variantAttribute,
			tx.productVariant,
			tx.productAttribute,
			tx.product,
			tx.category,
			tx.brand,
			tx.seoSetting
		]) {
			const method = 'deleteMany' in model ? model.deleteMany : model.updateMany
			method.mockResolvedValue(createBatchPayload(0))
		}
		const { service } = createService(tx)

		await expect(
			service.deleteCatalogContent('catalog-1')
		).resolves.toMatchObject({
			ok: true,
			catalogId: 'catalog-1',
			counts: {
				products: 0,
				productVariants: 0,
				productAttributes: 0,
				variantAttributes: 0,
				categories: 0,
				brands: 0,
				seoSettings: 0,
				productMediaLinks: 0,
				categoryProductLinks: 0,
				integrationProductLinks: 0,
				integrationCategoryLinks: 0
			}
		})
	})
})

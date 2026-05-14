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
			findUnique: jest.fn().mockResolvedValue({ id: 'catalog-1' })
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
	const service = new AdminService(
		prisma as any,
		{} as any,
		{} as any,
		cache as any,
		capabilities as any
	)

	return { cache, capabilities, prisma, service, tx }
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

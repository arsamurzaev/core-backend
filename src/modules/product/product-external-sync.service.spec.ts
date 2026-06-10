import { ProductStatus } from '@generated/enums'

import { ProductExternalSyncService } from './product-external-sync.service'
import { ProductVariantService } from './product-variant.service'
import { ProductWriteFinalizer } from './product-write-finalizer.service'
import { ProductRepository } from './product.repository'

describe('ProductExternalSyncService', () => {
	let service: ProductExternalSyncService
	let repo: jest.Mocked<ProductRepository>
	let finalizer: jest.Mocked<ProductWriteFinalizer>

	beforeEach(() => {
		repo = {
			findExternalSyncById: jest.fn(),
			findExternalSyncBySku: jest.fn(),
			existsExternalSyncSlug: jest.fn(),
			existsExternalSyncSku: jest.fn(),
			createExternalSync: jest.fn(),
			updateExternalSync: jest.fn(),
			syncExternalDescription: jest.fn(),
			softDelete: jest.fn(),
			ensureDefaultVariant: jest.fn(),
			findByIdsWithDetails: jest.fn()
		} as unknown as jest.Mocked<ProductRepository>
		finalizer = {
			invalidateCatalogProductsCache: jest.fn(),
			invalidateCategoryProductsCache: jest.fn(),
			removeProductSeo: jest.fn(),
			syncProductSeo: jest.fn()
		} as unknown as jest.Mocked<ProductWriteFinalizer>

		service = new ProductExternalSyncService(
			repo,
			{
				buildDefaultVariantData: jest.fn()
			} as unknown as ProductVariantService,
			finalizer
		)
	})

	it('creates an externally synced product through the product repository boundary', async () => {
		const created = {
			id: 'product-1',
			catalogId: 'catalog-1',
			productTypeId: null,
			name: 'Product 1',
			sku: 'SKU-1',
			slug: 'product-1',
			price: '125',
			status: ProductStatus.ACTIVE,
			deleteAt: null
		}
		repo.createExternalSync.mockResolvedValue(created as never)

		await expect(
			service.createExternalProduct({
				catalogId: 'catalog-1',
				name: 'Product 1',
				sku: 'SKU-1',
				slug: 'product-1',
				price: '125',
				status: ProductStatus.ACTIVE
			})
		).resolves.toBe(created)

		expect(repo.createExternalSync).toHaveBeenCalledWith(
			{
				catalogId: 'catalog-1',
				name: 'Product 1',
				sku: 'SKU-1',
				slug: 'product-1',
				price: 125,
				status: ProductStatus.ACTIVE
			},
			undefined
		)
	})

	it('updates only allowed external product fields', async () => {
		repo.updateExternalSync.mockResolvedValue({
			id: 'product-1',
			catalogId: 'catalog-1',
			productTypeId: null,
			name: 'Updated',
			sku: 'SKU-2',
			slug: 'product-1',
			price: 150,
			status: ProductStatus.HIDDEN,
			deleteAt: null
		} as never)

		await service.updateExternalProduct({
			catalogId: 'catalog-1',
			productId: 'product-1',
			data: {
				name: 'Updated',
				sku: 'SKU-2',
				price: '150',
				status: ProductStatus.HIDDEN
			}
		})

		expect(repo.updateExternalSync).toHaveBeenCalledWith(
			{
				productId: 'product-1',
				catalogId: 'catalog-1',
				data: {
					name: 'Updated',
					sku: 'SKU-2',
					price: 150,
					status: ProductStatus.HIDDEN
				}
			},
			undefined
		)
	})

	it('syncs external product description and refreshes product side effects', async () => {
		const product = { id: 'product-1' }
		repo.syncExternalDescription.mockResolvedValue(true)
		repo.findByIdsWithDetails.mockResolvedValue([product] as never)

		await expect(
			service.syncExternalProductDescription({
				catalogId: 'catalog-1',
				productId: 'product-1',
				description: ' Imported description '
			})
		).resolves.toBe(true)

		expect(repo.syncExternalDescription).toHaveBeenCalledWith(
			{
				catalogId: 'catalog-1',
				productId: 'product-1',
				description: ' Imported description '
			},
			undefined
		)
		expect(repo.findByIdsWithDetails).toHaveBeenCalledWith(
			['product-1'],
			'catalog-1'
		)
		expect(finalizer.invalidateCatalogProductsCache).toHaveBeenCalledWith(
			'catalog-1'
		)
		expect(finalizer.invalidateCategoryProductsCache).toHaveBeenCalledWith(
			'catalog-1'
		)
		expect(finalizer.syncProductSeo).toHaveBeenCalledWith(product, 'catalog-1')
	})

	it('does not refresh product side effects when external description is unchanged', async () => {
		repo.syncExternalDescription.mockResolvedValue(false)

		await expect(
			service.syncExternalProductDescription({
				catalogId: 'catalog-1',
				productId: 'product-1',
				description: 'Same description'
			})
		).resolves.toBe(false)

		expect(repo.findByIdsWithDetails).not.toHaveBeenCalled()
		expect(finalizer.invalidateCatalogProductsCache).not.toHaveBeenCalled()
		expect(finalizer.invalidateCategoryProductsCache).not.toHaveBeenCalled()
		expect(finalizer.syncProductSeo).not.toHaveBeenCalled()
	})

	it('soft deletes an external product and refreshes delete side effects', async () => {
		repo.softDelete.mockResolvedValue({
			id: 'product-1',
			mediaIds: []
		})

		await expect(
			service.softDeleteExternalProduct({
				catalogId: 'catalog-1',
				productId: 'product-1'
			})
		).resolves.toBe(true)

		expect(repo.softDelete).toHaveBeenCalledWith('product-1', 'catalog-1')
		expect(finalizer.removeProductSeo).toHaveBeenCalledWith(
			'product-1',
			'catalog-1'
		)
		expect(finalizer.invalidateCatalogProductsCache).toHaveBeenCalledWith(
			'catalog-1'
		)
		expect(finalizer.invalidateCategoryProductsCache).toHaveBeenCalledWith(
			'catalog-1'
		)
	})

	it('does not refresh delete side effects when external product is already missing', async () => {
		repo.softDelete.mockResolvedValue(null)

		await expect(
			service.softDeleteExternalProduct({
				catalogId: 'catalog-1',
				productId: 'product-1'
			})
		).resolves.toBe(false)

		expect(finalizer.removeProductSeo).not.toHaveBeenCalled()
		expect(finalizer.invalidateCatalogProductsCache).not.toHaveBeenCalled()
		expect(finalizer.invalidateCategoryProductsCache).not.toHaveBeenCalled()
	})
})

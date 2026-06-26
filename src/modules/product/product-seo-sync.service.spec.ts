import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import type { SeoSettingsPort } from '@/modules/seo/public'
import { MediaUrlService } from '@/shared/media/media-url.service'

import { ProductSeoSyncService } from './product-seo-sync.service'

describe('ProductSeoSyncService', () => {
	let service: ProductSeoSyncService
	let prisma: {
		catalog: {
			findUnique: jest.Mock
		}
	}
	let seoSettings: jest.Mocked<SeoSettingsPort>
	let mediaUrl: jest.Mocked<MediaUrlService>

	beforeEach(() => {
		prisma = {
			catalog: {
				findUnique: jest.fn().mockResolvedValue({
					id: 'catalog-1',
					name: 'Store',
					domain: 'store.test',
					config: {
						currency: 'RUB'
					}
				})
			}
		}

		seoSettings = {
			findByEntity: jest.fn(),
			create: jest.fn(),
			update: jest.fn(),
			softDelete: jest.fn()
		} as any

		mediaUrl = {
			mapMedia: jest.fn().mockReturnValue({
				url: 'https://cdn.example.com/products/product-1/detail.webp'
			})
		} as any

		service = new ProductSeoSyncService(
			prisma as unknown as PrismaService,
			seoSettings,
			mediaUrl
		)
	})

	it('creates rich product SEO with structured data and social media', async () => {
		seoSettings.findByEntity.mockResolvedValue(null)

		await service.syncProduct(
			{
				id: 'product-1',
				name: 'Джинсы Slim Fit',
				slug: 'dzhinsy-slim-fit',
				sku: 'JEANS-001',
				price: 2499,
				status: 'ACTIVE',
				brand: {
					id: 'brand-1',
					name: 'Levis',
					slug: 'levis'
				},
				media: [
					{
						position: 0,
						media: {
							id: 'media-1',
							originalName: 'product.jpg',
							mimeType: 'image/jpeg',
							size: 100,
							width: 1200,
							height: 900,
							status: 'READY',
							storage: 's3',
							key: 'products/product.jpg',
							variants: []
						}
					}
				],
				productAttributes: [
					{
						attribute: {
							displayName: 'Материал',
							isHidden: false
						},
						enumValue: null,
						valueString: 'Хлопок',
						valueInteger: null,
						valueDecimal: null,
						valueBoolean: null,
						valueDateTime: null
					}
				],
				variants: [],
				categoryProducts: [
					{
						category: {
							id: 'category-1',
							name: 'Джинсы'
						}
					}
				]
			} as any,
			'catalog-1'
		)

		expect(seoSettings.create).toHaveBeenCalledWith(
			expect.objectContaining({
				entityType: 'PRODUCT',
				entityId: 'product-1',
				urlPath: '/product/dzhinsy-slim-fit',
				canonicalUrl: 'https://store.test/product/dzhinsy-slim-fit',
				ogMedia: { connect: { id: 'media-1' } },
				twitterMedia: { connect: { id: 'media-1' } },
				structuredData: expect.stringContaining('"@type":"Product"')
			})
		)
	})

	it('updates existing product SEO and disables indexing for hidden products', async () => {
		seoSettings.findByEntity.mockResolvedValue({
			id: 'seo-1'
		} as any)

		await service.syncProduct(
			{
				id: 'product-1',
				name: 'Скрытый товар',
				slug: 'hidden-product',
				sku: 'HIDDEN-001',
				price: 100,
				status: 'HIDDEN',
				brand: null,
				media: [],
				productAttributes: [],
				variants: [],
				categoryProducts: []
			} as any,
			'catalog-1'
		)

		expect(seoSettings.update).toHaveBeenCalledWith(
			'seo-1',
			'catalog-1',
			expect.objectContaining({
				robots: 'noindex,nofollow',
				isIndexable: false,
				isFollowable: false,
				ogMedia: { disconnect: true },
				twitterMedia: { disconnect: true }
			})
		)
	})

	it('soft deletes product SEO on remove', async () => {
		seoSettings.findByEntity.mockResolvedValue({
			id: 'seo-1'
		} as any)

		await service.removeProduct('product-1', 'catalog-1')

		expect(seoSettings.softDelete).toHaveBeenCalledWith('seo-1', 'catalog-1')
	})
})

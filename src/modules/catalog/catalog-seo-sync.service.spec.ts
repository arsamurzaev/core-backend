import { BadRequestException } from '@nestjs/common'

import { S3Service } from '@/modules/s3/s3.service'
import { SeoRepository } from '@/modules/seo/seo.repository'

import { CatalogSeoSyncService } from './catalog-seo-sync.service'

describe('CatalogSeoSyncService', () => {
	let service: CatalogSeoSyncService
	let seoRepo: jest.Mocked<SeoRepository>
	let s3Service: jest.Mocked<S3Service>

	beforeEach(() => {
		seoRepo = {
			findByEntity: jest.fn(),
			create: jest.fn(),
			update: jest.fn()
		} as any

		s3Service = {
			uploadGeneratedAsset: jest.fn()
		} as any

		service = new CatalogSeoSyncService(seoRepo, s3Service)
	})

	it('creates default catalog SEO with generated assets', async () => {
		seoRepo.findByEntity.mockResolvedValue(null)
		s3Service.uploadGeneratedAsset
			.mockResolvedValueOnce({
				ok: true,
				mediaId: 'favicon-media',
				key: 'catalogs/catalog-1/seo/catalog/catalog-1/favicon.ico',
				url: 'https://cdn.example.com/favicon.ico'
			} as any)
			.mockResolvedValueOnce({
				ok: true,
				mediaId: 'telegram-media',
				key: 'catalogs/catalog-1/seo/catalog/catalog-1/telegram.png',
				url: 'https://cdn.example.com/telegram.png'
			} as any)
			.mockResolvedValueOnce({
				ok: true,
				mediaId: 'whatsapp-media',
				key: 'catalogs/catalog-1/seo/catalog/catalog-1/whatsapp.png',
				url: 'https://cdn.example.com/whatsapp.png'
			} as any)

		await service.syncCatalog({
			id: 'catalog-1',
			slug: 'store',
			domain: 'store.test',
			name: 'Store',
			config: {
				description: 'Best store'
			}
		})

		expect(seoRepo.create).toHaveBeenCalledTimes(1)
		expect(seoRepo.create).toHaveBeenCalledWith(
			expect.objectContaining({
				entityId: 'catalog-1',
				entityType: 'CATALOG',
				title: 'Store',
				canonicalUrl: 'https://store.test',
				ogMedia: { connect: { id: 'whatsapp-media' } },
				twitterMedia: { connect: { id: 'telegram-media' } }
			})
		)
	})

	it('updates existing SEO and merges generated assets into extras', async () => {
		seoRepo.findByEntity.mockResolvedValue({
			id: 'seo-1',
			extras: JSON.stringify({ custom: true }),
			ogMedia: null,
			twitterMedia: null
		} as any)
		s3Service.uploadGeneratedAsset
			.mockResolvedValueOnce({
				ok: true,
				mediaId: 'favicon-media',
				key: 'catalogs/catalog-1/seo/catalog/catalog-1/favicon.ico',
				url: 'https://cdn.example.com/favicon.ico'
			} as any)
			.mockResolvedValueOnce({
				ok: true,
				mediaId: 'telegram-media',
				key: 'catalogs/catalog-1/seo/catalog/catalog-1/telegram.png',
				url: 'https://cdn.example.com/telegram.png'
			} as any)
			.mockResolvedValueOnce({
				ok: true,
				mediaId: 'whatsapp-media',
				key: 'catalogs/catalog-1/seo/catalog/catalog-1/whatsapp.png',
				url: 'https://cdn.example.com/whatsapp.png'
			} as any)

		await service.syncCatalog({
			id: 'catalog-1',
			slug: 'store',
			name: 'Store'
		})

		expect(seoRepo.update).toHaveBeenCalledTimes(1)
		expect(seoRepo.update).toHaveBeenCalledWith(
			'seo-1',
			'catalog-1',
			expect.objectContaining({
				ogMedia: { connect: { id: 'whatsapp-media' } },
				twitterMedia: { connect: { id: 'telegram-media' } },
				extras: expect.stringContaining('"custom":true')
			})
		)
	})

	it('creates SEO without assets when uploads are disabled', async () => {
		seoRepo.findByEntity.mockResolvedValue(null)
		s3Service.uploadGeneratedAsset.mockRejectedValue(
			new BadRequestException('Загрузка файлов отключена')
		)

		await service.syncCatalog({
			id: 'catalog-1',
			slug: 'store',
			name: 'Store'
		})

		expect(seoRepo.create).toHaveBeenCalledWith(
			expect.not.objectContaining({
				ogMedia: expect.anything(),
				twitterMedia: expect.anything()
			})
		)
	})
})

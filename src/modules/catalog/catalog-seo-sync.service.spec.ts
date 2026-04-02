import { BadRequestException } from '@nestjs/common'
import sharp from 'sharp'

import { S3Service } from '@/modules/s3/s3.service'
import { SeoRepository } from '@/modules/seo/seo.repository'
import { MediaUrlService } from '@/shared/media/media-url.service'

import { CatalogSeoSyncService } from './catalog-seo-sync.service'

describe('CatalogSeoSyncService', () => {
	let service: CatalogSeoSyncService
	let seoRepo: jest.Mocked<SeoRepository>
	let s3Service: jest.Mocked<S3Service>
	let mediaUrl: jest.Mocked<MediaUrlService>

	beforeEach(() => {
		seoRepo = {
			findByEntity: jest.fn(),
			create: jest.fn(),
			update: jest.fn()
		} as any

		s3Service = {
			uploadGeneratedAsset: jest.fn(),
			downloadObject: jest.fn()
		} as any

		mediaUrl = {
			resolveUrl: jest.fn()
		} as any

		service = new CatalogSeoSyncService(seoRepo, s3Service, mediaUrl)
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

	it('uses configured background and logo media for social previews', async () => {
		const imageBuffer = await sharp({
			create: {
				width: 48,
				height: 48,
				channels: 4,
				background: '#ffffff'
			}
		})
			.png()
			.toBuffer()

		seoRepo.findByEntity.mockResolvedValue(null)
		s3Service.downloadObject
			.mockResolvedValueOnce({
				buffer: imageBuffer,
				contentType: 'image/png',
				size: imageBuffer.length
			} as any)
			.mockResolvedValueOnce({
				buffer: imageBuffer,
				contentType: 'image/png',
				size: imageBuffer.length
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
			name: 'Store',
			config: {
				description: 'Best store',
				logoMedia: {
					storage: 's3',
					key: 'catalogs/catalog-1/logo.png',
					mimeType: 'image/png',
					variants: []
				},
				bgMedia: {
					storage: 's3',
					key: 'catalogs/catalog-1/background.png',
					mimeType: 'image/png',
					variants: []
				}
			}
		})

		expect(s3Service.downloadObject).toHaveBeenCalledTimes(2)
		expect(s3Service.downloadObject).toHaveBeenNthCalledWith(
			1,
			'catalogs/catalog-1/background.png'
		)
		expect(s3Service.downloadObject).toHaveBeenNthCalledWith(
			2,
			'catalogs/catalog-1/logo.png'
		)
		expect(s3Service.uploadGeneratedAsset).toHaveBeenCalledTimes(3)
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

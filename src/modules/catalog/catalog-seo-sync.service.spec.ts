import { BadRequestException } from '@nestjs/common'
import sharp from 'sharp'

import type { MediaStoragePort } from '@/modules/s3/public'
import type { SeoSettingsPort } from '@/modules/seo/public'
import { MediaUrlService } from '@/shared/media/media-url.service'

import { CatalogSeoSyncService } from './catalog-seo-sync.service'

describe('CatalogSeoSyncService', () => {
	let service: CatalogSeoSyncService
	let seoSettings: jest.Mocked<SeoSettingsPort>
	let mediaStorage: jest.Mocked<MediaStoragePort>
	let mediaUrl: jest.Mocked<MediaUrlService>

	beforeEach(() => {
		seoSettings = {
			findByEntity: jest.fn(),
			create: jest.fn(),
			update: jest.fn()
		} as any

		mediaStorage = {
			uploadGeneratedAsset: jest.fn(),
			downloadObject: jest.fn()
		} as any

		mediaUrl = {
			resolveUrl: jest.fn()
		} as any

		service = new CatalogSeoSyncService(seoSettings, mediaStorage, mediaUrl)
	})

	it('creates default catalog SEO with generated assets', async () => {
		seoSettings.findByEntity.mockResolvedValue(null)
		mediaStorage.uploadGeneratedAsset
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

		expect(seoSettings.create).toHaveBeenCalledTimes(1)
		expect(seoSettings.create).toHaveBeenCalledWith(
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
		seoSettings.findByEntity.mockResolvedValue({
			id: 'seo-1',
			extras: JSON.stringify({ custom: true }),
			ogMedia: null,
			twitterMedia: null
		} as any)
		mediaStorage.uploadGeneratedAsset
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

		expect(seoSettings.update).toHaveBeenCalledTimes(1)
		expect(seoSettings.update).toHaveBeenCalledWith(
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

		seoSettings.findByEntity.mockResolvedValue(null)
		mediaStorage.downloadObject
			.mockResolvedValueOnce({
				buffer: imageBuffer,
				contentType: 'image/png',
				size: imageBuffer.length
			})
			.mockResolvedValueOnce({
				buffer: imageBuffer,
				contentType: 'image/png',
				size: imageBuffer.length
			})
		mediaStorage.uploadGeneratedAsset
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

		expect(mediaStorage.downloadObject).toHaveBeenCalledTimes(2)
		expect(mediaStorage.downloadObject).toHaveBeenNthCalledWith(
			1,
			'catalogs/catalog-1/background.png'
		)
		expect(mediaStorage.downloadObject).toHaveBeenNthCalledWith(
			2,
			'catalogs/catalog-1/logo.png'
		)
		expect(mediaStorage.uploadGeneratedAsset).toHaveBeenCalledTimes(3)
	})

	it('creates SEO without assets when uploads are disabled', async () => {
		seoSettings.findByEntity.mockResolvedValue(null)
		mediaStorage.uploadGeneratedAsset.mockRejectedValue(
			new BadRequestException('Загрузка файлов отключена')
		)

		await service.syncCatalog({
			id: 'catalog-1',
			slug: 'store',
			name: 'Store'
		})

		expect(seoSettings.create).toHaveBeenCalledWith(
			expect.not.objectContaining({
				ogMedia: expect.anything(),
				twitterMedia: expect.anything()
			})
		)
	})
})

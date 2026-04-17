import { Test, TestingModule } from '@nestjs/testing'

import { CacheService } from '@/shared/cache/cache.service'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { RequestContext } from '@/shared/tenancy/request-context'

import { CatalogSeoSyncService } from './catalog-seo-sync.service'
import { CatalogRepository } from './catalog.repository'
import { CatalogService } from './catalog.service'

describe('CatalogService', () => {
	let service: CatalogService
	let serviceState: { cacheTtlSec: number }
	let repo: jest.Mocked<CatalogRepository>
	let cache: jest.Mocked<CacheService>
	let mediaUrl: jest.Mocked<MediaUrlService>
	let catalogSeoSync: jest.Mocked<CatalogSeoSyncService>

	const runWithCatalog = <T>(fn: () => Promise<T>) =>
		RequestContext.run(
			{
				requestId: 'req-1',
				host: 'example.test',
				catalogId: 'catalog-1',
				typeId: 'type-1'
			},
			fn
		)

	const runWithCatalogWithoutType = <T>(fn: () => Promise<T>) =>
		RequestContext.run(
			{
				requestId: 'req-2',
				host: 'example.test',
				catalogId: 'catalog-1'
			},
			fn
		)

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CatalogService,
				{
					provide: CatalogRepository,
					useValue: {
						getAll: jest.fn(),
						getById: jest.fn(),
						getByIdWithType: jest.fn(),
						getCurrentByIdWithType: jest.fn(),
						getCurrentShellById: jest.fn(),
						getTypeByIdWithAttributes: jest.fn(),
						getBySlug: jest.fn(),
						getByDomain: jest.fn(),
						existsSlug: jest.fn(),
						existsDomain: jest.fn(),
						create: jest.fn(),
						update: jest.fn()
					}
				},
				{
					provide: CacheService,
					useValue: {
						buildKey: jest.fn(),
						getVersion: jest.fn(),
						bumpVersion: jest.fn(),
						getJson: jest.fn(),
						setJson: jest.fn(),
						del: jest.fn()
					}
				},
				{
					provide: MediaRepository,
					useValue: {
						findById: jest.fn()
					}
				},
				{
					provide: MediaUrlService,
					useValue: {
						mapMedia: jest.fn()
					}
				},
				{
					provide: CatalogSeoSyncService,
					useValue: {
						syncCatalog: jest.fn()
					}
				}
			]
		}).compile()

		service = module.get(CatalogService)
		serviceState = service as unknown as { cacheTtlSec: number }
		repo = module.get(CatalogRepository)
		cache = module.get(CacheService)
		mediaUrl = module.get(MediaUrlService)
		catalogSeoSync = module.get(CatalogSeoSyncService)

		cache.buildKey.mockImplementation(parts =>
			parts
				.filter(part => part !== undefined && part !== null && part !== '')
				.map(part => String(part))
				.join(':')
		)
		cache.getVersion.mockResolvedValue(0)
		cache.getJson.mockResolvedValue(null)
		cache.setJson.mockResolvedValue(undefined)
		mediaUrl.mapMedia.mockImplementation(
			media =>
				({
					id: media.id,
					originalName: media.originalName ?? null,
					mimeType: media.mimeType ?? null,
					size: media.size ?? null,
					width: media.width ?? null,
					height: media.height ?? null,
					status: media.status,
					key: media.key,
					url: `https://cdn.example.com/${media.key}`,
					variants: []
				}) as any
		)
		serviceState.cacheTtlSec = 0
	})

	it('composes current catalog from shell and type schema', async () => {
		repo.getCurrentShellById.mockResolvedValue({
			id: 'catalog-1',
			slug: 'store',
			domain: 'store.test',
			name: 'Store',
			typeId: 'type-1',
			parentId: null,
			userId: null,
			config: {
				status: 'ACTIVE',
				about: 'About',
				description: null,
				currency: 'RUB',
				logoMedia: {
					id: 'media-1',
					originalName: 'logo.png',
					mimeType: 'image/png',
					size: 100,
					width: 10,
					height: 10,
					status: 'READY',
					storage: 's3',
					key: 'logo.png',
					variants: []
				},
				bgMedia: null,
				note: null
			},
			settings: {
				isActive: true,
				defaultMode: 'DELIVERY',
				allowedModes: ['DELIVERY'],
				googleVerification: null,
				yandexVerification: null
			},
			contacts: [{ id: 'contact-1', type: 'PHONE', position: 0, value: '+7' }],
			seoSettings: [
				{
					id: 'seo-1',
					catalogId: 'catalog-1',
					entityType: 'CATALOG',
					entityId: 'catalog-1',
					urlPath: '/',
					canonicalUrl: 'https://store.test',
					title: 'Store',
					description: 'SEO description',
					keywords: null,
					h1: 'Store',
					seoText: null,
					robots: 'index,follow',
					isIndexable: true,
					isFollowable: true,
					ogTitle: 'Store',
					ogDescription: 'SEO description',
					ogMedia: {
						id: 'media-2',
						originalName: 'og.png',
						mimeType: 'image/png',
						size: 200,
						width: 1200,
						height: 630,
						status: 'READY',
						storage: 's3',
						key: 'seo/og.png',
						variants: []
					},
					ogType: 'website',
					ogUrl: 'https://store.test',
					ogSiteName: 'Store',
					ogLocale: 'ru_RU',
					twitterCard: 'summary_large_image',
					twitterTitle: 'Store',
					twitterDescription: 'SEO description',
					twitterMedia: null,
					twitterSite: null,
					twitterCreator: null,
					hreflang: null,
					structuredData: null,
					extras: null,
					sitemapPriority: 1,
					sitemapChangeFreq: 'WEEKLY',
					createdAt: new Date(),
					updatedAt: new Date()
				}
			]
		} as any)
		repo.getTypeByIdWithAttributes.mockResolvedValue({
			id: 'type-1',
			code: 'clothing',
			name: 'Clothing',
			attributes: [
				{
					id: 'attr-1',
					key: 'color',
					displayName: 'Color',
					dataType: 'ENUM',
					isRequired: false,
					isVariantAttribute: false,
					isFilterable: true,
					displayOrder: 0,
					isHidden: false,
					createdAt: new Date(),
					updatedAt: new Date(),
					types: [{ id: 'type-1' }],
					enumValues: []
				}
			]
		} as any)

		const result = await runWithCatalog(() => service.getCurrent())

		expect(result).toMatchObject({
			id: 'catalog-1',
			typeId: 'type-1',
			contacts: [{ id: 'contact-1', type: 'PHONE', position: 0, value: '+7' }],
			seo: {
				id: 'seo-1',
				entityId: 'catalog-1',
				title: 'Store',
				ogMedia: {
					id: 'media-2',
					url: 'https://cdn.example.com/seo/og.png'
				}
			},
			type: {
				id: 'type-1',
				code: 'clothing',
				attributes: [{ id: 'attr-1', typeIds: ['type-1'] }]
			}
		})
		expect(mediaUrl.mapMedia).toHaveBeenCalledTimes(2)
	})

	it('returns cached shell and cached type schema when caches are warm', async () => {
		serviceState.cacheTtlSec = 120
		cache.getJson
			.mockResolvedValueOnce({
				id: 'catalog-1',
				typeId: 'type-1',
				contacts: [],
				config: null,
				settings: null
			} as any)
			.mockResolvedValueOnce({
				id: 'type-1',
				code: 'clothing',
				name: 'Clothing',
				attributes: []
			} as any)

		const result = await runWithCatalog(() => service.getCurrent())

		expect(result).toEqual({
			id: 'catalog-1',
			typeId: 'type-1',
			contacts: [],
			config: null,
			settings: null,
			type: {
				id: 'type-1',
				code: 'clothing',
				name: 'Clothing',
				attributes: []
			}
		})
		expect(repo.getCurrentShellById).not.toHaveBeenCalled()
		expect(repo.getTypeByIdWithAttributes).not.toHaveBeenCalled()
	})

	it('warms separate shell and type caches for current catalog', async () => {
		serviceState.cacheTtlSec = 120
		repo.getCurrentShellById.mockResolvedValue({
			id: 'catalog-1',
			slug: 'store',
			domain: null,
			name: 'Store',
			typeId: 'type-1',
			parentId: null,
			userId: null,
			config: null,
			settings: null,
			contacts: []
		} as any)
		repo.getTypeByIdWithAttributes.mockResolvedValue({
			id: 'type-1',
			code: 'clothing',
			name: 'Clothing',
			attributes: []
		} as any)

		await runWithCatalog(() => service.getCurrent())

		expect(cache.setJson).toHaveBeenCalledTimes(2)
		expect(cache.setJson.mock.calls[0]?.[1]).toMatchObject({
			id: 'catalog-1',
			typeId: 'type-1',
			contacts: []
		})
		expect(cache.setJson.mock.calls[1]?.[1]).toMatchObject({
			id: 'type-1',
			code: 'clothing',
			attributes: []
		})
	})

	it('returns current catalog shell without loading type schema', async () => {
		repo.getCurrentShellById.mockResolvedValue({
			id: 'catalog-1',
			slug: 'store',
			domain: 'store.test',
			name: 'Store',
			typeId: 'type-1',
			parentId: null,
			userId: null,
			config: null,
			settings: null,
			contacts: [{ id: 'contact-1', type: 'PHONE', position: 0, value: '+7' }]
		} as any)

		const result = await runWithCatalog(() => service.getCurrentShell())

		expect(result).toEqual({
			id: 'catalog-1',
			slug: 'store',
			domain: 'store.test',
			name: 'Store',
			typeId: 'type-1',
			parentId: null,
			userId: null,
			config: null,
			settings: null,
			contacts: [{ id: 'contact-1', type: 'PHONE', position: 0, value: '+7' }]
		})
		expect(repo.getTypeByIdWithAttributes).not.toHaveBeenCalled()
	})

	it('returns current catalog type schema without loading shell when typeId is in context', async () => {
		repo.getTypeByIdWithAttributes.mockResolvedValue({
			id: 'type-1',
			code: 'clothing',
			name: 'Clothing',
			attributes: []
		} as any)

		const result = await runWithCatalog(() => service.getCurrentTypeSchema())

		expect(result).toEqual({
			id: 'type-1',
			code: 'clothing',
			name: 'Clothing',
			attributes: []
		})
		expect(repo.getCurrentShellById).not.toHaveBeenCalled()
	})

	it('falls back to catalog shell to resolve current type schema when context has no typeId', async () => {
		repo.getCurrentShellById.mockResolvedValue({
			id: 'catalog-1',
			slug: 'store',
			domain: null,
			name: 'Store',
			typeId: 'type-1',
			parentId: null,
			userId: null,
			config: null,
			settings: null,
			contacts: []
		} as any)
		repo.getTypeByIdWithAttributes.mockResolvedValue({
			id: 'type-1',
			code: 'clothing',
			name: 'Clothing',
			attributes: []
		} as any)

		const result = await runWithCatalogWithoutType(() =>
			service.getCurrentTypeSchema()
		)

		expect(result).toEqual({
			id: 'type-1',
			code: 'clothing',
			name: 'Clothing',
			attributes: []
		})
		expect(repo.getCurrentShellById).toHaveBeenCalledWith('catalog-1')
	})

	it('creates default SEO assets after catalog creation', async () => {
		repo.existsSlug.mockResolvedValue(false)
		repo.existsDomain.mockResolvedValue(false)
		repo.create.mockResolvedValue({
			id: 'catalog-1',
			slug: 'store',
			domain: 'store.test',
			name: 'Store',
			typeId: 'type-1',
			parentId: null,
			userId: null,
			config: null,
			settings: null
		} as any)

		await service.create({
			name: 'Store',
			typeId: 'type-1',
			status: 'PROPOSAL'
		} as any)

		expect(catalogSeoSync.syncCatalog).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'catalog-1',
				slug: 'store',
				name: 'Store'
			})
		)
	})

	it('resyncs default SEO assets after catalog update', async () => {
		repo.update.mockResolvedValue({
			id: 'catalog-1'
		} as any)
		repo.getCurrentShellById.mockResolvedValue({
			id: 'catalog-1',
			slug: 'store',
			domain: 'store.test',
			name: 'Store',
			typeId: 'type-1',
			parentId: null,
			userId: null,
			config: {
				about: 'About store',
				description: 'Description',
				logoMedia: null,
				bgMedia: null,
				currency: 'RUB',
				status: 'ACTIVE',
				note: null
			},
			settings: null,
			contacts: [],
			seoSettings: []
		} as any)

		await runWithCatalog(() => service.updateCurrent({ name: 'Store' } as any))

		expect(catalogSeoSync.syncCatalog).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'catalog-1',
				domain: 'store.test',
				config: expect.objectContaining({
					description: 'Description'
				})
			})
		)
	})

	it('updates catalog settings with catalog experience modes', async () => {
		repo.getById.mockResolvedValue({
			id: 'catalog-1',
			settings: {
				isActive: true,
				defaultMode: 'DELIVERY',
				allowedModes: ['DELIVERY']
			}
		} as any)
		repo.update.mockResolvedValue({
			id: 'catalog-1',
			slug: 'store',
			domain: 'store.test',
			name: 'Store',
			typeId: 'type-1',
			parentId: null,
			userId: null,
			config: null,
			settings: {
				isActive: true,
				defaultMode: 'HALL',
				allowedModes: ['DELIVERY', 'HALL']
			}
		} as any)

		await service.updateById(
			'catalog-1',
			{
				defaultMode: 'HALL',
				allowedModes: ['DELIVERY', 'HALL']
			} as any
		)

		expect(repo.update).toHaveBeenCalledWith(
			'catalog-1',
			expect.objectContaining({
				settings: expect.objectContaining({
					upsert: expect.objectContaining({
						update: expect.objectContaining({
							defaultMode: 'HALL',
							allowedModes: ['DELIVERY', 'HALL']
						})
					})
				})
			})
		)
	})

	it('rejects catalog experience settings when default mode is not allowed', async () => {
		repo.getById.mockResolvedValue({
			id: 'catalog-1',
			settings: {
				isActive: true,
				defaultMode: 'DELIVERY',
				allowedModes: ['DELIVERY']
			}
		} as any)

		await expect(
			service.updateById(
				'catalog-1',
				{
					defaultMode: 'HALL',
					allowedModes: ['DELIVERY']
				} as any
			)
		).rejects.toThrow('defaultMode must be included in allowedModes')
	})
})

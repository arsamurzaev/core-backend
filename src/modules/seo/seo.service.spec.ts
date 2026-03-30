import { Test, TestingModule } from '@nestjs/testing'

import { CacheService } from '@/shared/cache/cache.service'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { RequestContext } from '@/shared/tenancy/request-context'

import { SeoRepository } from './seo.repository'
import { SeoService } from './seo.service'

describe('SeoService', () => {
	let service: SeoService
	let repo: jest.Mocked<SeoRepository>
	let cache: jest.Mocked<CacheService>

	const runWithCatalog = <T>(fn: () => Promise<T>) =>
		RequestContext.run(
			{
				requestId: 'req-1',
				host: 'example.test',
				catalogId: 'catalog-1'
			},
			fn
		)

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				SeoService,
				{
					provide: SeoRepository,
					useValue: {
						findAll: jest.fn(),
						findById: jest.fn(),
						findByEntity: jest.fn(),
						create: jest.fn(),
						update: jest.fn(),
						softDelete: jest.fn()
					}
				},
				{
					provide: CacheService,
					useValue: {
						bumpVersion: jest.fn()
					}
				},
				{
					provide: MediaRepository,
					useValue: {
						findById: jest.fn(),
						findByIds: jest.fn()
					}
				},
				{
					provide: MediaUrlService,
					useValue: {
						mapMedia: jest.fn()
					}
				}
			]
		}).compile()

		service = module.get<SeoService>(SeoService)
		repo = module.get(SeoRepository)
		cache = module.get(CacheService)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	it('invalidates catalog cache after seo update', async () => {
		repo.update.mockResolvedValue({
			id: 'seo-1',
			ogMedia: null,
			twitterMedia: null
		} as any)

		await runWithCatalog(() =>
			service.update('seo-1', {
				title: 'Updated title'
			} as any)
		)

		expect(cache.bumpVersion).toHaveBeenCalledWith('catalog', 'catalog-1')
	})

	it('invalidates catalog cache after seo removal', async () => {
		repo.softDelete.mockResolvedValue({ id: 'seo-1' } as any)

		await runWithCatalog(() => service.remove('seo-1'))

		expect(cache.bumpVersion).toHaveBeenCalledWith('catalog', 'catalog-1')
	})
})

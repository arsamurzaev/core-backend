import { Test, TestingModule } from '@nestjs/testing'

import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'

import { SeoRepository } from './seo.repository'
import { SeoService } from './seo.service'

describe('SeoService', () => {
	let service: SeoService

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
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})
})

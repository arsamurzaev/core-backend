import { Test, TestingModule } from '@nestjs/testing'

import { CacheService } from '@/shared/cache/cache.service'

import { ProductAttributeBuilder } from './product-attribute.builder'
import { ProductRepository } from './product.repository'
import { ProductService } from './product.service'

describe('ProductService', () => {
	let service: ProductService

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ProductService,
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
					provide: ProductAttributeBuilder,
					useValue: {
						buildForCreate: jest.fn(),
						buildForUpdate: jest.fn()
					}
				},
				{
					provide: ProductRepository,
					useValue: {
						findAll: jest.fn(),
						findById: jest.fn(),
						findBySlug: jest.fn(),
						create: jest.fn(),
						update: jest.fn(),
						softDelete: jest.fn()
					}
				}
			]
		}).compile()

		service = module.get<ProductService>(ProductService)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})
})

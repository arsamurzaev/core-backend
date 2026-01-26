import { Test, TestingModule } from '@nestjs/testing'

import { AttributeRepository } from './attribute.repository'
import { AttributeService } from './attribute.service'

describe('AttributeService', () => {
	let service: AttributeService

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				AttributeService,
				{
					provide: AttributeRepository,
					useValue: {
						findById: jest.fn(),
						findByType: jest.fn(),
						create: jest.fn(),
						update: jest.fn(),
						softDelete: jest.fn(),
						findEnumValues: jest.fn(),
						createEnumValue: jest.fn(),
						updateEnumValue: jest.fn(),
						softDeleteEnumValue: jest.fn()
					}
				}
			]
		}).compile()

		service = module.get<AttributeService>(AttributeService)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})
})

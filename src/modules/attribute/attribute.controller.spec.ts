import { Test, TestingModule } from '@nestjs/testing'

import { AttributeController } from './attribute.controller'
import { AttributeService } from './attribute.service'

describe('AttributeController', () => {
	let controller: AttributeController

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [AttributeController],
			providers: [
				{
					provide: AttributeService,
					useValue: {
						getByType: jest.fn(),
						getById: jest.fn(),
						create: jest.fn(),
						update: jest.fn(),
						remove: jest.fn(),
						getEnumValues: jest.fn(),
						createEnumValue: jest.fn(),
						updateEnumValue: jest.fn(),
						removeEnumValue: jest.fn()
					}
				}
			]
		}).compile()

		controller = module.get<AttributeController>(AttributeController)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})
})

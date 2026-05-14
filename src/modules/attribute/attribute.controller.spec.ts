import { Test, TestingModule } from '@nestjs/testing'

import { OptionalSessionGuard } from '@/modules/auth/guards/optional-session.guard'
import { SessionGuard } from '@/modules/auth/guards/session.guard'

import { AttributeController } from './attribute.controller'
import { AttributeService } from './attribute.service'

describe('AttributeController', () => {
	let controller: AttributeController

	beforeEach(async () => {
		const moduleBuilder = Test.createTestingModule({
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
						removeEnumValue: jest.fn(),
						getEnumValueAliases: jest.fn(),
						createEnumValueAlias: jest.fn(),
						removeEnumValueAlias: jest.fn(),
						mergeEnumValues: jest.fn()
					}
				}
			]
		})

		moduleBuilder.overrideGuard(OptionalSessionGuard).useValue({
			canActivate: jest.fn().mockReturnValue(true)
		})
		moduleBuilder.overrideGuard(SessionGuard).useValue({
			canActivate: jest.fn().mockReturnValue(true)
		})

		const module: TestingModule = await moduleBuilder.compile()

		controller = module.get<AttributeController>(AttributeController)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})
})

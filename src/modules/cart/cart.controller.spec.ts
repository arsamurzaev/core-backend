import { Test, TestingModule } from '@nestjs/testing'

import { SessionGuard } from '@/modules/auth/guards/session.guard'

import { CartController } from './cart.controller'
import { CartService } from './cart.service'

describe('CartController', () => {
	let controller: CartController

	beforeEach(async () => {
		const moduleBuilder = Test.createTestingModule({
			controllers: [CartController],
			providers: [
				{
					provide: CartService,
					useValue: {}
				}
			]
		})

		moduleBuilder.overrideGuard(SessionGuard).useValue({
			canActivate: jest.fn().mockReturnValue(true)
		})

		const module: TestingModule = await moduleBuilder.compile()

		controller = module.get<CartController>(CartController)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})
})

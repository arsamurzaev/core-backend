import { Test, TestingModule } from '@nestjs/testing'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { CartService } from './cart.service'

describe('CartService', () => {
	let service: CartService

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CartService,
				{
					provide: PrismaService,
					useValue: {}
				}
			]
		}).compile()

		service = module.get<CartService>(CartService)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})
})

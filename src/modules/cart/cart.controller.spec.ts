import { Test, TestingModule } from '@nestjs/testing'
import type { Request, Response } from 'express'

import { SessionGuard } from '@/modules/auth/guards/session.guard'

import { CartController } from './cart.controller'
import { CartService } from './cart.service'

describe('CartController', () => {
	let controller: CartController
	let cartService: { getCookieName: jest.Mock }

	beforeEach(async () => {
		cartService = {
			getCookieName: jest.fn().mockReturnValue('cart_token')
		}

		const moduleBuilder = Test.createTestingModule({
			controllers: [CartController],
			providers: [
				{
					provide: CartService,
					useValue: cartService
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

	it('sets cart token cookie without domain on localhost', () => {
		const req = createRequest('localhost:4000')
		const res = createResponse()

		;(controller as any).setTokenCookie(req, res, 'token-1')

		expect(res.cookie).toHaveBeenCalledWith(
			'cart_token',
			'token-1',
			expect.not.objectContaining({ domain: expect.any(String) })
		)
	})

	it('sets cart token cookie with base domain for catalog hosts', () => {
		const req = createRequest('shop.myctlg.ru')
		const res = createResponse()

		;(controller as any).setTokenCookie(req, res, 'token-1')

		expect(res.cookie).toHaveBeenCalledWith(
			'cart_token',
			'token-1',
			expect.objectContaining({ domain: '.myctlg.ru' })
		)
	})
})

function createRequest(host: string): Request {
	return {
		headers: { host }
	} as Request
}

function createResponse(): Response {
	return {
		cookie: jest.fn(),
		clearCookie: jest.fn()
	} as unknown as Response
}

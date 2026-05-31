import { Test, TestingModule } from '@nestjs/testing'
import type { Request, Response } from 'express'

import { SessionGuard } from '@/modules/auth/guards/session.guard'

import { CartController } from './cart.controller'
import { CartService } from './cart.service'

describe('CartController', () => {
	let controller: CartController
	let cartService: { getCookieName: jest.Mock }
	const originalBaseDomains = process.env.CATALOG_BASE_DOMAINS
	const originalPlatformCookieSubdomains = process.env.PLATFORM_COOKIE_SUBDOMAINS

	beforeEach(async () => {
		process.env.CATALOG_BASE_DOMAINS = 'myctlg.ru,myctlg-update.ru'
		process.env.PLATFORM_COOKIE_SUBDOMAINS = 'www,api,admin,app,shtab'

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

	afterEach(() => {
		restoreEnv('CATALOG_BASE_DOMAINS', originalBaseDomains)
		restoreEnv('PLATFORM_COOKIE_SUBDOMAINS', originalPlatformCookieSubdomains)
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

	it('sets cart token cookie without domain for catalog subdomains', () => {
		const req = createRequest('shop.myctlg.ru')
		const res = createResponse()

		;(controller as any).setTokenCookie(req, res, 'token-1')

		expect(res.cookie).toHaveBeenCalledWith(
			'cart_token',
			'token-1',
			expect.not.objectContaining({ domain: expect.any(String) })
		)
	})

	it('sets cart token cookie with base domain for platform hosts', () => {
		const req = createRequest('shtab.myctlg.ru')
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

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name]
		return
	}

	process.env[name] = value
}

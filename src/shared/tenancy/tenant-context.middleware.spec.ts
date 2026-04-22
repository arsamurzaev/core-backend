import type { NextFunction, Request, Response } from 'express'

import { CatalogContextMiddleware } from './tenant-context.middleware'

describe('CatalogContextMiddleware', () => {
	const originalBaseDomains = process.env.CATALOG_BASE_DOMAINS
	const originalReservedSubdomains = process.env.CATALOG_RESERVED_SUBDOMAINS

	afterEach(() => {
		if (originalBaseDomains === undefined) {
			delete process.env.CATALOG_BASE_DOMAINS
		} else {
			process.env.CATALOG_BASE_DOMAINS = originalBaseDomains
		}

		if (originalReservedSubdomains === undefined) {
			delete process.env.CATALOG_RESERVED_SUBDOMAINS
		} else {
			process.env.CATALOG_RESERVED_SUBDOMAINS = originalReservedSubdomains
		}

		jest.clearAllMocks()
	})

	function createRequest(host: string): Request {
		return {
			headers: { host },
			hostname: host,
			originalUrl: '/catalog/current',
			url: '/catalog/current'
		} as unknown as Request
	}

	function createResponse(): Response {
		return {
			setHeader: jest.fn()
		} as unknown as Response
	}

	it('reads catalog base domains at request time', async () => {
		process.env.CATALOG_BASE_DOMAINS = 'myctlg-update.ru'

		const resolver = {
			resolveBySlug: jest.fn().mockResolvedValue({
				catalogId: 'catalog-1',
				slug: 'steepstep',
				typeId: 'type-1'
			}),
			resolveByDomain: jest.fn()
		}
		const middleware = new CatalogContextMiddleware(resolver as any)
		const req = createRequest('steepstep.myctlg-update.ru')
		const next: NextFunction = jest.fn()

		await middleware.use(req, createResponse(), next)

		expect(resolver.resolveBySlug).toHaveBeenCalledWith('steepstep')
		expect(resolver.resolveByDomain).not.toHaveBeenCalled()
		expect((req as any).catalogId).toBe('catalog-1')
		expect(next).toHaveBeenCalledTimes(1)
	})

	it('falls back to resolving by full domain when subdomain slug is missing', async () => {
		process.env.CATALOG_BASE_DOMAINS = 'myctlg-update.ru'

		const resolver = {
			resolveBySlug: jest.fn().mockResolvedValue(null),
			resolveByDomain: jest.fn().mockResolvedValue({
				catalogId: 'catalog-2',
				slug: 'store',
				typeId: 'type-1'
			})
		}
		const middleware = new CatalogContextMiddleware(resolver as any)
		const req = createRequest('steepstep.myctlg-update.ru')

		await middleware.use(req, createResponse(), jest.fn())

		expect(resolver.resolveBySlug).toHaveBeenCalledWith('steepstep')
		expect(resolver.resolveByDomain).toHaveBeenCalledWith(
			'steepstep.myctlg-update.ru'
		)
		expect((req as any).catalogId).toBe('catalog-2')
	})
})

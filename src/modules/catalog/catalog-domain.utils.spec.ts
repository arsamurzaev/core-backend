import {
	isValidPublicHostname,
	normalizeCaddyAskDomain,
	normalizeCustomDomainInput
} from './catalog-domain.utils'

describe('catalog domain utils', () => {
	const originalBaseDomains = process.env.CATALOG_BASE_DOMAINS

	afterEach(() => {
		if (originalBaseDomains === undefined) {
			delete process.env.CATALOG_BASE_DOMAINS
		} else {
			process.env.CATALOG_BASE_DOMAINS = originalBaseDomains
		}
	})

	it('normalizes urls and records whether www was provided', () => {
		expect(normalizeCustomDomainInput('https://www.KingsName.ru/path')).toEqual({
			hostname: 'kingsname.ru',
			inputHadWww: true
		})
	})

	it('rejects platform domains as custom domains', () => {
		process.env.CATALOG_BASE_DOMAINS = 'myctlg-update.ru'

		expect(() => normalizeCustomDomainInput('shop.myctlg-update.ru')).toThrow(
			'Platform domain cannot be attached'
		)
	})

	it('accepts public hostnames and rejects local names', () => {
		expect(isValidPublicHostname('kingsname.ru')).toBe(true)
		expect(isValidPublicHostname('localhost')).toBe(false)
		expect(isValidPublicHostname('shop.local')).toBe(false)
		expect(isValidPublicHostname('service.home.arpa')).toBe(false)
	})

	it('keeps www for Caddy ask checks', () => {
		expect(normalizeCaddyAskDomain('www.kingsname.ru')).toBe('www.kingsname.ru')
	})
})

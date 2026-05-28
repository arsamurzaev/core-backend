import { getSessionCookieNames, resolveCookieDomain } from './auth-cookie.utils'

describe('auth cookie utils', () => {
	const originalBaseDomains = process.env.CATALOG_BASE_DOMAINS
	const originalPlatformCookieSubdomains =
		process.env.PLATFORM_COOKIE_SUBDOMAINS

	beforeEach(() => {
		process.env.CATALOG_BASE_DOMAINS = 'myctlg.ru,myctlg-update.ru'
		process.env.PLATFORM_COOKIE_SUBDOMAINS = 'www,api,admin,app,shtab'
	})

	afterEach(() => {
		restoreEnv('CATALOG_BASE_DOMAINS', originalBaseDomains)
		restoreEnv('PLATFORM_COOKIE_SUBDOMAINS', originalPlatformCookieSubdomains)
	})

	it('does not set a cookie domain for localhost hosts', () => {
		expect(resolveCookieDomain('localhost')).toBeUndefined()
		expect(resolveCookieDomain('localhost:4000')).toBeUndefined()
		expect(resolveCookieDomain('127.0.0.1')).toBeUndefined()
	})

	it('sets shared cookie domain only for platform hosts', () => {
		expect(resolveCookieDomain('myctlg.ru')).toBe('.myctlg.ru')
		expect(resolveCookieDomain('shtab.myctlg.ru')).toBe('.myctlg.ru')
		expect(resolveCookieDomain('api.myctlg.ru')).toBe('.myctlg.ru')
	})

	it('keeps catalog subdomain cookies host-only', () => {
		expect(resolveCookieDomain('shop.myctlg.ru')).toBeUndefined()
		expect(resolveCookieDomain('demo.myctlg.ru')).toBeUndefined()
	})

	it('keeps custom domain cookies host-only', () => {
		expect(resolveCookieDomain('kingsname.ru')).toBeUndefined()
		expect(resolveCookieDomain('shop.kingsname.ru')).toBeUndefined()
	})

	it('uses separate cookie names for global admin sessions', () => {
		expect(getSessionCookieNames()).toEqual({ sid: 'sid', csrf: 'csrf' })
		expect(getSessionCookieNames({ global: true })).toEqual({
			sid: 'asid',
			csrf: 'acrsf'
		})
	})
})

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name]
		return
	}

	process.env[name] = value
}

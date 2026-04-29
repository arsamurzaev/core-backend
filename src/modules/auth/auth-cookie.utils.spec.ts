import { resolveCookieDomain } from './auth-cookie.utils'

describe('auth cookie utils', () => {
	it('does not set a cookie domain for localhost hosts', () => {
		expect(resolveCookieDomain('localhost')).toBeUndefined()
		expect(resolveCookieDomain('localhost:4000')).toBeUndefined()
		expect(resolveCookieDomain('127.0.0.1')).toBeUndefined()
	})
})

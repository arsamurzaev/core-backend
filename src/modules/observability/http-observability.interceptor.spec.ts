import { CallHandler, ExecutionContext, Logger } from '@nestjs/common'
import { lastValueFrom, of } from 'rxjs'

import { HttpObservabilityInterceptor } from './http-observability.interceptor'

describe('HttpObservabilityInterceptor', () => {
	afterEach(() => {
		jest.restoreAllMocks()
	})

	function createContext(req: Record<string, unknown>, res: Record<string, unknown>) {
		return {
			getType: () => 'http',
			switchToHttp: () => ({
				getRequest: () => req,
				getResponse: () => res
			})
		} as unknown as ExecutionContext
	}

	it('logs completed HTTP requests with an expanded message and request fields', async () => {
		const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation()
		const observability = {
			isEnabled: true,
			incrementHttpInFlight: jest.fn(),
			decrementHttpInFlight: jest.fn(),
			recordHttpRequest: jest.fn()
		}
		const req = {
			method: 'GET',
			baseUrl: '/catalog',
			route: { path: '/current' },
			originalUrl: '/catalog/current?type=full',
			url: '/catalog/current?type=full',
			path: '/catalog/current',
			headers: {
				'user-agent': 'jest-agent',
				'x-real-ip': '203.0.113.10',
				referer: 'https://steepstep.myctlg-update.ru/'
			},
			ip: '127.0.0.1',
			socket: {}
		}
		const res = {
			statusCode: 404,
			getHeader: jest.fn().mockReturnValue('128')
		}
		const next: CallHandler = {
			handle: () => of({ ok: true })
		}

		const interceptor = new HttpObservabilityInterceptor(observability as any)

		await lastValueFrom(interceptor.intercept(createContext(req, res), next))

		expect(logSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'http_request_completed',
				message: expect.stringMatching(
					/^GET \/catalog\/current\?type=full -> 404 \(\d+(\.\d+)?ms\)$/
				),
				method: 'GET',
				route: '/catalog/current',
				path: '/catalog/current',
				originalUrl: '/catalog/current?type=full',
				statusCode: 404,
				statusClass: '4xx',
				contentLength: '128',
				clientIp: '203.0.113.10',
				userAgent: 'jest-agent',
				referrer: 'https://steepstep.myctlg-update.ru/'
			})
		)
	})
})

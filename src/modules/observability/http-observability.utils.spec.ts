import type { Request } from 'express'

import {
	normalizeHttpRouteForMetrics,
	shouldSkipHttpObservability,
	statusCodeToClass
} from './http-observability.utils'

function createRequest(partial: Partial<Request>): Request {
	return partial as Request
}

describe('http-observability utils', () => {
	it('prefers the matched express route for low-cardinality metrics', () => {
		const route = normalizeHttpRouteForMetrics(
			createRequest({
				baseUrl: '/catalog',
				route: { path: '/products/:id' } as Request['route']
			})
		)

		expect(route).toBe('/catalog/products/:id')
	})

	it('masks dynamic path segments when route metadata is unavailable', () => {
		const route = normalizeHttpRouteForMetrics(
			createRequest({
				originalUrl: '/product/6fe8d855-82e4-4e95-8f2b-b1200ab29acc'
			})
		)

		expect(route).toBe('/product/:param')
	})

	it('skips scrape noise for the metrics endpoint', () => {
		expect(
			shouldSkipHttpObservability(createRequest({ originalUrl: '/metrics' }))
		).toBe(true)
	})

	it('maps HTTP status codes to Prometheus-friendly classes', () => {
		expect(statusCodeToClass(204)).toBe('2xx')
		expect(statusCodeToClass(404)).toBe('4xx')
		expect(statusCodeToClass(503)).toBe('5xx')
	})
})

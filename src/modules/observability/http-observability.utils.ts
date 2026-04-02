import type { Request } from 'express'

import { resolveObservabilitySettings } from '@/infrastructure/observability/observability.settings'

const observabilitySettings = resolveObservabilitySettings()

function looksDynamicSegment(segment: string): boolean {
	return (
		/^\d+$/.test(segment) ||
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			segment
		) ||
		/^[a-z0-9_-]{24,}$/i.test(segment)
	)
}

export function normalizeHttpRouteForMetrics(req: Request): string {
	const baseUrl = typeof req.baseUrl === 'string' ? req.baseUrl : ''
	const routePath = req.route?.path

	if (typeof routePath === 'string') {
		const normalized = `${baseUrl}${routePath}` || '/'
		return normalized.startsWith('/') ? normalized : `/${normalized}`
	}

	if (Array.isArray(routePath) && routePath.length > 0) {
		const normalized = `${baseUrl}${routePath[0]}` || '/'
		return normalized.startsWith('/') ? normalized : `/${normalized}`
	}

	const path = (req.path || req.originalUrl || '/').split('?')[0] || '/'
	const normalized = path
		.split('/')
		.map(segment => {
			if (!segment) return segment
			return looksDynamicSegment(segment) ? ':param' : segment
		})
		.join('/')

	return normalized.startsWith('/') ? normalized : `/${normalized}`
}

export function shouldSkipHttpObservability(req: Request): boolean {
	const path = (req.originalUrl || req.url || '').split('?')[0] || ''
	return path === observabilitySettings.metricsPath
}

export function statusCodeToClass(statusCode: number): string {
	if (statusCode >= 500) return '5xx'
	if (statusCode >= 400) return '4xx'
	if (statusCode >= 300) return '3xx'
	if (statusCode >= 200) return '2xx'
	return '1xx'
}

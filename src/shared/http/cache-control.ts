import type { Response } from 'express'

export const PUBLIC_CACHE_CONTROL_STANDARD =
	'public, max-age=60, s-maxage=300, stale-while-revalidate=600'

export const PUBLIC_CACHE_CONTROL_SHORT =
	'public, max-age=30, s-maxage=120, stale-while-revalidate=300'

export const PRIVATE_NO_STORE_CACHE_CONTROL = 'private, no-store'

function normalizeHeaderValues(value?: string | string[]): string[] {
	if (!value) return []
	return (Array.isArray(value) ? value : value.split(','))
		.map(item => item.trim())
		.filter(Boolean)
}

export function appendVaryHeader(
	response: Response,
	value: string | string[]
): void {
	const values = new Map<string, string>()
	const current = response.getHeader('Vary')

	for (const item of normalizeHeaderValues(
		typeof current === 'string'
			? current
			: Array.isArray(current)
				? current.filter((entry): entry is string => typeof entry === 'string')
				: undefined
	)) {
		values.set(item.toLowerCase(), item)
	}

	for (const item of normalizeHeaderValues(value)) {
		values.set(item.toLowerCase(), item)
	}

	if (values.size) {
		response.setHeader('Vary', [...values.values()].join(', '))
	}
}

export function setPublicCacheHeaders(
	response: Response,
	cacheControl = PUBLIC_CACHE_CONTROL_STANDARD,
	vary?: string | string[]
): void {
	response.setHeader('Cache-Control', cacheControl)
	if (vary) {
		appendVaryHeader(response, vary)
	}
}

export function setPrivateNoStoreHeaders(
	response: Response,
	vary?: string | string[]
): void {
	response.setHeader('Cache-Control', PRIVATE_NO_STORE_CACHE_CONTROL)
	if (vary) {
		appendVaryHeader(response, vary)
	}
}

export function setUserAwarePublicCacheHeaders(
	response: Response,
	options?: {
		isPrivate?: boolean
		publicCacheControl?: string
		vary?: string | string[]
	}
): void {
	const {
		isPrivate = false,
		publicCacheControl = PUBLIC_CACHE_CONTROL_SHORT,
		vary = 'Cookie'
	} = options ?? {}

	if (isPrivate) {
		setPrivateNoStoreHeaders(response, vary)
		return
	}

	setPublicCacheHeaders(response, publicCacheControl, vary)
}

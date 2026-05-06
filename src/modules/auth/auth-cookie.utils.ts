import type { Request, Response } from 'express'

const SID_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'sid'
const CSRF_COOKIE = process.env.CSRF_COOKIE_NAME ?? 'csrf'
const ADMIN_SID_COOKIE = process.env.ADMIN_SESSION_COOKIE_NAME ?? 'asid'
const ADMIN_CSRF_COOKIE = process.env.ADMIN_CSRF_COOKIE_NAME ?? 'acrsf'
const LEGACY_CATALOG_SID_COOKIE_PREFIX = 'catalog_sid'
const LEGACY_CATALOG_CSRF_COOKIE_PREFIX = 'catalog_csrf'
const SAME_SITE = (process.env.COOKIE_SAMESITE ?? 'lax') as 'strict' | 'lax'
const isProd = process.env.NODE_ENV === 'production'
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7

function parseCsv(value: string | undefined, fallback: string[]): string[] {
	return (value ?? fallback.join(','))
		.split(',')
		.map(s => s.trim().toLowerCase())
		.filter(Boolean)
}

const BASE_DOMAINS = (
	process.env.CATALOG_BASE_DOMAINS ?? 'myctlg.ru,myctlg-update.ru'
)
	.split(',')
	.map(s => s.trim().toLowerCase())
	.filter(Boolean)
const PLATFORM_COOKIE_SUBDOMAINS = new Set(
	parseCsv(process.env.PLATFORM_COOKIE_SUBDOMAINS, [
		'www',
		'api',
		'admin',
		'app',
		'shtab'
	])
)

export function resolveServerHost(req: { headers: { host?: string } }): string {
	return (req.headers.host ?? '').split(':')[0] ?? ''
}

export function resolveCookieDomain(host: string): string | undefined {
	if (!host) return undefined
	const h = host.toLowerCase().split(':')[0] ?? ''
	if (isLocalCookieHost(h)) return undefined
	for (const base of BASE_DOMAINS) {
		if (h === base) return '.' + base
		if (isPlatformCookieSubdomain(h, base)) return '.' + base
	}
	// Каталожные поддомены и кастомные домены должны получать host-only cookies.
	return undefined
}

function isPlatformCookieSubdomain(host: string, base: string): boolean {
	if (!host.endsWith('.' + base)) return false
	const left = host.slice(0, -(base.length + 1))
	if (!left || left.includes('.')) return false
	return PLATFORM_COOKIE_SUBDOMAINS.has(left)
}

function isLocalCookieHost(host: string): boolean {
	if (!host) return true
	if (host === 'localhost' || host.endsWith('.localhost')) return true
	if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return true
	if (host === '[::1]' || host === '::1') return true
	return false
}

export type SessionCookieScope = {
	catalogId?: string | null
	global?: boolean
}

export type SessionCookieNames = {
	sid: string
	csrf: string
}

export type ResolvedSessionCookies = {
	sid: string | null
	csrf: string | null
	names: SessionCookieNames
	scope: SessionCookieScope | null
}

export function getSessionCookieNames(
	scope?: SessionCookieScope | null
): SessionCookieNames {
	if (scope?.global) {
		return { sid: ADMIN_SID_COOKIE, csrf: ADMIN_CSRF_COOKIE }
	}
	return { sid: SID_COOKIE, csrf: CSRF_COOKIE }
}

export function getSessionCookie(
	req: Request,
	scope?: SessionCookieScope | null
): string | null {
	return readSessionCookies(req, scope).sid
}

export function readSessionCookies(
	req: Request,
	scope?: SessionCookieScope | null
): ResolvedSessionCookies {
	const primaryNames = getSessionCookieNames(scope)
	const primarySid = getCookie(req, primaryNames.sid)
	if (primarySid) {
		return {
			sid: primarySid,
			csrf: getCookie(req, primaryNames.csrf) ?? null,
			names: primaryNames,
			scope: scope?.global ? { global: true } : null
		}
	}

	const fallbackScope = scope?.global ? null : { global: true }
	const fallbackNames = getSessionCookieNames(fallbackScope)
	return {
		sid: getCookie(req, fallbackNames.sid) ?? null,
		csrf: getCookie(req, fallbackNames.csrf) ?? null,
		names: fallbackNames,
		scope: fallbackScope
	}
}

export function setSessionCookies(
	res: Response,
	session: { sid: string; csrf: string },
	cookieDomain?: string,
	scope?: SessionCookieScope | null
): void {
	const names = getSessionCookieNames(scope)
	const effectiveDomain = scope?.global ? cookieDomain : undefined

	res.cookie(names.sid, session.sid, {
		httpOnly: true,
		sameSite: SAME_SITE,
		secure: isProd,
		path: '/',
		maxAge: SESSION_MAX_AGE_MS,
		...(effectiveDomain ? { domain: effectiveDomain } : {})
	})
	res.cookie(names.csrf, session.csrf, {
		httpOnly: false,
		sameSite: SAME_SITE,
		secure: isProd,
		path: '/',
		maxAge: SESSION_MAX_AGE_MS,
		...(effectiveDomain ? { domain: effectiveDomain } : {})
	})
}

export function clearSessionCookies(
	res: Response,
	cookieDomain?: string,
	scope?: SessionCookieScope | null
): void {
	const names = getSessionCookieNames()
	const scopedNames = scope?.global ? getSessionCookieNames(scope) : names
	const effectiveDomain = scope?.global ? cookieDomain : undefined

	res.clearCookie(scopedNames.sid, {
		path: '/',
		sameSite: SAME_SITE,
		secure: isProd,
		...(effectiveDomain ? { domain: effectiveDomain } : {})
	})
	res.clearCookie(scopedNames.csrf, {
		path: '/',
		sameSite: SAME_SITE,
		secure: isProd,
		...(effectiveDomain ? { domain: effectiveDomain } : {})
	})

	const legacyCatalogId = normalizeCookieSegment(scope?.catalogId)
	if (!legacyCatalogId) return

	for (const legacyName of [
		`${LEGACY_CATALOG_SID_COOKIE_PREFIX}_${legacyCatalogId}`,
		`${LEGACY_CATALOG_CSRF_COOKIE_PREFIX}_${legacyCatalogId}`
	]) {
		res.clearCookie(legacyName, {
			path: '/',
			sameSite: SAME_SITE,
			secure: isProd,
			...(cookieDomain ? { domain: cookieDomain } : {})
		})
	}
}

function getCookie(req: Request, name: string): string | undefined {
	const header = req.headers.cookie
	if (!header) return undefined
	for (const part of header.split(';')) {
		const [key, ...rest] = part.trim().split('=')
		if (key === name) return decodeURIComponent(rest.join('='))
	}
	return undefined
}

function normalizeCookieSegment(value?: string | null): string | null {
	const normalized = (value ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '_')
	return normalized || null
}

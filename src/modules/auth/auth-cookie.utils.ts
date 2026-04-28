import type { Request, Response } from 'express'

const SID_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'sid'
const CSRF_COOKIE = process.env.CSRF_COOKIE_NAME ?? 'csrf'
const CATALOG_SID_COOKIE_PREFIX =
	process.env.CATALOG_SESSION_COOKIE_PREFIX ?? 'catalog_sid'
const CATALOG_CSRF_COOKIE_PREFIX =
	process.env.CATALOG_CSRF_COOKIE_PREFIX ?? 'catalog_csrf'
const SAME_SITE = (process.env.COOKIE_SAMESITE ?? 'lax') as 'strict' | 'lax'
const isProd = process.env.NODE_ENV === 'production'
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7

const BASE_DOMAINS = (process.env.CATALOG_BASE_DOMAINS ?? 'myctlg.ru')
	.split(',')
	.map(s => s.trim().toLowerCase())
	.filter(Boolean)

export function resolveCookieDomain(host: string): string | undefined {
	if (!host) return undefined
	const h = host.toLowerCase()
	for (const base of BASE_DOMAINS) {
		if (h === base || h.endsWith('.' + base)) return '.' + base
	}
	// кастомный домен — берём eTLD+1
	const parts = h.split('.')
	if (parts.length >= 2) return '.' + parts.slice(-2).join('.')
	return undefined
}

export type SessionCookieScope = {
	catalogId?: string | null
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
	const catalogId = normalizeCookieSegment(scope?.catalogId)
	if (!catalogId) {
		return { sid: SID_COOKIE, csrf: CSRF_COOKIE }
	}

	return {
		sid: `${CATALOG_SID_COOKIE_PREFIX}_${catalogId}`,
		csrf: `${CATALOG_CSRF_COOKIE_PREFIX}_${catalogId}`
	}
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
	const scopedNames = scope?.catalogId ? getSessionCookieNames(scope) : null

	if (scopedNames) {
		const sid = getCookie(req, scopedNames.sid)
		if (sid) {
			return {
				sid,
				csrf: getCookie(req, scopedNames.csrf) ?? null,
				names: scopedNames,
				scope
			}
		}
	}

	const names = getSessionCookieNames()
	return {
		sid: getCookie(req, names.sid) ?? null,
		csrf: getCookie(req, names.csrf) ?? null,
		names,
		scope: null
	}
}

export function setSessionCookies(
	res: Response,
	session: { sid: string; csrf: string },
	cookieDomain?: string,
	scope?: SessionCookieScope | null
): void {
	const names = getSessionCookieNames(scope)

	res.cookie(names.sid, session.sid, {
		httpOnly: true,
		sameSite: SAME_SITE,
		secure: isProd,
		path: '/',
		maxAge: SESSION_MAX_AGE_MS,
		...(cookieDomain ? { domain: cookieDomain } : {})
	})
	res.cookie(names.csrf, session.csrf, {
		httpOnly: false,
		sameSite: SAME_SITE,
		secure: isProd,
		path: '/',
		maxAge: SESSION_MAX_AGE_MS,
		...(cookieDomain ? { domain: cookieDomain } : {})
	})
}

export function clearSessionCookies(
	res: Response,
	cookieDomain?: string,
	scope?: SessionCookieScope | null
): void {
	const names = getSessionCookieNames(scope)

	res.clearCookie(names.sid, {
		path: '/',
		sameSite: SAME_SITE,
		secure: isProd,
		...(cookieDomain ? { domain: cookieDomain } : {})
	})
	res.clearCookie(names.csrf, {
		path: '/',
		sameSite: SAME_SITE,
		secure: isProd,
		...(cookieDomain ? { domain: cookieDomain } : {})
	})
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

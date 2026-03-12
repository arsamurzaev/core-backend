import type { Request, Response } from 'express'

const SID_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'sid'
const CSRF_COOKIE = process.env.CSRF_COOKIE_NAME ?? 'csrf'
const SAME_SITE = (process.env.COOKIE_SAMESITE ?? 'lax') as 'strict' | 'lax'
const isProd = process.env.NODE_ENV === 'production'
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7

export function getSessionCookie(req: Request): string | null {
	return getCookie(req, SID_COOKIE) ?? null
}

export function setSessionCookies(
	res: Response,
	session: { sid: string; csrf: string }
): void {
	res.cookie(SID_COOKIE, session.sid, {
		httpOnly: true,
		sameSite: SAME_SITE,
		secure: isProd,
		path: '/',
		maxAge: SESSION_MAX_AGE_MS
	})
	res.cookie(CSRF_COOKIE, session.csrf, {
		httpOnly: false,
		sameSite: SAME_SITE,
		secure: isProd,
		path: '/',
		maxAge: SESSION_MAX_AGE_MS
	})
}

export function clearSessionCookies(res: Response): void {
	res.clearCookie(SID_COOKIE, {
		path: '/',
		sameSite: SAME_SITE,
		secure: isProd
	})
	res.clearCookie(CSRF_COOKIE, {
		path: '/',
		sameSite: SAME_SITE,
		secure: isProd
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

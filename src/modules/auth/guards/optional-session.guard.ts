import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import type { Response } from 'express'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { RequestContext } from '@/shared/tenancy/request-context'

import { resolveCookieDomain } from '../auth-cookie.utils'
import { SessionService } from '../session/session.service'
import type { AuthRequest } from '../types/auth-request'

const SID_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'sid'
const CSRF_COOKIE = process.env.CSRF_COOKIE_NAME ?? 'csrf'
const SAME_SITE = (process.env.COOKIE_SAMESITE ?? 'lax') as 'strict' | 'lax'
const isProd = process.env.NODE_ENV === 'production'
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7
function parseCookie(
	header: string | undefined,
	name: string
): string | undefined {
	if (!header) return undefined
	for (const part of header.split(';')) {
		const [key, ...rest] = part.trim().split('=')
		if (key === name) return decodeURIComponent(rest.join('='))
	}
	return undefined
}

function clearSessionCookies(res: Response | undefined, cookieDomain?: string): void {
	if (!res?.clearCookie) return
	const opts = {
		path: '/' as const,
		sameSite: SAME_SITE,
		secure: isProd,
		...(cookieDomain ? { domain: cookieDomain } : {})
	}
	res.clearCookie(SID_COOKIE, opts)
	res.clearCookie(CSRF_COOKIE, opts)
}

@Injectable()
export class OptionalSessionGuard implements CanActivate {
	constructor(
		private readonly sessions: SessionService,
		private readonly prisma: PrismaService
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const http = context.switchToHttp()
		const req = http.getRequest<AuthRequest>()
		const res = http.getResponse<Response>()
		const sid = parseCookie(req.headers.cookie, SID_COOKIE)

		if (!sid) return true

		try {
			const session = await this.sessions.get(sid)
			if (!session?.userId) {
				clearSessionCookies(res, resolveCookieDomain(RequestContext.get()?.host ?? ''))
				return true
			}

			const user = await this.prisma.user.findFirst({
				where: { id: session.userId, deleteAt: null },
				select: { id: true, role: true, login: true, name: true }
			})
			if (!user) {
				clearSessionCookies(res, resolveCookieDomain(RequestContext.get()?.host ?? ''))
				return true
			}

			req.user = user
			req.sessionId = sid

			try {
				await this.sessions.touch(sid, session.userId)
			} catch {
				// no-op: optional auth should not block public reads
			}

			const cookieDomain = resolveCookieDomain(RequestContext.get()?.host ?? '')
			if (res?.cookie) {
				res.cookie(SID_COOKIE, sid, {
					httpOnly: true,
					sameSite: SAME_SITE,
					secure: isProd,
					path: '/',
					maxAge: SESSION_MAX_AGE_MS,
					...(cookieDomain ? { domain: cookieDomain } : {})
				})
				res.cookie(CSRF_COOKIE, session.csrf, {
					httpOnly: false,
					sameSite: SAME_SITE,
					secure: isProd,
					path: '/',
					maxAge: SESSION_MAX_AGE_MS,
					...(cookieDomain ? { domain: cookieDomain } : {})
				})
			}
		} catch {
			clearSessionCookies(res, resolveCookieDomain(RequestContext.get()?.host ?? ''))
		}

		return true
	}
}

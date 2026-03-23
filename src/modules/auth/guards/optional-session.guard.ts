import {
	CanActivate,
	ExecutionContext,
	Injectable
} from '@nestjs/common'
import type { Response } from 'express'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { SessionService } from '../session/session.service'
import type { AuthRequest } from '../types/auth-request'

const SID_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'sid'
const CSRF_COOKIE = process.env.CSRF_COOKIE_NAME ?? 'csrf'
const SAME_SITE = (process.env.COOKIE_SAMESITE ?? 'lax') as 'strict' | 'lax'
const isProd = process.env.NODE_ENV === 'production'
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7
const CLEAR_COOKIE_OPTIONS = {
	path: '/',
	sameSite: SAME_SITE,
	secure: isProd
} as const

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

function clearSessionCookies(res: Response | undefined): void {
	if (!res?.clearCookie) return

	res.clearCookie(SID_COOKIE, CLEAR_COOKIE_OPTIONS)
	res.clearCookie(CSRF_COOKIE, CLEAR_COOKIE_OPTIONS)
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
				clearSessionCookies(res)
				return true
			}

			const user = await this.prisma.user.findFirst({
				where: { id: session.userId, deleteAt: null },
				select: { id: true, role: true, login: true, name: true }
			})
			if (!user) {
				clearSessionCookies(res)
				return true
			}

			req.user = user
			req.sessionId = sid

			try {
				await this.sessions.touch(sid, session.userId)
			} catch {
				// no-op: optional auth should not block public reads
			}

			if (res?.cookie) {
				res.cookie(SID_COOKIE, sid, {
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
		} catch {
			clearSessionCookies(res)
		}

		return true
	}
}

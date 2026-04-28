import { Role } from '@generated/enums'
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import type { Response } from 'express'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { RequestContext } from '@/shared/tenancy/request-context'

import {
	clearSessionCookies,
	readSessionCookies,
	resolveCookieDomain,
	type SessionCookieScope,
	setSessionCookies
} from '../auth-cookie.utils'
import { SessionService } from '../session/session.service'
import type { AuthRequest } from '../types/auth-request'

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
		let activeCookieScope = this.resolveCookieScope()
		const sessionCookies = readSessionCookies(req, activeCookieScope)
		activeCookieScope = sessionCookies.scope
		const sid = sessionCookies.sid

		if (!sid) return true

		try {
			const session = await this.sessions.get(sid)
			if (!session?.userId) {
				clearSessionCookies(
					res,
					resolveCookieDomain(RequestContext.get()?.host ?? ''),
					sessionCookies.scope
				)
				return true
			}

			const user = await this.prisma.user.findFirst({
				where: { id: session.userId, deleteAt: null },
				select: { id: true, role: true, login: true, name: true }
			})
			if (!user) {
				clearSessionCookies(
					res,
					resolveCookieDomain(RequestContext.get()?.host ?? ''),
					sessionCookies.scope
				)
				return true
			}
			if (
				!this.isSessionInCurrentCatalogScope(
					user.role,
					session.context?.catalogId ?? null
				)
			) {
				clearSessionCookies(
					res,
					resolveCookieDomain(RequestContext.get()?.host ?? ''),
					sessionCookies.scope
				)
				return true
			}

			req.user = user
			req.sessionId = sid
			req.session = session

			try {
				await this.sessions.touch(sid, session.userId)
			} catch {
				// no-op: optional auth should not block public reads
			}

			const cookieDomain = resolveCookieDomain(RequestContext.get()?.host ?? '')
			if (res?.cookie) {
				const responseCookieScope =
					user.role === Role.CATALOG && session.context?.catalogId
						? { catalogId: session.context.catalogId }
						: sessionCookies.scope
				setSessionCookies(
					res,
					{ sid, csrf: session.csrf },
					cookieDomain,
					responseCookieScope
				)
			}
		} catch {
			clearSessionCookies(
				res,
				resolveCookieDomain(RequestContext.get()?.host ?? ''),
				activeCookieScope
			)
		}

		return true
	}

	private resolveCookieScope(): SessionCookieScope | null {
		const catalogId = RequestContext.get()?.catalogId ?? null
		return catalogId ? { catalogId } : null
	}

	private isSessionInCurrentCatalogScope(
		role: Role,
		sessionCatalogId: string | null
	): boolean {
		if (role === Role.ADMIN || role !== Role.CATALOG) return true

		const currentCatalogId = RequestContext.get()?.catalogId ?? null
		return Boolean(
			sessionCatalogId && currentCatalogId && sessionCatalogId === currentCatalogId
		)
	}
}

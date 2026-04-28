import { Role } from '@generated/client'
import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
	UnauthorizedException
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Response } from 'express'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { IS_PUBLIC_KEY } from '@/shared/http/decorators/public.decorator'
import { RequestContext } from '@/shared/tenancy/request-context'

import {
	clearSessionCookies,
	readSessionCookies,
	resolveCookieDomain,
	type SessionCookieScope,
	setSessionCookies
} from '../auth-cookie.utils'
import { ROLES_KEY } from '../decorators/roles.decorator'
import { SessionService } from '../session/session.service'
import type { AuthRequest } from '../types/auth-request'

function isUnsafeMethod(method: string | undefined) {
	const m = (method ?? 'GET').toUpperCase()
	return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE'
}

// Иерархия ролей: ADMIN > CATALOG > USER
const ROLE_RANK: Record<Role, number> = {
	ADMIN: 3,
	CATALOG: 2,
	USER: 1
}

function requiredRank(required: Role[]) {
	// Берём максимальный уровень роли среди требуемых
	return Math.max(...required.map(r => ROLE_RANK[r] ?? 999))
}

@Injectable()
export class SessionGuard implements CanActivate {
	constructor(
		private readonly sessions: SessionService,
		private readonly prisma: PrismaService,
		private readonly reflector: Reflector
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
			context.getHandler(),
			context.getClass()
		])
		if (isPublic) return true

		const http = context.switchToHttp()
		const req = http.getRequest<AuthRequest>()
		const res = http.getResponse<Response>()
		let activeCookieScope = this.resolveCookieScope()

		try {
			const sessionCookies = readSessionCookies(req, activeCookieScope)
			activeCookieScope = sessionCookies.scope
			const sid = sessionCookies.sid

			if (!sid) throw new UnauthorizedException('Не авторизован')

			const session = await this.sessions.get(sid)
			if (!session?.userId) {
				throw new UnauthorizedException('Сессия недействительна')
			}

			// CSRF проверяем только для небезопасных методов
			if (isUnsafeMethod(req.method)) {
				const csrfHeader = String(req.headers['x-csrf-token'] ?? '')
				const csrfCookie = sessionCookies.csrf ?? ''

				if (!csrfHeader || !csrfCookie) {
					throw new ForbiddenException('CSRF токен обязателен')
				}
				if (csrfHeader !== csrfCookie || csrfHeader !== session.csrf) {
					throw new ForbiddenException('CSRF токен недействителен')
				}
			}

			const user = await this.prisma.user.findFirst({
				where: { id: session.userId, deleteAt: null },
				select: { id: true, role: true, login: true, name: true }
			})
			if (!user) throw new UnauthorizedException('Пользователь не найден')
			this.assertCatalogSessionScope(user.role, session.context?.catalogId ?? null)
			req.user = user
			req.sessionId = sid
			req.session = session

			// Roles(...) учитываем с иерархией ролей
			const required =
				this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
					context.getHandler(),
					context.getClass()
				]) ?? []

			if (required.length > 0) {
				const need = requiredRank(required)
				const have = ROLE_RANK[user.role]
				if (have < need) throw new ForbiddenException('Недостаточно прав')
			}
			try {
				await this.sessions.touch(sid, session.userId)
			} catch {
				// no-op: do not block request if refresh fails
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
			return true
		} catch (error: unknown) {
			if (
				error instanceof UnauthorizedException ||
				error instanceof ForbiddenException
			) {
				clearSessionCookies(
					res,
					resolveCookieDomain(RequestContext.get()?.host ?? ''),
					activeCookieScope
				)
			}
			throw error
		}
	}

	private resolveCookieScope(): SessionCookieScope | null {
		const catalogId = RequestContext.get()?.catalogId ?? null
		return catalogId ? { catalogId } : null
	}

	private assertCatalogSessionScope(
		role: Role,
		sessionCatalogId: string | null
	): void {
		if (role === Role.ADMIN || role !== Role.CATALOG) return

		const currentCatalogId = RequestContext.get()?.catalogId ?? null
		if (!sessionCatalogId || !currentCatalogId) {
			throw new ForbiddenException('Сессия не привязана к этому каталогу')
		}
		if (sessionCatalogId !== currentCatalogId) {
			throw new ForbiddenException('Сессия не для этого каталога')
		}
	}
}

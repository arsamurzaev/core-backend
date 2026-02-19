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

import { ROLES_KEY } from '../decorators/roles.decorator'
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
		const [k, ...rest] = part.trim().split('=')
		if (k === name) return decodeURIComponent(rest.join('='))
	}
	return undefined
}

function isUnsafeMethod(method: string | undefined) {
	const m = (method ?? 'GET').toUpperCase()
	return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE'
}

// Иерархия: ADMIN > CATALOG > USER
const ROLE_RANK: Record<Role, number> = {
	ADMIN: 3,
	CATALOG: 2,
	USER: 1
}

function requiredRank(required: Role[]) {
	// требуем “самое строгое” из перечисленных
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

		const sid = parseCookie(req.headers.cookie, SID_COOKIE)

		if (!sid) throw new UnauthorizedException('Не авторизован')

		const session = await this.sessions.get(sid)
		if (!session?.userId)
			throw new UnauthorizedException('Сессия недействительна')

		// CSRF (только unsafe методы)
		if (isUnsafeMethod(req.method)) {
			const csrfHeader = String(req.headers['x-csrf-token'] ?? '')
			const csrfCookie = parseCookie(req.headers.cookie, CSRF_COOKIE) ?? ''

			if (!csrfHeader || !csrfCookie)
				throw new ForbiddenException('CSRF токен отсутствует')
			if (csrfHeader !== csrfCookie || csrfHeader !== session.csrf) {
				throw new ForbiddenException('CSRF токен недействителен')
			}
		}

		const user = await this.prisma.user.findFirst({
			where: { id: session.userId, deleteAt: null },
			select: { id: true, role: true, login: true, name: true }
		})
		if (!user) throw new UnauthorizedException('Пользователь не найден')
		req.user = user
		req.sessionId = sid

		// Roles(...) с иерархией
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
		return true
	}
}

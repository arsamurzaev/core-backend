import { Role } from '@generated/client'
import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
	UnauthorizedException
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { ROLES_KEY } from '../decorators/roles.decorator'
import { SessionService } from '../session/session.service'

const SID_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'sid'
const CSRF_COOKIE = process.env.CSRF_COOKIE_NAME ?? 'csrf'

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

// Иерархия: ADMIN > CATALOG_OWNER > USER
const ROLE_RANK: Record<Role, number> = {
	ADMIN: 3,
	CATALOG_OWNER: 2,
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
		const req = context.switchToHttp().getRequest<Request>()

		const sid =
			(req as any).cookies?.[SID_COOKIE] ??
			parseCookie(req.headers.cookie, SID_COOKIE)

		if (!sid) throw new UnauthorizedException('Не авторизован')

		const session = await this.sessions.get(sid)
		if (!session?.userId)
			throw new UnauthorizedException('Сессия недействительна')

		// CSRF (только unsafe методы)
		if (isUnsafeMethod(req.method)) {
			const csrfHeader = String(req.headers['x-csrf-token'] ?? '')
			const csrfCookie =
				(req as any).cookies?.[CSRF_COOKIE] ??
				parseCookie(req.headers.cookie, CSRF_COOKIE) ??
				''

			if (!csrfHeader || !csrfCookie)
				throw new ForbiddenException('CSRF token missing')
			if (csrfHeader !== csrfCookie || csrfHeader !== session.csrf) {
				throw new ForbiddenException('CSRF token invalid')
			}
		}

		const user = await this.prisma.user.findFirst({
			where: { id: session.userId, deleteAt: null },
			select: { id: true, role: true, login: true, name: true }
		})
		if (!user) throw new UnauthorizedException('Пользователь не найден')
		;(req as any).user = user
		;(req as any).sessionId = sid


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

		// доступ к каталогу
		if (user.role === Role.ADMIN) return true


		// USER в каталог-админку не пускаем (без таблиц доступа иначе невозможно контролировать)
		throw new ForbiddenException('Нет доступа')
	}
}

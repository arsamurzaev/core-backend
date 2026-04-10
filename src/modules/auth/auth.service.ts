import { Role } from '@generated/enums'
import {
	ForbiddenException,
	HttpException,
	HttpStatus,
	Injectable,
	Logger,
	UnauthorizedException
} from '@nestjs/common'
import { verify } from 'argon2'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { ObservabilityService } from '@/modules/observability/observability.service'

import { LoginDtoReq } from './dto/requests/login.dto.req'
import { SessionService } from './session/session.service'

const LOCKOUT_MAX_ATTEMPTS = 20
const LOCKOUT_WINDOW_SEC = 900
const LOCKOUT_DURATION_SEC = 1800

type LoginMeta = {
	ip?: string | null
	userAgent?: string | null
}

type AuthFailureReason =
	| 'none'
	| 'credentials'
	| 'access'
	| 'token'
	| 'session'
	| 'not_found'
	| 'other'

@Injectable()
export class AuthService {
	private readonly logger = new Logger(AuthService.name)

	constructor(
		private readonly prisma: PrismaService,
		private readonly sessions: SessionService,
		private readonly observability: ObservabilityService,
		private readonly redis: RedisService
	) {}

	private lockoutKey(ip: string) {
		return `auth:lock:${ip}`
	}

	private failKey(ip: string) {
		return `auth:fail:${ip}`
	}

	private async checkLockout(ip: string | null | undefined) {
		if (!ip) return
		const locked = await this.redis.exists(this.lockoutKey(ip))
		if (locked) {
			const ttl = await this.redis.ttl(this.lockoutKey(ip))
			throw new HttpException(
				`Слишком много попыток входа. Попробуйте через ${Math.ceil(ttl / 60)} мин.`,
				HttpStatus.TOO_MANY_REQUESTS
			)
		}
	}

	private async recordFailedAttempt(ip: string | null | undefined) {
		if (!ip) return
		const key = this.failKey(ip)
		const count = await this.redis.incr(key)
		if (count === 1) await this.redis.expire(key, LOCKOUT_WINDOW_SEC)
		if (count >= LOCKOUT_MAX_ATTEMPTS) {
			await this.redis.set(this.lockoutKey(ip), '1', 'EX', LOCKOUT_DURATION_SEC)
			await this.redis.del(key)
		}
	}

	private async clearFailedAttempts(ip: string | null | undefined) {
		if (!ip) return
		await this.redis.del(this.failKey(ip))
	}

	async createSessionForUser(
		userId: string,
		meta?: LoginMeta,
		catalogId?: string | null,
		existingSid?: string | null
	) {
		const reuse = await this.tryReuseSession(
			existingSid ?? null,
			userId,
			catalogId ?? null
		)
		if (reuse) {
			return { ...reuse, reused: true }
		}

		const { sid, csrf } = await this.sessions.createForUser(userId, {
			meta: { ...meta, catalogId: catalogId ?? null }
		})
		return { sid, csrf, reused: false }
	}

	private async tryReuseSession(
		existingSid: string | null,
		userId: string,
		catalogId: string | null
	) {
		const sid = (existingSid ?? '').trim()
		if (!sid) return null

		const session = await this.sessions.get(sid)
		if (!session?.userId) return null
		if (session.userId !== userId) return null

		const existingCatalogId = session.context?.catalogId ?? null
		if (existingCatalogId !== (catalogId ?? null)) return null

		await this.sessions.touch(sid, userId)
		return { sid, csrf: session.csrf }
	}

	private async validateUser(dto: LoginDtoReq) {
		const { login, password } = dto

		const user = await this.prisma.user.findFirst({
			where: { login, deleteAt: null },
			select: { id: true, login: true, name: true, role: true, password: true }
		})

		if (!user?.password) {
			throw new UnauthorizedException('Неверные учётные данные')
		}

		const ok = await verify(user.password, password)
		if (!ok) {
			throw new UnauthorizedException('Неверные учётные данные')
		}

		return { id: user.id, login: user.login, name: user.name, role: user.role }
	}

	async login(dto: LoginDtoReq, meta?: LoginMeta, existingSid?: string | null) {
		await this.checkLockout(meta?.ip)
		try {
			const user = await this.validateUser(dto)
			const { sid, csrf, reused } = await this.createSessionForUser(
				user.id,
				meta,
				null,
				existingSid ?? null
			)

			await this.clearFailedAttempts(meta?.ip)
			this.recordAuthSuccess('admin', 'login', user.id, meta, {
				role: user.role,
				sessionReused: reused
			})

			return { sid, csrf, user }
		} catch (error) {
			if (error instanceof UnauthorizedException) {
				await this.recordFailedAttempt(meta?.ip)
			}
			this.recordAuthFailure(
				'admin',
				'login',
				this.resolveAuthFailureReason(error),
				meta
			)
			throw error
		}
	}

	async loginForCatalog(
		dto: LoginDtoReq,
		catalogId: string,
		ownerUserId?: string | null,
		meta?: LoginMeta,
		existingSid?: string | null
	) {
		await this.checkLockout(meta?.ip)
		try {
			const user = await this.validateUser(dto)
			await this.assertCatalogAccess(
				user.id,
				user.role,
				catalogId,
				ownerUserId ?? null
			)

			const { sid, csrf, reused } = await this.createSessionForUser(
				user.id,
				meta,
				catalogId,
				existingSid ?? null
			)

			await this.clearFailedAttempts(meta?.ip)
			this.recordAuthSuccess('catalog', 'login', user.id, meta, {
				role: user.role,
				catalogId,
				sessionReused: reused
			})

			return { sid, csrf, user, catalogId }
		} catch (error) {
			if (error instanceof UnauthorizedException) {
				await this.recordFailedAttempt(meta?.ip)
			}
			this.recordAuthFailure(
				'catalog',
				'login',
				this.resolveAuthFailureReason(error),
				meta,
				{ catalogId }
			)
			throw error
		}
	}

	async assertCatalogAccess(
		userId: string,
		role: Role,
		catalogId: string,
		ownerUserId?: string | null
	): Promise<void> {
		if (role !== Role.CATALOG && role !== Role.ADMIN) {
			throw new ForbiddenException('Нет прав на вход в каталог')
		}
		if (role === Role.ADMIN) return

		const ownerId = await this.resolveCatalogOwnerId(
			catalogId,
			ownerUserId ?? null
		)
		if (!ownerId || ownerId !== userId) {
			throw new ForbiddenException('Нет прав для этого каталога')
		}
	}

	private async resolveCatalogOwnerId(
		catalogId: string,
		ownerUserId: string | null
	): Promise<string | null> {
		if (ownerUserId) return ownerUserId

		const catalog = await this.prisma.catalog.findUnique({
			where: { id: catalogId },
			select: { userId: true }
		})
		return catalog?.userId ?? null
	}

	private recordAuthSuccess(
		flow: 'admin' | 'catalog',
		action: 'login',
		userId: string,
		meta?: LoginMeta,
		extra?: {
			role?: Role
			catalogId?: string | null
			sessionReused?: boolean
		}
	) {
		this.observability.recordAuthEvent(flow, action, 'success', 'none')
		this.logger.log({
			event: 'auth_event',
			flow,
			action,
			outcome: 'success',
			reason: 'none',
			userId,
			role: extra?.role ?? null,
			catalogId: extra?.catalogId ?? null,
			sessionReused: extra?.sessionReused ?? false,
			clientIp: meta?.ip ?? null,
			userAgent: meta?.userAgent ?? null
		} as any)
	}

	private recordAuthFailure(
		flow: 'admin' | 'catalog',
		action: 'login',
		reason: AuthFailureReason,
		meta?: LoginMeta,
		extra?: { catalogId?: string | null }
	) {
		this.observability.recordAuthEvent(flow, action, 'failure', reason)
		this.logger.warn({
			event: 'auth_event',
			flow,
			action,
			outcome: 'failure',
			reason,
			catalogId: extra?.catalogId ?? null,
			clientIp: meta?.ip ?? null,
			userAgent: meta?.userAgent ?? null
		} as any)
	}

	private resolveAuthFailureReason(error: unknown): AuthFailureReason {
		if (error instanceof UnauthorizedException) {
			return 'credentials'
		}
		if (error instanceof ForbiddenException) {
			return 'access'
		}

		return 'other'
	}
}

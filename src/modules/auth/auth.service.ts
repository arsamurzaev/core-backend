import { Role } from '@generated/enums'
import {
	ForbiddenException,
	Injectable,
	Logger,
	UnauthorizedException
} from '@nestjs/common'
import { verify } from 'argon2'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { ObservabilityService } from '@/modules/observability/observability.service'

import { LoginDtoReq } from './dto/requests/login.dto.req'
import { SessionService } from './session/session.service'

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
		private readonly observability: ObservabilityService
	) {}

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
		try {
			const user = await this.validateUser(dto)
			const { sid, csrf, reused } = await this.createSessionForUser(
				user.id,
				meta,
				null,
				existingSid ?? null
			)

			this.recordAuthSuccess('admin', 'login', user.id, meta, {
				role: user.role,
				sessionReused: reused
			})

			return { sid, csrf, user }
		} catch (error) {
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

			this.recordAuthSuccess('catalog', 'login', user.id, meta, {
				role: user.role,
				catalogId,
				sessionReused: reused
			})

			return { sid, csrf, user, catalogId }
		} catch (error) {
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

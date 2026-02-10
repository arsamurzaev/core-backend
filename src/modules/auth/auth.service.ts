import { Role } from '@generated/enums'
import {
	ForbiddenException,
	Injectable,
	UnauthorizedException
} from '@nestjs/common'
import { verify } from 'argon2'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

import { LoginDtoReq } from './dto/requests/login.dto.req'
import { SessionService } from './session/session.service'

type LoginMeta = {
	ip?: string | null
	userAgent?: string | null
}

@Injectable()
export class AuthService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly sessions: SessionService
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
		if (reuse) return reuse

		const { sid, csrf } = await this.sessions.createForUser(userId, {
			meta: { ...meta, catalogId: catalogId ?? null }
		})
		return { sid, csrf }
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

		const existingCatalogId =
			session.context?.catalogId ?? (session as any).catalogId ?? null
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
		const user = await this.validateUser(dto)
		const { sid, csrf } = await this.createSessionForUser(
			user.id,
			meta,
			null,
			existingSid ?? null
		)

		return { sid, csrf, user }
	}

	async loginForCatalog(
		dto: LoginDtoReq,
		catalogId: string,
		ownerUserId?: string | null,
		meta?: LoginMeta,
		existingSid?: string | null
	) {
		const user = await this.validateUser(dto)

		if (user.role !== Role.CATALOG) {
			throw new ForbiddenException('Нет прав на вход в каталог')
		}

		let ownerId = ownerUserId ?? null
		if (!ownerId) {
			const catalog = await this.prisma.catalog.findUnique({
				where: { id: catalogId },
				select: { userId: true }
			})
			ownerId = catalog?.userId ?? null
		}

		if (!ownerId || ownerId !== user.id) {
			throw new ForbiddenException('Нет прав для этого каталога')
		}

		const { sid, csrf } = await this.createSessionForUser(
			user.id,
			meta,
			catalogId,
			existingSid ?? null
		)

		return { sid, csrf, user, catalogId }
	}
}

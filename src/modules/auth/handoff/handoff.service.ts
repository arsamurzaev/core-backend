import { Role } from '@generated/client'
import { ForbiddenException, Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { RedisService } from '@/infrastructure/redis/redis.service'

export type HandoffPayload = {
	userId: string
	role: Role
	catalogId: string
	next?: string
	createdAt: number
}

@Injectable()
export class HandoffService {
	private readonly prefix = 'handoff:'
	private readonly ttlSeconds = Number(process.env.HANDOFF_TTL_SECONDS ?? 30)

	constructor(
		private readonly prisma: PrismaService,
		private readonly redis: RedisService
	) {}

	private key(token: string) {
		return `${this.prefix}${token}`
	}

	private sanitizeNext(next?: string): string | undefined {
		if (!next) return undefined
		if (!next.startsWith('/')) return undefined
		if (next.startsWith('//')) return undefined
		if (next.includes('http://') || next.includes('https://')) return undefined
		return next
	}

	async createForCatalog(params: {
		userId: string
		role: Role
		catalogId: string
		next?: string
	}): Promise<string> {
		const { userId, role, catalogId } = params

		// ADMIN — может всё
		if (role !== Role.ADMIN) {
			const catalog = await this.prisma.catalog.findUnique({
				where: { id: catalogId },
				select: { userId: true }
			})
			if (!catalog || catalog.userId !== userId) {
				throw new ForbiddenException('Нет прав на вход в этот каталог')
			}
		}

		const token = randomUUID()
		const payload: HandoffPayload = {
			userId,
			role,
			catalogId,
			next: this.sanitizeNext(params.next),
			createdAt: Date.now()
		}

		await this.redis.set(
			this.key(token),
			JSON.stringify(payload),
			'EX',
			this.ttlSeconds
		)
		return token
	}

	async consume(token: string): Promise<HandoffPayload | null> {
		if (!token) return null
		const key = this.key(token)
		const redisWithGetDel = this.redis as RedisService & {
			getdel?: (key: string) => Promise<string | null>
		}

		// атомарно одноразово (Redis 6.2+)
		const raw = redisWithGetDel.getdel
			? await redisWithGetDel.getdel(key)
			: await this.redis.get(key)

		if (!raw) return null

		if (!redisWithGetDel.getdel) {
			await this.redis.del(key)
		}

		try {
			return JSON.parse(raw) as HandoffPayload
		} catch {
			return null
		}
	}
}

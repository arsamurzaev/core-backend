import { Injectable } from '@nestjs/common'
import { randomUUID } from 'node:crypto'

import { RedisService } from '@/infrastructure/redis/redis.service'

export type SessionData = {
	userId: string
	csrf: string
	createdAt: number
}

@Injectable()
export class SessionService {
	private readonly prefix = 'sess:'
	private readonly ttlSeconds = Number(
		process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 7
	)

	constructor(private readonly redis: RedisService) {}

	private key(id: string) {
		return `${this.prefix}${id}`
	}

	async createForUser(userId: string, ttlSeconds: number = this.ttlSeconds) {
		const sid = randomUUID()
		const csrf = randomUUID()
		const data: SessionData = { userId, csrf, createdAt: Date.now() }

		await this.redis.set(this.key(sid), JSON.stringify(data), 'EX', ttlSeconds)
		return { sid, csrf }
	}

	async get(sid: string): Promise<SessionData | null> {
		if (!sid) return null
		const raw = await this.redis.get(this.key(sid))
		if (!raw) return null
		try {
			return JSON.parse(raw) as SessionData
		} catch {
			return null
		}
	}

	async destroy(sid: string): Promise<void> {
		if (!sid) return
		await this.redis.del(this.key(sid))
	}
}

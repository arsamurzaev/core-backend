import { Injectable, Logger } from '@nestjs/common'
import geoip from 'geoip-lite'
import { randomUUID } from 'node:crypto'

import { RedisService } from '@/infrastructure/redis/redis.service'

import {
	buildSessionClient,
	buildSessionContext,
	parseStoredSessionData,
	type SessionData,
	type SessionLoginEntry,
	type SessionMeta
} from './session.utils'

export type {
	SessionClient,
	SessionContext,
	SessionData,
	SessionGeo,
	SessionLoginEntry,
	SessionMeta,
	SessionUserAgent
} from './session.utils'

type CreateSessionOptions = {
	ttlSeconds?: number
	meta?: SessionMeta
	maxLogins?: number
	loginsTtlSeconds?: number
}

@Injectable()
export class SessionService {
	private readonly logger = new Logger(SessionService.name)
	private readonly prefix = 'sess:'
	private readonly isDev = process.env.NODE_ENV !== 'production'
	private readonly ttlSeconds = Number(
		process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 7
	)
	private readonly loginsTtlSeconds = Number(
		process.env.SESSION_LOGINS_TTL_SECONDS ?? 60 * 60 * 24 * 30
	)
	private readonly maxLogins = Number(process.env.SESSION_LOGINS_MAX ?? 20)
	private readonly geoLookup = (
		geoip as unknown as {
			lookup?: (value: string) => unknown
		}
	).lookup

	constructor(private readonly redis: RedisService) {}

	private key(id: string) {
		return `${this.prefix}${id}`
	}

	private primaryKey(userId: string) {
		return `${this.prefix}primary:${userId}`
	}

	private loginsKey(userId: string) {
		return `${this.prefix}logins:${userId}`
	}

	async createForUser(
		userId: string,
		ttlOrOptions?: number | CreateSessionOptions
	) {
		const options: CreateSessionOptions =
			typeof ttlOrOptions === 'number'
				? { ttlSeconds: ttlOrOptions }
				: (ttlOrOptions ?? {})

		const ttlSeconds = options.ttlSeconds ?? this.ttlSeconds
		const meta = options.meta ?? {}
		const client = buildSessionClient(meta, {
			isDev: this.isDev,
			geoLookup: this.geoLookup
		})
		const context = buildSessionContext(meta)

		const sid = randomUUID()
		const csrf = randomUUID()
		const createdAt = Date.now()
		const data: SessionData = {
			userId,
			csrf,
			createdAt,
			client,
			context
		}

		const loginsTtlSeconds = options.loginsTtlSeconds ?? this.loginsTtlSeconds
		const maxLogins = options.maxLogins ?? this.maxLogins
		const loginEntry: SessionLoginEntry = {
			sid,
			createdAt,
			isPrimary: true,
			client,
			context
		}

		await this.redis
			.multi()
			.set(this.key(sid), JSON.stringify(data), 'EX', ttlSeconds)
			.set(this.primaryKey(userId), sid, 'EX', ttlSeconds)
			.lpush(this.loginsKey(userId), JSON.stringify(loginEntry))
			.ltrim(this.loginsKey(userId), 0, maxLogins - 1)
			.expire(this.loginsKey(userId), loginsTtlSeconds)
			.exec()

		return { sid, csrf }
	}

	async touch(sid: string, userId: string, ttlSeconds?: number): Promise<void> {
		if (!sid || !userId) return
		try {
			const ttl = ttlSeconds ?? this.ttlSeconds
			const loginsTtlSeconds = this.loginsTtlSeconds
			const primaryKey = this.primaryKey(userId)
			const currentPrimary = await this.redis.get(primaryKey)

			const pipeline = this.redis
				.multi()
				.expire(this.key(sid), ttl)
				.expire(this.loginsKey(userId), loginsTtlSeconds)

			if (currentPrimary === sid) {
				pipeline.expire(primaryKey, ttl)
			}

			await pipeline.exec()
		} catch (error) {
			this.logger.warn('Session touch failed', {
				sid,
				error: error instanceof Error ? error.message : String(error)
			})
		}
	}

	async get(sid: string): Promise<SessionData | null> {
		if (!sid) return null
		try {
			const raw = await this.redis.get(this.key(sid))
			return parseStoredSessionData(raw)
		} catch (error) {
			this.logger.warn('Session get failed', {
				sid,
				error: error instanceof Error ? error.message : String(error)
			})
			return null
		}
	}

	async destroy(sid: string): Promise<void> {
		if (!sid) return
		try {
			const data = await this.get(sid)
			await this.redis.del(this.key(sid))
			if (data?.userId) {
				const primaryKey = this.primaryKey(data.userId)
				const currentPrimary = await this.redis.get(primaryKey)
				if (currentPrimary === sid) {
					await this.redis.del(primaryKey)
				}
			}
		} catch (error) {
			this.logger.warn('Session destroy failed', {
				sid,
				error: error instanceof Error ? error.message : String(error)
			})
		}
	}

	async listForUser(userId: string): Promise<SessionLoginEntry[]> {
		try {
			const raw = await this.redis.lrange(this.loginsKey(userId), 0, -1)
			const primarySid = await this.redis.get(this.primaryKey(userId))

			return raw.flatMap(entry => {
				try {
					const parsed = JSON.parse(entry) as SessionLoginEntry
					parsed.isPrimary = parsed.sid === primarySid
					return [parsed]
				} catch {
					return []
				}
			})
		} catch (error) {
			this.logger.warn('Session listForUser failed', {
				userId,
				error: error instanceof Error ? error.message : String(error)
			})
			return []
		}
	}

	async destroyAllForUser(userId: string): Promise<void> {
		const entries = await this.listForUser(userId)
		const sids = entries.map(e => e.sid)

		if (sids.length > 0) {
			const pipeline = this.redis.pipeline()
			for (const sid of sids) {
				pipeline.del(this.key(sid))
			}
			await pipeline.exec()
		}

		await this.redis
			.multi()
			.del(this.primaryKey(userId))
			.del(this.loginsKey(userId))
			.exec()
	}
}

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

export type ActiveSessionEntry = SessionLoginEntry & {
	expiresAt: number | null
	ttlSeconds: number | null
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

	async listActiveForUser(userId: string): Promise<ActiveSessionEntry[]> {
		const entries = await this.listForUser(userId)
		if (entries.length === 0) return []

		try {
			const primarySid = await this.redis.get(this.primaryKey(userId))
			const pipeline = this.redis.pipeline()

			for (const entry of entries) {
				pipeline.get(this.key(entry.sid))
				pipeline.ttl(this.key(entry.sid))
			}

			const results = await pipeline.exec()
			if (!results) return []

			const seen = new Set<string>()
			const now = Date.now()
			const activeEntries: ActiveSessionEntry[] = []

			for (let index = 0; index < entries.length; index += 1) {
				const entry = entries[index]
				if (!entry?.sid || seen.has(entry.sid)) continue

				const rawResult = results[index * 2]
				const ttlResult = results[index * 2 + 1]
				const raw = rawResult?.[1]
				const ttl = ttlResult?.[1]
				const data = parseStoredSessionData(
					typeof raw === 'string' ? raw : null
				)

				if (!data || data.userId !== userId) continue

				const ttlSeconds =
					typeof ttl === 'number' && ttl >= 0 ? ttl : null

				seen.add(entry.sid)
				activeEntries.push({
					...entry,
					createdAt: data.createdAt || entry.createdAt,
					isPrimary: entry.sid === primarySid,
					client: data.client ?? entry.client,
					context: data.context ?? entry.context,
					expiresAt: ttlSeconds === null ? null : now + ttlSeconds * 1000,
					ttlSeconds
				})
			}

			return activeEntries
		} catch (error) {
			this.logger.warn('Session listActiveForUser failed', {
				userId,
				error: error instanceof Error ? error.message : String(error)
			})
			return []
		}
	}

	async destroyForUser(userId: string, sid: string): Promise<boolean> {
		if (!userId || !sid) return false

		const data = await this.get(sid)
		if (!data || data.userId !== userId) return false

		await this.destroy(sid)
		return true
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

	async destroyAllForUserExcept(userId: string, keepSid: string): Promise<void> {
		const sid = keepSid.trim()
		if (!sid) {
			await this.destroyAllForUser(userId)
			return
		}

		const keptSession = await this.get(sid)
		if (!keptSession || keptSession.userId !== userId) {
			await this.destroyAllForUser(userId)
			return
		}

		const entries = await this.listForUser(userId)
		const keptEntry =
			entries.find(entry => entry.sid === sid) ??
			({
				sid,
				createdAt: keptSession.createdAt,
				isPrimary: true,
				client: keptSession.client,
				context: keptSession.context
			} satisfies SessionLoginEntry)
		keptEntry.isPrimary = true

		const staleSids = entries
			.map(entry => entry.sid)
			.filter(entrySid => entrySid && entrySid !== sid)

		if (staleSids.length > 0) {
			const pipeline = this.redis.pipeline()
			for (const staleSid of staleSids) {
				pipeline.del(this.key(staleSid))
			}
			await pipeline.exec()
		}

		await this.redis
			.multi()
			.expire(this.key(sid), this.ttlSeconds)
			.set(this.primaryKey(userId), sid, 'EX', this.ttlSeconds)
			.del(this.loginsKey(userId))
			.lpush(this.loginsKey(userId), JSON.stringify(keptEntry))
			.expire(this.loginsKey(userId), this.loginsTtlSeconds)
			.exec()
	}
}

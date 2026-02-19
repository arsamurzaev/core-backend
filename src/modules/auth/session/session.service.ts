import { Injectable } from '@nestjs/common'
import geoip from 'geoip-lite'
import { randomUUID } from 'node:crypto'

import { RedisService } from '@/infrastructure/redis/redis.service'

export type SessionUserAgent = {
	raw: string | null
	browser: { name: string | null; version: string | null }
	os: { name: string | null; version: string | null }
	device: { type: string | null; vendor: string | null; model: string | null }
	engine: { name: string | null; version: string | null }
}

export type SessionGeo = {
	city: string | null
	region: string | null
	latitude: number | null
	longitude: number | null
}

export type SessionClient = {
	ip: string | null
	userAgent: SessionUserAgent | null
	geo: SessionGeo | null
}

export type SessionContext = {
	catalogId: string | null
}

export type SessionData = {
	userId: string
	csrf: string
	createdAt: number
	client: SessionClient
	context: SessionContext
}

export type SessionLoginEntry = {
	sid: string
	createdAt: number
	isPrimary: boolean
	client: SessionClient
	context: SessionContext
}

export type SessionMeta = {
	ip?: string | null
	userAgent?: string | null
	catalogId?: string | null
}

type CreateSessionOptions = {
	ttlSeconds?: number
	meta?: SessionMeta
	maxLogins?: number
	loginsTtlSeconds?: number
}

type GeoLookupRecord = {
	ll?: unknown
	city?: unknown
	region?: unknown
}

const DEV_GEO: SessionGeo = {
	city: 'Moscow',
	region: 'Moscow',
	latitude: 55.7558,
	longitude: 37.6173
}

const BROWSER_RULES: ReadonlyArray<[string, RegExp]> = [
	['Edge', /EdgA?\/([\d.]+)/],
	['Opera', /OPR\/([\d.]+)/],
	['Opera', /Opera\/([\d.]+)/],
	['Vivaldi', /Vivaldi\/([\d.]+)/],
	['Brave', /Brave\/([\d.]+)/],
	['Yandex', /YaBrowser\/([\d.]+)/],
	['Chrome', /Chrome\/([\d.]+)/],
	['Chrome', /CriOS\/([\d.]+)/],
	['Firefox', /Firefox\/([\d.]+)/],
	['Firefox', /FxiOS\/([\d.]+)/],
	['Safari', /Version\/([\d.]+).*Safari\//],
	['IE', /MSIE\s([\d.]+)/],
	['IE', /Trident\/.*rv:([\d.]+)/]
]

const WINDOWS_VERSION_MAP: Record<string, string> = {
	'10.0': '10',
	'6.3': '8.1',
	'6.2': '8',
	'6.1': '7',
	'6.0': 'Vista',
	'5.1': 'XP',
	'5.0': '2000'
}

const BLINK_BROWSERS = new Set([
	'Chrome',
	'Edge',
	'Opera',
	'Vivaldi',
	'Brave',
	'Yandex'
])

function isGeoLookupRecord(value: unknown): value is GeoLookupRecord {
	return Boolean(value) && typeof value === 'object'
}

@Injectable()
export class SessionService {
	private readonly prefix = 'sess:'
	private readonly isDev = process.env.NODE_ENV !== 'production'
	private readonly ttlSeconds = Number(
		process.env.SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 7
	)
	private readonly loginsTtlSeconds = Number(
		process.env.SESSION_LOGINS_TTL_SECONDS ?? 60 * 60 * 24 * 30
	)
	private readonly maxLogins = Number(process.env.SESSION_LOGINS_MAX ?? 20)

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

	private clean(value?: string | null) {
		const trimmed = (value ?? '').trim()
		return trimmed || null
	}

	private normalizeIp(ip?: string | null) {
		let value = this.clean(ip)
		if (!value) return null
		if (value.startsWith('::ffff:')) value = value.slice(7)
		if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(value)) {
			value = value.split(':')[0] ?? value
		}
		return value
	}

	private parseNumber(value: unknown) {
		if (typeof value === 'number' && Number.isFinite(value)) return value
		if (typeof value === 'string' && value.trim()) {
			const parsed = Number(value)
			if (Number.isFinite(parsed)) return parsed
		}
		return null
	}

	private extractVersion(ua: string, pattern: RegExp) {
		const match = ua.match(pattern)
		if (!match?.[1]) return null
		return match[1].replace(/_/g, '.')
	}

	private parseUserAgent(userAgent: string | null): SessionUserAgent | null {
		if (!userAgent) return null
		const ua = userAgent

		let browserName: string | null = null
		let browserVersion: string | null = null

		for (const [name, pattern] of BROWSER_RULES) {
			const version = this.extractVersion(ua, pattern)
			if (version) {
				browserName = name
				browserVersion = version
				break
			}
		}

		let osName: string | null = null
		let osVersion: string | null = null

		const windowsVersion = this.extractVersion(ua, /Windows NT ([\d.]+)/)
		if (windowsVersion) {
			osName = 'Windows'
			osVersion = WINDOWS_VERSION_MAP[windowsVersion] ?? windowsVersion
		} else {
			const macVersion = this.extractVersion(ua, /Mac OS X ([\d_]+)/)
			if (macVersion) {
				osName = 'macOS'
				osVersion = macVersion
			} else {
				const iosVersion =
					this.extractVersion(ua, /iPhone OS ([\d_]+)/) ??
					this.extractVersion(ua, /iPad.*OS ([\d_]+)/)
				if (iosVersion) {
					osName = ua.includes('iPad') ? 'iPadOS' : 'iOS'
					osVersion = iosVersion
				} else {
					const androidVersion = this.extractVersion(ua, /Android ([\d.]+)/)
					if (androidVersion) {
						osName = 'Android'
						osVersion = androidVersion
					} else if (/CrOS/.test(ua)) {
						osName = 'Chrome OS'
					} else if (/Linux/.test(ua)) {
						osName = 'Linux'
					}
				}
			}
		}

		let deviceType: string | null = null
		let deviceVendor: string | null = null
		let deviceModel: string | null = null

		if (/iPad/.test(ua)) {
			deviceType = 'tablet'
			deviceVendor = 'Apple'
			deviceModel = 'iPad'
		} else if (/iPhone/.test(ua)) {
			deviceType = 'mobile'
			deviceVendor = 'Apple'
			deviceModel = 'iPhone'
		} else if (/Android/.test(ua)) {
			deviceType = /Mobile/.test(ua) ? 'mobile' : 'tablet'
		} else if (/Mobile/.test(ua)) {
			deviceType = 'mobile'
		}

		let engineName: string | null = null
		let engineVersion: string | null = null

		if (browserName && BLINK_BROWSERS.has(browserName)) {
			engineName = 'Blink'
		} else if (/AppleWebKit\/([\d.]+)/.test(ua)) {
			engineName = 'WebKit'
			engineVersion = this.extractVersion(ua, /AppleWebKit\/([\d.]+)/)
		} else if (/Gecko\/([\d.]+)/.test(ua)) {
			engineName = 'Gecko'
			engineVersion = this.extractVersion(ua, /Gecko\/([\d.]+)/)
		} else if (/Trident\/([\d.]+)/.test(ua)) {
			engineName = 'Trident'
			engineVersion = this.extractVersion(ua, /Trident\/([\d.]+)/)
		}

		return {
			raw: userAgent,
			browser: { name: browserName, version: browserVersion },
			os: { name: osName, version: osVersion },
			device: { type: deviceType, vendor: deviceVendor, model: deviceModel },
			engine: { name: engineName, version: engineVersion }
		}
	}

	private resolveGeo(ip: string | null): SessionGeo | null {
		if (this.isDev) return DEV_GEO
		if (!ip) return null

		try {
			const geoipLookup = (
				geoip as unknown as {
					lookup?: (value: string) => unknown
				}
			).lookup
			if (!geoipLookup) {
				return null
			}
			const lookup = geoipLookup(ip)
			if (!isGeoLookupRecord(lookup)) {
				return null
			}

			const coordinates = Array.isArray(lookup.ll) ? lookup.ll : []
			const latitude = this.parseNumber(coordinates[0])
			const longitude = this.parseNumber(coordinates[1])
			const city = typeof lookup.city === 'string' ? lookup.city : null
			const region = typeof lookup.region === 'string' ? lookup.region : null

			return {
				city,
				region,
				latitude,
				longitude
			}
		} catch {
			return null
		}
	}

	private buildContext(meta: SessionMeta): SessionContext {
		return {
			catalogId: this.clean(meta.catalogId)
		}
	}

	private buildClient(meta: SessionMeta): SessionClient {
		const ip = this.normalizeIp(meta.ip)
		const userAgentRaw = this.clean(meta.userAgent)
		const userAgent = this.parseUserAgent(userAgentRaw)
		const geo = this.resolveGeo(ip)

		return { ip, userAgent, geo }
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
		const client = this.buildClient(meta)
		const context = this.buildContext(meta)

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
		const data = await this.get(sid)
		await this.redis.del(this.key(sid))
		if (data?.userId) {
			const primaryKey = this.primaryKey(data.userId)
			const currentPrimary = await this.redis.get(primaryKey)
			if (currentPrimary === sid) {
				await this.redis.del(primaryKey)
			}
		}
	}
}

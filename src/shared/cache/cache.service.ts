import { Injectable, Logger } from '@nestjs/common'

import { ObservabilityService } from '@/modules/observability/observability.service'
import { RedisService } from '@/infrastructure/redis/redis.service'

const CACHE_PREFIX = 'cache'
const VERSION_PREFIX = 'cache:version'

@Injectable()
export class CacheService {
	private readonly logger = new Logger(CacheService.name)

	constructor(
		private readonly redis: RedisService,
		private readonly observability: ObservabilityService
	) {}

	buildKey(parts: Array<string | number | null | undefined>): string {
		const normalized = parts
			.filter(part => part !== undefined && part !== null && part !== '')
			.map(part => String(part))
		return [CACHE_PREFIX, ...normalized].join(':')
	}

	private buildVersionKey(scope: string, catalogId?: string): string {
		return [VERSION_PREFIX, scope, catalogId].filter(Boolean).join(':')
	}

	async getVersion(scope: string, catalogId?: string): Promise<number> {
		const startedAt = process.hrtime.bigint()

		try {
			const key = this.buildVersionKey(scope, catalogId)
			const raw = await this.redis.get(key)
			const parsed = raw ? Number.parseInt(raw, 10) : 0
			this.recordOperation('get_version', 'success', startedAt)
			return Number.isNaN(parsed) ? 0 : parsed
		} catch (error) {
			this.recordOperation('get_version', 'error', startedAt)
			this.logger.warn(
				`Cache getVersion failed [${scope}:${catalogId ?? '*'}]`,
				error
			)
			return 0
		}
	}

	async bumpVersion(scope: string, catalogId?: string): Promise<number> {
		const startedAt = process.hrtime.bigint()

		try {
			const key = this.buildVersionKey(scope, catalogId)
			const value = await this.redis.incr(key)
			this.recordOperation('bump_version', 'success', startedAt)
			return value
		} catch (error) {
			this.recordOperation('bump_version', 'error', startedAt)
			this.logger.warn(
				`Cache bumpVersion failed [${scope}:${catalogId ?? '*'}]`,
				error
			)
			return 0
		}
	}

	async getJson<T>(key: string): Promise<T | null> {
		const startedAt = process.hrtime.bigint()

		try {
			const raw = await this.redis.get(key)
			if (!raw) {
				this.recordOperation('get_json', 'miss', startedAt)
				return null
			}
			try {
				const parsed = JSON.parse(raw) as T
				this.recordOperation('get_json', 'hit', startedAt)
				return parsed
			} catch {
				this.logger.warn(`Corrupted cache entry, deleting key=${key}`)
				await this.redis.del(key)
				this.recordOperation('get_json', 'corrupted', startedAt)
				return null
			}
		} catch (error) {
			this.recordOperation('get_json', 'error', startedAt)
			this.logger.warn(`Cache getJson failed key=${key}`, error)
			return null
		}
	}

	async setJson<T>(key: string, value: T, ttlSec: number): Promise<void> {
		const startedAt = process.hrtime.bigint()

		try {
			const payload = JSON.stringify(value)
			if (ttlSec > 0) {
				await this.redis.set(key, payload, 'EX', ttlSec)
				this.recordOperation('set_json', 'success', startedAt)
				return
			}
			await this.redis.set(key, payload)
			this.recordOperation('set_json', 'success', startedAt)
		} catch (error) {
			this.recordOperation('set_json', 'error', startedAt)
			this.logger.warn(`Cache setJson failed key=${key}`, error)
		}
	}

	async del(key: string): Promise<void> {
		const startedAt = process.hrtime.bigint()

		try {
			await this.redis.del(key)
			this.recordOperation('del', 'success', startedAt)
		} catch (error) {
			this.recordOperation('del', 'error', startedAt)
			this.logger.warn(`Cache del failed key=${key}`, error)
		}
	}

	private recordOperation(
		operation:
			| 'get_version'
			| 'bump_version'
			| 'get_json'
			| 'set_json'
			| 'del',
		outcome: 'success' | 'error' | 'hit' | 'miss' | 'corrupted',
		startedAt: bigint
	) {
		const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
		this.observability.recordCacheOperation(operation, outcome, durationMs)
	}
}

import { Injectable } from '@nestjs/common'

import { RedisService } from '@/infrastructure/redis/redis.service'

const CACHE_PREFIX = 'cache'
const VERSION_PREFIX = 'cache:version'

@Injectable()
export class CacheService {
	constructor(private readonly redis: RedisService) {}

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
		try {
			const key = this.buildVersionKey(scope, catalogId)
			const raw = await this.redis.get(key)
			const parsed = raw ? Number.parseInt(raw, 10) : 0
			return Number.isNaN(parsed) ? 0 : parsed
		} catch {
			return 0
		}
	}

	async bumpVersion(scope: string, catalogId?: string): Promise<number> {
		try {
			const key = this.buildVersionKey(scope, catalogId)
			return await this.redis.incr(key)
		} catch {
			return 0
		}
	}

	async getJson<T>(key: string): Promise<T | null> {
		try {
			const raw = await this.redis.get(key)
			if (!raw) return null
			try {
				return JSON.parse(raw) as T
			} catch {
				await this.redis.del(key)
				return null
			}
		} catch {
			return null
		}
	}

	async setJson<T>(key: string, value: T, ttlSec: number): Promise<void> {
		try {
			const payload = JSON.stringify(value)
			if (ttlSec > 0) {
				await this.redis.set(key, payload, 'EX', ttlSec)
				return
			}
			await this.redis.set(key, payload)
		} catch {
			return
		}
	}

	async del(key: string): Promise<void> {
		try {
			await this.redis.del(key)
		} catch {
			return
		}
	}
}

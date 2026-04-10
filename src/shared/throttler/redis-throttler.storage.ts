import { Injectable } from '@nestjs/common'
import { ThrottlerStorage } from '@nestjs/throttler'
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface'

import { RedisService } from '@/infrastructure/redis/redis.service'

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
	constructor(private readonly redis: RedisService) {}

	async increment(
		key: string,
		ttl: number,
		limit: number,
		blockDuration: number,
		throttlerName: string
	): Promise<ThrottlerStorageRecord> {
		const redisKey = `throttler:${throttlerName}:${key}`
		const blockKey = `throttler:${throttlerName}:blocked:${key}`
		const ttlSec = Math.ceil(ttl / 1000)
		const blockSec = Math.ceil(blockDuration / 1000)

		const isBlocked = await this.redis.exists(blockKey)
		if (isBlocked) {
			const blockTtl = await this.redis.pttl(blockKey)
			return {
				totalHits: limit + 1,
				timeToExpire: blockTtl > 0 ? blockTtl : blockDuration,
				isBlocked: true,
				timeToBlockExpire: blockTtl > 0 ? blockTtl : blockDuration
			}
		}

		const pipeline = this.redis.pipeline()
		pipeline.incr(redisKey)
		pipeline.pttl(redisKey)
		const results = await pipeline.exec()

		const totalHits = (results?.[0]?.[1] as number) ?? 1
		const currentPttl = (results?.[1]?.[1] as number) ?? -1

		if (currentPttl < 0) {
			await this.redis.pexpire(redisKey, ttl)
		}

		const timeToExpire = currentPttl > 0 ? currentPttl : ttl

		if (totalHits > limit) {
			const effectiveBlockSec = blockSec > 0 ? blockSec : ttlSec
			await this.redis.set(blockKey, '1', 'EX', effectiveBlockSec)
			return {
				totalHits,
				timeToExpire,
				isBlocked: true,
				timeToBlockExpire: effectiveBlockSec * 1000
			}
		}

		return { totalHits, timeToExpire, isBlocked: false, timeToBlockExpire: 0 }
	}
}

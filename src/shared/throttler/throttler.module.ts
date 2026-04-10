import { Global, Module } from '@nestjs/common'
import { ThrottlerStorage } from '@nestjs/throttler'

import { RedisModule } from '@/infrastructure/redis/redis.module'

import { RedisThrottlerStorage } from './redis-throttler.storage'

@Global()
@Module({
	imports: [RedisModule],
	providers: [
		RedisThrottlerStorage,
		{ provide: ThrottlerStorage, useExisting: RedisThrottlerStorage }
	],
	exports: [ThrottlerStorage]
})
export class ThrottlerStorageModule {}

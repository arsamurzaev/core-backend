import { registerAs } from '@nestjs/config'

import { validateEnv } from '@/shared/utils'

import { RedisInterface } from '../interfaces/redis.interface'
import { RedisValidator } from '../validators'

export const redisEnv = registerAs<RedisInterface>('redis', () => {
	validateEnv(process.env, RedisValidator)

	return {
		user: process.env.REDIS_USER,
		password: process.env.REDIS_PASSWORD,
		host: process.env.REDIS_HOST,
		port: parseInt(process.env.REDIS_PORT)
	}
})

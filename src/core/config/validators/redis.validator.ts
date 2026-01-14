import { IsInt, IsString, Max, Min } from 'class-validator'

export class RedisValidator {
	@IsString()
	REDIS_USER: string

	@IsString()
	REDIS_PASSWORD: string

	@IsString()
	REDIS_HOST: string

	@IsInt()
	@Min(1)
	@Max(65535)
	REDIS_PORT: number
}

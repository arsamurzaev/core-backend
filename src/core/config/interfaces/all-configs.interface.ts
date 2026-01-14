import { DatabaseInterface } from './database.interface'
import { HttpInterface } from './http.interface'
import { RedisInterface } from './redis.interface'

export interface AllInterfaces {
	database: DatabaseInterface
	redis: RedisInterface
	http: HttpInterface
}

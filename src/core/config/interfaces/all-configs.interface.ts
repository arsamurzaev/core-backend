import { DatabaseInterface } from './database.interface'
import { HttpInterface } from './http.interface'
import { RedisInterface } from './redis.interface'
import { S3Interface } from './s3.interface'

export interface AllInterfaces {
	database: DatabaseInterface
	redis: RedisInterface
	http: HttpInterface
	s3: S3Interface
}

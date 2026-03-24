import { DatabaseInterface } from './database.interface'
import { HttpInterface } from './http.interface'
import { IntegrationCryptoInterface } from './integration-crypto.interface'
import { RedisInterface } from './redis.interface'
import { S3Interface } from './s3.interface'

export interface AllInterfaces {
	database: DatabaseInterface
	integrationCrypto: IntegrationCryptoInterface
	redis: RedisInterface
	http: HttpInterface
	s3: S3Interface
}

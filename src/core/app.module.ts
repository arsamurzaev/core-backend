import {
	ExecutionContext,
	MiddlewareConsumer,
	Module,
	NestModule
} from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import { createHash } from 'crypto'

import { RedisModule } from '@/infrastructure/redis/redis.module'
import { RedisService } from '@/infrastructure/redis/redis.service'
import { AdminModule } from '@/modules/admin/admin.module'
import { AttributeModule } from '@/modules/attribute/attribute.module'
import { AuthModule } from '@/modules/auth/auth.module'
import { BrandModule } from '@/modules/brand/brand.module'
import { CartModule } from '@/modules/cart/cart.module'
import { CatalogModule } from '@/modules/catalog/catalog.module'
import { CategoryModule } from '@/modules/category/category.module'
import { CronModule } from '@/modules/cron/cron.module'
import { IntegrationModule } from '@/modules/integration/integration.module'
import { ObservabilityModule } from '@/modules/observability/observability.module'
import { ProductModule } from '@/modules/product/product.module'
import { S3Module } from '@/modules/s3/s3.module'
import { SeoModule } from '@/modules/seo/seo.module'
import { TypeModule } from '@/modules/type/type.module'
import { UserModule } from '@/modules/user/user.module'
import { CacheModule } from '@/shared/cache/cache.module'
import { readCookieValue } from '@/shared/http/cookie.utils'
import { GlobalExceptionFilter } from '@/shared/http/filters/global-exception.filter'
import { CatalogGuard } from '@/shared/tenancy/catalog.guard'
import { CatalogResolver } from '@/shared/tenancy/catalog.resolver'
import { CatalogContextMiddleware } from '@/shared/tenancy/tenant-context.middleware'
import { shouldApplyAuthThrottle } from '@/shared/throttler/auth-throttle.decorator'
import { CustomThrottlerGuard } from '@/shared/throttler/custom-throttler.guard'
import { RedisThrottlerStorage } from '@/shared/throttler/redis-throttler.storage'

import { PrismaModule } from '../infrastructure/prisma/prisma.module'

import {
	databaseEnv,
	httpEnv,
	integrationCryptoEnv,
	redisEnv,
	s3Env
} from './config/env'

const SID_COOKIE = process.env.SESSION_COOKIE_NAME ?? 'sid'
const CATALOG_SID_COOKIE_PREFIX =
	process.env.CATALOG_SESSION_COOKIE_PREFIX ?? 'catalog_sid'
type TrackerRequest = Record<string, unknown>

function readTrackerHeader(
	req: TrackerRequest,
	name: string
): string | string[] | undefined {
	const headers = req.headers
	if (!headers || typeof headers !== 'object') return undefined

	const value = (headers as Record<string, unknown>)[name]
	if (typeof value === 'string') return value
	if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
		return value
	}

	return undefined
}

function stringifyTrackerHeader(req: TrackerRequest, name: string): string {
	const value = readTrackerHeader(req, name)
	if (Array.isArray(value)) return value.join(', ')
	return value ?? ''
}

function readAnySessionCookie(cookieHeader: string | string[] | undefined) {
	const sid = readCookieValue(cookieHeader, SID_COOKIE)
	if (sid) return sid

	const header = Array.isArray(cookieHeader)
		? cookieHeader.join(';')
		: (cookieHeader ?? '')
	for (const part of header.split(';')) {
		const [key, ...rest] = part.trim().split('=')
		if (!key.startsWith(`${CATALOG_SID_COOKIE_PREFIX}_`)) continue
		return decodeURIComponent(rest.join('='))
	}

	return null
}

function readTrackerIp(req: TrackerRequest): string {
	if (typeof req.ip === 'string' && req.ip) return req.ip

	const socket = req.socket
	if (!socket || typeof socket !== 'object') return 'unknown'

	const remoteAddress = (socket as { remoteAddress?: unknown }).remoteAddress
	return typeof remoteAddress === 'string' && remoteAddress
		? remoteAddress
		: 'unknown'
}

function shouldSkipAuthThrottler(context: ExecutionContext): boolean {
	return !shouldApplyAuthThrottle(context)
}

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			load: [databaseEnv, redisEnv, httpEnv, s3Env, integrationCryptoEnv]
		}),
		ThrottlerModule.forRootAsync({
			imports: [RedisModule],
			inject: [RedisService],
			useFactory: (redis: RedisService) => ({
				throttlers: [
					{ name: 'global', ttl: 60_000, limit: 600 },
					{
						name: 'auth',
						ttl: 900_000,
						limit: 10,
						skipIf: shouldSkipAuthThrottler
					}
				],
				storage: new RedisThrottlerStorage(redis),
				getTracker: (req: TrackerRequest) => {
					const sid = readAnySessionCookie(readTrackerHeader(req, 'cookie'))
					if (sid) return `sess:${sid}`

					const ip = readTrackerIp(req)
					const ua = stringifyTrackerHeader(req, 'user-agent')
					const lang = stringifyTrackerHeader(req, 'accept-language')
					const fingerprint = createHash('sha256')
						.update(`${ip}:${ua}:${lang}`)
						.digest('hex')
						.slice(0, 16)
					return `anon:${fingerprint}`
				}
			})
		}),
		ObservabilityModule,
		CacheModule,
		PrismaModule,
		TypeModule,
		AuthModule,
		AdminModule,
		AttributeModule,
		BrandModule,
		UserModule,
		CatalogModule,
		CategoryModule,
		CronModule,
		IntegrationModule,
		CartModule,
		ProductModule,
		S3Module,
		SeoModule
	],
	providers: [
		{ provide: APP_FILTER, useClass: GlobalExceptionFilter },
		{ provide: APP_GUARD, useClass: CustomThrottlerGuard },
		{ provide: APP_GUARD, useClass: CatalogGuard },
		CatalogResolver,
		CatalogContextMiddleware
	]
})
export class AppModule implements NestModule {
	configure(consumer: MiddlewareConsumer) {
		consumer.apply(CatalogContextMiddleware).forRoutes('*')
	}
}

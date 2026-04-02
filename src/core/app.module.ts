import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'

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
import { GlobalExceptionFilter } from '@/shared/http/filters/global-exception.filter'
import { CatalogGuard } from '@/shared/tenancy/catalog.guard'
import { CatalogResolver } from '@/shared/tenancy/catalog.resolver'
import { CatalogContextMiddleware } from '@/shared/tenancy/tenant-context.middleware'

import { PrismaModule } from '../infrastructure/prisma/prisma.module'

import {
	databaseEnv,
	httpEnv,
	integrationCryptoEnv,
	redisEnv,
	s3Env
} from './config/env'

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			load: [databaseEnv, redisEnv, httpEnv, s3Env, integrationCryptoEnv]
		}),
		ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
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
		{ provide: APP_GUARD, useClass: ThrottlerGuard },
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

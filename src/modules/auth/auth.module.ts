import { Global, Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { RedisModule } from '@/infrastructure/redis/redis.module'

import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { CatalogAuthController } from './catalog-auth.controller'
import { CatalogAccessGuard } from './guards/catalog-access.guard'
import { OptionalSessionGuard } from './guards/optional-session.guard'
import { SessionGuard } from './guards/session.guard'
import { HandoffController } from './handoff/handoff.controller'
import { HandoffService } from './handoff/handoff.service'
import { SessionService } from './session/session.service'

@Global()
@Module({
	imports: [PrismaModule, RedisModule],
	controllers: [AuthController, CatalogAuthController, HandoffController],
	providers: [
		AuthService,
		SessionService,
		HandoffService,
		SessionGuard,
		OptionalSessionGuard,
		CatalogAccessGuard
	],
	exports: [
		AuthService,
		SessionService,
		HandoffService,
		SessionGuard,
		OptionalSessionGuard,
		CatalogAccessGuard
	]
})
export class AuthModule {}

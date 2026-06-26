import { Global, Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { RedisModule } from '@/infrastructure/redis/redis.module'

import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { CatalogAuthController } from './catalog-auth.controller'
import {
	AUTH_HANDOFF_ISSUER_PORT,
	AUTH_PASSWORD_COMMAND_PORT,
	AUTH_SESSION_ISSUER_PORT,
	AUTH_SESSION_MANAGEMENT_PORT
} from './contracts'
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
		{ provide: AUTH_SESSION_ISSUER_PORT, useExisting: AuthService },
		{ provide: AUTH_PASSWORD_COMMAND_PORT, useExisting: AuthService },
		SessionService,
		{ provide: AUTH_SESSION_MANAGEMENT_PORT, useExisting: SessionService },
		HandoffService,
		{ provide: AUTH_HANDOFF_ISSUER_PORT, useExisting: HandoffService },
		SessionGuard,
		OptionalSessionGuard,
		CatalogAccessGuard
	],
	exports: [
		AUTH_SESSION_ISSUER_PORT,
		AUTH_PASSWORD_COMMAND_PORT,
		AUTH_SESSION_MANAGEMENT_PORT,
		AUTH_HANDOFF_ISSUER_PORT,
		SessionGuard,
		OptionalSessionGuard,
		CatalogAccessGuard
	]
})
export class AuthModule {}

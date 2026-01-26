import { Global, Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { RedisModule } from '@/infrastructure/redis/redis.module'

import { CatalogAccessGuard } from './guards/catalog-access.guard'
import { SessionGuard } from './guards/session.guard'
import { HandoffService } from './handoff/handoff.service'
import { SessionService } from './session/session.service'

@Global()
@Module({
	imports: [PrismaModule, RedisModule],
	providers: [SessionService, HandoffService, SessionGuard, CatalogAccessGuard],
	exports: [SessionService, HandoffService, SessionGuard, CatalogAccessGuard]
})
export class AuthModule {}

import { Global, Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { RedisModule } from '@/infrastructure/redis/redis.module'

import { SessionGuard } from './guards/session.guard'
import { HandoffService } from './handoff/handoff.service'
import { SessionService } from './session/session.service'

@Global()
@Module({
	imports: [PrismaModule, RedisModule],
	providers: [SessionService, HandoffService, SessionGuard],
	exports: [SessionService, HandoffService, SessionGuard]
})
export class AuthModule {}

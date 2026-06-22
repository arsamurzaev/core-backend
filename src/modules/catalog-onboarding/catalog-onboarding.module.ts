import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { RedisModule } from '@/infrastructure/redis/redis.module'
import { EmailModule } from '@/modules/email/public'

import { CatalogOnboardingController } from './catalog-onboarding.controller'
import { CatalogOnboardingService } from './catalog-onboarding.service'

@Module({
	imports: [PrismaModule, RedisModule, EmailModule],
	controllers: [CatalogOnboardingController],
	providers: [CatalogOnboardingService]
})
export class CatalogOnboardingModule {}

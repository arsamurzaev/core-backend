import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'

import { SeoController } from './seo.controller'
import { SeoRepository } from './seo.repository'
import { SeoService } from './seo.service'

@Module({
	controllers: [SeoController],
	imports: [PrismaModule],
	providers: [SeoService, SeoRepository]
})
export class SeoModule {}

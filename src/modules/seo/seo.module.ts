import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { MediaRepository } from '@/shared/media/media.repository'
import { MediaUrlService } from '@/shared/media/media-url.service'

import { SeoController } from './seo.controller'
import { SeoRepository } from './seo.repository'
import { SeoService } from './seo.service'

@Module({
	controllers: [SeoController],
	imports: [PrismaModule],
	providers: [SeoService, SeoRepository, MediaRepository, MediaUrlService]
})
export class SeoModule {}

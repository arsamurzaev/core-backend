import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'

import { SEO_SETTINGS_PORT } from './contracts'
import { SeoController } from './seo.controller'
import { SeoRepository } from './seo.repository'
import { SeoService } from './seo.service'

@Module({
	controllers: [SeoController],
	imports: [PrismaModule],
	providers: [
		SeoService,
		SeoRepository,
		MediaRepository,
		MediaUrlService,
		{
			provide: SEO_SETTINGS_PORT,
			useExisting: SeoRepository
		}
	],
	exports: [SEO_SETTINGS_PORT]
})
export class SeoModule {}

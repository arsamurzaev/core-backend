import { Module } from '@nestjs/common'

import { S3Module } from '@/modules/s3/s3.module'
import { SeoRepository } from '@/modules/seo/seo.repository'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'

import { CatalogSeoSyncService } from './catalog-seo-sync.service'
import { CatalogController } from './catalog.controller'
import { CatalogRepository } from './catalog.repository'
import { CatalogService } from './catalog.service'

@Module({
	imports: [S3Module],
	controllers: [CatalogController],
	providers: [
		CatalogService,
		CatalogSeoSyncService,
		CatalogRepository,
		SeoRepository,
		MediaRepository,
		MediaUrlService
	]
})
export class CatalogModule {}

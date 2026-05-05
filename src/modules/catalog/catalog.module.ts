import { Module } from '@nestjs/common'

import { S3Module } from '@/modules/s3/s3.module'
import { SeoRepository } from '@/modules/seo/seo.repository'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'

import { CatalogDomainController } from './catalog-domain.controller'
import { CatalogDomainRepository } from './catalog-domain.repository'
import { CatalogDomainService } from './catalog-domain.service'
import { CatalogSeoSyncService } from './catalog-seo-sync.service'
import { CatalogController } from './catalog.controller'
import { CatalogRepository } from './catalog.repository'
import { CatalogService } from './catalog.service'
import { InternalTlsController } from './internal-tls.controller'

@Module({
	imports: [S3Module],
	controllers: [
		CatalogController,
		CatalogDomainController,
		InternalTlsController
	],
	providers: [
		CatalogService,
		CatalogDomainService,
		CatalogSeoSyncService,
		CatalogDomainRepository,
		CatalogRepository,
		SeoRepository,
		MediaRepository,
		MediaUrlService
	],
	exports: [CatalogDomainService]
})
export class CatalogModule {}

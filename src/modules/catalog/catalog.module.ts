import { Module } from '@nestjs/common'

import { MediaRepository } from '@/shared/media/media.repository'
import { MediaUrlService } from '@/shared/media/media-url.service'

import { CatalogController } from './catalog.controller'
import { CatalogRepository } from './catalog.repository'
import { CatalogService } from './catalog.service'

@Module({
	controllers: [CatalogController],
	providers: [CatalogService, CatalogRepository, MediaRepository, MediaUrlService]
})
export class CatalogModule {}

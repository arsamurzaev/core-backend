import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { S3Module } from '@/modules/s3/s3.module'
import { SeoRepository } from '@/modules/seo/seo.repository'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { ProductMediaMapper } from '@/shared/media/product-media.mapper'
import { MediaRepository } from '@/shared/media/media.repository'

import { ProductAttributeBuilder } from './product-attribute.builder'
import { ProductReadService } from './product-read.service'
import { ProductSeoSyncService } from './product-seo-sync.service'
import { ProductVariantBuilder } from './product-variant.builder'
import { ProductController } from './product.controller'
import { ProductRepository } from './product.repository'
import { ProductService } from './product.service'

@Module({
	controllers: [ProductController],
	imports: [PrismaModule, S3Module],
	providers: [
		ProductService,
		ProductReadService,
		ProductRepository,
		ProductAttributeBuilder,
		ProductVariantBuilder,
		ProductSeoSyncService,
		SeoRepository,
		ProductMediaMapper,
		MediaRepository,
		MediaUrlService
	],
	exports: [ProductService]
})
export class ProductModule {}

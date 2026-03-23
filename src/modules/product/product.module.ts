import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { S3Module } from '@/modules/s3/s3.module'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'

import { ProductAttributeBuilder } from './product-attribute.builder'
import { ProductVariantBuilder } from './product-variant.builder'
import { ProductController } from './product.controller'
import { ProductRepository } from './product.repository'
import { ProductService } from './product.service'

@Module({
	controllers: [ProductController],
	imports: [PrismaModule, S3Module],
	providers: [
		ProductService,
		ProductRepository,
		ProductAttributeBuilder,
		ProductVariantBuilder,
		MediaRepository,
		MediaUrlService
	]
})
export class ProductModule {}

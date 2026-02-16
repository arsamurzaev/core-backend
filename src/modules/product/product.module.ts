import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { MediaRepository } from '@/shared/media/media.repository'
import { MediaUrlService } from '@/shared/media/media-url.service'

import { ProductAttributeBuilder } from './product-attribute.builder'
import { ProductVariantBuilder } from './product-variant.builder'
import { ProductController } from './product.controller'
import { ProductRepository } from './product.repository'
import { ProductService } from './product.service'

@Module({
	controllers: [ProductController],
	imports: [PrismaModule],
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

import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { CapabilityModule } from '@/modules/capability/capability.module'
import { S3Module } from '@/modules/s3/s3.module'
import { SeoRepository } from '@/modules/seo/seo.repository'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { ProductMediaMapper } from '@/shared/media/product-media.mapper'

import {
	PRODUCT_COMMAND_PORT,
	PRODUCT_PRICING_PORT,
	PRODUCT_READER_PORT
} from './contracts'
import { ProductAttributeBuilder } from './product-attribute.builder'
import { ProductCommandService } from './product-command.service'
import { ProductMaintenanceService } from './product-maintenance.service'
import { ProductPricingService } from './product-pricing.service'
import { ProductReadService } from './product-read.service'
import { ProductSeoSyncService } from './product-seo-sync.service'
import { ProductTypeChangeService } from './product-type-change.service'
import { ProductVariantBuilder } from './product-variant.builder'
import { ProductVariantService } from './product-variant.service'
import { ProductWriteFinalizer } from './product-write-finalizer.service'
import { ProductController } from './product.controller'
import { ProductRepository } from './product.repository'
import { ProductService } from './product.service'

@Module({
	controllers: [ProductController],
	imports: [PrismaModule, S3Module, CapabilityModule],
	providers: [
		ProductService,
		ProductCommandService,
		ProductMaintenanceService,
		ProductWriteFinalizer,
		ProductPricingService,
		ProductReadService,
		ProductTypeChangeService,
		ProductVariantService,
		ProductRepository,
		ProductAttributeBuilder,
		ProductVariantBuilder,
		ProductSeoSyncService,
		SeoRepository,
		ProductMediaMapper,
		MediaRepository,
		MediaUrlService,
		{ provide: PRODUCT_COMMAND_PORT, useExisting: ProductService },
		{ provide: PRODUCT_READER_PORT, useExisting: ProductReadService },
		{ provide: PRODUCT_PRICING_PORT, useExisting: ProductPricingService }
	],
	exports: [
		ProductService,
		ProductMaintenanceService,
		PRODUCT_COMMAND_PORT,
		PRODUCT_READER_PORT,
		PRODUCT_PRICING_PORT
	]
})
export class ProductModule {}

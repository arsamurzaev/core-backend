import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { CapabilityModule } from '@/modules/capability/public'
import { CatalogPriceListModule } from '@/modules/catalog-price-list/public'
import { S3Module } from '@/modules/s3/public'
import { SeoModule } from '@/modules/seo/public'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'
import { ProductMediaMapper } from '@/shared/media/product-media.mapper'

import {
	PRODUCT_CATEGORY_READ_PROJECTOR_PORT,
	PRODUCT_COMMAND_PORT,
	PRODUCT_EXTERNAL_SYNC_PORT,
	PRODUCT_MAINTENANCE_PORT,
	PRODUCT_PRICING_PORT,
	PRODUCT_READER_PORT,
	PRODUCT_SELLABLE_READER_PORT,
	PRODUCT_VARIANT_PROJECTION_PORT
} from './contracts'
import { ProductAttributeBuilder } from './product-attribute.builder'
import { ProductCommandService } from './product-command.service'
import { ProductExternalSyncService } from './product-external-sync.service'
import { ProductMaintenanceService } from './product-maintenance.service'
import { ProductPricingService } from './product-pricing.service'
import { ProductReadService } from './product-read.service'
import { ProductSellableService } from './product-sellable.service'
import { ProductSeoDomainEventHandler } from './product-seo-domain-event.handler'
import { ProductSeoSyncService } from './product-seo-sync.service'
import { ProductTypeChangeService } from './product-type-change.service'
import { ProductVariantCardProjectionService } from './product-variant-card-projection.service'
import { ProductVariantBuilder } from './product-variant.builder'
import { ProductVariantService } from './product-variant.service'
import { ProductWriteFinalizer } from './product-write-finalizer.service'
import { ProductController } from './product.controller'
import { ProductRepository } from './product.repository'
import { ProductService } from './product.service'

@Module({
	controllers: [ProductController],
	imports: [
		PrismaModule,
		S3Module,
		CapabilityModule,
		CatalogPriceListModule,
		SeoModule
	],
	providers: [
		ProductService,
		ProductCommandService,
		ProductExternalSyncService,
		ProductMaintenanceService,
		ProductWriteFinalizer,
		ProductPricingService,
		ProductVariantCardProjectionService,
		ProductReadService,
		ProductSellableService,
		ProductTypeChangeService,
		ProductVariantService,
		ProductRepository,
		ProductAttributeBuilder,
		ProductVariantBuilder,
		ProductSeoSyncService,
		ProductSeoDomainEventHandler,
		ProductMediaMapper,
		MediaRepository,
		MediaUrlService,
		{
			provide: PRODUCT_CATEGORY_READ_PROJECTOR_PORT,
			useExisting: ProductReadService
		},
		{ provide: PRODUCT_COMMAND_PORT, useExisting: ProductService },
		{
			provide: PRODUCT_EXTERNAL_SYNC_PORT,
			useExisting: ProductExternalSyncService
		},
		{ provide: PRODUCT_MAINTENANCE_PORT, useExisting: ProductMaintenanceService },
		{ provide: PRODUCT_READER_PORT, useExisting: ProductReadService },
		{ provide: PRODUCT_PRICING_PORT, useExisting: ProductPricingService },
		{
			provide: PRODUCT_SELLABLE_READER_PORT,
			useExisting: ProductSellableService
		},
		{
			provide: PRODUCT_VARIANT_PROJECTION_PORT,
			useExisting: ProductVariantCardProjectionService
		}
	],
	exports: [
		PRODUCT_CATEGORY_READ_PROJECTOR_PORT,
		PRODUCT_COMMAND_PORT,
		PRODUCT_EXTERNAL_SYNC_PORT,
		PRODUCT_MAINTENANCE_PORT,
		PRODUCT_READER_PORT,
		PRODUCT_PRICING_PORT,
		PRODUCT_SELLABLE_READER_PORT,
		PRODUCT_VARIANT_PROJECTION_PORT
	]
})
export class ProductModule {}

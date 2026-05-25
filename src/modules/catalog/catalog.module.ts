import { Module } from '@nestjs/common'

import { CapabilityModule } from '@/modules/capability/public'
import { CatalogSaleUnitModule } from '@/modules/catalog-sale-unit/public'
import { IntegrationModule } from '@/modules/integration/public'
import { S3Module } from '@/modules/s3/public'
import { SeoRepository } from '@/modules/seo/public'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'

import { CatalogAdvancedSettingsController } from './catalog-advanced-settings.controller'
import { CatalogAdvancedSettingsService } from './catalog-advanced-settings.service'
import { CATALOG_DOMAIN_MAINTENANCE_PORT } from './contracts'
import { CatalogDomainController } from './catalog-domain.controller'
import { CatalogDomainRepository } from './catalog-domain.repository'
import { CatalogDomainService } from './catalog-domain.service'
import { CatalogFeatureEntitlementService } from './catalog-feature-entitlement.service'
import { CatalogSeoSyncService } from './catalog-seo-sync.service'
import { CatalogController } from './catalog.controller'
import { CatalogRepository } from './catalog.repository'
import { CatalogService } from './catalog.service'
import { CatalogFeatureEntitlementGuard } from './guards/catalog-feature-entitlement.guard'
import { InternalTlsController } from './internal-tls.controller'

@Module({
	imports: [S3Module, IntegrationModule, CapabilityModule, CatalogSaleUnitModule],
	controllers: [
		CatalogAdvancedSettingsController,
		CatalogController,
		CatalogDomainController,
		InternalTlsController
	],
	providers: [
		CatalogService,
		CatalogAdvancedSettingsService,
		CatalogDomainService,
		CatalogFeatureEntitlementService,
		CatalogFeatureEntitlementGuard,
		CatalogSeoSyncService,
		CatalogDomainRepository,
		CatalogRepository,
		SeoRepository,
		MediaRepository,
		MediaUrlService,
		{
			provide: CATALOG_DOMAIN_MAINTENANCE_PORT,
			useExisting: CatalogDomainService
		}
	],
	exports: [
		CatalogDomainService,
		CATALOG_DOMAIN_MAINTENANCE_PORT,
		CatalogFeatureEntitlementService,
		CatalogFeatureEntitlementGuard
	]
})
export class CatalogModule {}

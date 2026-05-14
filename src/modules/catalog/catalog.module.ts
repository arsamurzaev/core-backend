import { Module } from '@nestjs/common'

import { CapabilityModule } from '@/modules/capability/capability.module'
import { IntegrationModule } from '@/modules/integration/integration.module'
import { S3Module } from '@/modules/s3/s3.module'
import { SeoRepository } from '@/modules/seo/seo.repository'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'

import { CatalogAdvancedSettingsController } from './catalog-advanced-settings.controller'
import { CatalogAdvancedSettingsService } from './catalog-advanced-settings.service'
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
	imports: [S3Module, IntegrationModule, CapabilityModule],
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
		MediaUrlService
	],
	exports: [
		CatalogDomainService,
		CatalogFeatureEntitlementService,
		CatalogFeatureEntitlementGuard
	]
})
export class CatalogModule {}

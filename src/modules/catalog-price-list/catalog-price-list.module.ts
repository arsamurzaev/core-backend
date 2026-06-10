import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { CapabilityModule } from '@/modules/capability/public'
import { CacheModule } from '@/shared/cache/cache.module'

import { CatalogPriceListResolverService } from './catalog-price-list-resolver.service'
import { CatalogPriceListController } from './catalog-price-list.controller'
import { CatalogPriceListRepository } from './catalog-price-list.repository'
import { CatalogPriceListService } from './catalog-price-list.service'

@Module({
	imports: [PrismaModule, CapabilityModule, CacheModule],
	controllers: [CatalogPriceListController],
	providers: [
		CatalogPriceListService,
		CatalogPriceListRepository,
		CatalogPriceListResolverService
	],
	exports: [CatalogPriceListService, CatalogPriceListResolverService]
})
export class CatalogPriceListModule {}

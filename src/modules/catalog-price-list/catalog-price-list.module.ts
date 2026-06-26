import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { CapabilityModule } from '@/modules/capability/public'
import { CacheModule } from '@/shared/cache/cache.module'

import { CatalogPriceListResolverService } from './catalog-price-list-resolver.service'
import { CatalogPriceListController } from './catalog-price-list.controller'
import { CatalogPriceListRepository } from './catalog-price-list.repository'
import { CatalogPriceListService } from './catalog-price-list.service'
import {
	CATALOG_PRICE_LIST_MANAGEMENT_PORT,
	CATALOG_PRICE_LIST_RESOLVER_PORT
} from './contracts'

@Module({
	imports: [PrismaModule, CapabilityModule, CacheModule],
	controllers: [CatalogPriceListController],
	providers: [
		CatalogPriceListService,
		CatalogPriceListRepository,
		CatalogPriceListResolverService,
		{
			provide: CATALOG_PRICE_LIST_MANAGEMENT_PORT,
			useExisting: CatalogPriceListService
		},
		{
			provide: CATALOG_PRICE_LIST_RESOLVER_PORT,
			useExisting: CatalogPriceListResolverService
		}
	],
	exports: [CATALOG_PRICE_LIST_MANAGEMENT_PORT, CATALOG_PRICE_LIST_RESOLVER_PORT]
})
export class CatalogPriceListModule {}

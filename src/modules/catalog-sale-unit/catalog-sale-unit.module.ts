import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { CapabilityModule } from '@/modules/capability/public'

import { CatalogSaleUnitController } from './catalog-sale-unit.controller'
import { CatalogSaleUnitRepository } from './catalog-sale-unit.repository'
import { CatalogSaleUnitService } from './catalog-sale-unit.service'
import { CATALOG_SALE_UNIT_MANAGEMENT_PORT } from './contracts'

@Module({
	imports: [PrismaModule, CapabilityModule],
	controllers: [CatalogSaleUnitController],
	providers: [
		CatalogSaleUnitService,
		CatalogSaleUnitRepository,
		{
			provide: CATALOG_SALE_UNIT_MANAGEMENT_PORT,
			useExisting: CatalogSaleUnitService
		}
	],
	exports: [CATALOG_SALE_UNIT_MANAGEMENT_PORT]
})
export class CatalogSaleUnitModule {}

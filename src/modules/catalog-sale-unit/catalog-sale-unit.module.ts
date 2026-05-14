import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { CapabilityModule } from '@/modules/capability/capability.module'

import { CatalogSaleUnitController } from './catalog-sale-unit.controller'
import { CatalogSaleUnitRepository } from './catalog-sale-unit.repository'
import { CatalogSaleUnitService } from './catalog-sale-unit.service'

@Module({
	imports: [PrismaModule, CapabilityModule],
	controllers: [CatalogSaleUnitController],
	providers: [CatalogSaleUnitService, CatalogSaleUnitRepository],
	exports: [CatalogSaleUnitService, CatalogSaleUnitRepository]
})
export class CatalogSaleUnitModule {}

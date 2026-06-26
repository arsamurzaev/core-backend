import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { CapabilityModule } from '@/modules/capability/public'
import { CacheModule } from '@/shared/cache/cache.module'

import { CatalogModifierController } from './catalog-modifier.controller'
import { CatalogModifierRepository } from './catalog-modifier.repository'
import { CatalogModifierService } from './catalog-modifier.service'
import { CATALOG_MODIFIER_MANAGEMENT_PORT } from './contracts'

@Module({
	imports: [PrismaModule, CapabilityModule, CacheModule],
	controllers: [CatalogModifierController],
	providers: [
		CatalogModifierService,
		CatalogModifierRepository,
		{
			provide: CATALOG_MODIFIER_MANAGEMENT_PORT,
			useExisting: CatalogModifierService
		}
	],
	exports: [CATALOG_MODIFIER_MANAGEMENT_PORT]
})
export class CatalogModifierModule {}

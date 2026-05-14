import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'

import { CatalogModule } from '@/modules/catalog/catalog.module'
import { InventoryModule } from '@/modules/inventory/inventory.module'
import { ProductModule } from '@/modules/product/product.module'

import { CatalogDomainCronService } from './catalog-domain.cron.service'
import { InventoryReservationCronService } from './inventory-reservation.cron.service'
import { ProductDiscountCronService } from './product-discount.cron.service'

@Module({
	imports: [
		ScheduleModule.forRoot(),
		ProductModule,
		CatalogModule,
		InventoryModule
	],
	providers: [
		ProductDiscountCronService,
		CatalogDomainCronService,
		InventoryReservationCronService
	]
})
export class CronModule {}

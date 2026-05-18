import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'

import { CatalogModule } from '@/modules/catalog/public'
import { InventoryModule } from '@/modules/inventory/public'
import { ProductModule } from '@/modules/product/public'

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

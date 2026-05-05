import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'

import { CatalogModule } from '@/modules/catalog/catalog.module'
import { ProductModule } from '@/modules/product/product.module'

import { CatalogDomainCronService } from './catalog-domain.cron.service'
import { ProductDiscountCronService } from './product-discount.cron.service'

@Module({
	imports: [ScheduleModule.forRoot(), ProductModule, CatalogModule],
	providers: [ProductDiscountCronService, CatalogDomainCronService]
})
export class CronModule {}

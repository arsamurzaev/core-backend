import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'

import { ProductModule } from '@/modules/product/product.module'

import { ProductDiscountCronService } from './product-discount.cron.service'

@Module({
	imports: [ScheduleModule.forRoot(), ProductModule],
	providers: [ProductDiscountCronService]
})
export class CronModule {}

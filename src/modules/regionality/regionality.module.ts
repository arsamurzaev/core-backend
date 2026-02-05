import { Module } from '@nestjs/common'

import { RegionalityController } from './regionality.controller'
import { RegionalityService } from './regionality.service'

@Module({
	controllers: [RegionalityController],
	providers: [RegionalityService]
})
export class RegionalityModule {}

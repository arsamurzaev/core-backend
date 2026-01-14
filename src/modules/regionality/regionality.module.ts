import { Module } from '@nestjs/common';
import { RegionalityService } from './regionality.service';
import { RegionalityController } from './regionality.controller';

@Module({
  controllers: [RegionalityController],
  providers: [RegionalityService],
})
export class RegionalityModule {}

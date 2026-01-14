import { Module } from '@nestjs/common';
import { SeoService } from './seo.service';
import { SeoController } from './seo.controller';

@Module({
  controllers: [SeoController],
  providers: [SeoService],
})
export class SeoModule {}

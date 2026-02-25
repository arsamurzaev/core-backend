import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'

import { BrandController } from './brand.controller'
import { BrandRepository } from './brand.repository'
import { BrandService } from './brand.service'

@Module({
	controllers: [BrandController],
	imports: [PrismaModule],
	providers: [BrandService, BrandRepository]
})
export class BrandModule {}

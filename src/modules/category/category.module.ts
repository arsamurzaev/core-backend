import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { CapabilityModule } from '@/modules/capability/public'
import { ProductModule } from '@/modules/product/public'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { MediaRepository } from '@/shared/media/media.repository'

import { CategoryController } from './category.controller'
import { CategoryRepository } from './category.repository'
import { CategoryService } from './category.service'
import { CATEGORY_COMMAND_PORT, CATEGORY_READER_PORT } from './contracts'

@Module({
	controllers: [CategoryController],
	imports: [PrismaModule, ProductModule, CapabilityModule],
	providers: [
		CategoryService,
		CategoryRepository,
		MediaRepository,
		MediaUrlService,
		{ provide: CATEGORY_READER_PORT, useExisting: CategoryService },
		{ provide: CATEGORY_COMMAND_PORT, useExisting: CategoryService }
	],
	exports: [CATEGORY_READER_PORT, CATEGORY_COMMAND_PORT]
})
export class CategoryModule {}

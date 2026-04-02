import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { ProductMediaMapper } from '@/shared/media/product-media.mapper'
import { MediaRepository } from '@/shared/media/media.repository'

import { CategoryController } from './category.controller'
import { CategoryRepository } from './category.repository'
import { CategoryService } from './category.service'

@Module({
	controllers: [CategoryController],
	imports: [PrismaModule],
	providers: [
		CategoryService,
		CategoryRepository,
		MediaRepository,
		MediaUrlService,
		ProductMediaMapper
	]
})
export class CategoryModule {}

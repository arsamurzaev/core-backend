import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'

import { CategoryController } from './category.controller'
import { CategoryRepository } from './category.repository'
import { CategoryService } from './category.service'

@Module({
	controllers: [CategoryController],
	imports: [PrismaModule],
	providers: [CategoryService, CategoryRepository]
})
export class CategoryModule {}

import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'

import { ProductController } from './product.controller'
import { ProductAttributeBuilder } from './product-attribute.builder'
import { ProductRepository } from './product.repository'
import { ProductService } from './product.service'

@Module({
	controllers: [ProductController],
	imports: [PrismaModule],
	providers: [ProductService, ProductRepository, ProductAttributeBuilder]
})
export class ProductModule {}

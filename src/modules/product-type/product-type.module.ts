import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { CapabilityModule } from '@/modules/capability/public'

import {
	PRODUCT_TYPE_COMMAND_PORT,
	PRODUCT_TYPE_SCHEMA_PORT,
	PRODUCT_TYPE_VARIANT_ATTRIBUTES_PORT
} from './contracts'
import { ProductTypeController } from './product-type.controller'
import { ProductTypeRepository } from './product-type.repository'
import { ProductTypeService } from './product-type.service'

@Module({
	imports: [PrismaModule, CapabilityModule],
	controllers: [ProductTypeController],
	providers: [
		ProductTypeService,
		ProductTypeRepository,
		{ provide: PRODUCT_TYPE_COMMAND_PORT, useExisting: ProductTypeService },
		{ provide: PRODUCT_TYPE_SCHEMA_PORT, useExisting: ProductTypeService },
		{
			provide: PRODUCT_TYPE_VARIANT_ATTRIBUTES_PORT,
			useExisting: ProductTypeService
		}
	],
	exports: [
		ProductTypeService,
		PRODUCT_TYPE_COMMAND_PORT,
		PRODUCT_TYPE_SCHEMA_PORT,
		PRODUCT_TYPE_VARIANT_ATTRIBUTES_PORT
	]
})
export class ProductTypeModule {}

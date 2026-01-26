import { Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'

import { AttributeController } from './attribute.controller'
import { AttributeRepository } from './attribute.repository'
import { AttributeService } from './attribute.service'

@Module({
	controllers: [AttributeController],
	imports: [PrismaModule],
	providers: [AttributeService, AttributeRepository],
	exports: [AttributeService]
})
export class AttributeModule {}

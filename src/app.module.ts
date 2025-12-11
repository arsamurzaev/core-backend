import { Module } from '@nestjs/common'

import { PrismaModule } from './core/prisma/prisma.module'
import { IntegrationModule } from './modules/integration/integration.module'

@Module({
	imports: [PrismaModule, IntegrationModule]
})
export class AppModule {}

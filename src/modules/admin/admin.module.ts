import { Module } from '@nestjs/common'

import { SessionModule } from '@/modules/auth/session/session.module'
import { IntegrationModule } from '@/modules/integration/integration.module'

import { AdminSsoController } from './admin-sso.controller'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
	imports: [SessionModule, IntegrationModule],
	controllers: [AdminController, AdminSsoController],
	providers: [AdminService]
})
export class AdminModule {}

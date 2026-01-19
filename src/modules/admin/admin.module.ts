import { Module } from '@nestjs/common'

import { AdminSsoController } from './admin-sso.controller'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
	controllers: [AdminController, AdminSsoController],
	providers: [AdminService]
})
export class AdminModule {}

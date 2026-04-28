import { Module } from '@nestjs/common'

import { S3Module } from '@/modules/s3/s3.module'
import { MediaUrlService } from '@/shared/media/media-url.service'

import { AdminSsoController } from './admin-sso.controller'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
	imports: [S3Module],
	controllers: [AdminController, AdminSsoController],
	providers: [AdminService, MediaUrlService]
})
export class AdminModule {}

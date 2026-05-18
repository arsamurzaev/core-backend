import { Module } from '@nestjs/common'

import { CapabilityModule } from '@/modules/capability/public'
import { ProductModule } from '@/modules/product/public'
import { S3Module } from '@/modules/s3/public'
import { MediaUrlService } from '@/shared/media/media-url.service'

import { AdminSsoController } from './admin-sso.controller'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
	imports: [S3Module, CapabilityModule, ProductModule],
	controllers: [AdminController, AdminSsoController],
	providers: [AdminService, MediaUrlService]
})
export class AdminModule {}

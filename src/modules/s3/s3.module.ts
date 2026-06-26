import { Module } from '@nestjs/common'

import { MEDIA_STORAGE_PORT } from './contracts'
import { S3Controller } from './s3.controller'
import { S3Service } from './s3.service'

@Module({
	controllers: [S3Controller],
	providers: [
		S3Service,
		{
			provide: MEDIA_STORAGE_PORT,
			useExisting: S3Service
		}
	],
	exports: [MEDIA_STORAGE_PORT]
})
export class S3Module {}

import { Module } from '@nestjs/common'

import { MediaRepository } from '@/shared/media/media.repository'

import { S3Module } from '../s3/s3.module'

import { IntegrationController } from './integration.controller'
import { IntegrationRepository } from './integration.repository'
import { IntegrationService } from './integration.service'
import { MoySkladMetadataCryptoService } from './providers/moysklad/moysklad.metadata'
import { MoySkladQueueService } from './providers/moysklad/moysklad.queue.service'
import { MoySkladSyncService } from './providers/moysklad/moysklad.sync.service'

@Module({
	imports: [S3Module],
	controllers: [IntegrationController],
	providers: [
		IntegrationService,
		IntegrationRepository,
		MoySkladMetadataCryptoService,
		MoySkladQueueService,
		MoySkladSyncService,
		MediaRepository
	]
})
export class IntegrationModule {}

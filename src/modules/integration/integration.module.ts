import { Module } from '@nestjs/common'

import { CapabilityModule } from '@/modules/capability/capability.module'
import { MediaRepository } from '@/shared/media/media.repository'

import { S3Module } from '../s3/s3.module'

import { ORDER_EXPORT_PORT } from './contracts'
import { IntegrationController } from './integration.controller'
import { IntegrationRepository } from './integration.repository'
import { IntegrationService } from './integration.service'
import { MoySkladImageImportService } from './providers/moysklad/moysklad.image-import.service'
import { MoySkladMetadataCryptoService } from './providers/moysklad/moysklad.metadata'
import { MoySkladMissingProductSyncService } from './providers/moysklad/moysklad.missing-product-sync.service'
import { MoySkladOrderExportQueueService } from './providers/moysklad/moysklad.order-export.queue.service'
import { MoySkladOrderExportService } from './providers/moysklad/moysklad.order-export.service'
import { MoySkladProductFolderSyncService } from './providers/moysklad/moysklad.product-folder-sync.service'
import { MoySkladProductSyncService } from './providers/moysklad/moysklad.product-sync.service'
import { MoySkladQueueService } from './providers/moysklad/moysklad.queue.service'
import { MoySkladStockSyncService } from './providers/moysklad/moysklad.stock-sync.service'
import { MoySkladSyncOrchestratorService } from './providers/moysklad/moysklad.sync-orchestrator.service'
import { MoySkladSyncRunRecorderService } from './providers/moysklad/moysklad.sync-run-recorder.service'
import { MoySkladSyncService } from './providers/moysklad/moysklad.sync.service'
import { MoySkladVariantAttributeResolverService } from './providers/moysklad/moysklad.variant-attribute-resolver.service'
import { MoySkladVariantSyncService } from './providers/moysklad/moysklad.variant-sync.service'

@Module({
	imports: [S3Module, CapabilityModule],
	controllers: [IntegrationController],
	providers: [
		IntegrationService,
		IntegrationRepository,
		MoySkladImageImportService,
		MoySkladMetadataCryptoService,
		MoySkladMissingProductSyncService,
		MoySkladOrderExportQueueService,
		MoySkladOrderExportService,
		MoySkladQueueService,
		MoySkladProductFolderSyncService,
		MoySkladProductSyncService,
		MoySkladStockSyncService,
		MoySkladSyncOrchestratorService,
		MoySkladSyncRunRecorderService,
		MoySkladSyncService,
		MoySkladVariantAttributeResolverService,
		MoySkladVariantSyncService,
		MediaRepository,
		{ provide: ORDER_EXPORT_PORT, useExisting: MoySkladOrderExportQueueService }
	],
	exports: [
		IntegrationService,
		MoySkladQueueService,
		MoySkladOrderExportQueueService,
		ORDER_EXPORT_PORT
	]
})
export class IntegrationModule {}

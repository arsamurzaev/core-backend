import { Module } from '@nestjs/common'

import { CapabilityModule } from '@/modules/capability/public'
import { INVENTORY_EXTERNAL_STOCK_PORT } from '@/modules/inventory/contracts'
import { ProductModule } from '@/modules/product/public'
import { MediaRepository } from '@/shared/media/media.repository'

import { S3Module } from '@/modules/s3/public'

import { ORDER_EXPORT_PORT } from './contracts'
import { IntegrationController } from './integration.controller'
import { IntegrationOrderExportDispatcherService } from './integration-order-export-dispatcher.service'
import { IntegrationPayloadTokenService } from './integration-payload-token.service'
import { IntegrationRepository } from './integration.repository'
import { IntegrationService } from './integration.service'
import { IikoImageImportService } from './providers/iiko/iiko.image-import.service'
import { IikoMetadataCryptoService } from './providers/iiko/iiko.metadata'
import { IikoOrderExportQueueService } from './providers/iiko/iiko.order-export.queue.service'
import { IikoOrderExportService } from './providers/iiko/iiko.order-export.service'
import { IikoQueueService } from './providers/iiko/iiko.queue.service'
import { IikoSyncService } from './providers/iiko/iiko.sync.service'
import { MoySkladImageImportService } from './providers/moysklad/moysklad.image-import.service'
import { MoySkladMetadataCryptoService } from './providers/moysklad/moysklad.metadata'
import { MoySkladMissingProductSyncService } from './providers/moysklad/moysklad.missing-product-sync.service'
import { MoySkladOrderExportQueueService } from './providers/moysklad/moysklad.order-export.queue.service'
import { MoySkladOrderExportService } from './providers/moysklad/moysklad.order-export.service'
import { MoySkladProductFolderSyncService } from './providers/moysklad/moysklad.product-folder-sync.service'
import { MoySkladProductSyncService } from './providers/moysklad/moysklad.product-sync.service'
import { MoySkladQueueService } from './providers/moysklad/moysklad.queue.service'
import { MoySkladStockSyncService } from './providers/moysklad/moysklad.stock-sync.service'
import { MoySkladSyncCompletedDiagnosticsHandler } from './providers/moysklad/moysklad.sync-completed-diagnostics.handler'
import { MoySkladSyncOrchestratorService } from './providers/moysklad/moysklad.sync-orchestrator.service'
import { MoySkladSyncRunRecorderService } from './providers/moysklad/moysklad.sync-run-recorder.service'
import { MoySkladSyncService } from './providers/moysklad/moysklad.sync.service'
import { MoySkladVariantAttributeResolverService } from './providers/moysklad/moysklad.variant-attribute-resolver.service'
import { MoySkladVariantSyncService } from './providers/moysklad/moysklad.variant-sync.service'

@Module({
	imports: [S3Module, CapabilityModule, ProductModule],
	controllers: [IntegrationController],
	providers: [
		IntegrationService,
		IntegrationOrderExportDispatcherService,
		IntegrationPayloadTokenService,
		IntegrationRepository,
		IikoImageImportService,
		IikoMetadataCryptoService,
		IikoOrderExportQueueService,
		IikoOrderExportService,
		IikoQueueService,
		IikoSyncService,
		MoySkladImageImportService,
		MoySkladMetadataCryptoService,
		MoySkladMissingProductSyncService,
		MoySkladOrderExportQueueService,
		MoySkladOrderExportService,
		MoySkladQueueService,
		MoySkladProductFolderSyncService,
		MoySkladProductSyncService,
		MoySkladStockSyncService,
		MoySkladSyncCompletedDiagnosticsHandler,
		MoySkladSyncOrchestratorService,
		MoySkladSyncRunRecorderService,
		MoySkladSyncService,
		MoySkladVariantAttributeResolverService,
		MoySkladVariantSyncService,
		MediaRepository,
		{
			provide: ORDER_EXPORT_PORT,
			useExisting: IntegrationOrderExportDispatcherService
		},
		{
			provide: INVENTORY_EXTERNAL_STOCK_PORT,
			useExisting: MoySkladStockSyncService
		}
	],
	exports: [
		IntegrationService,
		IntegrationPayloadTokenService,
		IikoQueueService,
		IikoOrderExportQueueService,
		MoySkladQueueService,
		MoySkladOrderExportQueueService,
		ORDER_EXPORT_PORT,
		INVENTORY_EXTERNAL_STOCK_PORT
	]
})
export class IntegrationModule {}

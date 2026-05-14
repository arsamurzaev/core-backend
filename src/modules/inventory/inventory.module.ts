import { Module } from '@nestjs/common'

import { CapabilityModule } from '@/modules/capability/capability.module'

import { INVENTORY_RESERVATION_PORT } from './contracts'
import { InventoryController } from './inventory.controller'
import { InventoryRepository } from './inventory.repository'
import { InventoryService } from './inventory.service'

@Module({
	imports: [CapabilityModule],
	controllers: [InventoryController],
	providers: [
		InventoryService,
		InventoryRepository,
		{ provide: INVENTORY_RESERVATION_PORT, useExisting: InventoryService }
	],
	exports: [InventoryService, INVENTORY_RESERVATION_PORT]
})
export class InventoryModule {}

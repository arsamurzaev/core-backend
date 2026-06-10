import { Module } from '@nestjs/common'

import { CapabilityModule } from '@/modules/capability/public'
import { CatalogPriceListModule } from '@/modules/catalog-price-list/public'
import { IntegrationModule } from '@/modules/integration/public'
import { InventoryModule } from '@/modules/inventory/public'
import { ProductModule } from '@/modules/product/public'
import { MediaUrlService } from '@/shared/media/media-url.service'

import { CartCurrentService } from './cart-current.service'
import { CartInventoryReservationService } from './cart-inventory-reservation.service'
import { CartLifecycleService } from './cart-lifecycle.service'
import { CartLinePricingService } from './cart-line-pricing.service'
import { CartLineService } from './cart-line.service'
import { CartLookupService } from './cart-lookup.service'
import { CartManagerSessionService } from './cart-manager-session.service'
import { CartModifierSelectionService } from './cart-modifier-selection.service'
import { CartOrderExportService } from './cart-order-export.service'
import { CartOrderSnapshotService } from './cart-order-snapshot.service'
import { CartShareService } from './cart-share.service'
import { CartSseService } from './cart-sse.service'
import { CartVariantSelectionService } from './cart-variant-selection.service'
import { CartController } from './cart.controller'
import { CartService } from './cart.service'
import { OrderCheckoutService } from './order-checkout.service'

@Module({
	imports: [
		CapabilityModule,
		CatalogPriceListModule,
		IntegrationModule,
		InventoryModule,
		ProductModule
	],
	controllers: [CartController],
	providers: [
		CartService,
		CartInventoryReservationService,
		CartCurrentService,
		CartLinePricingService,
		CartLineService,
		CartLookupService,
		CartLifecycleService,
		CartManagerSessionService,
		CartModifierSelectionService,
		CartOrderExportService,
		CartOrderSnapshotService,
		CartShareService,
		CartSseService,
		CartVariantSelectionService,
		OrderCheckoutService,
		MediaUrlService
	]
})
export class CartModule {}

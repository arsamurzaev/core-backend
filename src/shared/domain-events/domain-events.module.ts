import { Global, Module } from '@nestjs/common'

import { PrismaModule } from '@/infrastructure/prisma/prisma.module'
import { CacheModule } from '@/shared/cache/cache.module'

import { CatalogCacheInvalidationHandler } from './catalog-cache-invalidation.handler'
import { DomainEventOutboxCleanupService } from './domain-event-outbox-cleanup.service'
import { DomainEventOutboxDiagnosticsService } from './domain-event-outbox-diagnostics.service'
import { DomainEventOutboxDrainService } from './domain-event-outbox-drain.service'
import { DomainEventOutboxDispatcher } from './domain-event-outbox.dispatcher'
import { DomainEventOutboxRepository } from './domain-event-outbox.repository'
import {
	DOMAIN_EVENT_BUS,
	DOMAIN_EVENT_DISPATCHER,
	DOMAIN_EVENT_OUTBOX
} from './domain-events.contract'
import { InProcessDomainEventBus } from './in-process-domain-event-bus'

@Global()
@Module({
	imports: [CacheModule, PrismaModule],
	providers: [
		InProcessDomainEventBus,
		DomainEventOutboxRepository,
		DomainEventOutboxDispatcher,
		DomainEventOutboxDiagnosticsService,
		DomainEventOutboxDrainService,
		DomainEventOutboxCleanupService,
		CatalogCacheInvalidationHandler,
		{ provide: DOMAIN_EVENT_BUS, useExisting: InProcessDomainEventBus },
		{
			provide: DOMAIN_EVENT_DISPATCHER,
			useExisting: DomainEventOutboxDispatcher
		},
		{ provide: DOMAIN_EVENT_OUTBOX, useExisting: DomainEventOutboxRepository }
	],
	exports: [
		DOMAIN_EVENT_BUS,
		DOMAIN_EVENT_DISPATCHER,
		DOMAIN_EVENT_OUTBOX,
		DomainEventOutboxDiagnosticsService
	]
})
export class DomainEventsModule {}

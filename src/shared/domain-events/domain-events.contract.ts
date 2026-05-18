export const DOMAIN_EVENT_DISPATCHER = Symbol('DOMAIN_EVENT_DISPATCHER')
export const DOMAIN_EVENT_BUS = Symbol('DOMAIN_EVENT_BUS')
export const DOMAIN_EVENT_OUTBOX = Symbol('DOMAIN_EVENT_OUTBOX')

export type DomainEventName =
	| 'order.completed'
	| 'product.changed'
	| 'product.variant_changed'
	| 'variant.stock_changed'
	| 'variant.price_changed'
	| 'integration.sync_completed'
	| 'catalog.capability_changed'
	| 'catalog.cache_invalidated'

export type DomainEventMeta = {
	eventId: string
	occurredAt: Date
	catalogId: string
}

export type DomainEventSource =
	| 'manual'
	| 'inventory'
	| 'integration'
	| 'cart'
	| 'order'
	| 'system'

export type CatalogCacheInvalidationScope =
	| {
			name: 'catalog'
			key?: string | null
	  }
	| {
			name: 'catalog_products'
			key?: string | null
	  }
	| {
			name: 'category_products'
			key?: string | null
	  }
	| {
			name: 'category_list'
			key?: string | null
	  }
	| {
			name: 'catalog_type'
			key: string
	  }

export type DomainEvent =
	| {
			eventId: string
			type: 'order.completed'
			catalogId: string
			orderId: string
			cartId?: string
			occurredAt: Date
	  }
	| {
			eventId: string
			type: 'product.changed'
			catalogId: string
			productId: string
			changes?: readonly string[]
			occurredAt: Date
	  }
	| {
			eventId: string
			type: 'product.variant_changed'
			catalogId: string
			productId: string
			variantId?: string | null
			changes?: readonly string[]
			occurredAt: Date
	  }
	| {
			eventId: string
			type: 'variant.stock_changed'
			catalogId: string
			productId?: string | null
			variantId: string
			previousStock?: number | null
			nextStock?: number | null
			source?: DomainEventSource
			reason?: string | null
			integrationId?: string | null
			externalId?: string | null
			runId?: string | null
			occurredAt: Date
	  }
	| {
			eventId: string
			type: 'variant.price_changed'
			catalogId: string
			productId?: string | null
			variantId: string
			previousPrice?: number | null
			nextPrice?: number | null
			source?: DomainEventSource
			reason?: string | null
			integrationId?: string | null
			externalId?: string | null
			runId?: string | null
			occurredAt: Date
	  }
	| {
			eventId: string
			type: 'integration.sync_completed'
			catalogId: string
			integrationId: string
			runId: string
			mode?: string
			trigger?: string
			occurredAt: Date
	  }
	| {
			eventId: string
			type: 'catalog.capability_changed'
			catalogId: string
			capability: string
			occurredAt: Date
	  }
	| {
			eventId: string
			type: 'catalog.cache_invalidated'
			catalogId: string
			scopes: readonly CatalogCacheInvalidationScope[]
			occurredAt: Date
	  }

// Handlers must be idempotent by eventId: outbox rows can be retried after
// failures, and the in-process bus deduplicates only successfully handled events.
export type DomainEventHandler<TEvent extends DomainEvent = DomainEvent> = (
	event: TEvent
) => Promise<void> | void

export interface DomainEventDispatcher {
	dispatch(event: DomainEvent): Promise<void>
	dispatchMany(events: DomainEvent[]): Promise<void>
}

export interface DomainEventBus extends DomainEventDispatcher {
	subscribe<TEvent extends DomainEvent>(
		type: TEvent['type'],
		handler: DomainEventHandler<TEvent>
	): () => void
}

export interface DomainEventOutboxWriter {
	appendTx(tx: unknown, events: DomainEvent[]): Promise<void>
}

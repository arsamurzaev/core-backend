export const DOMAIN_EVENT_DISPATCHER = Symbol('DOMAIN_EVENT_DISPATCHER')

export type DomainEvent =
	| {
			type: 'order.completed'
			catalogId: string
			orderId: string
			cartId?: string
			occurredAt: Date
	  }
	| {
			type: 'product.changed'
			catalogId: string
			productId: string
			occurredAt: Date
	  }
	| {
			type: 'stock.changed'
			catalogId: string
			variantId: string
			occurredAt: Date
	  }
	| {
			type: 'integration.sync_finished'
			catalogId: string
			integrationId: string
			runId: string
			occurredAt: Date
	  }
	| {
			type: 'capability.changed'
			catalogId: string
			capability: string
			occurredAt: Date
	  }

export interface DomainEventDispatcher {
	dispatch(event: DomainEvent): Promise<void>
}

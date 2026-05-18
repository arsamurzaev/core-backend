import type { Prisma } from '@generated/client'

import type { DomainEvent } from './domain-events.contract'

export type DomainEventAggregate = {
	aggregateType: string | null
	aggregateId: string | null
}

type StoredDomainEvent = Omit<DomainEvent, 'occurredAt'> & {
	occurredAt: string
}

export function serializeDomainEvent(
	event: DomainEvent
): Prisma.InputJsonValue {
	return {
		...event,
		occurredAt: event.occurredAt.toISOString()
	} as unknown as Prisma.InputJsonValue
}

export function deserializeDomainEvent(payload: unknown): DomainEvent {
	if (!payload || typeof payload !== 'object') {
		throw new Error('Invalid domain event payload')
	}

	const event = payload as StoredDomainEvent
	if (typeof event.occurredAt !== 'string') {
		throw new Error('Invalid domain event occurredAt')
	}

	return {
		...event,
		occurredAt: new Date(event.occurredAt)
	} as DomainEvent
}

export function resolveDomainEventAggregate(
	event: DomainEvent
): DomainEventAggregate {
	switch (event.type) {
		case 'order.completed':
			return { aggregateType: 'order', aggregateId: event.orderId }
		case 'product.changed':
			return { aggregateType: 'product', aggregateId: event.productId }
		case 'product.variant_changed':
			return {
				aggregateType: event.variantId ? 'product_variant' : 'product',
				aggregateId: event.variantId ?? event.productId
			}
		case 'variant.stock_changed':
		case 'variant.price_changed':
			return { aggregateType: 'product_variant', aggregateId: event.variantId }
		case 'integration.sync_completed':
			return { aggregateType: 'integration_sync_run', aggregateId: event.runId }
		case 'catalog.capability_changed':
		case 'catalog.cache_invalidated':
			return { aggregateType: 'catalog', aggregateId: event.catalogId }
		default:
			return { aggregateType: null, aggregateId: null }
	}
}

export function formatDomainEventError(error: unknown): string {
	if (error instanceof Error) return error.message.slice(0, 4000)
	return String(error).slice(0, 4000)
}

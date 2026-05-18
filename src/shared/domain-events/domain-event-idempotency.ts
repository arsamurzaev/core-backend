import type { DomainEvent } from './domain-events.contract'

export const DOMAIN_EVENT_IDEMPOTENCY_SCOPE = 'type:eventId' as const

export function buildDomainEventIdempotencyKey(
	event: Pick<DomainEvent, 'type' | 'eventId'>
): string {
	return `${event.type}:${event.eventId}`
}

import { randomUUID } from 'node:crypto'

import type { DomainEvent } from './domain-events.contract'

type DomainEventInput<TEvent extends DomainEvent> =
	TEvent extends DomainEvent
		? Omit<TEvent, 'eventId' | 'occurredAt'> &
				Partial<Pick<TEvent, 'eventId' | 'occurredAt'>>
		: never

export function createDomainEvent<TEvent extends DomainEvent>(
	event: DomainEventInput<TEvent>
): TEvent {
	return {
		...event,
		eventId: event.eventId ?? randomUUID(),
		occurredAt: event.occurredAt ?? new Date()
	} as unknown as TEvent
}

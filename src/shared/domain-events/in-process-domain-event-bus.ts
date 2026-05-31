import { Injectable, Logger } from '@nestjs/common'

import { buildDomainEventIdempotencyKey } from './domain-event-idempotency'
import type {
	DomainEvent,
	DomainEventBus,
	DomainEventHandler
} from './domain-events.contract'

@Injectable()
export class InProcessDomainEventBus implements DomainEventBus {
	private readonly logger = new Logger(InProcessDomainEventBus.name)
	private readonly handlers = new Map<string, Set<DomainEventHandler>>()
	private readonly handled = new Set<string>()
	private readonly handling = new Set<string>()

	subscribe<TEvent extends DomainEvent>(
		type: TEvent['type'],
		handler: DomainEventHandler<TEvent>
	): () => void {
		const handlers = this.handlers.get(type) ?? new Set<DomainEventHandler>()
		handlers.add(handler as DomainEventHandler)
		this.handlers.set(type, handlers)

		return () => handlers.delete(handler as DomainEventHandler)
	}

	async dispatch(event: DomainEvent): Promise<void> {
		const idempotencyKey = buildDomainEventIdempotencyKey(event)
		if (this.handled.has(idempotencyKey)) return
		if (this.handling.has(idempotencyKey)) return
		this.handling.add(idempotencyKey)

		const handlers = Array.from(this.handlers.get(event.type) ?? [])
		try {
			for (const handler of handlers) {
				await handler(event)
			}
			this.handled.add(idempotencyKey)
		} catch (error) {
			this.logger.error(
				`Domain event handler failed: type=${event.type}, eventId=${event.eventId}`,
				error instanceof Error ? error.stack : String(error)
			)
			throw error
		} finally {
			this.handling.delete(idempotencyKey)
		}
	}

	async dispatchMany(events: DomainEvent[]): Promise<void> {
		for (const event of events) {
			await this.dispatch(event)
		}
	}
}

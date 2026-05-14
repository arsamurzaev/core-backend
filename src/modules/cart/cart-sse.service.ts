import { Injectable, Logger, type MessageEvent } from '@nestjs/common'
import type Redis from 'ioredis'
import { randomBytes } from 'node:crypto'
import { Observable, Subject } from 'rxjs'

import { RedisService } from '@/infrastructure/redis/redis.service'

export type CartSsePayload = string | Record<string, unknown>

type CartSsePubSubMessage = {
	cartId: string
	eventId?: string
	originId: string
	payload: CartSsePayload
	type: string
}

type CartSseStoredEvent = {
	eventId: string
	payload: CartSsePayload
	type: string
}

const CART_SSE_HEARTBEAT_MS =
	Number(process.env.CART_SSE_HEARTBEAT_MS ?? 15_000) || 15_000
const CART_SSE_REDIS_CHANNEL = 'cart:sse'
const CART_SSE_STREAM_PREFIX = 'cart:sse:stream'
const CART_SSE_STREAM_MAXLEN =
	Number(process.env.CART_SSE_STREAM_MAXLEN ?? 100) || 100
const CART_SSE_STREAM_TTL_SEC =
	Number(process.env.CART_SSE_STREAM_TTL_SEC ?? 24 * 60 * 60) || 24 * 60 * 60

@Injectable()
export class CartSseService {
	private readonly logger = new Logger(CartSseService.name)
	private readonly originId = randomBytes(8).toString('hex')
	private readonly streams = new Map<string, Set<Subject<MessageEvent>>>()
	private redisSubscriber: Redis | null = null

	constructor(private readonly redis: RedisService) {}

	setupRedisSubscriber() {
		if (this.redisSubscriber) {
			return
		}

		const subscriber = this.redis.duplicate()
		this.redisSubscriber = subscriber

		subscriber.on('message', (channel, rawMessage) => {
			if (channel !== CART_SSE_REDIS_CHANNEL) {
				return
			}

			const message = this.parsePubSubMessage(rawMessage)
			if (!message || message.originId === this.originId) {
				return
			}

			this.broadcastLocal(
				message.cartId,
				message.type,
				message.payload,
				message.eventId
			)
		})

		subscriber.on('error', error => {
			this.logger.error('Cart SSE Redis subscriber error', {
				error: error instanceof Error ? error.message : String(error)
			})
		})

		void subscriber.subscribe(CART_SSE_REDIS_CHANNEL).catch(error => {
			this.logger.error('Cart SSE Redis subscribe failed', {
				error: error instanceof Error ? error.message : String(error)
			})
		})
	}

	shutdown() {
		if (!this.redisSubscriber) {
			return
		}

		this.redisSubscriber.removeAllListeners()
		void this.redisSubscriber.quit().catch(error => {
			this.logger.warn('Cart SSE Redis subscriber shutdown failed', {
				error: error instanceof Error ? error.message : String(error)
			})
		})
		this.redisSubscriber = null
	}

	connect(
		cartId: string,
		loadSnapshot: () => Promise<CartSsePayload>,
		lastEventId?: string | null
	): Observable<MessageEvent> {
		return new Observable<MessageEvent>(subscriber => {
			const stream = new Subject<MessageEvent>()
			const set = this.streams.get(cartId) ?? new Set<Subject<MessageEvent>>()
			set.add(stream)
			this.streams.set(cartId, set)

			const sub = stream.subscribe(subscriber)
			stream.next({
				id: this.buildEventId(cartId, 'connected'),
				type: 'connected',
				data: { cartId, timestamp: new Date().toISOString() }
			})

			void this.replayEvents(cartId, lastEventId, stream)
				.catch(error => {
					this.logger.warn('Cart SSE replay failed', {
						cartId,
						error: error instanceof Error ? error.message : String(error)
					})
				})
				.finally(() => {
					void loadSnapshot()
						.then(snapshot => {
							stream.next({
								id: this.buildEventId(cartId, 'cart.snapshot', snapshot),
								type: 'cart.snapshot',
								data: snapshot
							})
						})
						.catch(error => {
							this.logger.warn('Cart SSE snapshot failed', {
								cartId,
								error: error instanceof Error ? error.message : String(error)
							})
						})
				})

			const pingTimer = setInterval(() => {
				stream.next({
					id: this.buildEventId(cartId, 'ping'),
					type: 'ping',
					data: { timestamp: new Date().toISOString() }
				})
			}, CART_SSE_HEARTBEAT_MS)

			return () => {
				clearInterval(pingTimer)
				sub.unsubscribe()
				set.delete(stream)
				stream.complete()
				if (set.size === 0) {
					this.streams.delete(cartId)
				}
			}
		})
	}

	broadcast(cartId: string, type: string, payload: CartSsePayload) {
		void this.persistAndBroadcast(cartId, type, payload).catch(error => {
			const eventId = this.buildEventId(cartId, type, payload)
			this.logger.warn('Cart SSE Redis stream write failed', {
				cartId,
				error: error instanceof Error ? error.message : String(error),
				type
			})
			this.broadcastLocal(cartId, type, payload, eventId)
		})
	}

	private broadcastLocal(
		cartId: string,
		type: string,
		payload: CartSsePayload,
		eventId?: string
	) {
		const streams = this.streams.get(cartId)
		if (!streams?.size) return

		for (const stream of streams) {
			stream.next({
				...(eventId ? { id: eventId } : {}),
				type,
				data: payload
			})
		}
	}

	private async persistAndBroadcast(
		cartId: string,
		type: string,
		payload: CartSsePayload
	) {
		const eventId = await this.appendStreamEvent(cartId, type, payload)
		this.logger.debug('Cart SSE event persisted', {
			cartId,
			eventId,
			type
		})
		this.broadcastLocal(cartId, type, payload, eventId)

		const message: CartSsePubSubMessage = {
			cartId,
			eventId,
			originId: this.originId,
			payload,
			type
		}
		await this.redis.publish(CART_SSE_REDIS_CHANNEL, JSON.stringify(message))
	}

	private async appendStreamEvent(
		cartId: string,
		type: string,
		payload: CartSsePayload
	) {
		const streamKey = this.buildStreamKey(cartId)
		const eventId = await this.redis.xadd(
			streamKey,
			'MAXLEN',
			'~',
			String(CART_SSE_STREAM_MAXLEN),
			'*',
			'type',
			type,
			'payload',
			JSON.stringify(payload),
			'originId',
			this.originId
		)

		await this.redis.expire(streamKey, CART_SSE_STREAM_TTL_SEC)
		return eventId ?? this.buildEventId(cartId, type, payload)
	}

	private async replayEvents(
		cartId: string,
		lastEventId: string | null | undefined,
		stream: Subject<MessageEvent>
	) {
		const replayStartId = this.normalizeRedisStreamLastEventId(lastEventId)
		if (!replayStartId) {
			return
		}

		const entries = await this.redis.xrange(
			this.buildStreamKey(cartId),
			`(${replayStartId}`,
			'+',
			'COUNT',
			String(CART_SSE_STREAM_MAXLEN)
		)

		if (entries.length > 0) {
			this.logger.debug('Cart SSE replaying missed events', {
				cartId,
				count: entries.length,
				lastEventId: replayStartId
			})
		}

		for (const [eventId, rawFields] of entries) {
			const event = this.parseStreamEntry(eventId, rawFields)
			if (!event) {
				continue
			}

			stream.next({
				id: event.eventId,
				type: event.type,
				data: event.payload
			})
		}
	}

	private parseStreamEntry(
		eventId: string,
		rawFields: string[]
	): CartSseStoredEvent | null {
		const fields: Record<string, string> = {}
		for (let index = 0; index < rawFields.length - 1; index += 2) {
			fields[rawFields[index]] = rawFields[index + 1]
		}

		const type = fields.type
		const rawPayload = fields.payload
		if (!type || !rawPayload) {
			return null
		}

		try {
			return {
				eventId,
				payload: JSON.parse(rawPayload) as CartSsePayload,
				type
			}
		} catch {
			return {
				eventId,
				payload: rawPayload,
				type
			}
		}
	}

	private parsePubSubMessage(rawMessage: string): CartSsePubSubMessage | null {
		try {
			const parsed = JSON.parse(rawMessage) as Partial<CartSsePubSubMessage>
			if (
				!parsed ||
				typeof parsed.cartId !== 'string' ||
				typeof parsed.originId !== 'string' ||
				typeof parsed.type !== 'string' ||
				!('payload' in parsed)
			) {
				return null
			}

			return {
				cartId: parsed.cartId,
				eventId: typeof parsed.eventId === 'string' ? parsed.eventId : undefined,
				originId: parsed.originId,
				payload: parsed.payload,
				type: parsed.type
			}
		} catch {
			return null
		}
	}

	private normalizeRedisStreamLastEventId(value?: string | null): string | null {
		const normalized = value?.trim()
		if (!normalized) {
			return null
		}

		return /^\d+-\d+$/.test(normalized) ? normalized : null
	}

	private buildStreamKey(cartId: string) {
		return `${CART_SSE_STREAM_PREFIX}:${cartId}`
	}

	private buildEventId(cartId: string, type: string, payload?: CartSsePayload) {
		const version =
			typeof payload === 'object' && payload !== null
				? this.resolvePayloadVersion(payload)
				: new Date().toISOString()

		return `${cartId}:${type}:${version}`
	}

	private resolvePayloadVersion(payload: Record<string, unknown>) {
		const updatedAt = payload.updatedAt
		const statusChangedAt = payload.statusChangedAt

		if (typeof updatedAt === 'string' && updatedAt) {
			return updatedAt
		}
		if (updatedAt instanceof Date) {
			return updatedAt.toISOString()
		}
		if (typeof statusChangedAt === 'string' && statusChangedAt) {
			return statusChangedAt
		}
		if (statusChangedAt instanceof Date) {
			return statusChangedAt.toISOString()
		}

		return new Date().toISOString()
	}
}

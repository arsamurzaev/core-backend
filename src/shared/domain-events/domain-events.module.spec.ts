import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_CACHE_VERSION,
	CATALOG_TYPE_CACHE_VERSION,
	CATEGORY_LIST_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'

import { CatalogCacheInvalidationHandler } from './catalog-cache-invalidation.handler'
import {
	buildDomainEventIdempotencyKey,
	DOMAIN_EVENT_IDEMPOTENCY_SCOPE
} from './domain-event-idempotency'
import { createDomainEvent } from './domain-event.utils'
import { InProcessDomainEventBus } from './in-process-domain-event-bus'

describe('DomainEventsModule', () => {
	it('invalidates requested product cache scopes through product.changed event', async () => {
		const bus = new InProcessDomainEventBus()
		const cache = {
			bumpVersion: jest.fn().mockResolvedValue(1)
		} as unknown as jest.Mocked<CacheService>
		const handler = new CatalogCacheInvalidationHandler(bus, cache)
		handler.onModuleInit()

		await bus.dispatch(
			createDomainEvent({
				type: 'product.changed',
				catalogId: 'catalog-1',
				productId: 'product-1',
				changes: ['catalog_products']
			})
		)

		expect(cache.bumpVersion).toHaveBeenCalledTimes(1)
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			PRODUCTS_CACHE_VERSION,
			'catalog-1'
		)
	})

	it('invalidates category list scope through product.changed event', async () => {
		const bus = new InProcessDomainEventBus()
		const cache = {
			bumpVersion: jest.fn().mockResolvedValue(1)
		} as unknown as jest.Mocked<CacheService>
		const handler = new CatalogCacheInvalidationHandler(bus, cache)
		handler.onModuleInit()

		await bus.dispatch(
			createDomainEvent({
				type: 'product.changed',
				catalogId: 'catalog-1',
				productId: '*',
				changes: ['category_list']
			})
		)

		expect(cache.bumpVersion).toHaveBeenCalledTimes(1)
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			CATEGORY_LIST_CACHE_VERSION,
			'catalog-1'
		)
	})

	it('deduplicates the same event for idempotent handlers', async () => {
		const bus = new InProcessDomainEventBus()
		const cache = {
			bumpVersion: jest.fn().mockResolvedValue(1)
		} as unknown as jest.Mocked<CacheService>
		const handler = new CatalogCacheInvalidationHandler(bus, cache)
		const event = createDomainEvent({
			type: 'product.changed',
			catalogId: 'catalog-1',
			productId: 'product-1'
		})
		handler.onModuleInit()

		await bus.dispatch(event)
		await bus.dispatch(event)

		expect(cache.bumpVersion.mock.calls).toEqual([
			[PRODUCTS_CACHE_VERSION, 'catalog-1'],
			[CATEGORY_PRODUCTS_CACHE_VERSION, 'catalog-1'],
			[CATEGORY_LIST_CACHE_VERSION, 'catalog-1']
		])
		expect(DOMAIN_EVENT_IDEMPOTENCY_SCOPE).toBe('type:eventId')
		expect(buildDomainEventIdempotencyKey(event)).toBe(
			`product.changed:${event.eventId}`
		)
	})

	it('invalidates explicit catalog cache scopes through catalog.cache_invalidated event', async () => {
		const bus = new InProcessDomainEventBus()
		const cache = {
			bumpVersion: jest.fn().mockResolvedValue(1)
		} as unknown as jest.Mocked<CacheService>
		const handler = new CatalogCacheInvalidationHandler(bus, cache)
		handler.onModuleInit()

		await bus.dispatch(
			createDomainEvent({
				type: 'catalog.cache_invalidated',
				catalogId: 'catalog-1',
				scopes: [
					{ name: 'catalog' },
					{ name: 'catalog_products' },
					{ name: 'category_products' },
					{ name: 'category_list' },
					{ name: 'catalog_type', key: 'type-1' },
					{ name: 'catalog_type', key: 'type-1' }
				]
			})
		)

		expect(cache.bumpVersion.mock.calls).toEqual([
			[CATALOG_CACHE_VERSION, 'catalog-1'],
			[PRODUCTS_CACHE_VERSION, 'catalog-1'],
			[CATEGORY_PRODUCTS_CACHE_VERSION, 'catalog-1'],
			[CATEGORY_LIST_CACHE_VERSION, 'catalog-1'],
			[CATALOG_TYPE_CACHE_VERSION, 'type-1']
		])
	})

	it('does not mark failed events as handled before retry', async () => {
		const bus = new InProcessDomainEventBus()
		const handler = jest
			.fn()
			.mockRejectedValueOnce(new Error('temporary failure'))
			.mockResolvedValueOnce(undefined)
		const event = createDomainEvent({
			type: 'product.changed',
			catalogId: 'catalog-1',
			productId: 'product-1'
		})
		bus.subscribe('product.changed', handler)

		await expect(bus.dispatch(event)).rejects.toThrow('temporary failure')
		await expect(bus.dispatch(event)).resolves.toBeUndefined()

		expect(handler).toHaveBeenCalledTimes(2)
	})
})

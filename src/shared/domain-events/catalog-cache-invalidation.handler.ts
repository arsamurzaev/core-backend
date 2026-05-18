import { Inject, Injectable, OnModuleInit } from '@nestjs/common'

import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_CACHE_VERSION,
	CATALOG_TYPE_CACHE_VERSION,
	CATEGORY_LIST_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'

import {
	DOMAIN_EVENT_BUS,
	type DomainEvent,
	type DomainEventBus
} from './domain-events.contract'

const PRODUCT_CACHE_EVENT_TYPES = new Set<DomainEvent['type']>([
	'product.changed',
	'product.variant_changed',
	'variant.stock_changed',
	'variant.price_changed',
	'integration.sync_completed',
	'catalog.capability_changed',
	'catalog.cache_invalidated'
])

@Injectable()
export class CatalogCacheInvalidationHandler implements OnModuleInit {
	constructor(
		@Inject(DOMAIN_EVENT_BUS)
		private readonly bus: DomainEventBus,
		private readonly cache: CacheService
	) {}

	onModuleInit(): void {
		for (const type of PRODUCT_CACHE_EVENT_TYPES) {
			this.bus.subscribe(type, event => this.invalidateProductCaches(event))
		}
	}

	private async invalidateProductCaches(event: DomainEvent): Promise<void> {
		if (event.type === 'catalog.cache_invalidated') {
			await this.invalidateExplicitScopes(event)
			return
		}

		if (shouldBump(event, 'catalog_products')) {
			await this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, event.catalogId)
		}
		if (shouldBump(event, 'category_products')) {
			await this.cache.bumpVersion(
				CATEGORY_PRODUCTS_CACHE_VERSION,
				event.catalogId
			)
		}

		if (shouldBump(event, 'category_list')) {
			await this.cache.bumpVersion(CATEGORY_LIST_CACHE_VERSION, event.catalogId)
		}
	}

	private async invalidateExplicitScopes(
		event: Extract<DomainEvent, { type: 'catalog.cache_invalidated' }>
	): Promise<void> {
		const requests = new Map<string, { scope: string; key: string }>()

		for (const item of event.scopes) {
			const key = item.key ?? event.catalogId
			const scope = resolveCacheScope(item.name)
			if (!scope || !key) continue
			requests.set(`${scope}:${key}`, { scope, key })
		}

		await Promise.all(
			Array.from(requests.values()).map(request =>
				this.cache.bumpVersion(request.scope, request.key)
			)
		)
	}
}

function resolveCacheScope(
	name: Extract<
		DomainEvent,
		{ type: 'catalog.cache_invalidated' }
	>['scopes'][number]['name']
): string | null {
	switch (name) {
		case 'catalog':
			return CATALOG_CACHE_VERSION
		case 'catalog_products':
			return PRODUCTS_CACHE_VERSION
		case 'category_products':
			return CATEGORY_PRODUCTS_CACHE_VERSION
		case 'category_list':
			return CATEGORY_LIST_CACHE_VERSION
		case 'catalog_type':
			return CATALOG_TYPE_CACHE_VERSION
		default:
			return null
	}
}

function shouldBump(
	event: DomainEvent,
	scope: 'catalog_products' | 'category_products' | 'category_list'
): boolean {
	if (event.type === 'product.changed') {
		return !event.changes?.length || event.changes.includes(scope)
	}

	if (scope === 'category_list') {
		return (
			event.type === 'product.variant_changed' ||
			event.type === 'catalog.capability_changed'
		)
	}

	return true
}

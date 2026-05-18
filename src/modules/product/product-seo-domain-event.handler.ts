import { Inject, Injectable, OnModuleInit } from '@nestjs/common'

import {
	DOMAIN_EVENT_BUS,
	type DomainEvent,
	type DomainEventBus
} from '@/shared/domain-events/domain-events.contract'

import { ProductSeoSyncService } from './product-seo-sync.service'
import { ProductRepository } from './product.repository'

const PRODUCT_SEO_SYNC_EVENT_TYPES: DomainEvent['type'][] = [
	'product.changed',
	'product.variant_changed',
	'variant.stock_changed',
	'variant.price_changed'
]

@Injectable()
export class ProductSeoDomainEventHandler implements OnModuleInit {
	constructor(
		@Inject(DOMAIN_EVENT_BUS)
		private readonly bus: DomainEventBus,
		private readonly repo: ProductRepository,
		private readonly productSeoSync: ProductSeoSyncService
	) {}

	onModuleInit(): void {
		for (const type of PRODUCT_SEO_SYNC_EVENT_TYPES) {
			this.bus.subscribe(type, event => this.handle(event))
		}
	}

	private async handle(event: DomainEvent): Promise<void> {
		switch (event.type) {
			case 'product.changed':
				await this.handleProductChanged(event)
				return
			case 'product.variant_changed':
			case 'variant.stock_changed':
			case 'variant.price_changed':
				if (!event.productId) return
				await this.syncProductSeo(event.catalogId, event.productId)
				return
		}
	}

	private async handleProductChanged(
		event: Extract<DomainEvent, { type: 'product.changed' }>
	): Promise<void> {
		if (event.productId === '*') return

		if (
			event.changes?.length &&
			!event.changes.includes('seo') &&
			!event.changes.includes('seo_remove')
		) {
			return
		}

		if (event.changes?.includes('seo_remove')) {
			await this.productSeoSync.removeProduct(event.productId, event.catalogId)
			return
		}

		await this.syncProductSeo(event.catalogId, event.productId)
	}

	private async syncProductSeo(
		catalogId: string,
		productId: string
	): Promise<void> {
		const product = await this.repo.findById(productId, catalogId, true)
		if (!product) {
			await this.productSeoSync.removeProduct(productId, catalogId)
			return
		}

		await this.productSeoSync.syncProduct(product, catalogId)
	}
}

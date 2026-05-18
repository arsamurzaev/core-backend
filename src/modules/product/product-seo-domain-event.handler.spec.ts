import { createDomainEvent } from '@/shared/domain-events/domain-event.utils'
import { InProcessDomainEventBus } from '@/shared/domain-events/in-process-domain-event-bus'

import { ProductSeoDomainEventHandler } from './product-seo-domain-event.handler'
import { ProductSeoSyncService } from './product-seo-sync.service'
import { ProductRepository } from './product.repository'

describe('ProductSeoDomainEventHandler', () => {
	let bus: InProcessDomainEventBus
	let repo: jest.Mocked<Pick<ProductRepository, 'findById'>>
	let seo: jest.Mocked<Pick<ProductSeoSyncService, 'syncProduct' | 'removeProduct'>>

	beforeEach(() => {
		bus = new InProcessDomainEventBus()
		repo = {
			findById: jest.fn()
		}
		seo = {
			syncProduct: jest.fn().mockResolvedValue(undefined),
			removeProduct: jest.fn().mockResolvedValue(undefined)
		}

		new ProductSeoDomainEventHandler(
			bus,
			repo as unknown as ProductRepository,
			seo as unknown as ProductSeoSyncService
		).onModuleInit()
	})

	it('syncs product seo for product seo events', async () => {
		const product = { id: 'product-1', slug: 'product-1' }
		repo.findById.mockResolvedValue(product as any)

		await bus.dispatch(
			createDomainEvent({
				type: 'product.changed',
				catalogId: 'catalog-1',
				productId: 'product-1',
				changes: ['seo']
			})
		)

		expect(repo.findById).toHaveBeenCalledWith('product-1', 'catalog-1', true)
		expect(seo.syncProduct).toHaveBeenCalledWith(product, 'catalog-1')
		expect(seo.removeProduct).not.toHaveBeenCalled()
	})

	it('removes product seo for delete events', async () => {
		await bus.dispatch(
			createDomainEvent({
				type: 'product.changed',
				catalogId: 'catalog-1',
				productId: 'product-1',
				changes: ['seo_remove']
			})
		)

		expect(repo.findById).not.toHaveBeenCalled()
		expect(seo.removeProduct).toHaveBeenCalledWith('product-1', 'catalog-1')
	})

	it('removes product seo when changed product is missing', async () => {
		repo.findById.mockResolvedValue(null)

		await bus.dispatch(
			createDomainEvent({
				type: 'product.changed',
				catalogId: 'catalog-1',
				productId: 'product-1',
				changes: ['seo']
			})
		)

		expect(seo.syncProduct).not.toHaveBeenCalled()
		expect(seo.removeProduct).toHaveBeenCalledWith('product-1', 'catalog-1')
	})

	it('ignores wildcard cache-only product events', async () => {
		await bus.dispatch(
			createDomainEvent({
				type: 'product.changed',
				catalogId: 'catalog-1',
				productId: '*',
				changes: ['catalog_products']
			})
		)

		expect(repo.findById).not.toHaveBeenCalled()
		expect(seo.syncProduct).not.toHaveBeenCalled()
	})

	it('syncs product seo for variant price and stock events with productId', async () => {
		const product = { id: 'product-1', slug: 'product-1' }
		repo.findById.mockResolvedValue(product as any)

		await bus.dispatch(
			createDomainEvent({
				type: 'variant.price_changed',
				catalogId: 'catalog-1',
				productId: 'product-1',
				variantId: 'variant-1',
				previousPrice: 100,
				nextPrice: 120
			})
		)
		await bus.dispatch(
			createDomainEvent({
				type: 'variant.stock_changed',
				catalogId: 'catalog-1',
				productId: 'product-1',
				variantId: 'variant-1',
				previousStock: 1,
				nextStock: 0
			})
		)

		expect(seo.syncProduct).toHaveBeenCalledTimes(2)
		expect(seo.syncProduct).toHaveBeenNthCalledWith(1, product, 'catalog-1')
		expect(seo.syncProduct).toHaveBeenNthCalledWith(2, product, 'catalog-1')
	})
})

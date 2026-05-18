import { CacheService } from '@/shared/cache/cache.service'
import { MediaUrlService } from '@/shared/media/media-url.service'
import { ProductMediaMapper } from '@/shared/media/product-media.mapper'

import { SeoRepository } from '../seo/seo.repository'

import { ProductSeoSyncService } from './product-seo-sync.service'
import { ProductWriteFinalizer } from './product-write-finalizer.service'

describe('ProductWriteFinalizer', () => {
	function createSubject(events?: {
		dispatch: jest.Mock
		dispatchMany?: jest.Mock
	}) {
		const cache = { bumpVersion: jest.fn() }
		const mediaUrl = { mapMedia: jest.fn() }
		const mapper = { mapProduct: jest.fn(product => product) }
		const seoSync = {
			syncProduct: jest.fn().mockResolvedValue(undefined),
			removeProduct: jest.fn().mockResolvedValue(undefined)
		}
		const seoRepo = { findByEntity: jest.fn().mockResolvedValue(null) }
		const finalizer = new ProductWriteFinalizer(
			cache as unknown as CacheService,
			mediaUrl as unknown as MediaUrlService,
			mapper as unknown as ProductMediaMapper,
			seoSync as unknown as ProductSeoSyncService,
			seoRepo as unknown as SeoRepository,
			events as any
		)

		return { finalizer, seoSync, events }
	}

	it('publishes seo sync event when dispatcher is available', async () => {
		const { finalizer, seoSync, events } = createSubject({
			dispatch: jest.fn().mockResolvedValue(undefined)
		})

		await finalizer.syncProductSeo({ id: 'product-1' } as any, 'catalog-1')

		expect(events?.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'product.changed',
				catalogId: 'catalog-1',
				productId: 'product-1',
				changes: ['seo']
			})
		)
		expect(seoSync.syncProduct).not.toHaveBeenCalled()
	})

	it('keeps direct seo sync fallback when dispatcher is unavailable', async () => {
		const { finalizer, seoSync } = createSubject()
		const product = { id: 'product-1' }

		await finalizer.syncProductSeo(product as any, 'catalog-1')

		expect(seoSync.syncProduct).toHaveBeenCalledWith(product, 'catalog-1')
	})
})

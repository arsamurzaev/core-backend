import { Injectable } from '@nestjs/common'

import { ProductWriteFinalizer } from './product-write-finalizer.service'
import { ProductRepository } from './product.repository'

@Injectable()
export class ProductMaintenanceService {
	constructor(
		private readonly repo: ProductRepository,
		private readonly finalizer: ProductWriteFinalizer
	) {}

	async expireScheduledDiscounts(now = new Date()) {
		const expiredProducts = await this.repo.expireScheduledDiscounts(now)
		if (!expiredProducts.length) {
			return {
				updatedProducts: 0,
				affectedCatalogs: 0
			}
		}

		const productIdsByCatalog = new Map<string, string[]>()
		for (const item of expiredProducts) {
			const bucket = productIdsByCatalog.get(item.catalogId)
			if (bucket) {
				bucket.push(item.productId)
				continue
			}

			productIdsByCatalog.set(item.catalogId, [item.productId])
		}

		for (const catalogId of productIdsByCatalog.keys()) {
			await this.finalizer.invalidateCatalogProductsCache(catalogId)
			await this.finalizer.invalidateCategoryProductsCache(catalogId)
		}

		for (const [catalogId, productIds] of productIdsByCatalog) {
			const products = await this.repo.findByIdsWithDetails(productIds, catalogId)
			for (const product of products) {
				await this.finalizer.syncProductSeo(product, catalogId)
			}
		}

		return {
			updatedProducts: expiredProducts.length,
			affectedCatalogs: productIdsByCatalog.size
		}
	}

	async rebuildSeoForCatalog(catalogId: string) {
		const batchSize = 100
		let cursorId: string | undefined
		let rebuiltProducts = 0

		for (;;) {
			const productIds = await this.repo.findIdsByCatalog(
				catalogId,
				batchSize,
				cursorId
			)
			if (!productIds.length) break

			const products = await this.repo.findByIdsWithDetails(
				productIds.map(item => item.id),
				catalogId
			)
			for (const product of products) {
				await this.finalizer.syncProductSeo(product, catalogId)
			}

			rebuiltProducts += products.length
			cursorId = productIds[productIds.length - 1]?.id
			if (productIds.length < batchSize) break
		}

		return { rebuiltProducts }
	}
}

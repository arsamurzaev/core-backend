import { Injectable } from '@nestjs/common'

import { ProductVariantService } from './product-variant.service'
import { ProductWriteFinalizer } from './product-write-finalizer.service'
import { ProductRepository } from './product.repository'

const DEFAULT_VARIANT_REPAIR_BATCH_SIZE = 100

@Injectable()
export class ProductMaintenanceService {
	constructor(
		private readonly repo: ProductRepository,
		private readonly variants: ProductVariantService,
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

	async repairMissingDefaultVariantsForCatalog(catalogId: string) {
		let cursorId: string | undefined
		let checkedProducts = 0
		let repairedProducts = 0
		const repairedProductIds: string[] = []

		for (;;) {
			const products = await this.repo.findDefaultVariantRepairCandidates(
				catalogId,
				DEFAULT_VARIANT_REPAIR_BATCH_SIZE,
				cursorId
			)
			if (!products.length) break

			for (const product of products) {
				checkedProducts += 1
				const defaultVariant = await this.variants.buildDefaultVariantData(
					product.sku,
					product.price,
					{ productStatus: product.status }
				)
				const repaired = await this.repo.ensureDefaultVariant(
					product.id,
					catalogId,
					defaultVariant
				)
				if (repaired) {
					repairedProducts += 1
					repairedProductIds.push(product.id)
				}
			}

			cursorId = products[products.length - 1]?.id
			if (products.length < DEFAULT_VARIANT_REPAIR_BATCH_SIZE) break
		}

		if (repairedProducts > 0) {
			await this.finalizer.invalidateCatalogProductsCache(catalogId)
			await this.finalizer.invalidateCategoryProductsCache(catalogId)
			await this.syncRepairedProductSeo(catalogId, repairedProductIds)
		}

		return {
			checkedProducts,
			repairedProducts,
			affectedCatalogs: repairedProducts > 0 ? 1 : 0
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

	private async syncRepairedProductSeo(
		catalogId: string,
		productIds: string[]
	): Promise<void> {
		for (let index = 0; index < productIds.length; index += 100) {
			const products = await this.repo.findByIdsWithDetails(
				productIds.slice(index, index + 100),
				catalogId
			)
			for (const product of products) {
				await this.finalizer.syncProductSeo(product, catalogId)
			}
		}
	}
}

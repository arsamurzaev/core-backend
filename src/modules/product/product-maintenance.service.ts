import { Injectable } from '@nestjs/common'

import { ProductVariantService } from './product-variant.service'
import { ProductWriteFinalizer } from './product-write-finalizer.service'
import {
	type ProductDefaultVariantDiagnosticCheck,
	type ProductDefaultVariantPriceMismatchRepairCandidate,
	ProductRepository
} from './product.repository'

const DEFAULT_VARIANT_REPAIR_BATCH_SIZE = 100
const DEFAULT_VARIANT_DIAGNOSTIC_SAMPLE_LIMIT = 10
const DEFAULT_VARIANT_PRICE_REPAIR_BATCH_SIZE = 100
const DEFAULT_VARIANT_PRICE_REPAIR_SAMPLE_LIMIT = 20

export type ProductDefaultVariantDiagnostics = {
	catalogId: string
	sampleLimit: number
	checks: ProductDefaultVariantDiagnosticCheck[]
	warnCount: number
	failCount: number
	ok: boolean
}

export type ProductDefaultVariantPriceMismatchRepairOptions = {
	apply?: boolean
	batchSize?: number
	sampleLimit?: number
}

export type ProductDefaultVariantPriceMismatchRepairResult = {
	catalogId: string
	dryRun: boolean
	checkedProducts: number
	repairableProducts: number
	updatedProducts: number
	affectedCatalogs: number
	batchSize: number
	sampleLimit: number
	samples: ProductDefaultVariantPriceMismatchRepairCandidate[]
}

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

	async diagnoseDefaultVariantsForCatalog(
		catalogId: string,
		sampleLimit = DEFAULT_VARIANT_DIAGNOSTIC_SAMPLE_LIMIT
	): Promise<ProductDefaultVariantDiagnostics> {
		const normalizedSampleLimit = this.normalizeDiagnosticSampleLimit(sampleLimit)
		const checks = await this.repo.findDefaultVariantDiagnostics(
			catalogId,
			normalizedSampleLimit
		)
		const warnCount = checks.filter(check => check.status === 'warn').length
		const failCount = checks.filter(check => check.status === 'fail').length

		return {
			catalogId,
			sampleLimit: normalizedSampleLimit,
			checks,
			warnCount,
			failCount,
			ok: warnCount === 0 && failCount === 0
		}
	}

	async repairDefaultVariantPriceMismatchesForCatalog(
		catalogId: string,
		options: ProductDefaultVariantPriceMismatchRepairOptions = {}
	): Promise<ProductDefaultVariantPriceMismatchRepairResult> {
		const apply = options.apply === true
		const batchSize = this.normalizeBatchSize(
			options.batchSize,
			DEFAULT_VARIANT_PRICE_REPAIR_BATCH_SIZE
		)
		const sampleLimit = this.normalizeRepairSampleLimit(options.sampleLimit)
		let cursorProductId: string | undefined
		let checkedProducts = 0
		let updatedProducts = 0
		const samples: ProductDefaultVariantPriceMismatchRepairCandidate[] = []
		const updatedProductIds: string[] = []

		for (;;) {
			const candidates =
				await this.repo.findDefaultVariantPriceMismatchRepairCandidates(
					catalogId,
					batchSize,
					cursorProductId
				)
			if (!candidates.length) break

			checkedProducts += candidates.length
			const remainingSampleSlots = sampleLimit - samples.length
			if (remainingSampleSlots > 0) {
				samples.push(...candidates.slice(0, remainingSampleSlots))
			}

			if (apply) {
				const repairedProductIds =
					await this.repo.applyDefaultVariantPriceMismatchRepairs(
						catalogId,
						candidates.map(candidate => candidate.productId)
					)
				updatedProducts += repairedProductIds.length
				updatedProductIds.push(...repairedProductIds)
			}

			cursorProductId = candidates[candidates.length - 1]?.productId
			if (candidates.length < batchSize) break
		}

		if (apply && updatedProducts > 0) {
			await this.finalizer.invalidateCatalogProductsCache(catalogId)
			await this.finalizer.invalidateCategoryProductsCache(catalogId)
			await this.syncRepairedProductSeo(catalogId, updatedProductIds)
		}

		return {
			catalogId,
			dryRun: !apply,
			checkedProducts,
			repairableProducts: checkedProducts,
			updatedProducts,
			affectedCatalogs: updatedProducts > 0 ? 1 : 0,
			batchSize,
			sampleLimit,
			samples
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

	private normalizeDiagnosticSampleLimit(value: number): number {
		if (!Number.isInteger(value) || value <= 0) {
			return DEFAULT_VARIANT_DIAGNOSTIC_SAMPLE_LIMIT
		}
		return Math.min(value, 100)
	}

	private normalizeBatchSize(value: number | undefined, fallback: number): number {
		if (!Number.isInteger(value) || value <= 0) {
			return fallback
		}
		return Math.min(value, 1000)
	}

	private normalizeRepairSampleLimit(value: number | undefined): number {
		if (!Number.isInteger(value) || value <= 0) {
			return DEFAULT_VARIANT_PRICE_REPAIR_SAMPLE_LIMIT
		}
		return Math.min(value, 100)
	}
}

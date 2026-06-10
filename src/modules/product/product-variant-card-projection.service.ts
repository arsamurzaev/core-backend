import { Injectable } from '@nestjs/common'

import type { CatalogPriceListProductPriceContext } from '@/modules/catalog-price-list/public'

import { applyPriceListContextToVariant } from './product-price-list-read.utils'
import {
	buildVariantPickerOptionsFromVariants,
	buildVariantPickerOptionsMap,
	buildVariantSummaryFromVariants,
	buildVariantSummaryMap,
	createEmptyVariantProjection,
	type ProductVariantPickerSource,
	type ProductVariantProjection,
	shouldBuildVariantPickerOptions
} from './product-variant-card-projection'
import { ProductRepository } from './product.repository'

@Injectable()
export class ProductVariantCardProjectionService {
	constructor(private readonly repo: ProductRepository) {}

	async resolveForProductIds(
		productIds: string[],
		priceContext?: CatalogPriceListProductPriceContext,
		options: {
			filterUnavailable?: boolean
			canUseCatalogSaleUnits?: boolean
		} = {}
	): Promise<Map<string, ProductVariantProjection>> {
		const ids = [...new Set(productIds.filter(Boolean))]
		if (!ids.length) return new Map()

		if (priceContext?.priceList) {
			return this.resolveWithPriceList(ids, priceContext, options)
		}

		const summaries = await this.repo.findVariantSummaries(ids, {
			canUseCatalogSaleUnits: options.canUseCatalogSaleUnits
		})
		const summaryMap = buildVariantSummaryMap(summaries)
		const variantPickerProductIds = ids.filter(productId =>
			shouldBuildVariantPickerOptions(
				summaryMap.get(productId) ?? createEmptyVariantProjection().variantSummary
			)
		)
		const variantPickerOptionsMap = variantPickerProductIds.length
			? buildVariantPickerOptionsMap(
					await this.repo.findVariantPickerOptions(variantPickerProductIds),
					{ canUseCatalogSaleUnits: options.canUseCatalogSaleUnits }
				)
			: new Map<string, ProductVariantProjection['variantPickerOptions']>()

		return new Map(
			ids.map(productId => {
				const summary =
					summaryMap.get(productId) ?? createEmptyVariantProjection().variantSummary
				return [
					productId,
					{
						variantSummary: summary,
						variantPickerOptions: variantPickerOptionsMap.get(productId) ?? []
					}
				] as const
			})
		)
	}

	private async resolveWithPriceList(
		productIds: string[],
		priceContext: CatalogPriceListProductPriceContext,
		options: {
			filterUnavailable?: boolean
			canUseCatalogSaleUnits?: boolean
		}
	): Promise<Map<string, ProductVariantProjection>> {
		const variants = await this.repo.findVariantPickerOptions(productIds)
		const variantsByProductId = new Map<string, ProductVariantPickerSource[]>()

		for (const variant of variants) {
			const filtered = applyPriceListContextToVariant(
				variant.productId,
				variant,
				priceContext,
				options
			)
			if (!filtered) continue

			const productVariants = variantsByProductId.get(variant.productId) ?? []
			productVariants.push(filtered)
			variantsByProductId.set(variant.productId, productVariants)
		}

		return new Map(
			productIds.map(productId => {
				const productVariants = variantsByProductId.get(productId) ?? []
				const variantSummary = buildVariantSummaryFromVariants(productVariants, {
					canUseCatalogSaleUnits: options.canUseCatalogSaleUnits
				})

				return [
					productId,
					{
						variantSummary,
						variantPickerOptions: buildVariantPickerOptionsFromVariants(
							productVariants,
							variantSummary,
							{ canUseCatalogSaleUnits: options.canUseCatalogSaleUnits }
						)
					}
				] as const
			})
		)
	}
}

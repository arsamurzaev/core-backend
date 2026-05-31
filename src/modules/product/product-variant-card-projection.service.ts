import { Injectable } from '@nestjs/common'

import {
	buildVariantPickerOptionsMap,
	buildVariantSummaryMap,
	createEmptyVariantProjection,
	type ProductVariantProjection,
	shouldBuildVariantPickerOptions
} from './product-variant-card-projection'
import { ProductRepository } from './product.repository'

@Injectable()
export class ProductVariantCardProjectionService {
	constructor(private readonly repo: ProductRepository) {}

	async resolveForProductIds(
		productIds: string[]
	): Promise<Map<string, ProductVariantProjection>> {
		const ids = [...new Set(productIds.filter(Boolean))]
		if (!ids.length) return new Map()

		const summaries = await this.repo.findVariantSummaries(ids)
		const summaryMap = buildVariantSummaryMap(summaries)
		const variantPickerProductIds = ids.filter(productId =>
			shouldBuildVariantPickerOptions(
				summaryMap.get(productId) ?? createEmptyVariantProjection().variantSummary
			)
		)
		const variantPickerOptionsMap = variantPickerProductIds.length
			? buildVariantPickerOptionsMap(
					await this.repo.findVariantPickerOptions(variantPickerProductIds)
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
}

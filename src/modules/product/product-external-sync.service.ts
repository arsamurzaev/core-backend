import type { Prisma } from '@generated/client'
import { ProductStatus } from '@generated/enums'
import { Injectable } from '@nestjs/common'

import type {
	ProductExternalCommercialStateInput,
	ProductExternalDefaultVariantInput,
	ProductExternalProductCreateInput,
	ProductExternalProductDescriptionInput,
	ProductExternalProductIdentityInput,
	ProductExternalProductSkuExistsInput,
	ProductExternalProductSkuInput,
	ProductExternalProductSlugExistsInput,
	ProductExternalProductSoftDeleteInput,
	ProductExternalProductUpdateInput,
	ProductExternalSyncPort
} from './contracts'
import { ProductVariantService } from './product-variant.service'
import { ProductWriteFinalizer } from './product-write-finalizer.service'
import { ProductRepository } from './product.repository'

@Injectable()
export class ProductExternalSyncService implements ProductExternalSyncPort {
	constructor(
		private readonly repo: ProductRepository,
		private readonly variants: ProductVariantService,
		private readonly finalizer: ProductWriteFinalizer
	) {}

	findExternalProductById(input: ProductExternalProductIdentityInput) {
		return this.repo.findExternalSyncById(
			input.catalogId,
			input.productId,
			asTransaction(input.tx)
		)
	}

	findExternalProductBySku(input: ProductExternalProductSkuInput) {
		return this.repo.findExternalSyncBySku(
			input.catalogId,
			input.sku,
			asTransaction(input.tx)
		)
	}

	existsExternalProductSlug(
		input: ProductExternalProductSlugExistsInput
	): Promise<boolean> {
		return this.repo.existsExternalSyncSlug(
			input.catalogId,
			input.slug,
			input.excludeId,
			asTransaction(input.tx)
		)
	}

	existsExternalProductSku(
		input: ProductExternalProductSkuExistsInput
	): Promise<boolean> {
		return this.repo.existsExternalSyncSku(
			input.sku,
			input.excludeId,
			asTransaction(input.tx)
		)
	}

	createExternalProduct(input: ProductExternalProductCreateInput) {
		return this.repo.createExternalSync(
			{
				catalogId: input.catalogId,
				name: input.name,
				sku: input.sku,
				slug: input.slug,
				price: normalizePrice(input.price),
				status: normalizeProductStatus(input.status) ?? ProductStatus.ACTIVE,
				...(input.isPopular === undefined ? {} : { isPopular: input.isPopular }),
				...(input.position === undefined ? {} : { position: input.position })
			},
			asTransaction(input.tx)
		)
	}

	updateExternalProduct(input: ProductExternalProductUpdateInput) {
		const data: Prisma.ProductUpdateManyMutationInput = {}
		if (input.data.name !== undefined) {
			data.name = input.data.name
		}
		if (input.data.sku !== undefined) {
			data.sku = input.data.sku
		}
		if (input.data.slug !== undefined) {
			data.slug = input.data.slug
		}
		if (input.data.price !== undefined) {
			data.price = normalizePrice(input.data.price)
		}
		if (input.data.status !== undefined) {
			const status = normalizeProductStatus(input.data.status)
			if (status) {
				data.status = status
			}
		}
		if (input.data.isPopular !== undefined) {
			data.isPopular = input.data.isPopular
		}
		if (input.data.position !== undefined) {
			data.position = input.data.position
		}

		return this.repo.updateExternalSync(
			{
				productId: input.productId,
				catalogId: input.catalogId,
				data
			},
			asTransaction(input.tx)
		)
	}

	async syncExternalProductDescription(
		input: ProductExternalProductDescriptionInput
	): Promise<boolean> {
		const changed = await this.repo.syncExternalDescription(
			{
				catalogId: input.catalogId,
				productId: input.productId,
				description: input.description
			},
			asTransaction(input.tx)
		)
		if (changed) {
			await this.recomputeProductCommercialState(input)
		}

		return changed
	}

	async softDeleteExternalProduct(
		input: ProductExternalProductSoftDeleteInput
	): Promise<boolean> {
		const deleted = await this.repo.softDelete(input.productId, input.catalogId)
		if (!deleted) return false

		await this.finalizer.removeProductSeo(input.productId, input.catalogId)
		await this.finalizer.invalidateCatalogProductsCache(input.catalogId)
		await this.finalizer.invalidateCategoryProductsCache(input.catalogId)
		return true
	}

	async ensureDefaultVariant(
		input: ProductExternalDefaultVariantInput
	): Promise<boolean | null> {
		const defaultVariant = await this.variants.buildDefaultVariantData(
			input.sku,
			input.price,
			{
				stock: input.stock,
				productStatus: normalizeProductStatus(input.productStatus)
			}
		)

		const repaired = await this.repo.ensureDefaultVariant(
			input.productId,
			input.catalogId,
			defaultVariant
		)
		if (repaired) {
			await this.recomputeProductCommercialState(input)
		}

		return repaired
	}

	async recomputeProductCommercialState(
		input: ProductExternalCommercialStateInput
	): Promise<boolean> {
		const products = await this.repo.findByIdsWithDetails(
			[input.productId],
			input.catalogId
		)
		const product = products[0]
		if (!product) return false

		await this.finalizer.invalidateCatalogProductsCache(input.catalogId)
		await this.finalizer.invalidateCategoryProductsCache(input.catalogId)
		await this.finalizer.syncProductSeo(product, input.catalogId)
		return true
	}
}

function asTransaction(tx: unknown): Prisma.TransactionClient | undefined {
	return tx as Prisma.TransactionClient | undefined
}

function normalizePrice(value: number | string | null): number | null {
	if (value === null) return null
	const numeric = Number(value)
	return Number.isFinite(numeric) ? numeric : null
}

function normalizeProductStatus(
	value: string | null | undefined
): ProductStatus | null {
	if (!value) return null
	return Object.values(ProductStatus).includes(value as ProductStatus)
		? (value as ProductStatus)
		: null
}

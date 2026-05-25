import { ProductVariantKind, SeoEntityType } from '@generated/enums'
import { Inject, Injectable, Optional } from '@nestjs/common'

import { SeoRepository } from '@/modules/seo/public'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_TYPE_CACHE_VERSION,
	CATEGORY_LIST_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { createDomainEvent } from '@/shared/domain-events/domain-event.utils'
import {
	DOMAIN_EVENT_DISPATCHER,
	type DomainEventDispatcher
} from '@/shared/domain-events/domain-events.contract'
import type { MediaDto } from '@/shared/media/dto/media.dto.res'
import {
	MEDIA_DETAIL_VARIANT_NAMES,
	MediaUrlService
} from '@/shared/media/media-url.service'
import { ProductMediaMapper } from '@/shared/media/product-media.mapper'

import { ProductSeoSyncService } from './product-seo-sync.service'
import type { ProductDetailsItem } from './product.repository'

type ProductSeoRecord = NonNullable<
	Awaited<ReturnType<SeoRepository['findByEntity']>>
>

type ProductSeoMapped = Omit<ProductSeoRecord, 'ogMedia' | 'twitterMedia'> & {
	ogMedia: MediaDto | null
	twitterMedia: MediaDto | null
}

export type ProductWriteFinalizeOptions = {
	bumpCatalogTypeId?: string | null
	invalidateCatalogProducts?: boolean
	invalidateCategoryProducts?: boolean
	syncSeo?: boolean
}

@Injectable()
export class ProductWriteFinalizer {
	constructor(
		private readonly cache: CacheService,
		private readonly mediaUrl: MediaUrlService,
		private readonly mapper: ProductMediaMapper,
		private readonly productSeoSync: ProductSeoSyncService,
		private readonly seoRepo: SeoRepository,
		@Optional()
		@Inject(DOMAIN_EVENT_DISPATCHER)
		private readonly events?: DomainEventDispatcher
	) {}

	async finalizeProduct(
		product: ProductDetailsItem,
		catalogId: string,
		options: ProductWriteFinalizeOptions = {}
	) {
		if (options.syncSeo) {
			await this.syncProductSeo(product, catalogId)
		}
		if (options.invalidateCatalogProducts) {
			await this.invalidateCatalogProductsCache(catalogId)
		}
		if (options.invalidateCategoryProducts) {
			await this.invalidateCategoryProductsCache(catalogId)
		}
		if (options.bumpCatalogTypeId) {
			await this.bumpCatalogTypeCache(catalogId, options.bumpCatalogTypeId)
		}

		return {
			ok: true,
			...(await this.mapProductWithSeo(product, catalogId))
		}
	}

	async syncProductSeo(
		product: ProductDetailsItem,
		catalogId: string
	): Promise<void> {
		if (this.events) {
			await this.events.dispatch(
				createDomainEvent({
					type: 'product.changed',
					catalogId,
					productId: product.id,
					changes: ['seo']
				})
			)
			return
		}

		await this.productSeoSync.syncProduct(product, catalogId)
	}

	async removeProductSeo(productId: string, catalogId: string): Promise<void> {
		if (this.events) {
			await this.events.dispatch(
				createDomainEvent({
					type: 'product.changed',
					catalogId,
					productId,
					changes: ['seo_remove']
				})
			)
			return
		}

		await this.productSeoSync.removeProduct(productId, catalogId)
	}

	async mapProductWithSeo(product: ProductDetailsItem, catalogId: string) {
		const seo = await this.seoRepo.findByEntity(
			catalogId,
			SeoEntityType.PRODUCT,
			product.id
		)
		const mapped = this.mapper.mapProduct(product, MEDIA_DETAIL_VARIANT_NAMES)
		return {
			...mapped,
			saleUnits: resolveDefaultVariantSaleUnits(mapped),
			seo: this.mapSeo(seo)
		}
	}

	async invalidateCatalogProductsCache(catalogId: string): Promise<void> {
		if (this.events) {
			await this.events.dispatch(
				createDomainEvent({
					type: 'product.changed',
					catalogId,
					productId: '*',
					changes: ['catalog_products']
				})
			)
			return
		}

		await this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId)
	}

	async invalidateCategoryProductsCache(catalogId: string): Promise<void> {
		if (this.events) {
			await this.events.dispatch(
				createDomainEvent({
					type: 'product.changed',
					catalogId,
					productId: '*',
					changes: ['category_products', 'category_list']
				})
			)
			return
		}

		await this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId)
		await this.cache.bumpVersion(CATEGORY_LIST_CACHE_VERSION, catalogId)
	}

	async bumpCatalogTypeCache(
		catalogId: string,
		catalogTypeId: string
	): Promise<void> {
		if (this.events) {
			await this.events.dispatch(
				createDomainEvent({
					type: 'catalog.cache_invalidated',
					catalogId,
					scopes: [{ name: 'catalog_type', key: catalogTypeId }]
				})
			)
			return
		}

		await this.cache.bumpVersion(CATALOG_TYPE_CACHE_VERSION, catalogTypeId)
	}

	private mapSeo(seo?: ProductSeoRecord | null): ProductSeoMapped | null {
		if (!seo) return null
		return {
			...seo,
			ogMedia: seo.ogMedia ? this.mediaUrl.mapMedia(seo.ogMedia) : null,
			twitterMedia: seo.twitterMedia
				? this.mediaUrl.mapMedia(seo.twitterMedia)
				: null
		}
	}
}

function resolveDefaultVariantSaleUnits(product: {
	variants?: unknown
}): unknown[] {
	const variants = Array.isArray(product.variants) ? product.variants : []
	const defaultVariant = variants.find(variant => {
		if (!variant || typeof variant !== 'object') return false
		const row = variant as { kind?: unknown; variantKey?: unknown }
		return row.kind === ProductVariantKind.DEFAULT || row.variantKey === 'default'
	})
	if (!defaultVariant || typeof defaultVariant !== 'object') return []

	const saleUnits = (defaultVariant as { saleUnits?: unknown }).saleUnits
	return Array.isArray(saleUnits) ? saleUnits : []
}

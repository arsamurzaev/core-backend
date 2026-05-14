import { SeoEntityType } from '@generated/enums'
import { Injectable } from '@nestjs/common'

import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_TYPE_CACHE_VERSION,
	CATEGORY_LIST_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import type { MediaDto } from '@/shared/media/dto/media.dto.res'
import {
	MEDIA_DETAIL_VARIANT_NAMES,
	MediaUrlService
} from '@/shared/media/media-url.service'
import { ProductMediaMapper } from '@/shared/media/product-media.mapper'

import { SeoRepository } from '../seo/seo.repository'

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
		private readonly seoRepo: SeoRepository
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
			await this.bumpCatalogTypeCache(options.bumpCatalogTypeId)
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
		await this.productSeoSync.syncProduct(product, catalogId)
	}

	async removeProductSeo(productId: string, catalogId: string): Promise<void> {
		await this.productSeoSync.removeProduct(productId, catalogId)
	}

	async mapProductWithSeo(product: ProductDetailsItem, catalogId: string) {
		const seo = await this.seoRepo.findByEntity(
			catalogId,
			SeoEntityType.PRODUCT,
			product.id
		)
		return {
			...this.mapper.mapProduct(product, MEDIA_DETAIL_VARIANT_NAMES),
			seo: this.mapSeo(seo)
		}
	}

	async invalidateCatalogProductsCache(catalogId: string): Promise<void> {
		await this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId)
	}

	async invalidateCategoryProductsCache(catalogId: string): Promise<void> {
		await this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId)
		await this.cache.bumpVersion(CATEGORY_LIST_CACHE_VERSION, catalogId)
	}

	async bumpCatalogTypeCache(catalogTypeId: string): Promise<void> {
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

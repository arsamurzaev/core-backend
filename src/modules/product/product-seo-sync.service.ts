import { ProductStatus, SeoChangeFreq, SeoEntityType } from '@generated/enums'
import { SeoSettingCreateInput, SeoSettingUpdateInput } from '@generated/models'
import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { SeoRepository } from '@/modules/seo/seo.repository'
import {
	MEDIA_DETAIL_VARIANT_NAMES,
	MediaUrlService
} from '@/shared/media/media-url.service'
import { normalizeNullableTrimmedString } from '@/shared/utils'

import type { ProductDetailsItem } from './product.repository'

type ProductSeoCatalogContext = {
	id: string
	name: string
	domain: string | null
	currency: string
}

@Injectable()
export class ProductSeoSyncService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly seoRepo: SeoRepository,
		private readonly mediaUrl: MediaUrlService
	) {}

	async syncProduct(
		product: ProductDetailsItem,
		catalogId: string
	): Promise<void> {
		const catalog = await this.loadCatalogContext(catalogId)
		const existing = await this.seoRepo.findByEntity(
			catalogId,
			SeoEntityType.PRODUCT,
			product.id
		)
		const seoMeta = this.buildSeoMeta(product, catalog)

		if (!existing) {
			const data: SeoSettingCreateInput = {
				catalog: { connect: { id: catalogId } },
				entityType: SeoEntityType.PRODUCT,
				entityId: product.id,
				urlPath: seoMeta.urlPath,
				canonicalUrl: seoMeta.canonicalUrl,
				title: seoMeta.title,
				description: seoMeta.description,
				keywords: seoMeta.keywords,
				h1: seoMeta.h1,
				seoText: seoMeta.seoText,
				robots: seoMeta.robots,
				isIndexable: seoMeta.isIndexable,
				isFollowable: seoMeta.isFollowable,
				ogTitle: seoMeta.ogTitle,
				ogDescription: seoMeta.ogDescription,
				...(seoMeta.primaryMediaId
					? { ogMedia: { connect: { id: seoMeta.primaryMediaId } } }
					: {}),
				ogType: 'product',
				ogUrl: seoMeta.canonicalUrl,
				ogSiteName: catalog.name,
				ogLocale: 'ru_RU',
				twitterCard: seoMeta.twitterCard,
				twitterTitle: seoMeta.ogTitle,
				twitterDescription: seoMeta.ogDescription,
				...(seoMeta.primaryMediaId
					? { twitterMedia: { connect: { id: seoMeta.primaryMediaId } } }
					: {}),
				structuredData: seoMeta.structuredData,
				extras: seoMeta.extras,
				sitemapPriority: seoMeta.sitemapPriority,
				sitemapChangeFreq: SeoChangeFreq.WEEKLY
			}

			await this.seoRepo.create(data)
			return
		}

		const data: SeoSettingUpdateInput = {
			urlPath: seoMeta.urlPath,
			canonicalUrl: seoMeta.canonicalUrl,
			title: seoMeta.title,
			description: seoMeta.description,
			keywords: seoMeta.keywords,
			h1: seoMeta.h1,
			seoText: seoMeta.seoText,
			robots: seoMeta.robots,
			isIndexable: seoMeta.isIndexable,
			isFollowable: seoMeta.isFollowable,
			ogTitle: seoMeta.ogTitle,
			ogDescription: seoMeta.ogDescription,
			ogType: 'product',
			ogUrl: seoMeta.canonicalUrl,
			ogSiteName: catalog.name,
			ogLocale: 'ru_RU',
			twitterCard: seoMeta.twitterCard,
			twitterTitle: seoMeta.ogTitle,
			twitterDescription: seoMeta.ogDescription,
			structuredData: seoMeta.structuredData,
			extras: seoMeta.extras,
			sitemapPriority: seoMeta.sitemapPriority,
			sitemapChangeFreq: SeoChangeFreq.WEEKLY,
			ogMedia: seoMeta.primaryMediaId
				? { connect: { id: seoMeta.primaryMediaId } }
				: { disconnect: true },
			twitterMedia: seoMeta.primaryMediaId
				? { connect: { id: seoMeta.primaryMediaId } }
				: { disconnect: true }
		}

		await this.seoRepo.update(existing.id, catalogId, data)
	}

	async removeProduct(productId: string, catalogId: string): Promise<void> {
		const existing = await this.seoRepo.findByEntity(
			catalogId,
			SeoEntityType.PRODUCT,
			productId
		)
		if (!existing) return

		await this.seoRepo.softDelete(existing.id, catalogId)
	}

	private async loadCatalogContext(
		catalogId: string
	): Promise<ProductSeoCatalogContext> {
		const catalog = await this.prisma.catalog.findUnique({
			where: { id: catalogId },
			select: {
				id: true,
				name: true,
				domain: true,
				config: {
					select: {
						currency: true
					}
				}
			}
		})

		return {
			id: catalogId,
			name: catalog?.name?.trim() || 'Catalog',
			domain: catalog?.domain?.trim() || null,
			currency: catalog?.config?.currency?.trim() || 'RUB'
		}
	}

	private buildSeoMeta(
		product: ProductDetailsItem,
		catalog: ProductSeoCatalogContext
	) {
		const primaryMedia = product.media[0]?.media ?? null
		const primaryMediaId = primaryMedia?.id ?? null
		const primaryMediaUrl = primaryMedia
			? this.mediaUrl.mapMedia(primaryMedia, {
					variantNames: MEDIA_DETAIL_VARIANT_NAMES
				}).url
			: null
		const categoryNames = this.extractCategoryNames(product)
		const attributeSummary = this.buildAttributeSummary(product)
		const canonicalUrl = catalog.domain
			? `https://${catalog.domain}/products/${product.slug}`
			: null
		const title = this.truncateText(
			[
				product.name,
				product.brand?.name ?? null,
				categoryNames[0] ?? null,
				catalog.name
			]
				.filter(Boolean)
				.join(' | '),
			255
		)
		const description = this.buildDescription(
			product,
			catalog.currency,
			categoryNames,
			attributeSummary
		)
		const seoText = this.buildSeoText(
			product,
			catalog.currency,
			categoryNames,
			attributeSummary
		)
		const keywords = this.buildKeywords(product, categoryNames)
		const isIndexable = product.status === ProductStatus.ACTIVE
		const isFollowable = product.status === ProductStatus.ACTIVE
		const robots = isIndexable ? 'index,follow' : 'noindex,nofollow'
		const structuredData = JSON.stringify(
			this.buildStructuredData(
				product,
				catalog,
				description,
				canonicalUrl,
				primaryMediaUrl,
				categoryNames
			)
		)
		const extras = JSON.stringify({
			source: 'product-seo-sync-v1',
			sku: product.sku,
			brand: product.brand?.name ?? null,
			primaryCategory: categoryNames[0] ?? null,
			primaryMediaId,
			status: product.status
		})

		return {
			urlPath: `/products/${product.slug}`,
			canonicalUrl,
			title,
			description,
			keywords,
			h1: this.truncateText(product.name, 255),
			seoText,
			robots,
			isIndexable,
			isFollowable,
			ogTitle: title,
			ogDescription: description,
			primaryMediaId,
			twitterCard: primaryMediaId ? 'summary_large_image' : 'summary',
			structuredData,
			extras,
			sitemapPriority: isIndexable ? 0.8 : 0.2
		}
	}

	private buildDescription(
		product: ProductDetailsItem,
		currency: string,
		categoryNames: string[],
		attributeSummary: string | null
	): string {
		const parts = [
			`Купить ${product.name}${product.brand?.name ? ` ${product.brand.name}` : ''}.`,
			categoryNames.length
				? `Категория: ${categoryNames.slice(0, 2).join(', ')}.`
				: null,
			`Цена: ${this.formatPrice(product.price)} ${currency}.`,
			attributeSummary ? `Характеристики: ${attributeSummary}.` : null
		].filter((part): part is string => Boolean(part))

		return this.truncateText(parts.join(' '), 500)
	}

	private buildSeoText(
		product: ProductDetailsItem,
		currency: string,
		categoryNames: string[],
		attributeSummary: string | null
	): string {
		const parts = [
			`${product.name} доступен в каталоге с актуальной ценой ${this.formatPrice(product.price)} ${currency}.`,
			product.brand?.name ? `Бренд: ${product.brand.name}.` : null,
			categoryNames.length
				? `Разделы: ${categoryNames.slice(0, 3).join(', ')}.`
				: null,
			attributeSummary ? `Основные характеристики: ${attributeSummary}.` : null
		].filter((part): part is string => Boolean(part))

		return parts.join(' ')
	}

	private buildKeywords(
		product: ProductDetailsItem,
		categoryNames: string[]
	): string | null {
		const candidates = [
			product.name,
			product.brand?.name ?? null,
			product.sku,
			...categoryNames,
			...product.productAttributes
				.slice(0, 4)
				.flatMap(attribute => [
					attribute.attribute.displayName,
					this.extractAttributeValue(attribute)
				])
		]

		const unique = new Set<string>()
		const items: string[] = []

		for (const candidate of candidates) {
			const normalized = normalizeNullableTrimmedString(candidate)
			if (!normalized) continue

			const key = normalized.toLowerCase()
			if (unique.has(key)) continue
			unique.add(key)
			items.push(normalized)
		}

		if (!items.length) return null

		return this.truncateText(items.join(', '), 500)
	}

	private buildStructuredData(
		product: ProductDetailsItem,
		catalog: ProductSeoCatalogContext,
		description: string,
		canonicalUrl: string | null,
		primaryMediaUrl: string | null,
		categoryNames: string[]
	) {
		const availability = this.resolveAvailability(product)

		return {
			'@context': 'https://schema.org',
			'@type': 'Product',
			name: product.name,
			description,
			sku: product.sku,
			...(primaryMediaUrl ? { image: [primaryMediaUrl] } : {}),
			...(product.brand?.name
				? {
						brand: {
							'@type': 'Brand',
							name: product.brand.name
						}
					}
				: {}),
			...(categoryNames.length ? { category: categoryNames.join(' / ') } : {}),
			...(canonicalUrl ? { url: canonicalUrl } : {}),
			offers: {
				'@type': 'Offer',
				priceCurrency: catalog.currency,
				price: this.formatPrice(product.price),
				availability,
				itemCondition: 'https://schema.org/NewCondition',
				...(canonicalUrl ? { url: canonicalUrl } : {})
			}
		}
	}

	private resolveAvailability(product: ProductDetailsItem): string {
		if (product.status !== ProductStatus.ACTIVE) {
			return 'https://schema.org/OutOfStock'
		}

		if (!product.variants.length) {
			return 'https://schema.org/InStock'
		}

		const hasAvailableVariant = product.variants.some(
			variant =>
				variant.isAvailable &&
				variant.status === 'ACTIVE' &&
				typeof variant.stock === 'number' &&
				variant.stock > 0
		)

		return hasAvailableVariant
			? 'https://schema.org/InStock'
			: 'https://schema.org/OutOfStock'
	}

	private buildAttributeSummary(product: ProductDetailsItem): string | null {
		const parts = product.productAttributes
			.filter(attribute => !attribute.attribute.isHidden)
			.map(attribute => {
				const value = this.extractAttributeValue(attribute)
				if (!value) return null
				return `${attribute.attribute.displayName}: ${value}`
			})
			.filter((value): value is string => Boolean(value))
			.slice(0, 3)

		if (!parts.length) return null

		return this.truncateText(parts.join(', '), 220)
	}

	private extractAttributeValue(
		attribute: ProductDetailsItem['productAttributes'][number]
	): string | null {
		if (attribute.enumValue?.displayName) return attribute.enumValue.displayName
		if (attribute.enumValue?.value) return attribute.enumValue.value
		if (attribute.valueString) return attribute.valueString
		if (attribute.valueInteger !== null) return String(attribute.valueInteger)
		if (attribute.valueDecimal !== null)
			return this.formatPrice(attribute.valueDecimal)
		if (attribute.valueBoolean !== null) {
			return attribute.valueBoolean ? 'да' : 'нет'
		}
		if (attribute.valueDateTime) {
			return new Date(attribute.valueDateTime).toISOString().slice(0, 10)
		}

		return null
	}

	private extractCategoryNames(product: ProductDetailsItem): string[] {
		return Array.from(
			new Set(
				product.categoryProducts
					.map(item => normalizeNullableTrimmedString(item.category?.name))
					.filter((value): value is string => Boolean(value))
			)
		)
	}

	private truncateText(value: string, maxLength: number): string {
		const normalized = value.replace(/\s+/g, ' ').trim()
		if (normalized.length <= maxLength) return normalized
		return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`
	}

	private formatPrice(value: number | string | { toString(): string }): string {
		const numeric = typeof value === 'number' ? value : Number(String(value ?? 0))
		if (!Number.isFinite(numeric)) return '0'
		return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2)
	}
}

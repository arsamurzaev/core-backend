import type { IntegrationProvider } from '@generated/enums'
import { Injectable } from '@nestjs/common'

import type { MediaDto } from './dto/media.dto.res'
import type { MediaRecord } from './media-url.service'
import { MediaUrlService } from './media-url.service'

export type ProductIntegrationLinkRecord = {
	externalId: string
	externalCode?: string | null
	lastSyncedAt?: Date | string | null
	integration?: { provider: IntegrationProvider } | null
}

export type ProductMappableRecord = {
	media: { position: number; kind?: string | null; media: MediaRecord }[]
	categoryProducts?: {
		position: number
		category?: { id: string; name: string } | null
	}[]
	integrationLinks?: ProductIntegrationLinkRecord[]
}

export type ProductIntegrationMapped = {
	provider: IntegrationProvider
	externalId: string
	externalCode: string | null
	lastSyncedAt: Date | string | null
} | null

export type ProductMediaMapped<T extends ProductMappableRecord> = Omit<
	T,
	'media' | 'categoryProducts' | 'integrationLinks'
> & {
	media: { position: number; kind: string | null; media: MediaDto }[]
	categories: { id: string; name: string; position: number }[]
	integration: ProductIntegrationMapped
}

@Injectable()
export class ProductMediaMapper {
	constructor(private readonly mediaUrl: MediaUrlService) {}

	mapProduct<T extends ProductMappableRecord>(
		product: T,
		variantNames?: readonly string[]
	): ProductMediaMapped<T> {
		const { media, categoryProducts, integrationLinks, ...rest } = product

		return {
			...rest,
			media: (media ?? []).map(item => ({
				position: item.position,
				kind: item.kind ?? null,
				media: this.mediaUrl.mapMedia(item.media, { variantNames })
			})),
			categories: (categoryProducts ?? [])
				.map(item =>
					item.category
						? {
								id: item.category.id,
								name: item.category.name,
								position: item.position
							}
						: null
				)
				.filter((item): item is NonNullable<typeof item> => item !== null),
			integration: this.mapIntegration(integrationLinks)
		} as ProductMediaMapped<T>
	}

	mapIntegration(
		integrationLinks?: ProductIntegrationLinkRecord[]
	): ProductIntegrationMapped {
		const link = integrationLinks?.[0]
		if (!link?.integration?.provider) return null

		return {
			provider: link.integration.provider,
			externalId: link.externalId,
			externalCode: link.externalCode ?? null,
			lastSyncedAt: link.lastSyncedAt ?? null
		}
	}
}

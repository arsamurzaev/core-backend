import { ProductStatus } from '@generated/enums'
import { Inject, Injectable, Logger } from '@nestjs/common'

import {
	PRODUCT_EXTERNAL_SYNC_PORT,
	type ProductExternalSyncPort
} from '@/modules/product/public'

import {
	type IntegrationProductLinkRecord,
	IntegrationRepository
} from '../../integration.repository'

const REQUIRED_MISSING_PRODUCT_CONFIRMATIONS = 2

@Injectable()
export class MoySkladMissingProductSyncService {
	private readonly logger = new Logger(MoySkladMissingProductSyncService.name)

	constructor(
		private readonly repo: IntegrationRepository,
		@Inject(PRODUCT_EXTERNAL_SYNC_PORT)
		private readonly products: ProductExternalSyncPort
	) {}

	async hideMissingProducts(params: {
		catalogId: string
		integrationId: string
		currentExternalIds: ReadonlySet<string>
		productLinks?: IntegrationProductLinkRecord[] | null
	}): Promise<number> {
		const links =
			params.productLinks ??
			(await this.repo.findProductLinksByIntegration(params.integrationId))
		let hidden = 0
		let quarantined = 0

		for (const link of links) {
			const rawMetaId = readRawMetaString(link.rawMeta, 'id')
			if (
				params.currentExternalIds.has(link.externalId) ||
				(rawMetaId ? params.currentExternalIds.has(rawMetaId) : false)
			) {
				continue
			}

			const missingLink = await this.repo.markProductLinkMissingFromSnapshot(
				link.id
			)
			if (
				!missingLink ||
				missingLink.missingSyncCount < REQUIRED_MISSING_PRODUCT_CONFIRMATIONS
			) {
				quarantined += 1
				continue
			}

			const product = await this.products.findExternalProductById({
				catalogId: params.catalogId,
				productId: link.productId
			})
			if (!product || product.status !== ProductStatus.ACTIVE) {
				continue
			}

			await this.products.updateExternalProduct({
				productId: product.id,
				catalogId: params.catalogId,
				data: { status: ProductStatus.HIDDEN }
			})
			await this.repo.markProductLinkHiddenAfterMissing(link.id)
			hidden += 1
		}

		if (quarantined > 0) {
			this.logger.warn(
				`Quarantined ${quarantined} missing MoySklad products for catalog ${params.catalogId}; waiting for ${REQUIRED_MISSING_PRODUCT_CONFIRMATIONS} complete snapshots before hiding`
			)
		}
		if (hidden > 0) {
			this.logger.log(
				`Hidden ${hidden} missing MoySklad products for catalog ${params.catalogId}`
			)
		}

		return hidden
	}
}

function readRawMetaString(rawMeta: unknown, key: string): string | null {
	if (!rawMeta || typeof rawMeta !== 'object' || Array.isArray(rawMeta)) {
		return null
	}

	const value = (rawMeta as Record<string, unknown>)[key]
	return typeof value === 'string' && value.trim() ? value.trim() : null
}

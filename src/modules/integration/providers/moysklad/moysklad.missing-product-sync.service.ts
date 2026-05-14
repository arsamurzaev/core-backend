import { ProductStatus } from '@generated/enums'
import { Injectable, Logger } from '@nestjs/common'

import {
	type IntegrationProductLinkRecord,
	IntegrationRepository
} from '../../integration.repository'

@Injectable()
export class MoySkladMissingProductSyncService {
	private readonly logger = new Logger(MoySkladMissingProductSyncService.name)

	constructor(private readonly repo: IntegrationRepository) {}

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

		for (const link of links) {
			if (params.currentExternalIds.has(link.externalId)) {
				continue
			}

			const product = await this.repo.findProductById(
				params.catalogId,
				link.productId
			)
			if (!product || product.status !== ProductStatus.ACTIVE) {
				continue
			}

			await this.repo.updateProduct({
				productId: product.id,
				catalogId: params.catalogId,
				data: { status: ProductStatus.HIDDEN }
			})
			hidden += 1
		}

		if (hidden > 0) {
			this.logger.log(
				`Hidden ${hidden} missing MoySklad products for catalog ${params.catalogId}`
			)
		}

		return hidden
	}
}

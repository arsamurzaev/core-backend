import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'

import { CatalogDomainService } from '@/modules/catalog/catalog-domain.service'

const DEFAULT_DOMAIN_CHECK_CRON = '*/5 * * * *'

@Injectable()
export class CatalogDomainCronService {
	private readonly logger = new Logger(CatalogDomainCronService.name)

	constructor(private readonly domains: CatalogDomainService) {}

	@Cron(process.env.CATALOG_DOMAIN_CHECK_CRON ?? DEFAULT_DOMAIN_CHECK_CRON, {
		name: 'catalog-domain-check'
	})
	async checkPendingDomains() {
		if (process.env.CATALOG_DOMAIN_CHECK_ENABLED === 'false') return

		const limit = Number(process.env.CATALOG_DOMAIN_CHECK_LIMIT ?? 25) || 25
		const checked = await this.domains.checkPendingDomains(limit)
		if (checked > 0) {
			this.logger.log(`Checked ${checked} catalog domain(s)`)
		}
	}
}

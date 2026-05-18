import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'

import {
	CATALOG_DOMAIN_MAINTENANCE_PORT,
	type CatalogDomainMaintenancePort
} from '@/modules/catalog/contracts'

const DEFAULT_DOMAIN_CHECK_CRON = '*/5 * * * *'

@Injectable()
export class CatalogDomainCronService {
	private readonly logger = new Logger(CatalogDomainCronService.name)

	constructor(
		@Inject(CATALOG_DOMAIN_MAINTENANCE_PORT)
		private readonly domains: CatalogDomainMaintenancePort
	) {}

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

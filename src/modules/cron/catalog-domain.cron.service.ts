import { Inject, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { SpanStatusCode, trace } from '@opentelemetry/api'

import {
	CATALOG_DOMAIN_MAINTENANCE_PORT,
	type CatalogDomainMaintenancePort
} from '@/modules/catalog/contracts'
import {
	OBSERVABILITY_RECORDER_PORT,
	type ObservabilityRecorderPort
} from '@/modules/observability/contracts'

const DEFAULT_DOMAIN_CHECK_CRON = '*/5 * * * *'
const CATALOG_DOMAIN_CHECK_JOB_NAME = 'catalog-domain-check'

@Injectable()
export class CatalogDomainCronService {
	private readonly logger = new Logger(CatalogDomainCronService.name)
	private readonly tracer = trace.getTracer('catalog_backend.cron')

	constructor(
		@Inject(CATALOG_DOMAIN_MAINTENANCE_PORT)
		private readonly domains: CatalogDomainMaintenancePort,
		@Inject(OBSERVABILITY_RECORDER_PORT)
		private readonly observability: ObservabilityRecorderPort
	) {}

	@Cron(process.env.CATALOG_DOMAIN_CHECK_CRON ?? DEFAULT_DOMAIN_CHECK_CRON, {
		name: CATALOG_DOMAIN_CHECK_JOB_NAME
	})
	async checkPendingDomains(): Promise<void> {
		if (process.env.CATALOG_DOMAIN_CHECK_ENABLED === 'false') return

		return this.tracer.startActiveSpan(
			'cron.catalog_domain_check',
			async span => {
				const startedAt = process.hrtime.bigint()

				try {
					const limit = Number(process.env.CATALOG_DOMAIN_CHECK_LIMIT ?? 25) || 25
					const checked = await this.domains.checkPendingDomains(limit)
					const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000

					span.setAttributes({
						'cron.name': CATALOG_DOMAIN_CHECK_JOB_NAME,
						'catalog.domains.checked': checked
					})
					span.setStatus({ code: SpanStatusCode.OK })
					this.observability.recordCronRun(
						CATALOG_DOMAIN_CHECK_JOB_NAME,
						'success',
						durationMs
					)

					if (checked > 0) {
						this.logger.log(`Checked ${checked} catalog domain(s)`)
					}
				} catch (error) {
					const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
					const message = error instanceof Error ? error.message : String(error)

					span.recordException(error instanceof Error ? error : new Error(message))
					span.setStatus({ code: SpanStatusCode.ERROR, message })
					this.observability.recordCronRun(
						CATALOG_DOMAIN_CHECK_JOB_NAME,
						'error',
						durationMs
					)
					this.logger.error(
						`Catalog domain check cron failed: ${message}`,
						error instanceof Error ? error.stack : undefined
					)
				} finally {
					span.end()
				}
			}
		)
	}
}

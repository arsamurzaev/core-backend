import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { SpanStatusCode, trace } from '@opentelemetry/api'

import { ObservabilityService } from '@/modules/observability/observability.service'
import { ProductService } from '@/modules/product/product.service'

const PRODUCT_DISCOUNT_EXPIRY_CRON = '0 1 * * *'
const PRODUCT_DISCOUNT_EXPIRY_TIMEZONE = 'Europe/Moscow'
const PRODUCT_DISCOUNT_EXPIRY_JOB_NAME = 'product-discount-expiry'

@Injectable()
export class ProductDiscountCronService {
	private readonly logger = new Logger(ProductDiscountCronService.name)
	private readonly tracer = trace.getTracer('catalog_backend.cron')

	constructor(
		private readonly products: ProductService,
		private readonly observability: ObservabilityService
	) {}

	@Cron(PRODUCT_DISCOUNT_EXPIRY_CRON, {
		name: PRODUCT_DISCOUNT_EXPIRY_JOB_NAME,
		timeZone: PRODUCT_DISCOUNT_EXPIRY_TIMEZONE
	})
	async expireScheduledDiscounts(): Promise<void> {
		return this.tracer.startActiveSpan(
			'cron.product_discount_expiry',
			async span => {
				const startedAt = process.hrtime.bigint()

				try {
					const result = await this.products.expireScheduledDiscounts()
					const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000

					span.setAttributes({
						'cron.name': PRODUCT_DISCOUNT_EXPIRY_JOB_NAME,
						'catalog.products.updated': result.updatedProducts,
						'catalog.catalogs.affected': result.affectedCatalogs
					})
					span.setStatus({ code: SpanStatusCode.OK })

					this.observability.recordCronRun(
						PRODUCT_DISCOUNT_EXPIRY_JOB_NAME,
						'success',
						durationMs
					)
					this.logger.log(
						`Product discount expiry cron finished: updatedProducts=${result.updatedProducts}, affectedCatalogs=${result.affectedCatalogs}`
					)
				} catch (error) {
					const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000
					const message = error instanceof Error ? error.message : String(error)

					span.recordException(error instanceof Error ? error : new Error(message))
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message
					})

					this.observability.recordCronRun(
						PRODUCT_DISCOUNT_EXPIRY_JOB_NAME,
						'error',
						durationMs
					)
					this.logger.error(
						`Product discount expiry cron failed: ${message}`,
						error instanceof Error ? error.stack : undefined
					)
				} finally {
					span.end()
				}
			}
		)
	}
}

import { ObservabilityService } from './observability.service'

describe('ObservabilityService', () => {
	const originalEnv = process.env

	beforeEach(() => {
		process.env = {
			...originalEnv,
			OBSERVABILITY_ENABLED: 'true',
			OBSERVABILITY_METRICS_ENABLED: 'true',
			OBSERVABILITY_SERVICE_NAME: 'catalog_backend'
		}
	})

	afterEach(() => {
		process.env = originalEnv
	})

	it('reports stock stale age for the last successful integration stock sync', async () => {
		const service = new ObservabilityService()

		service.recordIntegrationStockFreshness(
			'MOYSKLAD',
			'catalog-1',
			new Date(Date.now() - 1000)
		)

		const metrics = await service.getMetrics()

		expect(metrics).toContain(
			'catalog_backend_integration_stock_stale_age_seconds'
		)
		expect(metrics).toContain('provider="MOYSKLAD",catalog_id="catalog-1"')
	})
})

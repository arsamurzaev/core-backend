import { resolveObservabilitySettings } from './observability.settings'

describe('resolveObservabilitySettings', () => {
	it('uses safe defaults for local development', () => {
		const settings = resolveObservabilitySettings({})

		expect(settings.enabled).toBe(true)
		expect(settings.serviceName).toBe('catalog_backend')
		expect(settings.metricsPath).toBe('/metrics')
		expect(settings.metricsEnabled).toBe(true)
		expect(settings.jsonLogsEnabled).toBe(true)
		expect(settings.tracesEnabled).toBe(false)
		expect(settings.logFilePath).toBe('runtime/logs/backend.jsonl')
	})

	it('enables tracing when a traces URL is configured', () => {
		const settings = resolveObservabilitySettings({
			OBSERVABILITY_SERVICE_NAME: 'Catalog Backend',
			OBSERVABILITY_OTLP_TRACES_URL: 'http://localhost:4318/v1/traces',
			OBSERVABILITY_TRACES_ENABLED: 'true',
			NODE_ENV: 'production'
		})

		expect(settings.tracesEnabled).toBe(true)
		expect(settings.metricPrefix).toBe('catalog_backend')
		expect(settings.otlpTracesUrl).toBe('http://localhost:4318/v1/traces')
	})

	it('disables all observability exports with a single flag', () => {
		const settings = resolveObservabilitySettings({
			OBSERVABILITY_ENABLED: 'false',
			OBSERVABILITY_JSON_LOGS: 'true',
			OBSERVABILITY_METRICS_ENABLED: 'true',
			OBSERVABILITY_TRACES_ENABLED: 'true',
			OBSERVABILITY_OTLP_TRACES_URL: 'http://localhost:4318/v1/traces'
		})

		expect(settings.enabled).toBe(false)
		expect(settings.metricsEnabled).toBe(false)
		expect(settings.jsonLogsEnabled).toBe(false)
		expect(settings.tracesEnabled).toBe(false)
		expect(settings.logFilePath).toBeUndefined()
	})
})

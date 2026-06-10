import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
	BatchSpanProcessor,
	ParentBasedSampler,
	TraceIdRatioBasedSampler
} from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION
} from '@opentelemetry/semantic-conventions'

import { resolveObservabilitySettings } from './observability.settings'

const settings = resolveObservabilitySettings()

let provider: NodeTracerProvider | null = null
let initialized = false

export function initTracing() {
	if (initialized || !settings.tracesEnabled || !settings.otlpTracesUrl) {
		return
	}

	initialized = true

	if (process.env.OBSERVABILITY_TRACING_DEBUG === 'true') {
		diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO)
	}

	const traceExporter = new OTLPTraceExporter({
		url: settings.otlpTracesUrl,
		timeoutMillis: 5000
	})

	provider = new NodeTracerProvider({
		resource: resourceFromAttributes({
			[ATTR_SERVICE_NAME]: settings.serviceName,
			[ATTR_SERVICE_VERSION]: settings.serviceVersion,
			'deployment.environment.name': settings.deploymentEnvironment
		}),
		sampler: new ParentBasedSampler({
			root: new TraceIdRatioBasedSampler(settings.tracesSampleRate)
		}),
		spanProcessors: [new BatchSpanProcessor(traceExporter)]
	})

	provider.register()

	const shutdown = () => {
		if (!provider) return

		const currentProvider = provider
		provider = null

		void currentProvider.shutdown().catch(error => {
			process.stderr.write(
				`Failed to shutdown OpenTelemetry provider: ${
					error instanceof Error ? error.message : String(error)
				}\n`
			)
		})
	}

	process.once('SIGTERM', shutdown)
	process.once('SIGINT', shutdown)
}

import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { NodeSDK } from '@opentelemetry/sdk-node'
import {
	ParentBasedSampler,
	TraceIdRatioBasedSampler
} from '@opentelemetry/sdk-trace-base'
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION
} from '@opentelemetry/semantic-conventions'

import { resolveObservabilitySettings } from './observability.settings'

const settings = resolveObservabilitySettings()

let sdk: NodeSDK | null = null
let initialized = false

export function initTracing() {
	if (initialized || !settings.tracesEnabled || !settings.otlpTracesUrl) {
		return
	}

	initialized = true

	if (process.env.OBSERVABILITY_TRACING_DEBUG === 'true') {
		diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO)
	}

	sdk = new NodeSDK({
		resource: resourceFromAttributes({
			[ATTR_SERVICE_NAME]: settings.serviceName,
			[ATTR_SERVICE_VERSION]: settings.serviceVersion,
			'deployment.environment.name': settings.deploymentEnvironment
		}),
		sampler: new ParentBasedSampler({
			root: new TraceIdRatioBasedSampler(settings.tracesSampleRate)
		}),
		traceExporter: new OTLPTraceExporter({
			url: settings.otlpTracesUrl,
			timeoutMillis: 5000
		}),
		instrumentations: [
			getNodeAutoInstrumentations({
				'@opentelemetry/instrumentation-fs': {
					enabled: false
				}
			})
		]
	})

	void Promise.resolve(sdk.start()).catch(error => {
		process.stderr.write(
			`Failed to start OpenTelemetry SDK: ${
				error instanceof Error ? error.message : String(error)
			}\n`
		)
	})

	const shutdown = () => {
		if (!sdk) return

		void Promise.resolve(sdk.shutdown()).catch(error => {
			process.stderr.write(
				`Failed to shutdown OpenTelemetry SDK: ${
					error instanceof Error ? error.message : String(error)
				}\n`
			)
		})
	}

	process.once('SIGTERM', shutdown)
	process.once('SIGINT', shutdown)
}

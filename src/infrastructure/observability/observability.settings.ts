type BooleanLike = '1' | '0' | 'true' | 'false' | 'yes' | 'no' | 'on' | 'off'

export type ObservabilitySettings = {
	enabled: boolean
	serviceName: string
	serviceVersion: string
	deploymentEnvironment: string
	metricsEnabled: boolean
	metricsPath: string
	jsonLogsEnabled: boolean
	logFilePath?: string
	tracesEnabled: boolean
	otlpTracesUrl?: string
	metricPrefix: string
}

const DEFAULT_SERVICE_NAME = 'catalog_backend'
const DEFAULT_SERVICE_VERSION = '0.0.1'
const DEFAULT_METRICS_PATH = '/metrics'
const DEFAULT_LOG_FILE_PATH = 'runtime/logs/backend.jsonl'

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) return fallback

	const normalized = value.trim().toLowerCase() as BooleanLike
	switch (normalized) {
		case '1':
		case 'true':
		case 'yes':
		case 'on':
			return true
		case '0':
		case 'false':
		case 'no':
		case 'off':
			return false
		default:
			return fallback
	}
}

function normalizePath(path: string | undefined, fallback: string): string {
	const normalized = path?.trim() || fallback
	return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function normalizeMetricPrefix(serviceName: string): string {
	const normalized = serviceName
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')

	return normalized || DEFAULT_SERVICE_NAME
}

export function resolveObservabilitySettings(
	env: NodeJS.ProcessEnv = process.env
): ObservabilitySettings {
	const enabled = parseBoolean(env.OBSERVABILITY_ENABLED, true)
	const serviceName =
		env.OBSERVABILITY_SERVICE_NAME?.trim() || DEFAULT_SERVICE_NAME
	const serviceVersion =
		env.OBSERVABILITY_SERVICE_VERSION?.trim() || DEFAULT_SERVICE_VERSION
	const deploymentEnvironment =
		env.OBSERVABILITY_DEPLOYMENT_ENVIRONMENT?.trim() ||
		env.NODE_ENV?.trim() ||
		'development'
	const metricsPath = normalizePath(
		env.OBSERVABILITY_METRICS_PATH,
		DEFAULT_METRICS_PATH
	)
	const otlpTracesUrl = env.OBSERVABILITY_OTLP_TRACES_URL?.trim() || undefined
	const configuredLogFilePath = env.OBSERVABILITY_LOG_FILE_PATH?.trim()
	const logFilePath =
		!enabled || configuredLogFilePath === ''
			? undefined
			: configuredLogFilePath || DEFAULT_LOG_FILE_PATH

	return {
		enabled,
		serviceName,
		serviceVersion,
		deploymentEnvironment,
		metricsEnabled:
			enabled && parseBoolean(env.OBSERVABILITY_METRICS_ENABLED, true),
		metricsPath,
		jsonLogsEnabled:
			enabled && parseBoolean(env.OBSERVABILITY_JSON_LOGS, true),
		logFilePath,
		tracesEnabled:
			enabled &&
			parseBoolean(env.OBSERVABILITY_TRACES_ENABLED, true) &&
			Boolean(otlpTracesUrl) &&
			env.NODE_ENV !== 'test',
		otlpTracesUrl,
		metricPrefix: normalizeMetricPrefix(serviceName)
	}
}

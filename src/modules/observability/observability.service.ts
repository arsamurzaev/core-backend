import { Injectable } from '@nestjs/common'
import {
	collectDefaultMetrics,
	Counter,
	Gauge,
	Histogram,
	Registry
} from 'prom-client'

import { resolveObservabilitySettings } from '@/infrastructure/observability/observability.settings'

import { statusCodeToClass } from './http-observability.utils'

@Injectable()
export class ObservabilityService {
	private readonly settings = resolveObservabilitySettings()
	private readonly registry = new Registry()

	private readonly httpRequestsTotal = new Counter({
		name: `${this.settings.metricPrefix}_http_requests_total`,
		help: 'Total number of completed HTTP requests.',
		labelNames: ['method', 'route', 'status_code', 'status_class'] as const,
		registers: [this.registry]
	})

	private readonly httpRequestDurationSeconds = new Histogram({
		name: `${this.settings.metricPrefix}_http_request_duration_seconds`,
		help: 'HTTP request duration in seconds.',
		labelNames: ['method', 'route', 'status_code', 'status_class'] as const,
		buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
		registers: [this.registry]
	})

	private readonly httpRequestsInFlight = new Gauge({
		name: `${this.settings.metricPrefix}_http_requests_in_flight`,
		help: 'Number of in-flight HTTP requests.',
		labelNames: ['method', 'route'] as const,
		registers: [this.registry]
	})

	private readonly cronRunsTotal = new Counter({
		name: `${this.settings.metricPrefix}_cron_runs_total`,
		help: 'Total number of completed cron executions.',
		labelNames: ['name', 'status'] as const,
		registers: [this.registry]
	})

	private readonly cronDurationSeconds = new Histogram({
		name: `${this.settings.metricPrefix}_cron_duration_seconds`,
		help: 'Cron execution duration in seconds.',
		labelNames: ['name', 'status'] as const,
		buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
		registers: [this.registry]
	})

	private readonly queueJobsEnqueuedTotal = new Counter({
		name: `${this.settings.metricPrefix}_queue_jobs_enqueued_total`,
		help: 'Total number of queue jobs enqueued by the application.',
		labelNames: ['queue', 'job_name'] as const,
		registers: [this.registry]
	})

	private readonly queueJobsTotal = new Counter({
		name: `${this.settings.metricPrefix}_queue_jobs_total`,
		help: 'Total number of processed queue jobs.',
		labelNames: ['queue', 'job_name', 'status'] as const,
		registers: [this.registry]
	})

	private readonly queueJobDurationSeconds = new Histogram({
		name: `${this.settings.metricPrefix}_queue_job_duration_seconds`,
		help: 'Queue job execution duration in seconds.',
		labelNames: ['queue', 'job_name', 'status'] as const,
		buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
		registers: [this.registry]
	})

	private readonly queueJobsActive = new Gauge({
		name: `${this.settings.metricPrefix}_queue_jobs_active`,
		help: 'Number of queue jobs currently being processed.',
		labelNames: ['queue', 'job_name'] as const,
		registers: [this.registry]
	})

	private readonly cacheOperationsTotal = new Counter({
		name: `${this.settings.metricPrefix}_cache_operations_total`,
		help: 'Total number of cache operations.',
		labelNames: ['operation', 'outcome'] as const,
		registers: [this.registry]
	})

	private readonly cacheOperationDurationSeconds = new Histogram({
		name: `${this.settings.metricPrefix}_cache_operation_duration_seconds`,
		help: 'Cache operation duration in seconds.',
		labelNames: ['operation', 'outcome'] as const,
		buckets: [0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
		registers: [this.registry]
	})

	private readonly prismaSlowQueriesTotal = new Counter({
		name: `${this.settings.metricPrefix}_prisma_slow_queries_total`,
		help: 'Total number of slow Prisma queries detected.',
		registers: [this.registry]
	})

	private readonly prismaSlowQueryDurationSeconds = new Histogram({
		name: `${this.settings.metricPrefix}_prisma_slow_query_duration_seconds`,
		help: 'Observed duration of slow Prisma queries in seconds.',
		buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
		registers: [this.registry]
	})

	private readonly authEventsTotal = new Counter({
		name: `${this.settings.metricPrefix}_auth_events_total`,
		help: 'Total number of auth and security related events.',
		labelNames: ['flow', 'action', 'outcome', 'reason'] as const,
		registers: [this.registry]
	})

	private readonly adminActionsTotal = new Counter({
		name: `${this.settings.metricPrefix}_admin_actions_total`,
		help: 'Total number of admin panel actions.',
		labelNames: ['action', 'outcome', 'actor_id'] as const,
		registers: [this.registry]
	})

	constructor() {
		this.registry.setDefaultLabels({
			service: this.settings.serviceName,
			environment: this.settings.deploymentEnvironment
		})

		if (this.settings.metricsEnabled) {
			collectDefaultMetrics({
				register: this.registry,
				prefix: `${this.settings.metricPrefix}_process_`
			})
		}
	}

	get isEnabled(): boolean {
		return this.settings.enabled
	}

	get isMetricsEnabled(): boolean {
		return this.settings.metricsEnabled
	}

	get metricsPath(): string {
		return this.settings.metricsPath
	}

	get contentType(): string {
		return this.registry.contentType
	}

	async getMetrics(): Promise<string> {
		if (!this.settings.metricsEnabled) {
			return ''
		}

		return this.registry.metrics()
	}

	getHealth() {
		return {
			ok: true,
			enabled: this.settings.enabled,
			service: this.settings.serviceName,
			environment: this.settings.deploymentEnvironment,
			timestamp: new Date().toISOString(),
			metricsPath: this.settings.metricsPath,
			metricsEnabled: this.settings.metricsEnabled,
			jsonLogsEnabled: this.settings.jsonLogsEnabled,
			tracesEnabled: this.settings.tracesEnabled
		}
	}

	incrementHttpInFlight(method: string, route: string) {
		if (!this.settings.metricsEnabled) return

		this.httpRequestsInFlight.inc({
			method: method.toUpperCase(),
			route
		})
	}

	decrementHttpInFlight(method: string, route: string) {
		if (!this.settings.metricsEnabled) return

		this.httpRequestsInFlight.dec({
			method: method.toUpperCase(),
			route
		})
	}

	recordHttpRequest(
		method: string,
		route: string,
		statusCode: number,
		durationMs: number
	) {
		if (!this.settings.metricsEnabled) return

		const labels = {
			method: method.toUpperCase(),
			route,
			status_code: String(statusCode),
			status_class: statusCodeToClass(statusCode)
		}

		this.httpRequestsTotal.inc(labels)
		this.httpRequestDurationSeconds.observe(labels, durationMs / 1000)
	}

	recordCronRun(name: string, status: 'success' | 'error', durationMs: number) {
		if (!this.settings.metricsEnabled) return

		const labels = { name, status }
		this.cronRunsTotal.inc(labels)
		this.cronDurationSeconds.observe(labels, durationMs / 1000)
	}

	recordQueueJobEnqueued(queue: string, jobName: string) {
		if (!this.settings.metricsEnabled) return

		this.queueJobsEnqueuedTotal.inc({
			queue,
			job_name: jobName
		})
	}

	incrementQueueJobActive(queue: string, jobName: string) {
		if (!this.settings.metricsEnabled) return

		this.queueJobsActive.inc({
			queue,
			job_name: jobName
		})
	}

	decrementQueueJobActive(queue: string, jobName: string) {
		if (!this.settings.metricsEnabled) return

		this.queueJobsActive.dec({
			queue,
			job_name: jobName
		})
	}

	recordQueueJob(
		queue: string,
		jobName: string,
		status: 'success' | 'error' | 'skipped',
		durationMs: number
	) {
		if (!this.settings.metricsEnabled) return

		const labels = {
			queue,
			job_name: jobName,
			status
		}

		this.queueJobsTotal.inc(labels)
		this.queueJobDurationSeconds.observe(labels, durationMs / 1000)
	}

	recordCacheOperation(
		operation: 'get_version' | 'bump_version' | 'get_json' | 'set_json' | 'del',
		outcome: 'success' | 'error' | 'hit' | 'miss' | 'corrupted',
		durationMs: number
	) {
		if (!this.settings.metricsEnabled) return

		const labels = { operation, outcome }
		this.cacheOperationsTotal.inc(labels)
		this.cacheOperationDurationSeconds.observe(labels, durationMs / 1000)
	}

	recordPrismaSlowQuery(durationMs: number) {
		if (!this.settings.metricsEnabled) return

		this.prismaSlowQueriesTotal.inc()
		this.prismaSlowQueryDurationSeconds.observe(durationMs / 1000)
	}

	recordAdminAction(
		action: string,
		outcome: 'success' | 'error',
		actorId: string
	) {
		if (!this.settings.metricsEnabled) return

		this.adminActionsTotal.inc({
			action,
			outcome,
			actor_id: actorId
		})
	}

	recordAuthEvent(
		flow: 'admin' | 'catalog' | 'session' | 'admin_sso',
		action: 'login' | 'logout' | 'handoff_issue' | 'handoff_exchange',
		outcome: 'success' | 'failure',
		reason:
			| 'none'
			| 'credentials'
			| 'access'
			| 'token'
			| 'session'
			| 'not_found'
			| 'other'
	) {
		if (!this.settings.metricsEnabled) return

		this.authEventsTotal.inc({
			flow,
			action,
			outcome,
			reason
		})
	}
}

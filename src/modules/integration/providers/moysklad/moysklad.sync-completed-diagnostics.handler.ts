import { IntegrationSyncRunMode } from '@generated/enums'
import { Inject, Injectable, OnModuleInit } from '@nestjs/common'

import {
	OBSERVABILITY_RECORDER_PORT,
	type ObservabilityRecorderPort
} from '@/modules/observability/contracts'
import {
	DOMAIN_EVENT_BUS,
	type DomainEvent,
	type DomainEventBus
} from '@/shared/domain-events/domain-events.contract'

import { IntegrationRepository } from '../../integration.repository'

type IntegrationSyncCompletedEvent = Extract<
	DomainEvent,
	{ type: 'integration.sync_completed' }
>

@Injectable()
export class MoySkladSyncCompletedDiagnosticsHandler implements OnModuleInit {
	constructor(
		@Inject(DOMAIN_EVENT_BUS)
		private readonly bus: DomainEventBus,
		private readonly repo: IntegrationRepository,
		@Inject(OBSERVABILITY_RECORDER_PORT)
		private readonly observability: ObservabilityRecorderPort
	) {}

	onModuleInit(): void {
		this.bus.subscribe<IntegrationSyncCompletedEvent>(
			'integration.sync_completed',
			event => this.handleSyncCompleted(event)
		)
	}

	private async handleSyncCompleted(
		event: IntegrationSyncCompletedEvent
	): Promise<void> {
		const run = await this.repo.findSyncRunById(event.runId)
		if (!run) return
		if (run.catalogId !== event.catalogId) return
		if (run.integrationId !== event.integrationId) return
		if (run.mode !== IntegrationSyncRunMode.STOCK) return

		const lastStockSyncedAt = readLastStockSyncedAt(run.metadata)
		if (!lastStockSyncedAt) return

		this.observability.recordIntegrationStockFreshness(
			String(run.provider),
			run.catalogId,
			lastStockSyncedAt
		)
	}
}

function readLastStockSyncedAt(metadata: unknown): Date | null {
	const root = readJsonObject(metadata)
	const stockRows = readJsonObject(root?.stockRows)
	const rawValue = stockRows?.lastStockSyncedAt
	if (typeof rawValue !== 'string' || !rawValue.trim()) return null

	const date = new Date(rawValue)
	return Number.isNaN(date.getTime()) ? null : date
}

function readJsonObject(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	return value as Record<string, unknown>
}

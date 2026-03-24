import {
	IntegrationProvider,
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger,
	IntegrationSyncStatus
} from '@generated/enums'
import { ApiProperty } from '@nestjs/swagger'

export class MoySkladIntegrationDto {
	@ApiProperty({ enum: IntegrationProvider })
	provider: IntegrationProvider

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: Boolean })
	hasToken: boolean

	@ApiProperty({ type: String, nullable: true })
	tokenPreview: string | null

	@ApiProperty({ type: String })
	priceTypeName: string

	@ApiProperty({ type: Boolean })
	importImages: boolean

	@ApiProperty({ type: Boolean })
	syncStock: boolean

	@ApiProperty({ type: Boolean })
	scheduleEnabled: boolean

	@ApiProperty({ type: String, nullable: true })
	schedulePattern: string | null

	@ApiProperty({ type: String })
	scheduleTimezone: string

	@ApiProperty({ enum: IntegrationSyncStatus })
	lastSyncStatus: IntegrationSyncStatus

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	syncStartedAt: Date | null

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	lastSyncAt: Date | null

	@ApiProperty({ type: String, nullable: true })
	lastSyncError: string | null

	@ApiProperty({ type: Number })
	totalProducts: number

	@ApiProperty({ type: Number })
	createdProducts: number

	@ApiProperty({ type: Number })
	updatedProducts: number

	@ApiProperty({ type: Number })
	deletedProducts: number

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: Date

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: Date
}

export class MoySkladSyncRunDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ enum: IntegrationProvider })
	provider: IntegrationProvider

	@ApiProperty({ enum: IntegrationSyncRunMode })
	mode: IntegrationSyncRunMode

	@ApiProperty({ enum: IntegrationSyncRunTrigger })
	trigger: IntegrationSyncRunTrigger

	@ApiProperty({ enum: IntegrationSyncRunStatus })
	status: IntegrationSyncRunStatus

	@ApiProperty({ type: String, nullable: true })
	jobId: string | null

	@ApiProperty({ type: String, nullable: true })
	productId: string | null

	@ApiProperty({ type: String, nullable: true })
	externalId: string | null

	@ApiProperty({ type: String, nullable: true })
	error: string | null

	@ApiProperty({ type: Number })
	totalProducts: number

	@ApiProperty({ type: Number })
	createdProducts: number

	@ApiProperty({ type: Number })
	updatedProducts: number

	@ApiProperty({ type: Number })
	deletedProducts: number

	@ApiProperty({ type: Number })
	imagesImported: number

	@ApiProperty({ type: Number, nullable: true })
	durationMs: number | null

	@ApiProperty({ type: String, format: 'date-time' })
	requestedAt: Date

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	startedAt: Date | null

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	finishedAt: Date | null

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: Date

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: Date
}

export class MoySkladIntegrationStatusDto {
	@ApiProperty({ type: Boolean })
	configured: boolean

	@ApiProperty({ type: MoySkladIntegrationDto, nullable: true })
	integration: MoySkladIntegrationDto | null

	@ApiProperty({ type: MoySkladSyncRunDto, nullable: true })
	activeRun: MoySkladSyncRunDto | null

	@ApiProperty({ type: MoySkladSyncRunDto, nullable: true })
	lastRun: MoySkladSyncRunDto | null
}

export class MoySkladTestConnectionDto {
	@ApiProperty({ type: Boolean })
	ok: true
}

export class MoySkladQueuedSyncDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: Boolean })
	queued: true

	@ApiProperty({ type: String })
	runId: string

	@ApiProperty({ type: String })
	jobId: string

	@ApiProperty({ enum: IntegrationSyncRunMode })
	mode: IntegrationSyncRunMode

	@ApiProperty({ enum: IntegrationSyncRunTrigger })
	trigger: IntegrationSyncRunTrigger
}

import { DomainEventOutboxStatus } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

class AdminDomainEventOutboxCatalogDto {
	@ApiProperty({ type: String })
	slug: string

	@ApiProperty({ type: String })
	name: string
}

export class AdminDomainEventOutboxItemDto {
	@ApiProperty({ type: String, format: 'uuid' })
	id: string

	@ApiProperty({ type: String })
	eventId: string

	@ApiProperty({ type: String })
	eventType: string

	@ApiPropertyOptional({ type: String, nullable: true })
	aggregateType?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	aggregateId?: string | null

	@ApiProperty({ type: String, format: 'uuid' })
	catalogId: string

	@ApiProperty({ type: AdminDomainEventOutboxCatalogDto })
	catalog: AdminDomainEventOutboxCatalogDto

	@ApiProperty({ enum: DomainEventOutboxStatus })
	status: DomainEventOutboxStatus

	@ApiProperty({ type: Number })
	attempts: number

	@ApiPropertyOptional({ type: String, nullable: true })
	lastError?: string | null

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	lockedAt?: Date | null

	@ApiProperty({ type: String, format: 'date-time' })
	occurredAt: Date

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	processedAt?: Date | null

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: Date

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: Date

	@ApiProperty({ type: Object })
	payload: unknown
}

export class AdminDomainEventOutboxListDto {
	@ApiProperty({ type: Number })
	total: number

	@ApiProperty({ type: Number })
	limit: number

	@ApiProperty({ type: AdminDomainEventOutboxItemDto, isArray: true })
	items: AdminDomainEventOutboxItemDto[]
}

export class AdminDomainEventOutboxStatusCountsDto {
	@ApiProperty({ type: Number })
	PENDING: number

	@ApiProperty({ type: Number })
	PROCESSING: number

	@ApiProperty({ type: Number })
	PROCESSED: number

	@ApiProperty({ type: Number })
	FAILED: number
}

export class AdminDomainEventOutboxStatsDto {
	@ApiProperty({ type: Number })
	total: number

	@ApiProperty({ type: AdminDomainEventOutboxStatusCountsDto })
	byStatus: AdminDomainEventOutboxStatusCountsDto

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	oldestPendingAt: Date | null

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	newestFailedAt: Date | null

	@ApiProperty({ type: Number })
	failedWithLastError: number

	@ApiProperty({ type: Number })
	processedRetentionDays: number

	@ApiProperty({ type: String, format: 'date-time' })
	processedRetentionCutoff: Date

	@ApiProperty({ type: Number })
	processedOlderThanRetention: number

	@ApiProperty({ type: Number })
	failedOlderThan1Day: number

	@ApiProperty({ type: Number })
	failedOlderThan7Days: number

	@ApiProperty({ type: Number })
	failedOlderThan30Days: number
}

export class AdminDomainEventOutboxActionResultDto {
	@ApiProperty({ type: Number })
	processed: number

	@ApiProperty({ type: Number })
	failed: number

	@ApiProperty({ type: Number })
	skipped: number

	@ApiPropertyOptional({ type: Number })
	matched?: number
}

export class AdminDomainEventOutboxCleanupResultDto {
	@ApiProperty({ type: Number })
	deleted: number

	@ApiProperty({ type: Number })
	retentionDays: number

	@ApiProperty({ type: String, format: 'date-time' })
	cutoff: Date

	@ApiProperty({ type: Number })
	limit: number
}

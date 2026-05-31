import {
	type IntegrationOrderExportStatus,
	IntegrationProvider,
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger,
	IntegrationSyncSnapshotCompleteness,
	IntegrationSyncStatus
} from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

const INTEGRATION_ORDER_EXPORT_STATUSES = [
	'PENDING',
	'RUNNING',
	'SUCCESS',
	'ERROR',
	'SKIPPED'
] as const
const MOYSKLAD_FIELD_OWNERSHIP_VALUES = ['external', 'local'] as const
const MOYSKLAD_STOCK_APPLY_SOURCES = ['FULL_SYNC', 'WEBHOOK'] as const

export class MoySkladSyncEntityStatsDto {
	@ApiProperty({ type: Number })
	total: number

	@ApiProperty({ type: Number })
	created: number

	@ApiProperty({ type: Number })
	updated: number

	@ApiProperty({ type: Number })
	deleted: number

	@ApiProperty({ type: Number })
	skipped: number
}

export class MoySkladSyncStockSkippedReasonsDto {
	@ApiProperty({ type: Number })
	missingStock: number

	@ApiProperty({ type: Number })
	productHasVariantLinks: number

	@ApiProperty({ type: Number })
	variantsCapabilityDisabled: number

	@ApiProperty({ type: Number })
	stockRowWithoutLocalLink: number
}

export class MoySkladSyncStockDiagnosticsDto {
	@ApiProperty({ enum: MOYSKLAD_STOCK_APPLY_SOURCES })
	source: 'FULL_SYNC' | 'WEBHOOK'

	@ApiProperty({ type: Number })
	stockRows: number

	@ApiProperty({ type: Number })
	matchedStockRows: number

	@ApiProperty({ type: Number })
	unmatchedStockRows: number

	@ApiProperty({ type: Number })
	productLinks: number

	@ApiProperty({ type: Number })
	variantLinks: number

	@ApiProperty({ type: Number })
	ignoredVariantLinks: number

	@ApiProperty({ type: Number })
	appliedProductLinks: number

	@ApiProperty({ type: Number })
	appliedVariantLinks: number

	@ApiProperty({ type: MoySkladSyncStockSkippedReasonsDto })
	skippedReasons: MoySkladSyncStockSkippedReasonsDto
}

export class MoySkladSyncStockStatsDto {
	@ApiProperty({ type: Number })
	total: number

	@ApiProperty({ type: Number })
	applied: number

	@ApiProperty({ type: Number })
	skipped: number

	@ApiProperty({ type: MoySkladSyncStockDiagnosticsDto, nullable: true })
	diagnostics: MoySkladSyncStockDiagnosticsDto | null
}

export class MoySkladSyncIssueDto {
	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	message: string

	@ApiProperty({ type: String, nullable: true })
	externalId: string | null

	@ApiProperty({ type: Number, nullable: true })
	count: number | null
}

export class MoySkladSyncProgressDto {
	@ApiProperty({ type: String })
	runId: string

	@ApiProperty({ enum: IntegrationSyncRunStatus })
	status: IntegrationSyncRunStatus

	@ApiProperty({ type: String })
	phase: string

	@ApiProperty({ type: String })
	message: string

	@ApiProperty({ type: Number })
	processed: number

	@ApiProperty({ type: Number, nullable: true })
	total: number | null

	@ApiProperty({ type: Number, nullable: true })
	percent: number | null

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: string

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	startedAt: Date | null

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	finishedAt: Date | null
}

export class IntegrationProviderCapabilitiesDto {
	@ApiProperty({ type: Boolean })
	productImport: boolean

	@ApiProperty({ type: Boolean })
	variantImport: boolean

	@ApiProperty({ type: Boolean })
	stockImport: boolean

	@ApiProperty({ type: Boolean })
	imageImport: boolean

	@ApiProperty({ type: Boolean })
	orderExport: boolean

	@ApiProperty({ type: Boolean })
	reservation: boolean

	@ApiProperty({ type: Boolean })
	webhook: boolean
}

export class MoySkladStockWebhookDto {
	@ApiProperty({ type: Boolean })
	enabled: boolean

	@ApiProperty({ type: Boolean })
	registered: boolean

	@ApiProperty({ type: String })
	reportType: string

	@ApiProperty({ type: String })
	stockType: string

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	lastReceivedAt: string | null

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	lastProcessedAt: string | null

	@ApiProperty({ type: String, nullable: true })
	lastError: string | null
}

export class MoySkladFieldOwnershipDto {
	@ApiProperty({ enum: MOYSKLAD_FIELD_OWNERSHIP_VALUES })
	price: 'external' | 'local'

	@ApiProperty({ enum: MOYSKLAD_FIELD_OWNERSHIP_VALUES })
	stock: 'external' | 'local'

	@ApiProperty({ enum: MOYSKLAD_FIELD_OWNERSHIP_VALUES })
	content: 'external' | 'local'

	@ApiProperty({ enum: MOYSKLAD_FIELD_OWNERSHIP_VALUES })
	images: 'external' | 'local'
}

export class MoySkladIntegrationDto {
	@ApiProperty({ enum: IntegrationProvider })
	provider: IntegrationProvider

	@ApiProperty({ type: IntegrationProviderCapabilitiesDto })
	capabilities: IntegrationProviderCapabilitiesDto

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

	@ApiProperty({ type: MoySkladFieldOwnershipDto })
	fieldOwnership: MoySkladFieldOwnershipDto

	@ApiProperty({ type: MoySkladStockWebhookDto })
	stockWebhook: MoySkladStockWebhookDto

	@ApiProperty({ type: Boolean })
	exportOrders: boolean

	@ApiProperty({ type: String, nullable: true })
	orderExportOrganizationId: string | null

	@ApiProperty({ type: String, nullable: true })
	orderExportCounterpartyId: string | null

	@ApiProperty({ type: String, nullable: true })
	orderExportStoreId: string | null

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

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	lastStockSyncedAt: string | null

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

	@ApiProperty({ enum: IntegrationSyncSnapshotCompleteness })
	snapshotCompleteness: IntegrationSyncSnapshotCompleteness

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

	@ApiProperty({ type: MoySkladSyncEntityStatsDto })
	products: MoySkladSyncEntityStatsDto

	@ApiProperty({ type: MoySkladSyncEntityStatsDto })
	variants: MoySkladSyncEntityStatsDto

	@ApiProperty({ type: MoySkladSyncStockStatsDto })
	stockRows: MoySkladSyncStockStatsDto

	@ApiProperty({ type: [MoySkladSyncIssueDto] })
	warnings: MoySkladSyncIssueDto[]

	@ApiProperty({ type: [MoySkladSyncIssueDto] })
	errors: MoySkladSyncIssueDto[]

	@ApiProperty({ type: MoySkladSyncProgressDto, nullable: true })
	progress: MoySkladSyncProgressDto | null

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

export class MoySkladOrderExportRefOptionDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String, nullable: true })
	code: string | null

	@ApiProperty({ type: String, nullable: true })
	externalCode: string | null

	@ApiProperty({ type: Boolean })
	archived: boolean
}

export class MoySkladOrderExportRefsDto {
	@ApiProperty({ type: [MoySkladOrderExportRefOptionDto] })
	organizations: MoySkladOrderExportRefOptionDto[]

	@ApiProperty({ type: [MoySkladOrderExportRefOptionDto] })
	counterparties: MoySkladOrderExportRefOptionDto[]

	@ApiProperty({ type: [MoySkladOrderExportRefOptionDto] })
	stores: MoySkladOrderExportRefOptionDto[]
}

export class MoySkladMappingExistingAttributeDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	key: string

	@ApiProperty({ type: String })
	displayName: string

	@ApiProperty({ type: Number })
	score: number
}

export class MoySkladMappingExistingEnumValueDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	value: string

	@ApiProperty({ type: String, nullable: true })
	displayName: string | null
}

export class MoySkladMappingUnknownAttributeDto {
	@ApiProperty({ type: String })
	externalName: string

	@ApiProperty({ type: String })
	suggestedKey: string

	@ApiProperty({ type: Number })
	occurrences: number

	@ApiProperty({ type: [String] })
	sampledExternalIds: string[]

	@ApiProperty({ type: [MoySkladMappingExistingAttributeDto] })
	suggestedExistingAttributes: MoySkladMappingExistingAttributeDto[]
}

export class MoySkladMappingUnknownEnumValueDto {
	@ApiProperty({ type: String })
	externalAttributeName: string

	@ApiProperty({ type: String })
	externalValue: string

	@ApiProperty({ type: String })
	normalizedValue: string

	@ApiProperty({ type: String, nullable: true })
	attributeId: string | null

	@ApiProperty({ type: String, nullable: true })
	attributeKey: string | null

	@ApiProperty({ type: Number })
	occurrences: number

	@ApiProperty({ type: [String] })
	sampledExternalIds: string[]
}

export class MoySkladMappingSuggestedExistingValueDto {
	@ApiProperty({ type: String })
	externalAttributeName: string

	@ApiProperty({ type: String })
	externalValue: string

	@ApiProperty({ type: String })
	normalizedValue: string

	@ApiProperty({ type: String })
	attributeId: string

	@ApiProperty({ type: String })
	attributeKey: string

	@ApiProperty({ type: String })
	attributeDisplayName: string

	@ApiProperty({ type: MoySkladMappingExistingEnumValueDto })
	enumValue: MoySkladMappingExistingEnumValueDto

	@ApiProperty({ type: Number })
	score: number
}

export class MoySkladMappingPreviewCountersDto {
	@ApiProperty({ type: Number })
	assortmentItems: number

	@ApiProperty({ type: Number })
	variantItems: number

	@ApiProperty({ type: Number })
	itemsWithCharacteristics: number

	@ApiProperty({ type: Number })
	characteristics: number

	@ApiProperty({ type: Number })
	knownAttributes: number

	@ApiProperty({ type: Number })
	unknownAttributes: number

	@ApiProperty({ type: Number })
	knownEnumValues: number

	@ApiProperty({ type: Number })
	unknownEnumValues: number

	@ApiProperty({ type: Number })
	suggestedExistingValues: number
}

export class MoySkladMappingPreviewDto {
	@ApiProperty({ type: [MoySkladMappingUnknownAttributeDto] })
	unknownAttributes: MoySkladMappingUnknownAttributeDto[]

	@ApiProperty({ type: [MoySkladMappingUnknownEnumValueDto] })
	unknownEnumValues: MoySkladMappingUnknownEnumValueDto[]

	@ApiProperty({ type: [MoySkladMappingSuggestedExistingValueDto] })
	suggestedExistingValues: MoySkladMappingSuggestedExistingValueDto[]

	@ApiProperty({ type: MoySkladMappingPreviewCountersDto })
	counters: MoySkladMappingPreviewCountersDto

	@ApiProperty({ type: [String] })
	sampledExternalIds: string[]
}

export class MoySkladMappingApplyCounterDto {
	@ApiProperty({ type: Number })
	total: number

	@ApiProperty({ type: Number })
	attributes: number

	@ApiProperty({ type: Number })
	enumValues: number
}

export class MoySkladMappingAppliedAttributeDto {
	@ApiProperty({ type: String })
	externalName: string

	@ApiProperty({ type: String })
	normalizedName: string

	@ApiProperty({ enum: ['created', 'linked', 'skipped'] })
	status: 'created' | 'linked' | 'skipped'

	@ApiProperty({ type: String, nullable: true })
	attributeId: string | null

	@ApiProperty({ type: String, nullable: true })
	attributeKey: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	reason?: string | null
}

export class MoySkladMappingAppliedEnumValueDto {
	@ApiProperty({ type: String })
	externalAttributeName: string

	@ApiProperty({ type: String })
	externalValue: string

	@ApiProperty({ type: String })
	normalizedValue: string

	@ApiProperty({ enum: ['created', 'linked', 'skipped'] })
	status: 'created' | 'linked' | 'skipped'

	@ApiProperty({ type: String, nullable: true })
	attributeId: string | null

	@ApiProperty({ type: String, nullable: true })
	enumValueId: string | null

	@ApiProperty({ type: String, nullable: true })
	value: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	reason?: string | null
}

export class MoySkladMappingApplyReportDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: MoySkladMappingApplyCounterDto })
	applied: MoySkladMappingApplyCounterDto

	@ApiProperty({ type: MoySkladMappingApplyCounterDto })
	skipped: MoySkladMappingApplyCounterDto

	@ApiProperty({ type: MoySkladMappingApplyCounterDto })
	created: MoySkladMappingApplyCounterDto

	@ApiProperty({ type: MoySkladMappingApplyCounterDto })
	linked: MoySkladMappingApplyCounterDto

	@ApiProperty({ type: [MoySkladMappingAppliedAttributeDto] })
	attributes: MoySkladMappingAppliedAttributeDto[]

	@ApiProperty({ type: [MoySkladMappingAppliedEnumValueDto] })
	enumValues: MoySkladMappingAppliedEnumValueDto[]
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

export class MoySkladOrderExportDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ enum: IntegrationProvider })
	provider: IntegrationProvider

	@ApiProperty({ type: String })
	orderId: string

	@ApiProperty({ type: String })
	idempotencyKey: string

	@ApiProperty({ type: String, nullable: true })
	externalId: string | null

	@ApiProperty({ enum: INTEGRATION_ORDER_EXPORT_STATUSES })
	status: IntegrationOrderExportStatus

	@ApiProperty({ type: Number })
	attempts: number

	@ApiProperty({ type: String, nullable: true })
	lastError: string | null

	@ApiProperty({ type: String, format: 'date-time' })
	requestedAt: Date

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	startedAt: Date | null

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	exportedAt: Date | null

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: Date

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: Date
}

export class MoySkladQueuedOrderExportDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: Boolean })
	queued: boolean

	@ApiProperty({ type: String, nullable: true })
	exportId?: string

	@ApiProperty({ type: String, nullable: true })
	jobId?: string

	@ApiProperty({ type: String, nullable: true })
	reason?: string
}

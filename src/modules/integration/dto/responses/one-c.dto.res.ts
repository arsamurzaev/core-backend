import {
	IntegrationExternalObjectKind,
	IntegrationMappingDataType,
	IntegrationMappingDirection,
	IntegrationMappingLocalEntity,
	IntegrationProvider,
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger,
	IntegrationSyncSnapshotCompleteness,
	IntegrationSyncStatus
} from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import type {
	OneCApiKind,
	OneCAuthKind
} from '../../providers/one-c/one-c.types'

import { IntegrationProviderCapabilitiesDto } from './moysklad.dto.res'

export class OneCIntegrationDto {
	@ApiProperty({ enum: IntegrationProvider })
	provider: IntegrationProvider

	@ApiProperty({ type: IntegrationProviderCapabilitiesDto })
	capabilities: IntegrationProviderCapabilitiesDto

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ enum: ['ODATA', 'HTTP_SERVICE', 'CUSTOM'] })
	apiKind: OneCApiKind

	@ApiProperty({ enum: ['BASIC', 'BEARER', 'NONE'] })
	authKind: OneCAuthKind

	@ApiProperty({ type: String })
	baseUrl: string

	@ApiProperty({ type: String, nullable: true })
	username: string | null

	@ApiProperty({ type: Boolean })
	hasPassword: boolean

	@ApiProperty({ type: Boolean })
	hasToken: boolean

	@ApiProperty({ type: String, nullable: true })
	tokenPreview: string | null

	@ApiProperty({ type: Number })
	timeoutMs: number

	@ApiProperty({ type: Boolean })
	importProducts: boolean

	@ApiProperty({ type: Boolean })
	syncStock: boolean

	@ApiProperty({ type: Boolean })
	exportOrders: boolean

	@ApiProperty({ type: String, nullable: true })
	productSyncEntityMappingId: string | null

	@ApiProperty({ type: Number })
	productSyncLimit: number

	@ApiProperty({ type: String, nullable: true })
	productSyncFilter: string | null

	@ApiProperty({ type: String, nullable: true })
	variantSyncEntityMappingId: string | null

	@ApiProperty({ type: Number })
	variantSyncLimit: number

	@ApiProperty({ type: String, nullable: true })
	variantSyncFilter: string | null

	@ApiProperty({ type: String, nullable: true })
	stockSyncEntityMappingId: string | null

	@ApiProperty({ type: Number })
	stockSyncLimit: number

	@ApiProperty({ type: String, nullable: true })
	stockSyncFilter: string | null

	@ApiProperty({ type: String, nullable: true })
	priceSyncEntityMappingId: string | null

	@ApiProperty({ type: Number })
	priceSyncLimit: number

	@ApiProperty({ type: String, nullable: true })
	priceSyncFilter: string | null

	@ApiProperty({ type: Boolean })
	scheduleEnabled: boolean

	@ApiProperty({ type: String, nullable: true })
	schedulePattern: string | null

	@ApiProperty({ type: String })
	scheduleTimezone: string

	@ApiProperty({ type: Boolean })
	stockScheduleEnabled: boolean

	@ApiProperty({ type: String, nullable: true })
	stockSchedulePattern: string | null

	@ApiProperty({ type: String })
	stockScheduleTimezone: string

	@ApiProperty({ type: Boolean })
	priceScheduleEnabled: boolean

	@ApiProperty({ type: String, nullable: true })
	priceSchedulePattern: string | null

	@ApiProperty({ type: String })
	priceScheduleTimezone: string

	@ApiProperty({ enum: IntegrationSyncStatus })
	lastSyncStatus: IntegrationSyncStatus

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	syncStartedAt: Date | null

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	lastSyncAt: Date | null

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	lastDiscoveredAt: string | null

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

export class OneCSyncProgressDto {
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

export class OneCSyncRunDto {
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

	@ApiProperty({ type: Number })
	skippedProducts: number

	@ApiProperty({ type: Number })
	failedProducts: number

	@ApiProperty({ type: () => OneCSyncProgressDto, nullable: true })
	progress: OneCSyncProgressDto | null

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

export class OneCQueuedSyncDto {
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

export class OneCIntegrationStatusDto {
	@ApiProperty({ type: Boolean })
	configured: boolean

	@ApiProperty({ type: OneCIntegrationDto, nullable: true })
	integration: OneCIntegrationDto | null

	@ApiProperty({ type: OneCSyncRunDto, nullable: true })
	activeRun: OneCSyncRunDto | null

	@ApiProperty({ type: OneCSyncRunDto, nullable: true })
	lastRun: OneCSyncRunDto | null
}

export class OneCTestConnectionDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ enum: ['ODATA', 'HTTP_SERVICE', 'CUSTOM'] })
	apiKind: OneCApiKind

	@ApiProperty({ type: String })
	baseUrl: string

	@ApiProperty({ type: Number, nullable: true })
	status: number | null

	@ApiProperty({ type: Number })
	objectsDiscovered: number
}

export class OneCObjectFieldDto {
	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String, nullable: true })
	dataType: string | null

	@ApiProperty({ type: Boolean, nullable: true })
	nullable: boolean | null

	@ApiProperty({ enum: ['property', 'navigation'] })
	kind: 'property' | 'navigation'
}

export class OneCExternalObjectDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ enum: IntegrationExternalObjectKind })
	kind: IntegrationExternalObjectKind

	@ApiProperty({ type: String, nullable: true })
	endpoint: string | null

	@ApiProperty({ type: String, nullable: true })
	method: string | null

	@ApiProperty({ type: Object, nullable: true })
	schema: unknown

	@ApiProperty({ type: Object, nullable: true })
	sample: unknown

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	lastDiscoveredAt: Date | null

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: Date

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: Date
}

export class OneCDiscoveredObjectDto {
	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ enum: ['ODATA_ENTITY', 'HTTP_ENDPOINT', 'CUSTOM'] })
	kind: 'ODATA_ENTITY' | 'HTTP_ENDPOINT' | 'CUSTOM'

	@ApiProperty({ type: String, nullable: true })
	endpoint: string | null

	@ApiProperty({ type: [OneCObjectFieldDto] })
	fields: OneCObjectFieldDto[]
}

export class OneCDiscoverObjectsDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: Number })
	total: number

	@ApiProperty({ type: Boolean })
	persisted: boolean

	@ApiProperty({ type: [OneCDiscoveredObjectDto] })
	objects: OneCDiscoveredObjectDto[]
}

export class OneCFieldMappingDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	entityMappingId: string

	@ApiProperty({ type: String })
	localPath: string

	@ApiProperty({ type: String })
	externalPath: string

	@ApiProperty({ enum: IntegrationMappingDirection })
	direction: IntegrationMappingDirection

	@ApiProperty({ enum: IntegrationMappingDataType })
	dataType: IntegrationMappingDataType

	@ApiProperty({ type: Object, nullable: true })
	transform: unknown

	@ApiProperty({ nullable: true })
	defaultValue: unknown

	@ApiProperty({ type: Boolean })
	isRequired: boolean

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: Number })
	displayOrder: number

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: Date

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: Date
}

export class OneCEntityMappingDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ enum: IntegrationMappingLocalEntity })
	localEntity: IntegrationMappingLocalEntity

	@ApiProperty({ type: String, nullable: true })
	externalObjectId: string | null

	@ApiProperty({ type: String })
	externalObjectCode: string

	@ApiProperty({ type: String })
	identityField: string

	@ApiProperty({ enum: IntegrationMappingDirection })
	direction: IntegrationMappingDirection

	@ApiProperty({ type: String, nullable: true })
	conflictPolicy: string | null

	@ApiProperty({ type: Object, nullable: true })
	filters: unknown

	@ApiProperty({ type: Object, nullable: true })
	options: unknown

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: OneCExternalObjectDto, nullable: true })
	externalObject: OneCExternalObjectDto | null

	@ApiProperty({ type: [OneCFieldMappingDto] })
	fieldMappings: OneCFieldMappingDto[]

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: Date

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: Date
}

export class OneCRecommendedProductMappingDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: Boolean })
	ready: boolean

	@ApiProperty({ type: String, nullable: true })
	mappingId: string | null

	@ApiProperty({ type: OneCEntityMappingDto, nullable: true })
	mapping: OneCEntityMappingDto | null

	@ApiProperty({ type: String, nullable: true })
	reason: string | null
}

export class OneCRecommendedVariantMappingDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: Boolean })
	ready: boolean

	@ApiProperty({ type: String, nullable: true })
	mappingId: string | null

	@ApiProperty({ type: OneCEntityMappingDto, nullable: true })
	mapping: OneCEntityMappingDto | null

	@ApiProperty({ type: String, nullable: true })
	reason: string | null
}

export class OneCRecommendedStockMappingDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: Boolean })
	ready: boolean

	@ApiProperty({ type: String, nullable: true })
	mappingId: string | null

	@ApiProperty({ type: OneCEntityMappingDto, nullable: true })
	mapping: OneCEntityMappingDto | null

	@ApiProperty({ type: String, nullable: true })
	reason: string | null
}

export class OneCRecommendedPriceMappingDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: Boolean })
	ready: boolean

	@ApiProperty({ type: String, nullable: true })
	mappingId: string | null

	@ApiProperty({ type: OneCEntityMappingDto, nullable: true })
	mapping: OneCEntityMappingDto | null

	@ApiProperty({ type: String, nullable: true })
	reason: string | null
}

export class OneCMappingPreviewItemDto {
	@ApiProperty({ type: String })
	fieldMappingId: string

	@ApiProperty({ type: String })
	localPath: string

	@ApiProperty({ type: String })
	externalPath: string

	@ApiProperty({ enum: IntegrationMappingDataType })
	dataType: IntegrationMappingDataType

	@ApiProperty({ nullable: true })
	externalValue: unknown

	@ApiProperty({ nullable: true })
	mappedValue: unknown

	@ApiProperty({ type: Boolean })
	missing: boolean

	@ApiProperty({ type: String, nullable: true })
	error: string | null
}

export class OneCMappingPreviewDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: String })
	entityMappingId: string

	@ApiProperty({ enum: IntegrationMappingLocalEntity })
	localEntity: IntegrationMappingLocalEntity

	@ApiProperty({ type: String })
	externalObjectCode: string

	@ApiProperty({ type: [OneCMappingPreviewItemDto] })
	items: OneCMappingPreviewItemDto[]

	@ApiProperty({ type: [String] })
	errors: string[]

	@ApiPropertyOptional({ type: Object })
	result?: Record<string, unknown>
}

export class OneCRemoteMappingPreviewRowDto {
	@ApiProperty({ type: Number })
	index: number

	@ApiProperty({ type: String, nullable: true })
	externalIdentity: string | null

	@ApiProperty({ type: [OneCMappingPreviewItemDto] })
	items: OneCMappingPreviewItemDto[]

	@ApiProperty({ type: [String] })
	errors: string[]

	@ApiProperty({ type: Object })
	result: Record<string, unknown>

	@ApiPropertyOptional({ type: Object, nullable: true })
	raw?: Record<string, unknown> | null
}

export class OneCRemoteMappingPreviewDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: String })
	entityMappingId: string

	@ApiProperty({ enum: IntegrationMappingLocalEntity })
	localEntity: IntegrationMappingLocalEntity

	@ApiProperty({ type: String })
	externalObjectCode: string

	@ApiProperty({ type: Number })
	totalFetched: number

	@ApiProperty({ type: Number })
	totalWithErrors: number

	@ApiProperty({ type: [OneCRemoteMappingPreviewRowDto] })
	rows: OneCRemoteMappingPreviewRowDto[]
}

export class OneCImportPreviewCountersDto {
	@ApiProperty({ type: Number })
	total: number

	@ApiProperty({ type: Number })
	create: number

	@ApiProperty({ type: Number })
	update: number

	@ApiProperty({ type: Number })
	skip: number

	@ApiProperty({ type: Number })
	error: number
}

export class OneCImportPreviewChangeDto {
	@ApiProperty({ type: String })
	field: string

	@ApiProperty({ nullable: true })
	currentValue: unknown

	@ApiProperty({ nullable: true })
	nextValue: unknown
}

export class OneCProductImportPreviewRowDto {
	@ApiProperty({ type: Number })
	index: number

	@ApiProperty({ type: String, nullable: true })
	externalIdentity: string | null

	@ApiProperty({ enum: ['CREATE', 'UPDATE', 'SKIP', 'ERROR'] })
	action: 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR'

	@ApiProperty({ enum: ['externalId', 'sku', 'none'] })
	matchBy: 'externalId' | 'sku' | 'none'

	@ApiProperty({ type: String, nullable: true })
	productId: string | null

	@ApiProperty({ type: String, nullable: true })
	productName: string | null

	@ApiProperty({ type: String, nullable: true })
	productSku: string | null

	@ApiProperty({ type: Object })
	mapped: Record<string, unknown>

	@ApiProperty({ type: [OneCImportPreviewChangeDto] })
	changes: OneCImportPreviewChangeDto[]

	@ApiProperty({ type: [String] })
	errors: string[]

	@ApiPropertyOptional({ type: Object, nullable: true })
	raw?: Record<string, unknown> | null
}

export class OneCProductImportPreviewDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: String })
	entityMappingId: string

	@ApiProperty({ type: String })
	externalObjectCode: string

	@ApiProperty({ type: Number })
	totalFetched: number

	@ApiProperty({ type: OneCImportPreviewCountersDto })
	counters: OneCImportPreviewCountersDto

	@ApiProperty({ type: [OneCProductImportPreviewRowDto] })
	rows: OneCProductImportPreviewRowDto[]
}

export class OneCProductImportResultRowDto {
	@ApiProperty({ type: Number })
	index: number

	@ApiProperty({ type: String, nullable: true })
	externalIdentity: string | null

	@ApiProperty({ enum: ['CREATED', 'UPDATED', 'SKIPPED', 'FAILED'] })
	status: 'CREATED' | 'UPDATED' | 'SKIPPED' | 'FAILED'

	@ApiProperty({ type: String, nullable: true })
	productId: string | null

	@ApiProperty({ type: [String] })
	errors: string[]
}

export class OneCProductImportResultCountersDto {
	@ApiProperty({ type: Number })
	total: number

	@ApiProperty({ type: Number })
	created: number

	@ApiProperty({ type: Number })
	updated: number

	@ApiProperty({ type: Number })
	skipped: number

	@ApiProperty({ type: Number })
	failed: number
}

export class OneCProductImportResultDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: String })
	entityMappingId: string

	@ApiProperty({ type: String })
	externalObjectCode: string

	@ApiProperty({ type: OneCProductImportResultCountersDto })
	counters: OneCProductImportResultCountersDto

	@ApiProperty({ type: [OneCProductImportResultRowDto] })
	rows: OneCProductImportResultRowDto[]
}

export class OneCVariantImportPreviewRowDto {
	@ApiProperty({ type: Number })
	index: number

	@ApiProperty({ type: String, nullable: true })
	externalIdentity: string | null

	@ApiProperty({ enum: ['CREATE', 'UPDATE', 'SKIP', 'ERROR'] })
	action: 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR'

	@ApiProperty({ enum: ['externalId', 'sku', 'variantKey', 'none'] })
	matchBy: 'externalId' | 'sku' | 'variantKey' | 'none'

	@ApiProperty({ type: String, nullable: true })
	productId: string | null

	@ApiProperty({ type: String, nullable: true })
	productName: string | null

	@ApiProperty({ type: String, nullable: true })
	productSku: string | null

	@ApiProperty({ type: String, nullable: true })
	variantId: string | null

	@ApiProperty({ type: String, nullable: true })
	variantSku: string | null

	@ApiProperty({ type: String, nullable: true })
	variantKey: string | null

	@ApiProperty({ type: Object })
	mapped: Record<string, unknown>

	@ApiProperty({ type: [OneCImportPreviewChangeDto] })
	changes: OneCImportPreviewChangeDto[]

	@ApiProperty({ type: [String] })
	errors: string[]

	@ApiPropertyOptional({ type: Object, nullable: true })
	raw?: Record<string, unknown> | null
}

export class OneCVariantImportPreviewDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: String })
	entityMappingId: string

	@ApiProperty({ type: String })
	externalObjectCode: string

	@ApiProperty({ type: Number })
	totalFetched: number

	@ApiProperty({ type: OneCImportPreviewCountersDto })
	counters: OneCImportPreviewCountersDto

	@ApiProperty({ type: [OneCVariantImportPreviewRowDto] })
	rows: OneCVariantImportPreviewRowDto[]
}

export class OneCVariantImportResultRowDto {
	@ApiProperty({ type: Number })
	index: number

	@ApiProperty({ type: String, nullable: true })
	externalIdentity: string | null

	@ApiProperty({ enum: ['CREATED', 'UPDATED', 'SKIPPED', 'FAILED'] })
	status: 'CREATED' | 'UPDATED' | 'SKIPPED' | 'FAILED'

	@ApiProperty({ type: String, nullable: true })
	productId: string | null

	@ApiProperty({ type: String, nullable: true })
	variantId: string | null

	@ApiProperty({ type: [String] })
	errors: string[]
}

export class OneCVariantImportResultDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: String })
	entityMappingId: string

	@ApiProperty({ type: String })
	externalObjectCode: string

	@ApiProperty({ type: OneCProductImportResultCountersDto })
	counters: OneCProductImportResultCountersDto

	@ApiProperty({ type: [OneCVariantImportResultRowDto] })
	rows: OneCVariantImportResultRowDto[]
}

export class OneCValueSyncPreviewCountersDto {
	@ApiProperty({ type: Number })
	total: number

	@ApiProperty({ type: Number })
	update: number

	@ApiProperty({ type: Number })
	skip: number

	@ApiProperty({ type: Number })
	error: number
}

export class OneCValueSyncPreviewRowDto {
	@ApiProperty({ type: Number })
	index: number

	@ApiProperty({ type: String, nullable: true })
	externalIdentity: string | null

	@ApiProperty({ enum: ['UPDATE', 'SKIP', 'ERROR'] })
	action: 'UPDATE' | 'SKIP' | 'ERROR'

	@ApiProperty({ enum: ['product', 'variant'], nullable: true })
	targetKind: 'product' | 'variant' | null

	@ApiProperty({ enum: ['externalId', 'id', 'sku', 'none'] })
	matchBy: 'externalId' | 'id' | 'sku' | 'none'

	@ApiProperty({ type: String, nullable: true })
	productId: string | null

	@ApiProperty({ type: String, nullable: true })
	productName: string | null

	@ApiProperty({ type: String, nullable: true })
	productSku: string | null

	@ApiProperty({ type: String, nullable: true })
	variantId: string | null

	@ApiProperty({ type: String, nullable: true })
	variantSku: string | null

	@ApiProperty({ type: String, nullable: true })
	variantKey: string | null

	@ApiProperty({ type: Object })
	mapped: Record<string, unknown>

	@ApiProperty({ nullable: true })
	currentValue: unknown

	@ApiProperty({ nullable: true })
	nextValue: unknown

	@ApiProperty({ type: [String] })
	errors: string[]

	@ApiPropertyOptional({ type: Object, nullable: true })
	raw?: Record<string, unknown> | null
}

export class OneCStockSyncPreviewDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: String })
	entityMappingId: string

	@ApiProperty({ type: String })
	externalObjectCode: string

	@ApiProperty({ type: Number })
	totalFetched: number

	@ApiProperty({ type: OneCValueSyncPreviewCountersDto })
	counters: OneCValueSyncPreviewCountersDto

	@ApiProperty({ type: [OneCValueSyncPreviewRowDto] })
	rows: OneCValueSyncPreviewRowDto[]
}

export class OneCPriceSyncPreviewDto extends OneCStockSyncPreviewDto {}

export class OneCValueSyncResultCountersDto {
	@ApiProperty({ type: Number })
	total: number

	@ApiProperty({ type: Number })
	updated: number

	@ApiProperty({ type: Number })
	skipped: number

	@ApiProperty({ type: Number })
	failed: number
}

export class OneCValueSyncResultRowDto {
	@ApiProperty({ type: Number })
	index: number

	@ApiProperty({ type: String, nullable: true })
	externalIdentity: string | null

	@ApiProperty({ enum: ['UPDATED', 'SKIPPED', 'FAILED'] })
	status: 'UPDATED' | 'SKIPPED' | 'FAILED'

	@ApiProperty({ enum: ['product', 'variant'], nullable: true })
	targetKind: 'product' | 'variant' | null

	@ApiProperty({ type: String, nullable: true })
	productId: string | null

	@ApiProperty({ type: String, nullable: true })
	variantId: string | null

	@ApiProperty({ nullable: true })
	previousValue: unknown

	@ApiProperty({ nullable: true })
	nextValue: unknown

	@ApiProperty({ type: [String] })
	errors: string[]
}

export class OneCStockSyncResultDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: String })
	entityMappingId: string

	@ApiProperty({ type: String })
	externalObjectCode: string

	@ApiProperty({ type: OneCValueSyncResultCountersDto })
	counters: OneCValueSyncResultCountersDto

	@ApiProperty({ type: [OneCValueSyncResultRowDto] })
	rows: OneCValueSyncResultRowDto[]
}

export class OneCPriceSyncResultDto extends OneCStockSyncResultDto {}

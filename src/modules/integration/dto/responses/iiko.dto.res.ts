import {
	type IntegrationOrderExportStatus,
	IntegrationProvider,
	IntegrationSyncRunMode,
	IntegrationSyncRunStatus,
	IntegrationSyncRunTrigger,
	IntegrationSyncStatus,
	type IntegrationWebhookEventStatus
} from '@generated/enums'
import { ApiProperty } from '@nestjs/swagger'

import {
	IntegrationProviderCapabilitiesDto,
	MoySkladSyncRunDto
} from './moysklad.dto.res'

const IIKO_ORDER_EXPORT_STATUSES = [
	'PENDING',
	'RUNNING',
	'SUCCESS',
	'ERROR',
	'SKIPPED'
] as const

const IIKO_WEBHOOK_EVENT_STATUSES = [
	'PENDING',
	'PROCESSING',
	'PROCESSED',
	'FAILED',
	'SKIPPED'
] as const

export class IikoOrganizationDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: Boolean, nullable: true })
	isActive: boolean | null
}

export class IikoExternalMenuDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string
}

export class IikoPriceCategoryDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string
}

export class IikoTerminalGroupDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String, nullable: true })
	organizationId: string | null

	@ApiProperty({ type: Boolean, nullable: true })
	isActive: boolean | null

	@ApiProperty({ type: Boolean, nullable: true })
	isAlive: boolean | null
}

export class IikoRestaurantTableDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String, nullable: true })
	publicCode: string | null

	@ApiProperty({ type: Number, nullable: true })
	number: number | null

	@ApiProperty({ type: String, nullable: true })
	displayNumber: string | null

	@ApiProperty({ type: String, nullable: true })
	name: string | null

	@ApiProperty({ type: Number, nullable: true })
	seatingCapacity: number | null

	@ApiProperty({ type: String, nullable: true })
	sectionId: string | null

	@ApiProperty({ type: String, nullable: true })
	sectionName: string | null

	@ApiProperty({ type: String, nullable: true })
	terminalGroupId: string | null
}

export class IikoRestaurantTablesDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: IikoRestaurantTableDto, isArray: true })
	tables: IikoRestaurantTableDto[]

	@ApiProperty({ type: Number, nullable: true })
	revision: number | null
}

export class IikoTestConnectionDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: IikoOrganizationDto, isArray: true })
	organizations: IikoOrganizationDto[]

	@ApiProperty({ type: IikoExternalMenuDto, isArray: true })
	externalMenus: IikoExternalMenuDto[]

	@ApiProperty({ type: IikoPriceCategoryDto, isArray: true })
	priceCategories: IikoPriceCategoryDto[]

	@ApiProperty({ type: IikoTerminalGroupDto, isArray: true })
	terminalGroups: IikoTerminalGroupDto[]
}

export class IikoWebhookStatusDto {
	@ApiProperty({ type: Boolean })
	enabled: boolean

	@ApiProperty({ type: String, nullable: true })
	urlPreview: string | null

	@ApiProperty({ type: Boolean })
	hasSecret: boolean

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	lastConfiguredAt: string | null

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	lastReceivedAt: string | null

	@ApiProperty({ type: String, nullable: true })
	lastEventType: string | null

	@ApiProperty({ type: String, nullable: true })
	lastError: string | null
}

export class IikoWebhookSetupDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: Boolean })
	enabled: true

	@ApiProperty({ type: String })
	correlationId: string | null

	@ApiProperty({ type: IikoWebhookStatusDto })
	webhook: IikoWebhookStatusDto
}

export class IikoWebhookEventDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ enum: IntegrationProvider })
	provider: IntegrationProvider

	@ApiProperty({ type: String })
	requestId: string

	@ApiProperty({ type: String })
	eventType: string

	@ApiProperty({ enum: IIKO_WEBHOOK_EVENT_STATUSES })
	status: IntegrationWebhookEventStatus

	@ApiProperty({ type: String, nullable: true })
	jobId: string | null

	@ApiProperty({ type: String, nullable: true })
	error: string | null

	@ApiProperty({ type: Object })
	details: Record<string, string | null>

	@ApiProperty({ type: String, format: 'date-time' })
	receivedAt: Date

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	processedAt: Date | null

	@ApiProperty({ type: String, format: 'date-time' })
	createdAt: Date

	@ApiProperty({ type: String, format: 'date-time' })
	updatedAt: Date
}

export class IikoIntegrationDto {
	@ApiProperty({ enum: IntegrationProvider })
	provider: IntegrationProvider

	@ApiProperty({ type: IntegrationProviderCapabilitiesDto })
	capabilities: IntegrationProviderCapabilitiesDto

	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ type: Boolean })
	hasApiLogin: boolean

	@ApiProperty({ type: String, nullable: true })
	apiLoginPreview: string | null

	@ApiProperty({ type: String, nullable: true })
	appId: string | null

	@ApiProperty({ type: Boolean })
	hasClientSecret: boolean

	@ApiProperty({ type: String })
	organizationId: string

	@ApiProperty({ type: String, nullable: true })
	organizationName: string | null

	@ApiProperty({ type: String, nullable: true })
	externalMenuId: string | null

	@ApiProperty({ type: String, nullable: true })
	externalMenuName: string | null

	@ApiProperty({ type: String, nullable: true })
	priceCategoryId: string | null

	@ApiProperty({ type: String, nullable: true })
	priceCategoryName: string | null

	@ApiProperty({ type: String, nullable: true })
	terminalGroupId: string | null

	@ApiProperty({ type: String, nullable: true })
	terminalGroupName: string | null

	@ApiProperty({ type: Number })
	menuVersion: number

	@ApiProperty({ type: String })
	syncSource: string

	@ApiProperty({ type: Boolean })
	importImages: boolean

	@ApiProperty({ type: Boolean })
	exportOrders: boolean

	@ApiProperty({ type: IikoWebhookStatusDto })
	webhook: IikoWebhookStatusDto

	@ApiProperty({
		type: String,
		nullable: true,
		enum: ['DeliveryByCourier', 'DeliveryByClient']
	})
	orderExportServiceType: string | null

	@ApiProperty({ type: String, nullable: true })
	orderExportSourceKey: string | null

	@ApiProperty({ type: Number, nullable: true })
	lastRevision: number | null

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	lastMenuSyncedAt: string | null

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	lastStopListSyncedAt: string | null

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

export class IikoSyncRunDto extends MoySkladSyncRunDto {}

export class IikoIntegrationStatusDto {
	@ApiProperty({ type: Boolean })
	configured: boolean

	@ApiProperty({ type: IikoIntegrationDto, nullable: true })
	integration: IikoIntegrationDto | null

	@ApiProperty({ type: IikoSyncRunDto, nullable: true })
	activeRun: IikoSyncRunDto | null

	@ApiProperty({ type: IikoSyncRunDto, nullable: true })
	lastRun: IikoSyncRunDto | null
}

export class IikoImportPreviewStatsDto {
	@ApiProperty({ type: Number })
	categories: number

	@ApiProperty({ type: Number })
	items: number

	@ApiProperty({ type: Number })
	visibleItems: number

	@ApiProperty({ type: Number })
	hiddenItems: number

	@ApiProperty({ type: Number })
	itemsWithoutPrice: number

	@ApiProperty({ type: Number })
	itemsWithModifiers: number

	@ApiProperty({ type: Number })
	combos: number

	@ApiProperty({ type: Number })
	variants: number
}

export class IikoImportPreviewDiffDto {
	@ApiProperty({ type: Number })
	newItems: number

	@ApiProperty({ type: Number })
	matchedItems: number

	@ApiProperty({ type: Number })
	changedItems: number

	@ApiProperty({ type: Number })
	priceChanges: number

	@ApiProperty({ type: Number })
	nameChanges: number

	@ApiProperty({ type: Number })
	unchangedItems: number

	@ApiProperty({ type: Number })
	missingLinkedItems: number
}

export class IikoImportPreviewCategoryDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: Boolean })
	isHidden: boolean

	@ApiProperty({ type: Number })
	items: number
}

export class IikoImportPreviewItemDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String, nullable: true })
	categoryId: string | null

	@ApiProperty({ type: String, nullable: true })
	type: string | null

	@ApiProperty({ type: String, nullable: true })
	orderItemType: string | null

	@ApiProperty({ type: Boolean })
	isHidden: boolean

	@ApiProperty({ type: Boolean })
	hasPrice: boolean

	@ApiProperty({ type: Number, nullable: true })
	price: number | null

	@ApiProperty({ type: Number })
	variants: number

	@ApiProperty({ type: Boolean })
	hasModifiers: boolean

	@ApiProperty({ type: Boolean })
	willImport: boolean

	@ApiProperty({ type: String, isArray: true })
	skipReasons: string[]

	@ApiProperty({ type: String, nullable: true })
	diffStatus: string | null

	@ApiProperty({ type: String, nullable: true })
	localProductId: string | null

	@ApiProperty({ type: String, nullable: true })
	localName: string | null

	@ApiProperty({ type: Number, nullable: true })
	localPrice: number | null
}

export class IikoImportPreviewDto {
	@ApiProperty({ type: Boolean })
	ok: true

	@ApiProperty({ type: String })
	source: 'external_menu'

	@ApiProperty({ type: Number, nullable: true })
	revision: number | null

	@ApiProperty({ type: String, nullable: true })
	externalMenuId: string | null

	@ApiProperty({ type: String, nullable: true })
	externalMenuName: string | null

	@ApiProperty({ type: IikoImportPreviewStatsDto })
	stats: IikoImportPreviewStatsDto

	@ApiProperty({ type: IikoImportPreviewDiffDto })
	diff: IikoImportPreviewDiffDto

	@ApiProperty({ type: IikoImportPreviewCategoryDto, isArray: true })
	categories: IikoImportPreviewCategoryDto[]

	@ApiProperty({ type: IikoImportPreviewItemDto, isArray: true })
	items: IikoImportPreviewItemDto[]
}

export class IikoQueuedSyncDto {
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

export class IikoOrderExportDto {
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

	@ApiProperty({ enum: IIKO_ORDER_EXPORT_STATUSES })
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

export class IikoQueuedOrderExportDto {
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

export class IikoOrderExportTimelineItemDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ enum: IntegrationProvider })
	provider: IntegrationProvider

	@ApiProperty({ type: String })
	exportId: string

	@ApiProperty({ type: String })
	type: string

	@ApiProperty({ type: String })
	status: string

	@ApiProperty({ type: String })
	title: string

	@ApiProperty({ type: String, nullable: true })
	detail: string | null

	@ApiProperty({ type: String, nullable: true })
	externalId: string | null

	@ApiProperty({ type: String, nullable: true })
	error: string | null

	@ApiProperty({ type: Number })
	attempts: number

	@ApiProperty({ type: String, format: 'date-time' })
	occurredAt: Date
}

export class IikoOrderExportTimelineDto {
	@ApiProperty({ type: String })
	orderId: string

	@ApiProperty({ type: IikoOrderExportTimelineItemDto, isArray: true })
	items: IikoOrderExportTimelineItemDto[]
}

export class IikoSyncProgressDto {
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

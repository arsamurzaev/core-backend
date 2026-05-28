import {
	CartCheckoutMethod,
	CatalogExperienceMode,
	CatalogStatus,
	ContactType,
	Metric,
	MetricScope
} from '@generated/enums'
import type { CatalogInventoryMode } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { AttributeDto } from '@/modules/attribute/public'
import { CATALOG_CAPABILITIES } from '@/modules/capability/public'
import { SeoDto } from '@/modules/seo/public'
import { OkResponseDto } from '@/shared/http/dto/ok.response.dto'
import { MediaDto } from '@/shared/media/dto/media.dto.res'

const CATALOG_INVENTORY_MODES = ['NONE', 'EXTERNAL', 'INTERNAL'] as const

export class CatalogConfigDto {
	@ApiProperty({ enum: CatalogStatus })
	status: CatalogStatus

	@ApiProperty({ type: String })
	about: string

	@ApiProperty({ type: String, nullable: true })
	description: string | null

	@ApiProperty({ type: String })
	currency: string

	@ApiProperty({ type: MediaDto, nullable: true })
	logoMedia: MediaDto | null

	@ApiProperty({ type: MediaDto, nullable: true })
	bgMedia: MediaDto | null

	@ApiProperty({ type: String, nullable: true })
	note: string | null
}

export class CatalogCheckoutFieldDto {
	@ApiProperty({ type: String })
	key: string

	@ApiProperty({ type: String })
	label: string

	@ApiProperty({ type: String, enum: ['date', 'text', 'number', 'time'] })
	type: 'date' | 'text' | 'number' | 'time'

	@ApiProperty({ type: Boolean })
	required: boolean
}

export class CatalogCheckoutPreorderSettingsDto {
	@ApiProperty({ type: Number, example: 30 })
	minLeadTimeMinutes: number

	@ApiProperty({ type: Number, example: 14 })
	maxAdvanceDays: number
}

export class CatalogCheckoutConfigDto {
	@ApiProperty({ enum: CartCheckoutMethod, isArray: true })
	availableMethods: CartCheckoutMethod[]

	@ApiProperty({ enum: CartCheckoutMethod, isArray: true })
	enabledMethods: CartCheckoutMethod[]

	@ApiProperty({ type: Object })
	methodContacts: Record<string, Record<string, string>>

	@ApiProperty({ type: Object })
	methodFields: Record<string, CatalogCheckoutFieldDto[]>

	@ApiProperty({ type: CatalogCheckoutPreorderSettingsDto })
	preorder: CatalogCheckoutPreorderSettingsDto
}

export class CatalogSettingsDto {
	@ApiProperty({ type: Boolean })
	isActive: boolean

	@ApiProperty({ enum: CatalogExperienceMode })
	defaultMode: CatalogExperienceMode

	@ApiProperty({ enum: CatalogExperienceMode, isArray: true })
	allowedModes: CatalogExperienceMode[]

	@ApiProperty({ enum: CATALOG_INVENTORY_MODES })
	inventoryMode: CatalogInventoryMode

	@ApiProperty({ type: String, nullable: true })
	address: string | null

	@ApiProperty({ type: CatalogCheckoutConfigDto })
	checkout: CatalogCheckoutConfigDto

	@ApiProperty({ type: String, nullable: true })
	googleVerification: string | null

	@ApiProperty({ type: String, nullable: true })
	yandexVerification: string | null
}

export class CatalogCurrentFeaturesDto {
	@ApiProperty({ enum: CATALOG_INVENTORY_MODES })
	inventoryMode: CatalogInventoryMode

	@ApiProperty({
		type: Boolean,
		description: 'Whether the current catalog can use product type schemas.'
	})
	canUseProductTypes: boolean

	@ApiProperty({
		type: Boolean,
		description: 'Whether the current catalog can use product variants.'
	})
	canUseProductVariants: boolean

	@ApiProperty({
		type: Boolean,
		description: 'Whether the current catalog can use catalog sale units.'
	})
	canUseCatalogSaleUnits: boolean

	@ApiProperty({
		type: Boolean,
		description:
			'Whether the current catalog can use the paid internal inventory feature.'
	})
	canUseInternalInventory: boolean

	@ApiProperty({
		type: Boolean,
		description: 'Whether the current catalog can use MoySklad integration.'
	})
	canUseMoySkladIntegration: boolean

	@ApiProperty({
		type: Boolean,
		description: 'Whether the current catalog can use iiko integration.'
	})
	canUseIikoIntegration: boolean

	@ApiProperty({
		type: Object,
		additionalProperties: { type: 'boolean' },
		description: 'Raw admin entitlements before dependency resolution.'
	})
	raw: Record<(typeof CATALOG_CAPABILITIES)[number], boolean>

	@ApiProperty({
		type: Object,
		additionalProperties: { type: 'boolean' },
		description: 'Effective capabilities after dependency resolution.'
	})
	effective: Record<(typeof CATALOG_CAPABILITIES)[number], boolean>

	@ApiProperty({
		type: Object,
		isArray: true,
		description: 'Capability definitions for UI and admin surfaces.'
	})
	definitions: Array<{
		key: (typeof CATALOG_CAPABILITIES)[number]
		title: string
		description: string
		dependsOn: Array<(typeof CATALOG_CAPABILITIES)[number]>
	}>

	@ApiProperty({
		type: Object,
		isArray: true,
		description: 'Per-capability state with disabled reasons.'
	})
	items: Array<{
		key: (typeof CATALOG_CAPABILITIES)[number]
		raw: boolean
		effective: boolean
		disabledReason: string | null
	}>
}

export class CatalogMetricDto {
	@ApiProperty({ enum: Metric })
	provider: Metric

	@ApiProperty({ enum: MetricScope })
	scope: MetricScope

	@ApiProperty({ type: String })
	counterId: string
}

export class CatalogTypeDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: [AttributeDto] })
	attributes: AttributeDto[]
}

export class CatalogContactDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ enum: ContactType })
	type: ContactType

	@ApiProperty({ type: Number })
	position: number

	@ApiProperty({ type: String })
	value: string
}

export class CatalogDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	slug: string

	@ApiProperty({ type: String, nullable: true })
	domain: string | null

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String })
	typeId: string

	@ApiProperty({ type: String, nullable: true })
	parentId: string | null

	@ApiProperty({ type: String, nullable: true })
	userId: string | null

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	deleteAt?: string | null

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	createdAt?: string

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	updatedAt?: string

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	subscriptionEndsAt?: string | null

	@ApiProperty({ type: CatalogConfigDto, nullable: true })
	config: CatalogConfigDto | null

	@ApiProperty({ type: CatalogSettingsDto, nullable: true })
	settings: CatalogSettingsDto | null

	@ApiProperty({ type: [CatalogMetricDto] })
	metrics: CatalogMetricDto[]
}

export class CatalogCurrentDto extends CatalogDto {
	@ApiProperty({ type: CatalogCurrentFeaturesDto })
	features: CatalogCurrentFeaturesDto

	@ApiProperty({ type: [CatalogContactDto] })
	contacts: CatalogContactDto[]

	@ApiProperty({ type: SeoDto, nullable: true })
	seo: SeoDto | null

	@ApiProperty({ type: CatalogTypeDto })
	type: CatalogTypeDto
}

export class CatalogCurrentShellDto extends CatalogDto {
	@ApiProperty({ type: CatalogCurrentFeaturesDto })
	features: CatalogCurrentFeaturesDto

	@ApiProperty({ type: [CatalogContactDto] })
	contacts: CatalogContactDto[]

	@ApiProperty({ type: SeoDto, nullable: true })
	seo: SeoDto | null
}

export class CatalogCreateResponseDto extends OkResponseDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	slug: string

	@ApiProperty({ type: String, nullable: true })
	domain: string | null
}

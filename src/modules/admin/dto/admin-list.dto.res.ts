import { CatalogStatus, PaymentKind } from '@generated/enums'
import type { CatalogInventoryMode } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import {
	CATALOG_CAPABILITIES,
	type CatalogCapability
} from '@/modules/capability/capability.constants'
import { MediaDto } from '@/shared/media/dto/media.dto.res'

const CATALOG_INVENTORY_MODE_VALUES = ['NONE', 'EXTERNAL', 'INTERNAL'] as const

export class AdminDeleteInfoDto {
	@ApiProperty({ type: Boolean })
	isDeleted: boolean

	@ApiProperty({ type: String, format: 'date-time' })
	deletedAt: Date

	@ApiProperty({ type: String, format: 'date-time' })
	purgeAt: Date

	@ApiProperty({ type: Number })
	purgeInDays: number
}

export class AdminDeleteCatalogContentCountsDto {
	@ApiProperty({ type: Number })
	products: number

	@ApiProperty({ type: Number })
	productVariants: number

	@ApiProperty({ type: Number })
	productAttributes: number

	@ApiProperty({ type: Number })
	variantAttributes: number

	@ApiProperty({ type: Number })
	categories: number

	@ApiProperty({ type: Number })
	brands: number

	@ApiProperty({ type: Number })
	seoSettings: number

	@ApiProperty({ type: Number })
	productMediaLinks: number

	@ApiProperty({ type: Number })
	categoryProductLinks: number

	@ApiProperty({ type: Number })
	integrationProductLinks: number

	@ApiProperty({ type: Number })
	integrationCategoryLinks: number
}

export class AdminDeleteCatalogContentResultDto {
	@ApiProperty({ type: Boolean })
	ok: boolean

	@ApiProperty({ type: String })
	catalogId: string

	@ApiProperty({ type: String, format: 'date-time' })
	deletedAt: Date

	@ApiProperty({ type: AdminDeleteCatalogContentCountsDto })
	counts: AdminDeleteCatalogContentCountsDto
}

export class AdminTypeListItemDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	code: string

	@ApiProperty({ type: String })
	name: string

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	deleteAt?: Date | null

	@ApiPropertyOptional({ type: AdminDeleteInfoDto, nullable: true })
	deleteInfo?: AdminDeleteInfoDto | null

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	createdAt?: Date

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	updatedAt?: Date

	@ApiPropertyOptional({ type: Number })
	catalogsCount?: number
}

export class AdminPromoCodeListItemDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String })
	firstName: string

	@ApiProperty({ type: String })
	lastName: string

	@ApiProperty({ type: String })
	surName: string

	@ApiProperty({ type: String })
	bet: string

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	deleteAt?: Date | null

	@ApiPropertyOptional({ type: AdminDeleteInfoDto, nullable: true })
	deleteInfo?: AdminDeleteInfoDto | null

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	createdAt?: Date

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	updatedAt?: Date

	@ApiPropertyOptional({ type: Number })
	catalogsCount?: number

	@ApiPropertyOptional({ type: Number })
	paymentsCount?: number
}

export class AdminPaymentDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ enum: PaymentKind })
	kind: PaymentKind

	@ApiProperty({ type: String })
	catalogId: string

	@ApiProperty({ type: String, nullable: true })
	promoCodeId: string | null

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	paidAt?: Date | null

	@ApiPropertyOptional({ type: Number, nullable: true })
	amount?: number | null

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	licenseEndsAt?: Date | null

	@ApiPropertyOptional({ type: String, nullable: true })
	proofUrl?: string | null

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	deleteAt?: Date | null

	@ApiPropertyOptional({ type: AdminDeleteInfoDto, nullable: true })
	deleteInfo?: AdminDeleteInfoDto | null

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	createdAt?: Date

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	updatedAt?: Date
}

export class AdminActivityListItemDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	deleteAt?: Date | null

	@ApiPropertyOptional({ type: AdminDeleteInfoDto, nullable: true })
	deleteInfo?: AdminDeleteInfoDto | null

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	createdAt?: Date

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	updatedAt?: Date

	@ApiPropertyOptional({ type: Number })
	catalogsCount?: number

	@ApiProperty({ type: AdminTypeListItemDto, isArray: true })
	types: AdminTypeListItemDto[]
}

export class AdminCatalogConfigListItemDto {
	@ApiProperty({ enum: CatalogStatus })
	status: CatalogStatus

	@ApiProperty({ enum: CATALOG_INVENTORY_MODE_VALUES })
	inventoryMode: CatalogInventoryMode

	@ApiProperty({
		type: Boolean,
		description: 'Whether the catalog can use product type schemas.'
	})
	canUseProductTypes: boolean

	@ApiProperty({
		type: Boolean,
		description: 'Whether the catalog can use product variants.'
	})
	canUseProductVariants: boolean

	@ApiProperty({
		type: Boolean,
		description: 'Whether the catalog can use catalog sale units.'
	})
	canUseCatalogSaleUnits: boolean

	@ApiProperty({
		type: Boolean,
		description:
			'Whether the catalog can use the paid internal inventory feature.'
	})
	canUseInternalInventory: boolean

	@ApiProperty({
		type: Boolean,
		description: 'Whether the catalog can use MoySklad integration.'
	})
	canUseMoySkladIntegration: boolean
}

export class AdminCatalogFeatureEntitlementItemDto {
	@ApiProperty({ enum: CATALOG_CAPABILITIES })
	feature: CatalogCapability

	@ApiProperty({ type: Boolean })
	enabled: boolean

	@ApiProperty({ type: String, format: 'date-time', nullable: true })
	expiresAt: Date | null

	@ApiProperty({ type: Object, nullable: true })
	metadata: unknown | null
}

export class AdminCatalogFeatureEntitlementsDto {
	@ApiProperty({ type: String })
	catalogId: string

	@ApiProperty({ type: [Object] })
	definitions: Record<string, unknown>[]

	@ApiProperty({
		type: Object,
		additionalProperties: { type: 'boolean' },
		description: 'Raw admin entitlements before dependency resolution.'
	})
	raw: Record<string, boolean>

	@ApiProperty({
		type: Object,
		additionalProperties: { type: 'boolean' },
		description: 'Effective capabilities after dependency resolution.'
	})
	effective: Record<string, boolean>

	@ApiProperty({
		type: [Object],
		description: 'Per-capability state with disabled reasons.'
	})
	items: Record<string, unknown>[]

	@ApiProperty({ type: [AdminCatalogFeatureEntitlementItemDto] })
	features: AdminCatalogFeatureEntitlementItemDto[]
}

export class AdminCatalogChildListItemDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	slug: string

	@ApiProperty({ type: String, nullable: true })
	domain: string | null

	@ApiProperty({ type: String })
	name: string

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	deleteAt?: Date | null
}

export class AdminCatalogListItemDto {
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

	@ApiProperty({ type: String, nullable: true })
	promoCodeId: string | null

	@ApiProperty({ type: Boolean })
	promoCodePaid: boolean

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		description: 'Yandex Metrika counter id for MAIN scope.'
	})
	metricId?: string | null

	@ApiProperty({ type: AdminCatalogConfigListItemDto, nullable: true })
	config: AdminCatalogConfigListItemDto | null

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	subscriptionEndsAt?: Date | null

	@ApiPropertyOptional({ type: Number, nullable: true })
	subscriptionDaysLeft?: number | null

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	deleteAt?: Date | null

	@ApiPropertyOptional({ type: AdminDeleteInfoDto, nullable: true })
	deleteInfo?: AdminDeleteInfoDto | null

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	createdAt?: Date

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	updatedAt?: Date

	@ApiProperty({ type: MediaDto, nullable: true })
	logoMedia: MediaDto | null

	@ApiProperty({ type: AdminTypeListItemDto })
	type: AdminTypeListItemDto

	@ApiProperty({ type: AdminPromoCodeListItemDto, nullable: true })
	promoCode: AdminPromoCodeListItemDto | null

	@ApiProperty({ type: AdminCatalogChildListItemDto, isArray: true })
	children: AdminCatalogChildListItemDto[]
}

export class AdminCreatedCatalogOwnerDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	name: string

	@ApiProperty({ type: String })
	login: string

	@ApiProperty({ type: String })
	password: string
}

export class AdminCreateCatalogResponseDto {
	@ApiProperty({ type: AdminCatalogListItemDto })
	catalog: AdminCatalogListItemDto

	@ApiProperty({ type: AdminCreatedCatalogOwnerDto })
	owner: AdminCreatedCatalogOwnerDto
}

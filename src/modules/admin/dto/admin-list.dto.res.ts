import { CatalogStatus, PaymentKind } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

import { MediaDto } from '@/shared/media/dto/media.dto.res'

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

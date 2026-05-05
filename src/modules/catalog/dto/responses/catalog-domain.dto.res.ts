import { CatalogDomainStatus } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CatalogDomainDnsRecordDto {
	@ApiProperty({ type: String, example: 'TXT' })
	type: string

	@ApiProperty({ type: String, example: '_myctlg-verify.kingsname.ru' })
	name: string

	@ApiProperty({ type: String, example: 'verification-token' })
	value: string

	@ApiProperty({ type: Boolean })
	required: boolean

	@ApiPropertyOptional({ type: String })
	description?: string
}

export class CatalogDomainVerificationDto {
	@ApiProperty({ type: CatalogDomainDnsRecordDto })
	txtRecord: CatalogDomainDnsRecordDto

	@ApiProperty({ type: CatalogDomainDnsRecordDto, isArray: true })
	routingRecords: CatalogDomainDnsRecordDto[]

	@ApiPropertyOptional({ type: CatalogDomainDnsRecordDto, nullable: true })
	wwwRecord?: CatalogDomainDnsRecordDto | null

	@ApiProperty({ type: String, isArray: true })
	expectedHosts: string[]

	@ApiProperty({ type: String, isArray: true })
	instructions: string[]

	@ApiProperty({ type: Number, example: 300 })
	recheckAfterSeconds: number
}

export class CatalogDomainDto {
	@ApiProperty({ type: String })
	id: string

	@ApiProperty({ type: String })
	catalogId: string

	@ApiProperty({ type: String })
	hostname: string

	@ApiProperty({ enum: CatalogDomainStatus })
	status: CatalogDomainStatus

	@ApiProperty({ type: Boolean })
	isPrimary: boolean

	@ApiProperty({ type: Boolean })
	redirectToPrimary: boolean

	@ApiProperty({ type: Boolean })
	includeWww: boolean

	@ApiProperty({ type: String })
	verificationToken: string

	@ApiProperty({ type: CatalogDomainVerificationDto })
	verification: CatalogDomainVerificationDto

	@ApiProperty({ type: Number, example: 300 })
	nextCheckAfterSeconds: number

	@ApiProperty({ type: String, format: 'date-time' })
	nextCheckAt: string

	@ApiProperty({ type: String })
	message: string

	@ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
	lastCheckedAt?: Date | null

	@ApiPropertyOptional({ type: String, nullable: true })
	lastError?: string | null

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	createdAt?: Date

	@ApiPropertyOptional({ type: String, format: 'date-time' })
	updatedAt?: Date
}

export class CatalogDomainCheckDto {
	@ApiProperty({ type: Boolean })
	ok: boolean

	@ApiProperty({ type: String })
	status: CatalogDomainStatus

	@ApiPropertyOptional({ type: String, nullable: true })
	error?: string | null

	@ApiProperty({ type: CatalogDomainVerificationDto })
	verification: CatalogDomainVerificationDto

	@ApiProperty({ type: Number, example: 300 })
	nextCheckAfterSeconds: number

	@ApiProperty({ type: String, format: 'date-time' })
	nextCheckAt: string

	@ApiProperty({ type: String })
	message: string
}

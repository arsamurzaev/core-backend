import { CatalogStatus } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsArray,
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength
} from 'class-validator'

const SLUG_PATTERN = /^[a-z0-9-]+$/
const DOMAIN_PATTERN = /^[a-z0-9.-]+$/
const METRIC_ID_PATTERN = /^\d+$/

function trimOptionalString(value: unknown) {
	if (value === undefined || value === null) return value
	if (typeof value !== 'string') return value
	const normalized = value.trim()
	return normalized.length ? normalized : undefined
}

function trimOptionalNullableString(value: unknown) {
	if (value === undefined) return undefined
	if (value === null) return null
	if (typeof value !== 'string') return value
	const normalized = value.trim()
	return normalized.length ? normalized : null
}

export class AdminUpdateCatalogDtoReq {
	@ApiPropertyOptional({ type: String, example: 'Catalog name' })
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	@IsOptional()
	@IsString()
	name?: string

	@ApiPropertyOptional({ type: String, example: 'type uuid' })
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	@IsOptional()
	@IsString()
	typeId?: string

	@ApiPropertyOptional({
		type: String,
		isArray: true,
		example: ['activity uuid']
	})
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	activityIds?: string[]

	@ApiPropertyOptional({
		type: String,
		example: '108517746',
		description: 'Yandex Metrika counter id for MAIN scope.'
	})
	@Transform(({ value }: { value: unknown }) => trimOptionalString(value))
	@IsOptional()
	@Matches(METRIC_ID_PATTERN)
	@IsString()
	metricId?: string

	@ApiPropertyOptional({ enum: CatalogStatus })
	@IsOptional()
	@IsEnum(CatalogStatus)
	status?: CatalogStatus

	@ApiPropertyOptional({
		type: String,
		example: 'catalog',
		description: 'Catalog domain/subdomain stored as slug.'
	})
	@Transform(({ value }: { value: unknown }) => {
		const normalized = trimOptionalString(value)
		return typeof normalized === 'string' ? normalized.toLowerCase() : normalized
	})
	@IsOptional()
	@Matches(SLUG_PATTERN)
	@MinLength(2)
	@MaxLength(63)
	@IsString()
	slug?: string

	@ApiPropertyOptional({
		type: String,
		example: 'example.com',
		nullable: true,
		description: 'Custom domain. Pass null to clear.'
	})
	@Transform(({ value }: { value: unknown }) => {
		const normalized = trimOptionalNullableString(value)
		return typeof normalized === 'string' ? normalized.toLowerCase() : normalized
	})
	@IsOptional()
	@IsString()
	@MaxLength(253)
	@Matches(DOMAIN_PATTERN)
	domain?: string | null

	@ApiPropertyOptional({
		type: String,
		example: 'parent catalog uuid',
		nullable: true
	})
	@Transform(({ value }: { value: unknown }) =>
		trimOptionalNullableString(value)
	)
	@IsOptional()
	@IsString()
	parentId?: string | null

	@ApiPropertyOptional({
		type: String,
		example: 'promo code uuid',
		nullable: true
	})
	@Transform(({ value }: { value: unknown }) =>
		trimOptionalNullableString(value)
	)
	@IsOptional()
	@IsString()
	promoCodeId?: string | null

	@ApiPropertyOptional({
		type: Number,
		example: 14,
		description: 'Trial license duration in days from now.'
	})
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null || value === '') return undefined
		return Number(value)
	})
	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(3650)
	trialLicenseDays?: number
}

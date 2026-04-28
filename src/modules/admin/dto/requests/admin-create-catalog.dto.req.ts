import { CatalogStatus } from '@generated/enums'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsArray,
	IsEnum,
	IsInt,
	IsNotEmpty,
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

export class AdminCreateCatalogDtoReq {
	@ApiProperty({ type: String, example: 'Catalog name' })
	@IsString()
	@IsNotEmpty()
	name: string

	@ApiProperty({ type: String, example: 'type uuid' })
	@IsString()
	@IsNotEmpty()
	typeId: string

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
	@Transform(({ value }: { value: unknown }) => {
		if (typeof value !== 'string') return value
		const normalized = value.trim()
		return normalized.length ? normalized : value
	})
	@IsOptional()
	@Matches(METRIC_ID_PATTERN)
	@IsString()
	@IsNotEmpty()
	metricId?: string

	@ApiProperty({ enum: CatalogStatus })
	@IsEnum(CatalogStatus)
	@IsNotEmpty()
	status: CatalogStatus

	@ApiProperty({
		type: String,
		example: 'catalog',
		description: 'Catalog domain/subdomain stored as slug.'
	})
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return value
		if (typeof value !== 'string') return value
		const normalized = value.trim().toLowerCase()
		return normalized.length ? normalized : value
	})
	@Matches(SLUG_PATTERN)
	@MinLength(2)
	@MaxLength(63)
	@IsString()
	@IsNotEmpty()
	slug: string

	@ApiPropertyOptional({
		type: String,
		example: 'example.com',
		nullable: true,
		description: 'Custom domain.'
	})
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined) return undefined
		if (value === null) return null
		if (typeof value !== 'string') return value
		const normalized = value.trim().toLowerCase()
		return normalized.length ? normalized : null
	})
	@IsOptional()
	@IsString()
	@MaxLength(253)
	@Matches(DOMAIN_PATTERN)
	domain?: string | null

	@ApiPropertyOptional({ type: String, example: 'parent catalog uuid' })
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return undefined
		if (typeof value !== 'string') return value
		const normalized = value.trim()
		return normalized.length ? normalized : undefined
	})
	@IsOptional()
	@IsString()
	parentId?: string

	@ApiPropertyOptional({
		type: Number,
		example: 14,
		description: 'Trial license duration in days.'
	})
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null || value === '') return value
		return Number(value)
	})
	@IsOptional()
	@IsInt()
	@Min(1)
	@Max(3650)
	trialLicenseDays?: number

	@ApiPropertyOptional({
		type: String,
		example: 'Catalog owner',
		description: 'If omitted, catalog name is used.'
	})
	@Transform(({ value }: { value: unknown }) => {
		if (value === undefined || value === null) return undefined
		if (typeof value !== 'string') return value
		const normalized = value.trim()
		return normalized.length ? normalized : undefined
	})
	@IsOptional()
	@IsString()
	ownerName?: string
}

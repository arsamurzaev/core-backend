import { CatalogStatus } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsArray, IsEnum, IsIn, IsOptional, IsString } from 'class-validator'

const SORT_FIELDS = [
	'createdAt',
	'slug',
	'name',
	'promoCode',
	'type',
	'subscriptionDaysLeft',
	'status'
] as const

const SORT_ORDERS = ['asc', 'desc'] as const

export type AdminCatalogSortField = (typeof SORT_FIELDS)[number]
export type AdminCatalogSortOrder = (typeof SORT_ORDERS)[number]

function normalizeStringArray(value: unknown) {
	if (value === undefined || value === null || value === '') return undefined
	const values = Array.isArray(value) ? value : String(value).split(',')
	const normalized = values.map(item => String(item).trim()).filter(Boolean)
	return normalized.length ? normalized : undefined
}

export class AdminCatalogsQueryDtoReq {
	@ApiPropertyOptional({
		type: String,
		isArray: true,
		description: 'Type ids. Supports comma separated value.'
	})
	@Transform(({ value }: { value: unknown }) => normalizeStringArray(value))
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	typeIds?: string[]

	@Transform(({ value }: { value: unknown }) => normalizeStringArray(value))
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	'typeIds[]'?: string[]

	@ApiPropertyOptional({
		type: String,
		isArray: true,
		description: 'Promo code ids. Supports comma separated value.'
	})
	@Transform(({ value }: { value: unknown }) => normalizeStringArray(value))
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	promoCodeIds?: string[]

	@Transform(({ value }: { value: unknown }) => normalizeStringArray(value))
	@IsOptional()
	@IsArray()
	@IsString({ each: true })
	'promoCodeIds[]'?: string[]

	@ApiPropertyOptional({
		enum: CatalogStatus,
		isArray: true,
		description: 'Catalog statuses. Supports comma separated value.'
	})
	@Transform(({ value }: { value: unknown }) => normalizeStringArray(value))
	@IsOptional()
	@IsArray()
	@IsEnum(CatalogStatus, { each: true })
	statuses?: CatalogStatus[]

	@Transform(({ value }: { value: unknown }) => normalizeStringArray(value))
	@IsOptional()
	@IsArray()
	@IsEnum(CatalogStatus, { each: true })
	'statuses[]'?: CatalogStatus[]

	@ApiPropertyOptional({ enum: SORT_FIELDS, default: 'createdAt' })
	@IsOptional()
	@IsIn(SORT_FIELDS)
	sortBy?: AdminCatalogSortField = 'createdAt'

	@ApiPropertyOptional({ enum: SORT_ORDERS, default: 'desc' })
	@IsOptional()
	@IsIn(SORT_ORDERS)
	sortOrder?: AdminCatalogSortOrder = 'desc'
}

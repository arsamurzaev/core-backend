import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
	IsBoolean,
	IsIn,
	IsInt,
	IsOptional,
	IsString,
	Max,
	MaxLength,
	Min
} from 'class-validator'

import {
	ONE_C_API_KINDS,
	ONE_C_AUTH_KINDS,
	type OneCApiKind,
	type OneCAuthKind
} from '../../providers/one-c/one-c.types'

export const ONE_C_EXTERNAL_OBJECT_KINDS = [
	'ODATA_ENTITY',
	'HTTP_ENDPOINT',
	'CATALOG',
	'DOCUMENT',
	'REGISTER',
	'CUSTOM'
] as const

export const ONE_C_LOCAL_ENTITIES = [
	'PRODUCT',
	'PRODUCT_VARIANT',
	'CATEGORY',
	'ORDER',
	'STOCK',
	'PRICE',
	'WAREHOUSE',
	'CUSTOMER'
] as const

export const ONE_C_MAPPING_DIRECTIONS = [
	'IMPORT',
	'EXPORT',
	'IMPORT_EXPORT'
] as const

export const ONE_C_MAPPING_DATA_TYPES = [
	'STRING',
	'INTEGER',
	'DECIMAL',
	'BOOLEAN',
	'DATETIME',
	'JSON',
	'REFERENCE'
] as const

export class UpsertOneCIntegrationDtoReq {
	@ApiProperty({ enum: ONE_C_API_KINDS, example: 'ODATA' })
	@IsIn(ONE_C_API_KINDS)
	apiKind: OneCApiKind

	@ApiProperty({ enum: ONE_C_AUTH_KINDS, example: 'BASIC' })
	@IsIn(ONE_C_AUTH_KINDS)
	authKind: OneCAuthKind

	@ApiProperty({
		type: String,
		example: 'https://client.example/odata/standard.odata'
	})
	@IsString()
	@MaxLength(1000)
	baseUrl: string

	@ApiPropertyOptional({ type: String, nullable: true, example: 'api_user' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	username?: string | null

	@ApiPropertyOptional({ type: String, nullable: true, example: 'secret' })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	password?: string | null

	@ApiPropertyOptional({ type: String, nullable: true, example: 'bearer-token' })
	@IsOptional()
	@IsString()
	@MaxLength(2000)
	token?: string | null

	@ApiPropertyOptional({ type: Number, example: 30000 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1000)
	@Max(120000)
	timeoutMs?: number

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	importProducts?: boolean

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	syncStock?: boolean

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	exportOrders?: boolean

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(64)
	productSyncEntityMappingId?: string | null

	@ApiPropertyOptional({ type: Number, example: 100 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	productSyncLimit?: number

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	productSyncFilter?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(64)
	variantSyncEntityMappingId?: string | null

	@ApiPropertyOptional({ type: Number, example: 100 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	variantSyncLimit?: number

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	variantSyncFilter?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(64)
	stockSyncEntityMappingId?: string | null

	@ApiPropertyOptional({ type: Number, example: 100 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	stockSyncLimit?: number

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	stockSyncFilter?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(64)
	priceSyncEntityMappingId?: string | null

	@ApiPropertyOptional({ type: Number, example: 100 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	priceSyncLimit?: number

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	priceSyncFilter?: string | null

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	scheduleEnabled?: boolean

	@ApiPropertyOptional({ type: String, nullable: true, example: '0 */6 * * *' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	schedulePattern?: string | null

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		example: 'Europe/Moscow'
	})
	@IsOptional()
	@IsString()
	@MaxLength(100)
	scheduleTimezone?: string | null

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	stockScheduleEnabled?: boolean

	@ApiPropertyOptional({ type: String, nullable: true, example: '*/15 * * * *' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	stockSchedulePattern?: string | null

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		example: 'Europe/Moscow'
	})
	@IsOptional()
	@IsString()
	@MaxLength(100)
	stockScheduleTimezone?: string | null

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	priceScheduleEnabled?: boolean

	@ApiPropertyOptional({ type: String, nullable: true, example: '0 */2 * * *' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	priceSchedulePattern?: string | null

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		example: 'Europe/Moscow'
	})
	@IsOptional()
	@IsString()
	@MaxLength(100)
	priceScheduleTimezone?: string | null
}

export class UpdateOneCIntegrationDtoReq {
	@ApiPropertyOptional({ enum: ONE_C_API_KINDS })
	@IsOptional()
	@IsIn(ONE_C_API_KINDS)
	apiKind?: OneCApiKind

	@ApiPropertyOptional({ enum: ONE_C_AUTH_KINDS })
	@IsOptional()
	@IsIn(ONE_C_AUTH_KINDS)
	authKind?: OneCAuthKind

	@ApiPropertyOptional({ type: String })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	baseUrl?: string

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	username?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	password?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(2000)
	token?: string | null

	@ApiPropertyOptional({ type: Number })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1000)
	@Max(120000)
	timeoutMs?: number

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	importProducts?: boolean

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	syncStock?: boolean

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	exportOrders?: boolean

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(64)
	productSyncEntityMappingId?: string | null

	@ApiPropertyOptional({ type: Number })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	productSyncLimit?: number

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	productSyncFilter?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(64)
	variantSyncEntityMappingId?: string | null

	@ApiPropertyOptional({ type: Number })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	variantSyncLimit?: number

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	variantSyncFilter?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(64)
	stockSyncEntityMappingId?: string | null

	@ApiPropertyOptional({ type: Number })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	stockSyncLimit?: number

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	stockSyncFilter?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(64)
	priceSyncEntityMappingId?: string | null

	@ApiPropertyOptional({ type: Number })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	priceSyncLimit?: number

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	priceSyncFilter?: string | null

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	scheduleEnabled?: boolean

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	schedulePattern?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	scheduleTimezone?: string | null

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	stockScheduleEnabled?: boolean

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	stockSchedulePattern?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	stockScheduleTimezone?: string | null

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	priceScheduleEnabled?: boolean

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	priceSchedulePattern?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	priceScheduleTimezone?: string | null
}

export class TestOneCConnectionDtoReq extends UpdateOneCIntegrationDtoReq {}

export class DiscoverOneCObjectsDtoReq {
	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	persist?: boolean
}

export class CreateOneCExternalObjectDtoReq {
	@ApiProperty({ type: String, example: 'Catalog_Nomenclature' })
	@IsString()
	@MaxLength(191)
	code: string

	@ApiPropertyOptional({ type: String, example: 'Nomenclature' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	name?: string

	@ApiPropertyOptional({
		enum: ONE_C_EXTERNAL_OBJECT_KINDS,
		example: 'ODATA_ENTITY'
	})
	@IsOptional()
	@IsIn(ONE_C_EXTERNAL_OBJECT_KINDS)
	kind?: (typeof ONE_C_EXTERNAL_OBJECT_KINDS)[number]

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	endpoint?: string | null

	@ApiPropertyOptional({ type: String, nullable: true, example: 'GET' })
	@IsOptional()
	@IsString()
	@MaxLength(16)
	method?: string | null

	@ApiPropertyOptional({ type: Object, nullable: true })
	@IsOptional()
	schema?: unknown

	@ApiPropertyOptional({ type: Object, nullable: true })
	@IsOptional()
	sample?: unknown

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean
}

export class UpdateOneCExternalObjectDtoReq {
	@ApiPropertyOptional({ type: String })
	@IsOptional()
	@IsString()
	@MaxLength(191)
	code?: string

	@ApiPropertyOptional({ type: String })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	name?: string

	@ApiPropertyOptional({ enum: ONE_C_EXTERNAL_OBJECT_KINDS })
	@IsOptional()
	@IsIn(ONE_C_EXTERNAL_OBJECT_KINDS)
	kind?: (typeof ONE_C_EXTERNAL_OBJECT_KINDS)[number]

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	endpoint?: string | null

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(16)
	method?: string | null

	@ApiPropertyOptional({ type: Object, nullable: true })
	@IsOptional()
	schema?: unknown

	@ApiPropertyOptional({ type: Object, nullable: true })
	@IsOptional()
	sample?: unknown

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean
}

export class CreateOneCEntityMappingDtoReq {
	@ApiProperty({ enum: ONE_C_LOCAL_ENTITIES })
	@IsIn(ONE_C_LOCAL_ENTITIES)
	localEntity: (typeof ONE_C_LOCAL_ENTITIES)[number]

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(64)
	externalObjectId?: string | null

	@ApiProperty({ type: String, example: 'Catalog_Nomenclature' })
	@IsString()
	@MaxLength(191)
	externalObjectCode: string

	@ApiProperty({ type: String, example: 'Ref_Key' })
	@IsString()
	@MaxLength(255)
	identityField: string

	@ApiPropertyOptional({ enum: ONE_C_MAPPING_DIRECTIONS, example: 'IMPORT' })
	@IsOptional()
	@IsIn(ONE_C_MAPPING_DIRECTIONS)
	direction?: (typeof ONE_C_MAPPING_DIRECTIONS)[number]

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		example: 'external_wins'
	})
	@IsOptional()
	@IsString()
	@MaxLength(64)
	conflictPolicy?: string | null

	@ApiPropertyOptional({ type: Object, nullable: true })
	@IsOptional()
	filters?: unknown

	@ApiPropertyOptional({ type: Object, nullable: true })
	@IsOptional()
	options?: unknown

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean
}

export class UpdateOneCEntityMappingDtoReq {
	@ApiPropertyOptional({ enum: ONE_C_LOCAL_ENTITIES })
	@IsOptional()
	@IsIn(ONE_C_LOCAL_ENTITIES)
	localEntity?: (typeof ONE_C_LOCAL_ENTITIES)[number]

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(64)
	externalObjectId?: string | null

	@ApiPropertyOptional({ type: String })
	@IsOptional()
	@IsString()
	@MaxLength(191)
	externalObjectCode?: string

	@ApiPropertyOptional({ type: String })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	identityField?: string

	@ApiPropertyOptional({ enum: ONE_C_MAPPING_DIRECTIONS })
	@IsOptional()
	@IsIn(ONE_C_MAPPING_DIRECTIONS)
	direction?: (typeof ONE_C_MAPPING_DIRECTIONS)[number]

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(64)
	conflictPolicy?: string | null

	@ApiPropertyOptional({ type: Object, nullable: true })
	@IsOptional()
	filters?: unknown

	@ApiPropertyOptional({ type: Object, nullable: true })
	@IsOptional()
	options?: unknown

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean
}

export class CreateOneCFieldMappingDtoReq {
	@ApiProperty({ type: String, example: 'name' })
	@IsString()
	@MaxLength(255)
	localPath: string

	@ApiProperty({ type: String, example: 'Description' })
	@IsString()
	@MaxLength(500)
	externalPath: string

	@ApiPropertyOptional({ enum: ONE_C_MAPPING_DIRECTIONS, example: 'IMPORT' })
	@IsOptional()
	@IsIn(ONE_C_MAPPING_DIRECTIONS)
	direction?: (typeof ONE_C_MAPPING_DIRECTIONS)[number]

	@ApiPropertyOptional({ enum: ONE_C_MAPPING_DATA_TYPES, example: 'STRING' })
	@IsOptional()
	@IsIn(ONE_C_MAPPING_DATA_TYPES)
	dataType?: (typeof ONE_C_MAPPING_DATA_TYPES)[number]

	@ApiPropertyOptional({ type: Object, nullable: true })
	@IsOptional()
	transform?: unknown

	@ApiPropertyOptional({ nullable: true })
	@IsOptional()
	defaultValue?: unknown

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	isRequired?: boolean

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean

	@ApiPropertyOptional({ type: Number })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	displayOrder?: number
}

export class UpdateOneCFieldMappingDtoReq {
	@ApiPropertyOptional({ type: String })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	localPath?: string

	@ApiPropertyOptional({ type: String })
	@IsOptional()
	@IsString()
	@MaxLength(500)
	externalPath?: string

	@ApiPropertyOptional({ enum: ONE_C_MAPPING_DIRECTIONS })
	@IsOptional()
	@IsIn(ONE_C_MAPPING_DIRECTIONS)
	direction?: (typeof ONE_C_MAPPING_DIRECTIONS)[number]

	@ApiPropertyOptional({ enum: ONE_C_MAPPING_DATA_TYPES })
	@IsOptional()
	@IsIn(ONE_C_MAPPING_DATA_TYPES)
	dataType?: (typeof ONE_C_MAPPING_DATA_TYPES)[number]

	@ApiPropertyOptional({ type: Object, nullable: true })
	@IsOptional()
	transform?: unknown

	@ApiPropertyOptional({ nullable: true })
	@IsOptional()
	defaultValue?: unknown

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	isRequired?: boolean

	@ApiPropertyOptional({ type: Boolean })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean

	@ApiPropertyOptional({ type: Number })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	displayOrder?: number
}

export class PreviewOneCMappingDtoReq {
	@ApiProperty({ type: String })
	@IsString()
	@MaxLength(64)
	entityMappingId: string

	@ApiProperty({ type: Object })
	@IsOptional()
	externalPayload?: unknown
}

export class PreviewOneCRemoteMappingDtoReq {
	@ApiProperty({ type: String })
	@IsString()
	@MaxLength(64)
	entityMappingId: string

	@ApiPropertyOptional({ type: Number, example: 10 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	limit?: number

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	filter?: string | null

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	includeRaw?: boolean
}

export class PreviewOneCProductImportDtoReq extends PreviewOneCRemoteMappingDtoReq {}

export class ImportOneCProductsDtoReq extends PreviewOneCRemoteMappingDtoReq {
	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	failOnRowError?: boolean
}

export class PreviewOneCVariantImportDtoReq extends PreviewOneCRemoteMappingDtoReq {}

export class ImportOneCVariantsDtoReq extends PreviewOneCRemoteMappingDtoReq {
	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	failOnRowError?: boolean
}

export class RunOneCProductSyncDtoReq extends ImportOneCProductsDtoReq {}

export class RunOneCVariantSyncDtoReq extends ImportOneCVariantsDtoReq {}

export class RunOneCValueSyncDtoReq {
	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(64)
	entityMappingId?: string | null

	@ApiPropertyOptional({ type: Number, example: 100 })
	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(1)
	@Max(100)
	limit?: number

	@ApiPropertyOptional({ type: String, nullable: true })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	filter?: string | null

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	includeRaw?: boolean

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	failOnRowError?: boolean
}

export class PreviewOneCStockSyncDtoReq extends PreviewOneCRemoteMappingDtoReq {}

export class ApplyOneCStockSyncDtoReq extends PreviewOneCRemoteMappingDtoReq {
	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	failOnRowError?: boolean
}

export class RunOneCStockSyncDtoReq extends RunOneCValueSyncDtoReq {}

export class PreviewOneCPriceSyncDtoReq extends PreviewOneCRemoteMappingDtoReq {}

export class ApplyOneCPriceSyncDtoReq extends PreviewOneCRemoteMappingDtoReq {
	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	failOnRowError?: boolean
}

export class RunOneCPriceSyncDtoReq extends RunOneCValueSyncDtoReq {}

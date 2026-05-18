import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import {
	IsBoolean,
	IsIn,
	IsOptional,
	IsString,
	MaxLength,
	ValidateNested
} from 'class-validator'

const MOYSKLAD_FIELD_OWNERSHIP_VALUES = ['external', 'local'] as const

export class MoySkladFieldOwnershipDtoReq {
	@ApiPropertyOptional({ enum: MOYSKLAD_FIELD_OWNERSHIP_VALUES })
	@IsOptional()
	@IsIn(MOYSKLAD_FIELD_OWNERSHIP_VALUES)
	price?: 'external' | 'local'

	@ApiPropertyOptional({ enum: MOYSKLAD_FIELD_OWNERSHIP_VALUES })
	@IsOptional()
	@IsIn(MOYSKLAD_FIELD_OWNERSHIP_VALUES)
	stock?: 'external' | 'local'

	@ApiPropertyOptional({ enum: MOYSKLAD_FIELD_OWNERSHIP_VALUES })
	@IsOptional()
	@IsIn(MOYSKLAD_FIELD_OWNERSHIP_VALUES)
	content?: 'external' | 'local'

	@ApiPropertyOptional({ enum: MOYSKLAD_FIELD_OWNERSHIP_VALUES })
	@IsOptional()
	@IsIn(MOYSKLAD_FIELD_OWNERSHIP_VALUES)
	images?: 'external' | 'local'
}

export class UpsertMoySkladIntegrationDtoReq {
	@ApiProperty({ type: String, example: 'ms-token' })
	@IsString()
	@MaxLength(500)
	token: string

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean

	@ApiPropertyOptional({ type: String, example: 'Цена продажи' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	priceTypeName?: string

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	importImages?: boolean

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	syncStock?: boolean

	@ApiPropertyOptional({ type: MoySkladFieldOwnershipDtoReq })
	@IsOptional()
	@ValidateNested()
	@Type(() => MoySkladFieldOwnershipDtoReq)
	fieldOwnership?: MoySkladFieldOwnershipDtoReq

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	stockWebhookEnabled?: boolean

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	exportOrders?: boolean

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		example: '9d97b2a1-0000-0000-0000-000000000001'
	})
	@IsOptional()
	@IsString()
	@MaxLength(64)
	orderExportOrganizationId?: string | null

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		example: '9d97b2a1-0000-0000-0000-000000000002'
	})
	@IsOptional()
	@IsString()
	@MaxLength(64)
	orderExportCounterpartyId?: string | null

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		example: '9d97b2a1-0000-0000-0000-000000000003'
	})
	@IsOptional()
	@IsString()
	@MaxLength(64)
	orderExportStoreId?: string | null

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
}

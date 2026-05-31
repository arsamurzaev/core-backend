import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
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

export class UpsertIikoIntegrationDtoReq {
	@ApiProperty({ type: String, example: 'demo-api-login' })
	@IsString()
	@MaxLength(500)
	apiLogin: string

	@ApiProperty({ type: String, example: '9d97b2a1-0000-0000-0000-000000000001' })
	@IsString()
	@MaxLength(64)
	organizationId: string

	@ApiPropertyOptional({ type: String, nullable: true, example: 'Demo Cafe' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	organizationName?: string | null

	@ApiPropertyOptional({ type: String, nullable: true, example: '81651' })
	@IsOptional()
	@IsString()
	@MaxLength(64)
	externalMenuId?: string | null

	@ApiPropertyOptional({ type: String, nullable: true, example: 'Main menu' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	externalMenuName?: string | null

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		example: '9d97b2a1-0000-0000-0000-000000000002'
	})
	@IsOptional()
	@IsString()
	@MaxLength(64)
	priceCategoryId?: string | null

	@ApiPropertyOptional({ type: String, nullable: true, example: 'Base price' })
	@IsOptional()
	@IsString()
	@MaxLength(255)
	priceCategoryName?: string | null

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		example: '9d97b2a1-0000-0000-0000-000000000003'
	})
	@IsOptional()
	@IsString()
	@MaxLength(64)
	terminalGroupId?: string | null

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		example: 'Main terminal'
	})
	@IsOptional()
	@IsString()
	@MaxLength(255)
	terminalGroupName?: string | null

	@ApiPropertyOptional({ type: Number, example: 4 })
	@IsOptional()
	@IsInt()
	@Min(2)
	@Max(4)
	menuVersion?: number

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isActive?: boolean

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	importImages?: boolean

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	exportOrders?: boolean

	@ApiPropertyOptional({
		type: String,
		nullable: true,
		enum: ['DeliveryByCourier', 'DeliveryByClient'],
		example: 'DeliveryByClient'
	})
	@IsOptional()
	@IsString()
	@IsIn(['DeliveryByCourier', 'DeliveryByClient'])
	orderExportServiceType?: 'DeliveryByCourier' | 'DeliveryByClient' | null

	@ApiPropertyOptional({ type: String, nullable: true, example: 'catalog-api' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	orderExportSourceKey?: string | null
}

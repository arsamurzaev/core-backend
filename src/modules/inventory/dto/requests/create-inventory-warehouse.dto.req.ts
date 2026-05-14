import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import {
	IsBoolean,
	IsEnum,
	IsNotEmpty,
	IsOptional,
	IsString,
	Matches,
	MaxLength
} from 'class-validator'

import { INVENTORY_WAREHOUSE_STATUS } from '../../inventory.constants'

const WAREHOUSE_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,99}$/

export class CreateInventoryWarehouseDtoReq {
	@ApiProperty({ type: String, example: 'Основной склад' })
	@IsString()
	@IsNotEmpty()
	@MaxLength(255)
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim() : value
	)
	name: string

	@ApiPropertyOptional({ type: String, example: 'main-warehouse' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Matches(WAREHOUSE_CODE_PATTERN)
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim().toLowerCase() : value
	)
	code?: string

	@ApiPropertyOptional({
		enum: INVENTORY_WAREHOUSE_STATUS,
		example: INVENTORY_WAREHOUSE_STATUS.ACTIVE
	})
	@IsOptional()
	@IsEnum(INVENTORY_WAREHOUSE_STATUS)
	status?: string

	@ApiPropertyOptional({ type: String, example: 'Москва, склад 1' })
	@IsOptional()
	@IsString()
	@MaxLength(500)
	@Transform(({ value }: { value: unknown }) =>
		typeof value === 'string' ? value.trim() : value
	)
	address?: string

	@ApiPropertyOptional({ type: Boolean, example: true })
	@IsOptional()
	@IsBoolean()
	isDefault?: boolean
}

import { OrderStatus } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsDate, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator'

import { AdminPaginationDto } from './admin-pagination.dto'

export class AdminOrdersQueryDto extends AdminPaginationDto {
	@ApiPropertyOptional()
	@IsOptional()
	@IsUUID()
	catalogId?: string

	@ApiPropertyOptional({ enum: OrderStatus })
	@IsOptional()
	@IsEnum(OrderStatus)
	status?: OrderStatus

	@ApiPropertyOptional()
	@IsOptional()
	@Type(() => Date)
	@IsDate()
	dateFrom?: Date

	@ApiPropertyOptional()
	@IsOptional()
	@Type(() => Date)
	@IsDate()
	dateTo?: Date

	@ApiPropertyOptional()
	@IsOptional()
	@IsString()
	search?: string
}

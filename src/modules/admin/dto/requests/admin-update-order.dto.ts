import { OrderStatus } from '@generated/enums'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

export class AdminUpdateOrderDto {
	@ApiPropertyOptional({ enum: OrderStatus })
	@IsOptional()
	@IsEnum(OrderStatus)
	status?: OrderStatus

	@ApiPropertyOptional({ example: 'Клиент подтвердил оплату' })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	commentByAdmin?: string | null
}

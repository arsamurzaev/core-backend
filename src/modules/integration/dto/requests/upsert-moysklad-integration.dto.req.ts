import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

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

	@ApiPropertyOptional({ type: Boolean, example: false })
	@IsOptional()
	@IsBoolean()
	scheduleEnabled?: boolean

	@ApiPropertyOptional({ type: String, example: '0 */6 * * *' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	schedulePattern?: string | null

	@ApiPropertyOptional({ type: String, example: 'Europe/Moscow' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	scheduleTimezone?: string | null
}

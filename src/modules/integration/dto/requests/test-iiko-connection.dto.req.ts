import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'

export class TestIikoConnectionDtoReq {
	@ApiPropertyOptional({ type: String, example: 'demo-api-login' })
	@IsOptional()
	@IsString()
	@MaxLength(500)
	apiLogin?: string
}

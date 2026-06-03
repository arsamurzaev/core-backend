import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, MaxLength } from 'class-validator'

export class TestIikoConnectionDtoReq {
	@ApiPropertyOptional({ type: String, example: 'demo-api-login' })
	@IsOptional()
	@IsString()
	@MaxLength(500)
	apiLogin?: string

	@ApiPropertyOptional({ type: String, example: '15' })
	@IsOptional()
	@IsString()
	@MaxLength(100)
	appId?: string

	@ApiPropertyOptional({ type: String, example: 'sk_live_abc123def456' })
	@IsOptional()
	@IsString()
	@MaxLength(1000)
	clientSecret?: string
}

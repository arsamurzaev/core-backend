import { IsOptional, IsString, MaxLength } from 'class-validator'

export class IntegrationValidator {
	@IsOptional()
	@IsString()
	@MaxLength(500)
	INTEGRATION_WEBHOOK_BASE_URL?: string

	@IsOptional()
	@IsString()
	@MaxLength(500)
	MOYSKLAD_WEBHOOK_BASE_URL?: string

	@IsOptional()
	@IsString()
	@MaxLength(500)
	IIKO_WEBHOOK_BASE_URL?: string

	@IsOptional()
	@IsString()
	@MaxLength(500)
	IIKO_API_BASE_URL?: string

	@IsOptional()
	@IsString()
	@MaxLength(100)
	IIKO_APP_ID?: string

	@IsOptional()
	@IsString()
	@MaxLength(1000)
	IIKO_CLIENT_SECRET?: string
}

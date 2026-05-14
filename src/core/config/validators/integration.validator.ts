import { IsOptional, IsString, MaxLength } from 'class-validator'

export class IntegrationValidator {
	@IsOptional()
	@IsString()
	@MaxLength(500)
	MOYSKLAD_WEBHOOK_BASE_URL?: string
}

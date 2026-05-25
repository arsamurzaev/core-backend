import { IsOptional, IsString } from 'class-validator'

export class IntegrationCryptoValidator {
	@IsString()
	INTEGRATION_ENCRYPTION_KEY: string

	@IsString()
	INTEGRATION_ENCRYPTION_KEY_VERSION: string

	@IsOptional()
	@IsString()
	INTEGRATION_PAYLOAD_PRIVATE_KEY?: string

	@IsOptional()
	@IsString()
	INTEGRATION_PAYLOAD_PUBLIC_KEY?: string

	@IsOptional()
	@IsString()
	INTEGRATION_PAYLOAD_KEY_ID?: string
}

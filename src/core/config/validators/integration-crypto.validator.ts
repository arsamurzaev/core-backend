import { IsString } from 'class-validator'

export class IntegrationCryptoValidator {
	@IsString()
	INTEGRATION_ENCRYPTION_KEY: string

	@IsString()
	INTEGRATION_ENCRYPTION_KEY_VERSION: string
}

import { registerAs } from '@nestjs/config'

import { validateEnv } from '@/shared/utils'

import { IntegrationCryptoInterface } from '../interfaces/integration-crypto.interface'
import { IntegrationCryptoValidator } from '../validators'

export const integrationCryptoEnv = registerAs<IntegrationCryptoInterface>(
	'integrationCrypto',
	() => {
		validateEnv(process.env, IntegrationCryptoValidator)

		return {
			encryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY,
			keyVersion: process.env.INTEGRATION_ENCRYPTION_KEY_VERSION || 'v1'
		}
	}
)

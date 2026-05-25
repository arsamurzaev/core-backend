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
			keyVersion: process.env.INTEGRATION_ENCRYPTION_KEY_VERSION || 'v1',
			payloadPrivateKey:
				process.env.INTEGRATION_PAYLOAD_PRIVATE_KEY?.trim() || null,
			payloadPublicKey: process.env.INTEGRATION_PAYLOAD_PUBLIC_KEY?.trim() || null,
			payloadKeyId: process.env.INTEGRATION_PAYLOAD_KEY_ID?.trim() || 'v1'
		}
	}
)

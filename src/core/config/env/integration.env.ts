import { registerAs } from '@nestjs/config'

import { validateEnv } from '@/shared/utils'

import { IntegrationInterface } from '../interfaces/integration.interface'
import { IntegrationValidator } from '../validators'

export const integrationEnv = registerAs<IntegrationInterface>(
	'integration',
	() => {
		validateEnv(process.env, IntegrationValidator)

		const moySkladWebhookBaseUrl =
			process.env.MOYSKLAD_WEBHOOK_BASE_URL?.trim() || null

		return {
			moySkladWebhookBaseUrl
		}
	}
)

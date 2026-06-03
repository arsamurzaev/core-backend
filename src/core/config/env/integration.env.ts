import { registerAs } from '@nestjs/config'

import { validateEnv } from '@/shared/utils'

import { IntegrationInterface } from '../interfaces/integration.interface'
import { IntegrationValidator } from '../validators'

export const integrationEnv = registerAs<IntegrationInterface>(
	'integration',
	() => {
		validateEnv(process.env, IntegrationValidator)

		const integrationWebhookBaseUrl =
			process.env.INTEGRATION_WEBHOOK_BASE_URL?.trim() || null
		const moySkladWebhookBaseUrl =
			process.env.MOYSKLAD_WEBHOOK_BASE_URL?.trim() || integrationWebhookBaseUrl
		const iikoWebhookBaseUrl =
			process.env.IIKO_WEBHOOK_BASE_URL?.trim() ||
			integrationWebhookBaseUrl ||
			process.env.MOYSKLAD_WEBHOOK_BASE_URL?.trim() ||
			null
		const iikoApiBaseUrl =
			process.env.IIKO_API_BASE_URL?.trim() || 'https://api-ru.iiko.services'
		const iikoAppId = process.env.IIKO_APP_ID?.trim() || null
		const iikoClientSecret = process.env.IIKO_CLIENT_SECRET?.trim() || null

		return {
			integrationWebhookBaseUrl,
			moySkladWebhookBaseUrl,
			iikoWebhookBaseUrl,
			iikoApiBaseUrl,
			iikoAppId,
			iikoClientSecret
		}
	}
)

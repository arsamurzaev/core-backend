import { BadRequestException, Logger } from '@nestjs/common'

import {
	redactProviderSecrets,
	toSafeProviderError
} from '../../provider-error-redaction'

import type {
	IikoAccessTokenResponse,
	IikoCommandStatusResponse,
	IikoCreateDeliveryOrderPayload,
	IikoCreateDeliveryOrderResponse,
	IikoCreateReservePayload,
	IikoCreateReserveResponse,
	IikoCreateTableOrderPayload,
	IikoCreateTableOrderResponse,
	IikoExternalMenuRequest,
	IikoExternalMenuResponse,
	IikoMenusResponse,
	IikoNomenclatureResponse,
	IikoOrganizationsResponse,
	IikoOrganizationsSettingsRequest,
	IikoOrganizationsSettingsResponse,
	IikoRestaurantSectionsRequest,
	IikoRestaurantSectionsResponse,
	IikoStopListsRequest,
	IikoStopListsResponse,
	IikoTerminalGroupsIsAliveRequest,
	IikoTerminalGroupsIsAliveResponse,
	IikoTerminalGroupsResponse,
	IikoUpdateWebhookSettingsRequest,
	IikoUpdateWebhookSettingsResponse,
	IikoWebhookSettingsResponse
} from './iiko.types'

const DEFAULT_API_BASE_URL = 'https://api-ru.iiko.services'
const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_TOKEN_TTL_MS = 20 * 60 * 1000

type IikoClientConfig = {
	apiLogin: string
	appId?: string | null
	clientSecret?: string | null
	baseUrl?: string | null
	timeoutMs?: number
	tokenTtlMs?: number
}

type IikoTokenCache = {
	token: string
	expiresAt: number
} | null

class IikoHttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly retryable: boolean
	) {
		super(message)
		this.name = 'IikoHttpError'
	}
}

export class IikoClient {
	private readonly logger = new Logger(IikoClient.name)
	private readonly apiLogin: string
	private readonly appId: string | null
	private readonly clientSecret: string | null
	private readonly baseUrl: string
	private readonly timeoutMs: number
	private readonly tokenTtlMs: number
	private tokenCache: IikoTokenCache = null

	constructor(config: IikoClientConfig) {
		const apiLogin = config.apiLogin.trim()
		if (!apiLogin) {
			throw new Error('iiko apiLogin is required')
		}

		this.apiLogin = apiLogin
		this.appId = normalizeOptionalString(config.appId)
		this.clientSecret = normalizeOptionalString(config.clientSecret)
		this.baseUrl = normalizeBaseUrl(config.baseUrl)
		this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
		this.tokenTtlMs = config.tokenTtlMs ?? DEFAULT_TOKEN_TTL_MS
	}

	async getAccessToken(apiLogin = this.apiLogin): Promise<string> {
		const normalizedApiLogin = apiLogin.trim()
		if (!normalizedApiLogin) {
			throw new Error('iiko apiLogin is required')
		}

		if (
			normalizedApiLogin === this.apiLogin &&
			this.tokenCache &&
			this.tokenCache.expiresAt > Date.now()
		) {
			return this.tokenCache.token
		}

		const tokenRequest = this.buildAccessTokenRequest(normalizedApiLogin)
		let response: IikoAccessTokenResponse
		try {
			response = await this.requestWithoutAuth<IikoAccessTokenResponse>(
				tokenRequest.endpoint,
				tokenRequest.body,
				[normalizedApiLogin, this.appId, this.clientSecret]
			)
		} catch (error) {
			if (
				tokenRequest.endpoint === '/api/1/access_token' &&
				error instanceof IikoHttpError &&
				isLegacyAccessTokenUnsupportedError(error.message)
			) {
				throw new BadRequestException(
					'iiko appId and clientSecret are required for this API key. Add iiko Developer Portal credentials and try again.'
				)
			}
			throw error
		}
		const token = typeof response.token === 'string' ? response.token.trim() : ''
		if (!token) {
			throw new Error('iiko access_token response did not include token')
		}

		if (normalizedApiLogin === this.apiLogin) {
			this.tokenCache = {
				token,
				expiresAt: Date.now() + this.tokenTtlMs
			}
		}

		return token
	}

	private buildAccessTokenRequest(apiLogin: string): {
		endpoint: string
		body: Record<string, string>
	} {
		if (this.appId || this.clientSecret) {
			if (!this.appId) {
				throw new BadRequestException(
					'iiko appId is required when clientSecret is configured'
				)
			}
			if (!this.clientSecret) {
				throw new BadRequestException(
					'iiko clientSecret is required when appId is configured'
				)
			}

			return {
				endpoint: '/api/v2/access_token',
				body: {
					apiKey: apiLogin,
					appId: this.appId,
					clientSecret: this.clientSecret
				}
			}
		}

		return {
			endpoint: '/api/1/access_token',
			body: { apiLogin }
		}
	}

	async getOrganizations(): Promise<IikoOrganizationsResponse> {
		return this.request<IikoOrganizationsResponse>('/api/1/organizations', {
			returnAdditionalInfo: true,
			includeDisabled: false
		})
	}

	async getOrganizationSettings(
		request: IikoOrganizationsSettingsRequest
	): Promise<IikoOrganizationsSettingsResponse> {
		return this.request<IikoOrganizationsSettingsResponse>(
			'/api/1/organizations/settings',
			{
				organizationIds: request.organizationIds ?? null,
				includeDisabled: request.includeDisabled ?? false,
				parameters: request.parameters ?? [
					'AddressFormatType',
					'RestaurantAddress'
				],
				returnExternalData: null
			}
		)
	}

	async getMenus(): Promise<IikoMenusResponse> {
		return this.request<IikoMenusResponse>('/api/2/menu', {})
	}

	async getTerminalGroups(
		organizationIds: string[],
		options: { includeDisabled?: boolean } = {}
	): Promise<IikoTerminalGroupsResponse> {
		return this.request<IikoTerminalGroupsResponse>('/api/1/terminal_groups', {
			organizationIds,
			includeDisabled: options.includeDisabled ?? true
		})
	}

	async getTerminalGroupsIsAlive(
		request: IikoTerminalGroupsIsAliveRequest
	): Promise<IikoTerminalGroupsIsAliveResponse> {
		return this.request<IikoTerminalGroupsIsAliveResponse>(
			'/api/1/terminal_groups/is_alive',
			{
				organizationIds: request.organizationIds,
				terminalGroupIds: request.terminalGroupIds
			}
		)
	}

	async getStopLists(
		request: IikoStopListsRequest
	): Promise<IikoStopListsResponse> {
		const terminalGroupIds = Array.isArray(request.terminalGroupIds)
			? request.terminalGroupIds.filter(Boolean)
			: []

		return this.request<IikoStopListsResponse>('/api/1/stop_lists', {
			organizationIds: request.organizationIds,
			returnSize: request.returnSize ?? true,
			...(terminalGroupIds.length > 0
				? { terminalGroupsIds: terminalGroupIds }
				: {})
		})
	}

	async getRestaurantSections(
		request: IikoRestaurantSectionsRequest
	): Promise<IikoRestaurantSectionsResponse> {
		return this.request<IikoRestaurantSectionsResponse>(
			'/api/1/reserve/available_restaurant_sections',
			{
				terminalGroupIds: request.terminalGroupIds,
				returnSchema: request.returnSchema ?? false,
				revision: request.revision ?? null
			}
		)
	}

	async getExternalMenuById(
		request: IikoExternalMenuRequest
	): Promise<IikoExternalMenuResponse> {
		return this.request<IikoExternalMenuResponse>('/api/2/menu/by_id', {
			externalMenuId: request.externalMenuId,
			organizationIds: request.organizationIds,
			priceCategoryId: request.priceCategoryId ?? null,
			version: request.version ?? null,
			language: request.language ?? null,
			startRevision: request.startRevision ?? null
		})
	}

	async getNomenclature(
		organizationId: string,
		startRevision = 0
	): Promise<IikoNomenclatureResponse> {
		return this.request<IikoNomenclatureResponse>('/api/1/nomenclature', {
			organizationId,
			startRevision
		})
	}

	async createDeliveryOrder(
		payload: IikoCreateDeliveryOrderPayload
	): Promise<IikoCreateDeliveryOrderResponse> {
		return this.request<IikoCreateDeliveryOrderResponse>(
			'/api/1/deliveries/create',
			payload
		)
	}

	async createReserve(
		payload: IikoCreateReservePayload
	): Promise<IikoCreateReserveResponse> {
		return this.request<IikoCreateReserveResponse>(
			'/api/1/reserve/create',
			payload
		)
	}

	async createTableOrder(
		payload: IikoCreateTableOrderPayload
	): Promise<IikoCreateTableOrderResponse> {
		return this.request<IikoCreateTableOrderResponse>(
			'/api/1/order/create',
			payload
		)
	}

	async getCommandStatus(params: {
		organizationId: string
		correlationId: string
	}): Promise<IikoCommandStatusResponse> {
		return this.request<IikoCommandStatusResponse>('/api/1/commands/status', {
			organizationId: params.organizationId,
			correlationId: params.correlationId
		})
	}

	async getWebhookSettings(
		organizationId: string
	): Promise<IikoWebhookSettingsResponse> {
		return this.request<IikoWebhookSettingsResponse>('/api/1/webhooks/settings', {
			organizationId
		})
	}

	async updateWebhookSettings(
		request: IikoUpdateWebhookSettingsRequest
	): Promise<IikoUpdateWebhookSettingsResponse> {
		return this.request<IikoUpdateWebhookSettingsResponse>(
			'/api/1/webhooks/update_settings',
			request
		)
	}

	async downloadImage(
		imageUrl: string
	): Promise<{ buffer: Buffer; contentType: string | null } | null> {
		const url = imageUrl.trim()
		if (!url) return null

		const token = await this.getAccessToken()
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

		try {
			const response = await fetch(url, {
				headers: { Authorization: `Bearer ${token}` },
				signal: controller.signal
			})
			if (!response.ok) {
				throw new IikoHttpError(
					`iiko image download error ${response.status}: ${response.statusText}`,
					response.status,
					this.isRetryableStatus(response.status)
				)
			}

			const arrayBuffer = await response.arrayBuffer()
			return {
				buffer: Buffer.from(arrayBuffer),
				contentType: response.headers.get('content-type')
			}
		} catch (error) {
			throw toSafeProviderError(error, [this.apiLogin, token])
		} finally {
			clearTimeout(timeout)
		}
	}

	private async request<T>(
		endpoint: string,
		body: unknown,
		hasRetriedAfterAuth = false
	): Promise<T> {
		const token = await this.getAccessToken()

		try {
			return await this.requestJson<T>(endpoint, body, token, [
				this.apiLogin,
				token
			])
		} catch (error) {
			if (
				error instanceof IikoHttpError &&
				error.status === 401 &&
				!hasRetriedAfterAuth
			) {
				this.logger.warn('iiko token expired, refreshing access token')
				this.tokenCache = null
				return this.request<T>(endpoint, body, true)
			}

			throw toSafeProviderError(error, [this.apiLogin, token])
		}
	}

	private requestWithoutAuth<T>(
		endpoint: string,
		body: unknown,
		knownSecrets: Array<string | null | undefined>
	): Promise<T> {
		return this.requestJson<T>(endpoint, body, null, knownSecrets)
	}

	private async requestJson<T>(
		endpoint: string,
		body: unknown,
		token: string | null,
		knownSecrets: Array<string | null | undefined>
	): Promise<T> {
		const url = `${this.baseUrl}${endpoint}`
		let lastError: unknown = null

		for (let attempt = 0; attempt < 3; attempt += 1) {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

			try {
				const response = await fetch(url, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						...(token ? { Authorization: `Bearer ${token}` } : {})
					},
					body: JSON.stringify(body ?? {}),
					signal: controller.signal
				})

				if (!response.ok) {
					const errorBody = await response.text()
					throw new IikoHttpError(
						`iiko API error ${response.status}: ${this.formatErrorBody(errorBody, response.statusText, knownSecrets)}`,
						response.status,
						this.isRetryableStatus(response.status)
					)
				}

				const text = await response.text()
				return (text ? JSON.parse(text) : undefined) as T
			} catch (error) {
				lastError = error
				if (
					error instanceof IikoHttpError &&
					(!error.retryable || error.status === 401)
				) {
					throw error
				}
				if (attempt === 2) {
					throw toSafeProviderError(error, knownSecrets)
				}
				await sleep(500 * (attempt + 1))
			} finally {
				clearTimeout(timeout)
			}
		}

		throw toSafeProviderError(lastError, knownSecrets)
	}

	private formatErrorBody(
		body: string,
		statusText: string,
		knownSecrets: Array<string | null | undefined>
	): string {
		const fallback = body.trim() || statusText
		if (!body.trim()) return redactProviderSecrets(fallback, knownSecrets)

		try {
			const parsed = JSON.parse(body) as unknown
			return redactProviderSecrets(JSON.stringify(parsed), knownSecrets)
		} catch {
			return redactProviderSecrets(fallback, knownSecrets)
		}
	}

	private isRetryableStatus(status: number): boolean {
		return status === 429 || status >= 500
	}
}

function normalizeBaseUrl(value?: string | null): string {
	const normalized = value?.trim() || DEFAULT_API_BASE_URL
	return normalized.replace(/\/+$/g, '')
}

function normalizeOptionalString(value?: string | null): string | null {
	const normalized = value?.trim() ?? ''
	return normalized || null
}

function isLegacyAccessTokenUnsupportedError(message: string): boolean {
	return (
		/does not support\s+\/api\/1\/access_token/i.test(message) &&
		/use\s+\/api\/v2\/access_token/i.test(message)
	)
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}

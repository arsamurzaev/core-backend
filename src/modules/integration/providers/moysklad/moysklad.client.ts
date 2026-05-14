import { Logger } from '@nestjs/common'

import {
	redactProviderSecrets,
	toSafeProviderError
} from '../../provider-error-redaction'

import {
	type MoySkladCounterparty,
	type MoySkladCreateCustomerOrderPayload,
	type MoySkladCustomerOrder,
	type MoySkladEntityType,
	type MoySkladImage,
	type MoySkladListResponse,
	type MoySkladMetaRef,
	type MoySkladNamedEntity,
	type MoySkladOrganization,
	type MoySkladProduct,
	type MoySkladProductFolder,
	type MoySkladProductFolderRef,
	type MoySkladStockReportFilters,
	type MoySkladStockResponse,
	type MoySkladStore,
	type MoySkladVariant,
	type MoySkladWebhookStock,
	type MoySkladWebhookStockPayload
} from './moysklad.types'

const API_BASE = 'https://api.moysklad.ru/api/remap/1.2'
const API_HOST = 'api.moysklad.ru'
const STOCK_REPORT_PATH_PREFIX = '/api/remap/1.2/report/stock/'
const DEFAULT_TIMEOUT_MS = 30000
const LIST_LIMIT_WITH_EXPAND = 100
const DEFAULT_MAX_REQUESTS_PER_WINDOW = 22
const STOCK_REPORT_REQUEST_WEIGHT = 5
const DEFAULT_REQUEST_WEIGHT = 1

class MoySkladHttpError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly retryable: boolean
	) {
		super(message)
		this.name = 'MoySkladHttpError'
	}
}

function padDatePart(value: number): string {
	return value.toString().padStart(2, '0')
}

function formatMoySkladFilterDate(value: Date): string {
	return [
		value.getFullYear(),
		padDatePart(value.getMonth() + 1),
		padDatePart(value.getDate())
	]
		.join('-')
		.concat(
			` ${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}:${padDatePart(value.getSeconds())}`
		)
}

function withQueryParam(url: string, key: string, value: string): string {
	const separator = url.includes('?') ? '&' : '?'
	return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

function buildEntityExpand(): string {
	return 'images,salePrices,productFolder'
}

function buildVariantExpand(): string {
	return 'images,salePrices,product'
}

function normalizeFilterIds(value?: string | string[]): string[] {
	const values = Array.isArray(value) ? value : value ? [value] : []
	return values.map(item => item.trim()).filter(Boolean)
}

function normalizeStoreFilterIds(
	filters?: MoySkladStockReportFilters
): string[] {
	return Array.from(
		new Set([
			...normalizeFilterIds(filters?.storeId),
			...normalizeFilterIds(filters?.warehouseId)
		])
	)
}

function hasStockReportFilters(filters?: MoySkladStockReportFilters): boolean {
	return (
		normalizeFilterIds(filters?.assortmentId).length > 0 ||
		normalizeStoreFilterIds(filters).length > 0
	)
}

function buildCurrentStockFilter(filters: MoySkladStockReportFilters): string {
	const parts: string[] = []
	const assortmentIds = normalizeFilterIds(filters.assortmentId)
	const storeIds = normalizeStoreFilterIds(filters)

	if (assortmentIds.length > 0) {
		parts.push(`assortmentId=${assortmentIds.join(',')}`)
	}

	if (storeIds.length > 0) {
		parts.push(`storeId=${storeIds.join(',')}`)
	}

	return parts.join(';')
}

function buildCurrentStockEndpoint(
	filters: MoySkladStockReportFilters
): string {
	const storeIds = normalizeStoreFilterIds(filters)
	const endpoint =
		storeIds.length > 0
			? '/report/stock/bystore/current'
			: '/report/stock/all/current'
	const filter = buildCurrentStockFilter(filters)

	return filter ? withQueryParam(endpoint, 'filter', filter) : endpoint
}

function readMoySkladString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : ''
}

export function normalizeMoySkladStockReportUrl(value: string): string {
	const normalized = readMoySkladString(value)
	if (!normalized) {
		throw new Error('MoySklad stock reportUrl is required')
	}

	let url: URL
	try {
		url = new URL(normalized)
	} catch {
		throw new Error('Invalid MoySklad stock reportUrl')
	}

	if (
		url.protocol !== 'https:' ||
		url.hostname !== API_HOST ||
		!url.pathname.startsWith(STOCK_REPORT_PATH_PREFIX)
	) {
		throw new Error('MoySklad stock reportUrl host or path is not allowed')
	}

	return url.toString()
}

function extractMoySkladEntityIdFromHref(
	href: unknown,
	entityType: string
): string {
	const normalized = readMoySkladString(href)
	if (!normalized) return ''

	const escapedType = entityType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const match = normalized.match(
		new RegExp(`/entity/${escapedType}/([^/?#]+)`, 'i')
	)
	return match?.[1] ? decodeURIComponent(match[1]) : ''
}

function resolveVariantParentProductId(variant: MoySkladVariant): string {
	return (
		readMoySkladString(variant.product?.id) ||
		extractMoySkladEntityIdFromHref(variant.product?.meta?.href, 'product')
	)
}

function isFallbackableVariantProductFilterError(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	return /MoySklad API error (400|412):/i.test(error.message)
}

function renderErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : 'Unknown error'
}

function readProviderErrorPart(value: unknown): string {
	return typeof value === 'string' ? value.trim() : ''
}

function formatMoySkladErrorBody(body: string, statusText: string): string {
	const fallback = body.trim() || statusText
	if (!body.trim()) return fallback

	try {
		const parsed = JSON.parse(body) as unknown
		if (
			typeof parsed !== 'object' ||
			parsed === null ||
			!Array.isArray((parsed as { errors?: unknown }).errors)
		) {
			return fallback
		}

		const errors = ((parsed as { errors: unknown[] }).errors ?? [])
			.slice(0, 5)
			.map(item => {
				if (typeof item !== 'object' || item === null) return ''

				const record = item as Record<string, unknown>
				const message =
					readProviderErrorPart(record.error) ||
					readProviderErrorPart(record.error_message) ||
					readProviderErrorPart(record.message)
				const details = [
					readProviderErrorPart(record.code)
						? `code=${readProviderErrorPart(record.code)}`
						: '',
					readProviderErrorPart(record.parameter)
						? `parameter=${readProviderErrorPart(record.parameter)}`
						: ''
				].filter(Boolean)

				return [message, details.length ? `(${details.join(', ')})` : '']
					.filter(Boolean)
					.join(' ')
			})
			.filter(Boolean)

		return errors.length ? errors.join('; ') : fallback
	} catch {
		return fallback
	}
}

export function buildMoySkladMetaRef(
	entityType: string,
	entityId: string
): MoySkladMetaRef {
	return {
		meta: {
			href: `${API_BASE}/entity/${entityType}/${encodeURIComponent(entityId)}`,
			type: entityType,
			mediaType: 'application/json'
		}
	}
}

type MoySkladClientConfig = {
	token: string
	maxRetries?: number
	retryDelayMs?: number
	timeoutMs?: number
}

type MoySkladCurrentStockRow = {
	assortmentId: string
	storeId?: string | null
	stock?: number | null
}

export class MoySkladClient {
	private readonly logger = new Logger(MoySkladClient.name)
	private readonly token: string
	private readonly maxRetries: number
	private readonly retryDelayMs: number
	private readonly timeoutMs: number
	private readonly productFolderCache = new Map<
		string,
		Promise<MoySkladProductFolder | null>
	>()
	private requestCount = 0
	private requestWindowStart = Date.now()
	private readonly maxRequestsPerWindow = DEFAULT_MAX_REQUESTS_PER_WINDOW
	private readonly windowMs = 3000

	constructor(config: MoySkladClientConfig) {
		this.token = config.token
		this.maxRetries = config.maxRetries ?? 3
		this.retryDelayMs = config.retryDelayMs ?? 1000
		this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
	}

	async ping(): Promise<void> {
		await this.request<MoySkladListResponse<{ id: string }>>(
			'/entity/assortment?limit=1'
		)
	}

	async getAllOrganizations(): Promise<MoySkladOrganization[]> {
		return this.getAllNamedEntities<MoySkladOrganization>('/entity/organization')
	}

	async getAllCounterparties(): Promise<MoySkladCounterparty[]> {
		return this.getAllNamedEntities<MoySkladCounterparty>('/entity/counterparty')
	}

	async getAllStores(): Promise<MoySkladStore[]> {
		return this.getAllNamedEntities<MoySkladStore>('/entity/store')
	}

	async getAllAssortment(updatedFrom?: Date): Promise<MoySkladProduct[]> {
		const items: MoySkladProduct[] = []
		let offset = 0
		const limit = LIST_LIMIT_WITH_EXPAND
		const filter = updatedFrom
			? `&filter=${encodeURIComponent(`updated>${formatMoySkladFilterDate(updatedFrom)}`)}`
			: ''

		while (true) {
			const response = await this.request<MoySkladListResponse<MoySkladProduct>>(
				`/entity/assortment?limit=${limit}&offset=${offset}&expand=${buildEntityExpand()}${filter}`
			)
			const rows = this.readListRows(response, '/entity/assortment')
			items.push(...rows)
			if (rows.length < limit) break
			offset += limit
			await this.sleep(200)
		}

		return items
	}

	async getAllProducts(updatedFrom?: Date): Promise<MoySkladProduct[]> {
		const items: MoySkladProduct[] = []
		let offset = 0
		const limit = LIST_LIMIT_WITH_EXPAND
		const filter = updatedFrom
			? `&filter=${encodeURIComponent(`updated>${formatMoySkladFilterDate(updatedFrom)}`)}`
			: ''

		while (true) {
			const response = await this.request<MoySkladListResponse<MoySkladProduct>>(
				`/entity/product?limit=${limit}&offset=${offset}&expand=${buildEntityExpand()}${filter}`
			)
			const rows = this.readListRows(response, '/entity/product')
			items.push(...rows)
			if (rows.length < limit) break
			offset += limit
			await this.sleep(200)
		}

		return items
	}

	async getAllVariants(updatedFrom?: Date): Promise<MoySkladVariant[]> {
		const filter = updatedFrom
			? `updated>${formatMoySkladFilterDate(updatedFrom)}`
			: undefined

		return this.getVariantList(filter)
	}

	async getVariantsByProduct(productId: string): Promise<MoySkladVariant[]> {
		const normalizedProductId = productId.trim()
		if (!normalizedProductId) {
			return []
		}

		const productHref = `${API_BASE}/entity/product/${encodeURIComponent(normalizedProductId)}`
		try {
			return await this.getVariantList(`product=${productHref}`)
		} catch (error) {
			if (!isFallbackableVariantProductFilterError(error)) {
				throw error
			}

			this.logger.warn(
				`MoySklad variant product filter failed, falling back to local filtering for product ${normalizedProductId}: ${renderErrorMessage(error)}`
			)
			const variants = await this.getAllVariants()
			return variants.filter(
				variant => resolveVariantParentProductId(variant) === normalizedProductId
			)
		}
	}

	private async getVariantList(filter?: string): Promise<MoySkladVariant[]> {
		const items: MoySkladVariant[] = []
		let offset = 0
		const limit = LIST_LIMIT_WITH_EXPAND
		const filterQuery = filter ? `&filter=${encodeURIComponent(filter)}` : ''

		while (true) {
			const response = await this.request<MoySkladListResponse<MoySkladVariant>>(
				`/entity/variant?limit=${limit}&offset=${offset}&expand=${buildVariantExpand()}${filterQuery}`
			)
			const rows = this.readListRows(response, '/entity/variant')
			items.push(...rows)
			if (rows.length < limit) break
			offset += limit
			await this.sleep(200)
		}

		return items
	}

	async getProduct(productId: string): Promise<MoySkladProduct> {
		return this.request<MoySkladProduct>(
			`/entity/product/${productId}?expand=${buildEntityExpand()}`
		)
	}

	async getVariant(variantId: string): Promise<MoySkladVariant> {
		return this.request<MoySkladVariant>(
			`/entity/variant/${variantId}?expand=${buildVariantExpand()}`
		)
	}

	async getAssortmentItemById(itemId: string): Promise<MoySkladProduct> {
		const response = await this.request<MoySkladListResponse<MoySkladProduct>>(
			`/entity/assortment?limit=1&filter=${encodeURIComponent(`id=${itemId}`)}&expand=${buildEntityExpand()}`
		)
		const item = response.rows?.[0]
		if (!item) {
			throw new Error(
				`Позиция ассортимента MoySklad с идентификатором ${itemId} не найдена`
			)
		}
		return item
	}

	async getAssortmentItemByExternalCode(
		externalCode: string
	): Promise<MoySkladProduct> {
		const response = await this.request<MoySkladListResponse<MoySkladProduct>>(
			`/entity/assortment?limit=1&filter=${encodeURIComponent(`externalCode=${externalCode}`)}&expand=${buildEntityExpand()}`
		)
		const item = response.rows?.[0]
		if (!item) {
			throw new Error(
				`РџРѕР·РёС†РёСЏ Р°СЃСЃРѕСЂС‚РёРјРµРЅС‚Р° MoySklad СЃ РІРЅРµС€РЅРёРј РєРѕРґРѕРј ${externalCode} РЅРµ РЅР°Р№РґРµРЅР°`
			)
		}
		return item
	}

	async getEntity(
		entityType: Exclude<MoySkladEntityType, 'variant'>,
		entityId: string
	): Promise<MoySkladProduct> {
		return this.request<MoySkladProduct>(
			`/entity/${entityType}/${entityId}?expand=${buildEntityExpand()}`
		)
	}

	async getProductFolder(
		folder: MoySkladProductFolderRef
	): Promise<MoySkladProductFolder | null> {
		const href = folder.meta.href?.trim()
		const folderId = folder.id?.trim()
		const cacheKey = href || folderId
		if (!cacheKey) return null

		const cached = this.productFolderCache.get(cacheKey)
		if (cached !== undefined) {
			return cached
		}

		const request = (async () => {
			const endpoint = href
				? withQueryParam(href, 'expand', 'productFolder')
				: `/entity/productfolder/${folderId}?expand=productFolder`
			return this.request<MoySkladProductFolder>(endpoint)
		})()

		this.productFolderCache.set(cacheKey, request)

		try {
			return await request
		} catch (error) {
			this.productFolderCache.delete(cacheKey)
			throw error
		}
	}

	async getProductFolderChain(
		folder: MoySkladProductFolderRef
	): Promise<MoySkladProductFolder[]> {
		const chain: MoySkladProductFolder[] = []
		const visited = new Set<string>()
		let current: MoySkladProductFolderRef | undefined = folder

		while (current) {
			const resolved = await this.getProductFolder(current)
			if (!resolved) break

			const key = resolved.id?.trim() || resolved.meta.href?.trim()
			if (!key || visited.has(key)) {
				break
			}

			visited.add(key)
			chain.push(resolved)
			current = resolved.productFolder
		}

		return chain.reverse()
	}

	async getProductImages(productId: string): Promise<string[]> {
		const response = await this.request<MoySkladListResponse<MoySkladImage>>(
			`/entity/product/${productId}/images`
		)

		return (response.rows ?? [])
			.map(
				image => image.meta.downloadHref ?? image.miniature?.downloadHref ?? null
			)
			.filter((item): item is string => Boolean(item))
	}

	async getEntityImages(
		entityType: Exclude<MoySkladEntityType, 'variant'>,
		entityId: string
	): Promise<string[]> {
		const response = await this.request<MoySkladListResponse<MoySkladImage>>(
			`/entity/${entityType}/${entityId}/images`
		)

		return (response.rows ?? [])
			.map(
				image => image.meta.downloadHref ?? image.miniature?.downloadHref ?? null
			)
			.filter((item): item is string => Boolean(item))
	}

	async findCustomerOrderByExternalCode(
		externalCode: string
	): Promise<MoySkladCustomerOrder | null> {
		const response = await this.request<
			MoySkladListResponse<MoySkladCustomerOrder>
		>(
			`/entity/customerorder?limit=1&filter=${encodeURIComponent(`externalCode=${externalCode}`)}`
		)

		return response.rows?.[0] ?? null
	}

	async createCustomerOrder(
		payload: MoySkladCreateCustomerOrderPayload
	): Promise<MoySkladCustomerOrder> {
		return this.request<MoySkladCustomerOrder>('/entity/customerorder', {
			method: 'POST',
			body: JSON.stringify(payload)
		})
	}

	async getWebhookStocks(): Promise<MoySkladWebhookStock[]> {
		const response =
			await this.request<MoySkladListResponse<MoySkladWebhookStock>>(
				'/entity/webhookstock'
			)
		return this.readListRows(response, '/entity/webhookstock')
	}

	async createWebhookStock(
		payload: Required<MoySkladWebhookStockPayload>
	): Promise<MoySkladWebhookStock> {
		return this.request<MoySkladWebhookStock>('/entity/webhookstock', {
			method: 'POST',
			body: JSON.stringify(payload)
		})
	}

	async updateWebhookStock(
		webhookId: string,
		payload: MoySkladWebhookStockPayload
	): Promise<MoySkladWebhookStock> {
		return this.request<MoySkladWebhookStock>(
			`/entity/webhookstock/${encodeURIComponent(webhookId)}`,
			{
				method: 'PUT',
				body: JSON.stringify(payload)
			}
		)
	}

	async disableWebhookStock(webhookId: string): Promise<MoySkladWebhookStock> {
		return this.updateWebhookStock(webhookId, { enabled: false })
	}

	async deleteWebhookStock(webhookId: string): Promise<void> {
		await this.request<void>(
			`/entity/webhookstock/${encodeURIComponent(webhookId)}`,
			{
				method: 'DELETE'
			}
		)
	}

	async downloadImage(
		downloadHref: string
	): Promise<{ buffer: Buffer; contentType: string } | null> {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

		try {
			const response = await fetch(downloadHref, {
				headers: {
					Authorization: `Bearer ${this.token}`
				},
				redirect: 'follow',
				signal: controller.signal
			})

			if (!response.ok) {
				this.logger.warn(
					`Не удалось скачать изображение MoySklad: ${response.status}`
				)
				return null
			}

			const contentType = response.headers.get('content-type') || 'image/jpeg'
			const arrayBuffer = await response.arrayBuffer()

			return {
				buffer: Buffer.from(arrayBuffer),
				contentType
			}
		} finally {
			clearTimeout(timeout)
		}
	}

	async getStockAll(
		filters: MoySkladStockReportFilters = {}
	): Promise<Map<string, number>> {
		if (hasStockReportFilters(filters)) {
			return this.getCurrentStockAll(filters)
		}

		const stockMap = new Map<string, number>()
		let offset = 0
		const limit = 1000

		while (true) {
			const response = await this.request<MoySkladStockResponse>(
				`/report/stock/all?limit=${limit}&offset=${offset}`
			)
			const rows = this.readListRows(response, '/report/stock/all')

			for (const item of rows) {
				const match = item.meta.href.match(/\/(?:product|variant)\/([a-f0-9-]+)/i)
				if (
					match &&
					(item.meta.type === 'product' || item.meta.type === 'variant')
				) {
					stockMap.set(match[1], item.stock ?? 0)
				}
			}

			if (rows.length < limit) break
			offset += limit
			await this.sleep(200)
		}

		return stockMap
	}

	async getStockFromReportUrl(reportUrl: string): Promise<Map<string, number>> {
		const response = await this.request<MoySkladCurrentStockRow[]>(
			normalizeMoySkladStockReportUrl(reportUrl)
		)
		return this.mapCurrentStockRows(response)
	}

	private async getCurrentStockAll(
		filters: MoySkladStockReportFilters
	): Promise<Map<string, number>> {
		const response = await this.request<MoySkladCurrentStockRow[]>(
			buildCurrentStockEndpoint(filters)
		)
		return this.mapCurrentStockRows(response)
	}

	private mapCurrentStockRows(
		response: MoySkladCurrentStockRow[] | null | undefined
	): Map<string, number> {
		const stockMap = new Map<string, number>()

		for (const item of response ?? []) {
			if (!item.assortmentId) continue

			const current = stockMap.get(item.assortmentId) ?? 0
			stockMap.set(item.assortmentId, current + (item.stock ?? 0))
		}

		return stockMap
	}

	private async getAllNamedEntities<TEntity extends MoySkladNamedEntity>(
		endpoint: string
	): Promise<TEntity[]> {
		const items: TEntity[] = []
		let offset = 0
		const limit = LIST_LIMIT_WITH_EXPAND

		while (true) {
			const response = await this.request<MoySkladListResponse<TEntity>>(
				`${endpoint}?limit=${limit}&offset=${offset}`
			)
			const rows = this.readListRows(response, endpoint)
			items.push(...rows)
			if (rows.length < limit) break
			offset += limit
			await this.sleep(200)
		}

		return items
	}

	private async request<T>(
		endpoint: string,
		options: RequestInit = {}
	): Promise<T> {
		const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`
		await this.waitForRateLimit(this.resolveRequestWeight(endpoint))

		for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

			try {
				const response = await fetch(url, {
					...options,
					headers: {
						Authorization: `Bearer ${this.token}`,
						'Content-Type': 'application/json',
						'Accept-Encoding': 'gzip',
						...options.headers
					},
					signal: controller.signal
				})

				if (response.status === 429) {
					const waitMs = this.resolveRetryAfterMs(response.headers, attempt)
					this.logger.warn(
						`MoySklad rate limit hit, waiting ${waitMs}ms before retry`
					)
					await this.sleep(waitMs)
					this.requestCount = this.maxRequestsPerWindow
					continue
				}

				if (!response.ok) {
					const errorBody = await response.text()
					const safeErrorBody = redactProviderSecrets(
						formatMoySkladErrorBody(errorBody, response.statusText),
						[this.token]
					)
					const safeStatusText = redactProviderSecrets(response.statusText, [
						this.token
					])
					throw new MoySkladHttpError(
						`MoySklad API error ${response.status}: ${safeErrorBody || safeStatusText}`,
						response.status,
						this.isRetryableStatus(response.status)
					)
				}

				if (typeof response.text === 'function') {
					const text = await response.text()
					return (text ? JSON.parse(text) : undefined) as T
				}

				if (typeof response.json === 'function') {
					return (await response.json()) as T
				}

				return undefined as T
			} catch (error) {
				if (
					error instanceof MoySkladHttpError &&
					(!error.retryable || attempt === this.maxRetries)
				) {
					throw toSafeProviderError(error, [this.token])
				}
				if (attempt === this.maxRetries) {
					throw toSafeProviderError(error, [this.token])
				}
				await this.sleep(this.retryDelayMs * (attempt + 1))
			} finally {
				clearTimeout(timeout)
			}
		}

		throw new Error('Превышено количество попыток запроса к MoySklad')
	}

	private readListRows<T>(
		response: MoySkladListResponse<T>,
		endpoint: string
	): T[] {
		if (!Array.isArray(response?.rows)) {
			throw new Error(
				`Invalid MoySklad response for ${endpoint}: rows must be an array`
			)
		}

		return response.rows
	}

	private resolveRequestWeight(endpoint: string): number {
		const path = endpoint.startsWith('http')
			? new URL(endpoint).pathname
			: endpoint

		return path.includes('/report/stock/all') ||
			path.includes('/report/stock/bystore')
			? STOCK_REPORT_REQUEST_WEIGHT
			: DEFAULT_REQUEST_WEIGHT
	}

	private isRetryableStatus(status: number): boolean {
		return (
			status === 408 ||
			status === 409 ||
			status === 425 ||
			status === 429 ||
			status >= 500
		)
	}

	private resolveRetryAfterMs(headers: Headers, attempt: number): number {
		const lognexRetryAfter = headers.get('X-Lognex-Retry-After')
		if (lognexRetryAfter) {
			const parsed = Number.parseInt(lognexRetryAfter, 10)
			if (Number.isFinite(parsed) && parsed > 0) {
				return Math.min(parsed, 60_000)
			}
		}

		const retryAfter = headers.get('Retry-After')
		if (retryAfter) {
			const seconds = Number.parseInt(retryAfter, 10)
			if (Number.isFinite(seconds) && seconds > 0) {
				return Math.min(seconds * 1000, 60_000)
			}

			const retryAt = Date.parse(retryAfter)
			if (Number.isFinite(retryAt)) {
				return Math.min(Math.max(retryAt - Date.now(), 1000), 60_000)
			}
		}

		return this.retryDelayMs * (attempt + 1)
	}

	private async waitForRateLimit(
		weight = DEFAULT_REQUEST_WEIGHT
	): Promise<void> {
		const now = Date.now()
		const elapsed = now - this.requestWindowStart

		if (elapsed >= this.windowMs) {
			this.requestCount = 0
			this.requestWindowStart = now
		}

		if (this.requestCount + weight > this.maxRequestsPerWindow) {
			const waitMs = Math.max(0, this.windowMs - elapsed) + 100
			await this.sleep(waitMs)
			this.requestCount = 0
			this.requestWindowStart = Date.now()
		}

		this.requestCount += weight
	}

	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms))
	}
}

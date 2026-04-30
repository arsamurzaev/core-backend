import { Logger } from '@nestjs/common'

import {
	type MoySkladEntityType,
	type MoySkladImage,
	type MoySkladListResponse,
	type MoySkladProduct,
	type MoySkladProductFolder,
	type MoySkladProductFolderRef,
	type MoySkladStockResponse
} from './moysklad.types'

const API_BASE = 'https://api.moysklad.ru/api/remap/1.2'
const DEFAULT_TIMEOUT_MS = 30000

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

type MoySkladClientConfig = {
	token: string
	maxRetries?: number
	retryDelayMs?: number
	timeoutMs?: number
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
	private readonly maxRequestsPerWindow = 40
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

	async getAllAssortment(updatedFrom?: Date): Promise<MoySkladProduct[]> {
		const items: MoySkladProduct[] = []
		let offset = 0
		const limit = 1000
		const filter = updatedFrom
			? `&filter=${encodeURIComponent(`updated>${formatMoySkladFilterDate(updatedFrom)}`)}`
			: ''

		while (true) {
			const response = await this.request<MoySkladListResponse<MoySkladProduct>>(
				`/entity/assortment?limit=${limit}&offset=${offset}&expand=${buildEntityExpand()}${filter}`
			)
			items.push(...response.rows)
			if (response.rows.length < limit) break
			offset += limit
			await this.sleep(200)
		}

		return items
	}

	async getAllProducts(updatedFrom?: Date): Promise<MoySkladProduct[]> {
		const items: MoySkladProduct[] = []
		let offset = 0
		const limit = 1000
		const filter = updatedFrom
			? `&filter=${encodeURIComponent(`updated>${formatMoySkladFilterDate(updatedFrom)}`)}`
			: ''

		while (true) {
			const response = await this.request<MoySkladListResponse<MoySkladProduct>>(
				`/entity/product?limit=${limit}&offset=${offset}&expand=${buildEntityExpand()}${filter}`
			)
			items.push(...response.rows)
			if (response.rows.length < limit) break
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

	async getStockAll(): Promise<Map<string, number>> {
		const stockMap = new Map<string, number>()
		let offset = 0
		const limit = 1000

		while (true) {
			const response = await this.request<MoySkladStockResponse>(
				`/report/stock/all?limit=${limit}&offset=${offset}`
			)

			for (const item of response.rows ?? []) {
				const match = item.meta.href.match(/\/product\/([a-f0-9-]+)/i)
				if (match && item.meta.type === 'product') {
					stockMap.set(match[1], item.stock ?? 0)
				}
			}

			if ((response.rows ?? []).length < limit) break
			offset += limit
			await this.sleep(200)
		}

		return stockMap
	}

	private async request<T>(
		endpoint: string,
		options: RequestInit = {}
	): Promise<T> {
		const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`
		await this.waitForRateLimit()

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
					const retryAfter =
						response.headers.get('X-Lognex-Retry-After') ??
						response.headers.get('Retry-After')
					const waitMs = retryAfter
						? Number.parseInt(retryAfter, 10)
						: this.retryDelayMs * (attempt + 1)
					this.logger.warn(
						`MoySklad rate limit hit, waiting ${waitMs}ms before retry`
					)
					await this.sleep(waitMs)
					this.requestCount = this.maxRequestsPerWindow
					continue
				}

				if (!response.ok) {
					const errorBody = await response.text()
					throw new Error(
						`Ошибка API MoySklad ${response.status}: ${errorBody || response.statusText}`
					)
				}

				return (await response.json()) as T
			} catch (error) {
				if (attempt === this.maxRetries) {
					throw error
				}
				await this.sleep(this.retryDelayMs * (attempt + 1))
			} finally {
				clearTimeout(timeout)
			}
		}

		throw new Error('Превышено количество попыток запроса к MoySklad')
	}

	private async waitForRateLimit(): Promise<void> {
		const now = Date.now()
		const elapsed = now - this.requestWindowStart

		if (elapsed >= this.windowMs) {
			this.requestCount = 0
			this.requestWindowStart = now
		}

		if (this.requestCount >= this.maxRequestsPerWindow) {
			const waitMs = Math.max(0, this.windowMs - elapsed) + 100
			await this.sleep(waitMs)
			this.requestCount = 0
			this.requestWindowStart = Date.now()
		}

		this.requestCount += 1
	}

	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms))
	}
}

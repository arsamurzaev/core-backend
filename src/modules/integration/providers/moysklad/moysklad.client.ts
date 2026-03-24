import { Logger } from '@nestjs/common'

import {
	type MoySkladImage,
	type MoySkladListResponse,
	type MoySkladProduct,
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
	].join('-')
		.concat(
			` ${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}:${padDatePart(value.getSeconds())}`
		)
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
			'/entity/product?limit=1'
		)
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
				`/entity/product?limit=${limit}&offset=${offset}&expand=images,salePrices${filter}`
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
			`/entity/product/${productId}?expand=images,salePrices`
		)
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
						`MoySklad API error ${response.status}: ${errorBody || response.statusText}`
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

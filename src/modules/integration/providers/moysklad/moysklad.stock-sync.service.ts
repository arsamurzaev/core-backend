import { Injectable } from '@nestjs/common'

import { IntegrationRepository } from '../../integration.repository'

import { MoySkladClient } from './moysklad.client'

type StockSyncProgressReporter = {
	report(input: {
		phase: 'SYNCING_STOCK'
		message: string
		processed?: number
		total?: number | null
		force?: boolean
	}): Promise<void>
}

type ProductStockLink = {
	productId: string
	externalId: string
	rawMeta: unknown
}

type VariantStockLink = {
	variantId: string
	externalId: string
	rawMeta: unknown
}

export type MoySkladExternalStockSyncResult = {
	total: number
	updated: number
	updatedProducts: number
	updatedVariants: number
	skipped: number
}

@Injectable()
export class MoySkladStockSyncService {
	constructor(private readonly repo: IntegrationRepository) {}

	async syncExternalStock(params: {
		catalogId: string
		integrationId: string
		client: MoySkladClient
		canSyncVariants: boolean
		progress: StockSyncProgressReporter
	}): Promise<MoySkladExternalStockSyncResult> {
		await params.progress.report({
			phase: 'SYNCING_STOCK',
			message: 'РџРѕР»СѓС‡Р°РµРј РѕСЃС‚Р°С‚РєРё РёР· MoySklad',
			processed: 0,
			total: null,
			force: true
		})

		const stockMap = await params.client.getStockAll()
		const [productLinks, rawVariantLinks, rawProductIdsWithVariantLinks] =
			await Promise.all([
				this.loadProductLinks(params.integrationId),
				this.loadVariantLinks(params.integrationId),
				this.loadProductIdsWithVariantLinks(params.integrationId)
			])

		const variantLinks = params.canSyncVariants ? rawVariantLinks : []
		const productIdsWithVariantLinks = params.canSyncVariants
			? rawProductIdsWithVariantLinks
			: []
		const productsWithVariants = new Set(productIdsWithVariantLinks)
		const totalStockLinks = productLinks.length + variantLinks.length
		let processedStockLinks = 0

		await params.progress.report({
			phase: 'SYNCING_STOCK',
			message:
				'РџСЂРёРјРµРЅСЏРµРј РѕСЃС‚Р°С‚РєРё Рє С‚РѕРІР°СЂР°Рј Рё РјРѕРґРёС„РёРєР°С†РёСЏРј',
			processed: 0,
			total: totalStockLinks,
			force: true
		})

		let updatedProducts = 0
		let updatedVariants = 0
		let skipped = 0
		const variantProductIds = new Set<string>()

		for (const link of variantLinks) {
			try {
				const stock = resolveStockForExternalLink(stockMap, link)
				if (stock === null) {
					skipped += 1
					continue
				}

				const changed = await this.repo.updateLinkedVariantStock(
					link.variantId,
					stock
				)
				if (changed.productId) {
					variantProductIds.add(changed.productId)
				}
				if (changed.changed) {
					updatedVariants += 1
				}
			} finally {
				processedStockLinks += 1
				await reportStockProgress(
					params.progress,
					processedStockLinks,
					totalStockLinks
				)
			}
		}

		for (const productId of variantProductIds) {
			const changed = await this.repo.recomputeProductStatusFromVariants(
				params.catalogId,
				productId
			)
			if (changed) {
				updatedProducts += 1
			}
		}

		for (const link of productLinks) {
			try {
				if (productsWithVariants.has(link.productId)) {
					skipped += 1
					continue
				}

				const stock = resolveStockForExternalLink(stockMap, link)
				if (stock === null) {
					skipped += 1
					continue
				}

				const changed = await this.repo.updateLinkedProductStock(
					params.catalogId,
					link.productId,
					stock
				)
				if (changed) {
					updatedProducts += 1
				}
			} finally {
				processedStockLinks += 1
				await reportStockProgress(
					params.progress,
					processedStockLinks,
					totalStockLinks
				)
			}
		}

		const updated = updatedProducts + updatedVariants
		return {
			total: stockMap.size,
			updated,
			updatedProducts,
			updatedVariants,
			skipped
		}
	}

	private async loadProductLinks(
		integrationId: string
	): Promise<ProductStockLink[]> {
		const links = (await this.repo.findProductLinksByIntegration(
			integrationId
		)) as unknown

		return Array.isArray(links)
			? links.map(normalizeProductStockLink).filter(isPresent)
			: []
	}

	private async loadVariantLinks(
		integrationId: string
	): Promise<VariantStockLink[]> {
		const links = (await this.repo.findVariantLinksByIntegration(
			integrationId
		)) as unknown

		return Array.isArray(links)
			? links.map(normalizeVariantStockLink).filter(isPresent)
			: []
	}

	private async loadProductIdsWithVariantLinks(
		integrationId: string
	): Promise<string[]> {
		const productIds = (await this.repo.findProductIdsWithVariantLinks(
			integrationId
		)) as unknown

		return Array.isArray(productIds)
			? productIds.map(readMoySkladString).filter(Boolean)
			: []
	}
}

async function reportStockProgress(
	progress: StockSyncProgressReporter,
	processed: number,
	total: number
): Promise<void> {
	await progress.report({
		phase: 'SYNCING_STOCK',
		message: `РћР±РЅРѕРІР»СЏРµРј РѕСЃС‚Р°С‚РєРё: ${processed}/${total}`,
		processed,
		total
	})
}

function normalizeProductStockLink(value: unknown): ProductStockLink | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null
	}

	const record = value as Record<string, unknown>
	const productId = readMoySkladString(record.productId)
	const externalId = readMoySkladString(record.externalId)
	if (!productId || !externalId) {
		return null
	}

	return {
		productId,
		externalId,
		rawMeta: record.rawMeta
	}
}

function normalizeVariantStockLink(value: unknown): VariantStockLink | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null
	}

	const record = value as Record<string, unknown>
	const variantId = readMoySkladString(record.variantId)
	const externalId = readMoySkladString(record.externalId)
	if (!variantId || !externalId) {
		return null
	}

	return {
		variantId,
		externalId,
		rawMeta: record.rawMeta
	}
}

function resolveStockForExternalLink(
	stockMap: Map<string, number>,
	link: ProductStockLink | VariantStockLink
): number | null {
	const rawMetaId = readRawMetaString(link.rawMeta, 'id')
	const stock =
		(rawMetaId ? stockMap.get(rawMetaId) : undefined) ??
		stockMap.get(link.externalId)
	if (stock === undefined) {
		return null
	}

	return normalizeStockQuantity(stock)
}

function readRawMetaString(rawMeta: unknown, key: string): string | null {
	if (!rawMeta || typeof rawMeta !== 'object' || Array.isArray(rawMeta)) {
		return null
	}

	const value = (rawMeta as Record<string, unknown>)[key]
	return readMoySkladNullableString(value)
}

function normalizeStockQuantity(value: number): number {
	if (!Number.isFinite(value)) {
		return 0
	}

	return Math.max(0, Math.trunc(value))
}

function isPresent<T>(value: T | null | undefined): value is T {
	return value !== null && value !== undefined
}

function readMoySkladString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : ''
}

function readMoySkladNullableString(value: unknown): string | null {
	const normalized = readMoySkladString(value)
	return normalized || null
}

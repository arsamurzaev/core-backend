import { Inject, Injectable, Optional } from '@nestjs/common'

import { IntegrationRepository } from '../../integration.repository'

import { createDomainEvent } from '@/shared/domain-events/domain-event.utils'
import {
	DOMAIN_EVENT_DISPATCHER,
	type DomainEventDispatcher
} from '@/shared/domain-events/domain-events.contract'
import type { InventoryExternalStockPort } from '@/modules/inventory/contracts'

import { MoySkladClient } from './moysklad.client'
import {
	createMoySkladStockSkippedReasons,
	MOYSKLAD_SKIPPED_REASONS,
	type MoySkladExternalStockSkippedReasons
} from './moysklad.skipped-reasons'

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

type StockUpdateResult = {
	changed: boolean
	productId: string | null
	variantId: string | null
	previousStock: number | null
	nextStock: number | null
}

export type MoySkladExternalStockApplySource = 'FULL_SYNC' | 'WEBHOOK'

export type { MoySkladExternalStockSkippedReasons }

export type MoySkladExternalStockDiagnostics = {
	source: MoySkladExternalStockApplySource
	stockRows: number
	matchedStockRows: number
	unmatchedStockRows: number
	productLinks: number
	variantLinks: number
	ignoredVariantLinks: number
	appliedProductLinks: number
	appliedVariantLinks: number
	skippedReasons: MoySkladExternalStockSkippedReasons
}

export type MoySkladExternalStockSyncResult = {
	total: number
	updated: number
	updatedProducts: number
	updatedVariants: number
	skipped: number
	diagnostics: MoySkladExternalStockDiagnostics
}

@Injectable()
export class MoySkladStockSyncService implements InventoryExternalStockPort {
	constructor(
		private readonly repo: IntegrationRepository,
		@Optional()
		@Inject(DOMAIN_EVENT_DISPATCHER)
		private readonly events?: DomainEventDispatcher
	) {}

	async syncExternalStock(params: {
		catalogId: string
		integrationId: string
		client: MoySkladClient
		canSyncVariants: boolean
		progress: StockSyncProgressReporter
	}): Promise<MoySkladExternalStockSyncResult> {
		await params.progress.report({
			phase: 'SYNCING_STOCK',
			message: 'Получаем остатки из MoySklad',
			processed: 0,
			total: null,
			force: true
		})

		const stockMap = await params.client.getStockAll()
		return this.applyExternalStockMap({
			catalogId: params.catalogId,
			integrationId: params.integrationId,
			stockMap,
			source: 'FULL_SYNC',
			canSyncVariants: params.canSyncVariants,
			progress: params.progress
		})
	}

	async applyExternalStockMap(params: {
		catalogId: string
		integrationId: string
		stockMap: Map<string, number>
		source: MoySkladExternalStockApplySource
		canSyncVariants: boolean
		progress: StockSyncProgressReporter
	}): Promise<MoySkladExternalStockSyncResult> {
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
		const matchedStockRowIds = new Set<string>()
		const skippedReasons = createMoySkladStockSkippedReasons({
			variantsCapabilityDisabled: params.canSyncVariants
				? 0
				: rawVariantLinks.length,
			capabilityDisabled: params.canSyncVariants ? 0 : rawVariantLinks.length
		})
		let processedStockLinks = 0

		await params.progress.report({
			phase: 'SYNCING_STOCK',
			message:
				'Применяем остатки к товарам и модификациям',
			processed: 0,
			total: totalStockLinks,
			force: true
		})

		let updatedProducts = 0
		let updatedVariants = 0
		let skipped = 0
		let appliedProductLinks = 0
		let appliedVariantLinks = 0
		const variantProductIds = new Set<string>()

		if (!params.canSyncVariants) {
			for (const link of rawVariantLinks) {
				const stockResolution = resolveStockForExternalLink(
					params.stockMap,
					link
				)
				if (stockResolution) {
					matchedStockRowIds.add(stockResolution.matchedExternalId)
				}
				await this.repo.markVariantLinkStockSkipped(
					params.integrationId,
					link.variantId,
					MOYSKLAD_SKIPPED_REASONS.VARIANTS_CAPABILITY_DISABLED
				)
			}
		}

		for (const link of variantLinks) {
			try {
				const stockResolution = resolveStockForExternalLink(
					params.stockMap,
					link
				)
				if (!stockResolution) {
					skippedReasons.missingStock += 1
					skippedReasons.snapshotIncomplete += 1
					skipped += 1
					await this.repo.markVariantLinkStockSkipped(
						params.integrationId,
						link.variantId,
						MOYSKLAD_SKIPPED_REASONS.STOCK_MISSING_IN_EXTERNAL_REPORT
					)
					continue
				}
				matchedStockRowIds.add(stockResolution.matchedExternalId)

				const changed = await this.repo.updateLinkedVariantStock(
					link.variantId,
					stockResolution.stock
				)
				appliedVariantLinks += 1
				const stockUpdate = normalizeStockUpdateResult(changed, {
					variantId: link.variantId
				})
				await this.repo.touchVariantLinkStockSynced(
					params.integrationId,
					link.variantId
				)
				if (stockUpdate.productId) {
					variantProductIds.add(stockUpdate.productId)
				}
				if (stockUpdate.changed) {
					updatedVariants += 1
				}
				await this.publishStockChangedEvent({
					catalogId: params.catalogId,
					integrationId: params.integrationId,
					externalId: link.externalId,
					source: params.source,
					update: stockUpdate
				})
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
					const stockResolution = resolveStockForExternalLink(
						params.stockMap,
						link
					)
					if (stockResolution) {
						matchedStockRowIds.add(stockResolution.matchedExternalId)
					}
					skippedReasons.productHasVariantLinks += 1
					skipped += 1
					await this.repo.markProductLinkStockSkipped(
						params.integrationId,
						link.productId,
						MOYSKLAD_SKIPPED_REASONS.STOCK_OWNED_BY_VARIANT_LINKS
					)
					continue
				}

				const stockResolution = resolveStockForExternalLink(
					params.stockMap,
					link
				)
				if (!stockResolution) {
					skippedReasons.missingStock += 1
					skippedReasons.snapshotIncomplete += 1
					skipped += 1
					await this.repo.markProductLinkStockSkipped(
						params.integrationId,
						link.productId,
						MOYSKLAD_SKIPPED_REASONS.STOCK_MISSING_IN_EXTERNAL_REPORT
					)
					continue
				}
				matchedStockRowIds.add(stockResolution.matchedExternalId)

				const changed = await this.repo.updateLinkedProductStock(
					params.catalogId,
					link.productId,
					stockResolution.stock
				)
				appliedProductLinks += 1
				const stockUpdate = normalizeStockUpdateResult(changed, {
					productId: link.productId
				})
				await this.repo.touchProductLinkStockSynced(
					params.integrationId,
					link.productId
				)
				if (stockUpdate.changed) {
					updatedProducts += 1
				}
				await this.publishStockChangedEvent({
					catalogId: params.catalogId,
					integrationId: params.integrationId,
					externalId: link.externalId,
					source: params.source,
					update: stockUpdate
				})
			} finally {
				processedStockLinks += 1
				await reportStockProgress(
					params.progress,
					processedStockLinks,
					totalStockLinks
				)
			}
		}

		const unmatchedStockRows = Math.max(
			0,
			params.stockMap.size - matchedStockRowIds.size
		)
		skippedReasons.stockRowWithoutLocalLink = unmatchedStockRows
		skippedReasons.missingMapping = unmatchedStockRows
		const updated = updatedProducts + updatedVariants
		return {
			total: params.stockMap.size,
			updated,
			updatedProducts,
			updatedVariants,
			skipped,
			diagnostics: {
				source: params.source,
				stockRows: params.stockMap.size,
				matchedStockRows: matchedStockRowIds.size,
				unmatchedStockRows,
				productLinks: productLinks.length,
				variantLinks: rawVariantLinks.length,
				ignoredVariantLinks: params.canSyncVariants ? 0 : rawVariantLinks.length,
				appliedProductLinks,
				appliedVariantLinks,
				skippedReasons
			}
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

	private async publishStockChangedEvent(params: {
		catalogId: string
		integrationId: string
		externalId: string
		source: MoySkladExternalStockApplySource
		update: StockUpdateResult
	}): Promise<void> {
		if (!this.events || !params.update.variantId) return
		if (!hasStockFieldChanged(params.update)) return

		await this.events.dispatch(
			createDomainEvent({
				type: 'variant.stock_changed',
				catalogId: params.catalogId,
				productId: params.update.productId,
				variantId: params.update.variantId,
				previousStock: params.update.previousStock,
				nextStock: params.update.nextStock,
				source: 'integration',
				reason: resolveStockChangedReason(params.source),
				integrationId: params.integrationId,
				externalId: params.externalId
			})
		)
	}
}

async function reportStockProgress(
	progress: StockSyncProgressReporter,
	processed: number,
	total: number
): Promise<void> {
	await progress.report({
		phase: 'SYNCING_STOCK',
		message: `Обновляем остатки: ${processed}/${total}`,
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

function normalizeStockUpdateResult(
	value: unknown,
	fallback: { productId?: string | null; variantId?: string | null }
): StockUpdateResult {
	if (typeof value === 'boolean') {
		return {
			changed: value,
			productId: fallback.productId ?? null,
			variantId: fallback.variantId ?? null,
			previousStock: null,
			nextStock: null
		}
	}
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {
			changed: false,
			productId: fallback.productId ?? null,
			variantId: fallback.variantId ?? null,
			previousStock: null,
			nextStock: null
		}
	}

	const record = value as Record<string, unknown>
	return {
		changed: record.changed === true,
		productId:
			readMoySkladString(record.productId) || fallback.productId || null,
		variantId:
			readMoySkladString(record.variantId) || fallback.variantId || null,
		previousStock: readNullableNumber(record.previousStock),
		nextStock: readNullableNumber(record.nextStock)
	}
}

function hasStockFieldChanged(update: StockUpdateResult): boolean {
	if (
		typeof update.previousStock === 'number' &&
		typeof update.nextStock === 'number'
	) {
		return update.previousStock !== update.nextStock
	}

	return update.changed
}

function resolveStockChangedReason(
	source: MoySkladExternalStockApplySource
): string {
	return source === 'WEBHOOK'
		? 'moysklad_stock_webhook'
		: 'moysklad_stock_full_sync'
}

function readNullableNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null
	const numberValue = Number(value)
	return Number.isFinite(numberValue) ? numberValue : null
}

function resolveStockForExternalLink(
	stockMap: Map<string, number>,
	link: ProductStockLink | VariantStockLink
): { stock: number; matchedExternalId: string } | null {
	const rawMetaId = readRawMetaString(link.rawMeta, 'id')
	if (rawMetaId) {
		const stock = stockMap.get(rawMetaId)
		if (stock !== undefined) {
			return {
				stock: normalizeStockQuantity(stock),
				matchedExternalId: rawMetaId
			}
		}
	}

	const stock = stockMap.get(link.externalId)
	if (stock === undefined) {
		return null
	}

	return {
		stock: normalizeStockQuantity(stock),
		matchedExternalId: link.externalId
	}
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

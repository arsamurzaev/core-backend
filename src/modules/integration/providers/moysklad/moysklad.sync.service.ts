import type { Prisma } from '@generated/client'
import { type CatalogInventoryMode } from '@generated/enums'
import {
	BadGatewayException,
	ConflictException,
	HttpException,
	Injectable,
	Logger,
	NotFoundException
} from '@nestjs/common'

import { CapabilityService } from '@/modules/capability/capability.service'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'

import {
	type IntegrationProductLinkRecord,
	IntegrationRecord,
	IntegrationRepository
} from '../../integration.repository'
import { renderSafeProviderErrorMessage } from '../../provider-error-redaction'

import { MoySkladClient } from './moysklad.client'
import { MoySkladMetadataCryptoService } from './moysklad.metadata'
import { MoySkladMissingProductSyncService } from './moysklad.missing-product-sync.service'
import { MoySkladProductSyncService } from './moysklad.product-sync.service'
import { MoySkladStockSyncService } from './moysklad.stock-sync.service'
import {
	type MoySkladCatalogSyncResult,
	MoySkladCatalogSyncStats,
	type MoySkladSyncItemIssue
} from './moysklad.sync-stats'
import type { MoySkladEntityType, MoySkladProduct } from './moysklad.types'
import { MoySkladVariantSyncService } from './moysklad.variant-sync.service'

const SYNC_LOCK_TIMEOUT_MS = 10 * 60 * 1000
const SYNC_PROGRESS_MIN_INTERVAL_MS = 800
const SYNC_PROGRESS_MIN_ITEM_DELTA = 5
const SUPPORTED_ASSORTMENT_TYPES = new Set<MoySkladEntityType>([
	'product',
	'service',
	'bundle',
	'variant'
])
const PRODUCT_ASSORTMENT_TYPES = new Set<MoySkladEntityType>([
	'product',
	'service',
	'bundle'
])
const CATALOG_INVENTORY_MODE_INTERNAL: CatalogInventoryMode = 'INTERNAL'

type SyncStockResult = {
	ok: true
	total: number
	updated: number
	updatedProducts: number
	updatedVariants: number
	skipped: number
	durationMs: number
	syncedAt: Date
}

type SyncCatalogOptions = {
	updatedFrom?: Date | null
	runId?: string | null
}

type SyncProgressOptions = {
	runId?: string | null
}

type SyncProductResult = {
	ok: true
	productId: string
	externalId: string
	created: boolean
	updated: boolean
	productUpdated: boolean
	imagesImported: number
	totalVariants: number
	createdVariants: number
	updatedVariants: number
	deletedVariants: number
	skippedVariants: number
	warnings: MoySkladSyncItemIssue[]
	errors: MoySkladSyncItemIssue[]
	durationMs: number
}

type SyncProgressPhase =
	| 'QUEUED'
	| 'FETCHING_ASSORTMENT'
	| 'FETCHING_PRODUCT'
	| 'FETCHING_VARIANTS'
	| 'SYNCING_PRODUCTS'
	| 'SYNCING_VARIANTS'
	| 'SYNCING_STOCK'
	| 'ARCHIVING_MISSING'
	| 'IMPORTING_IMAGES'
	| 'COMPLETED'
	| 'FAILED'

type SyncProgressSnapshot = {
	phase: SyncProgressPhase
	message: string
	processed: number
	total: number | null
	percent: number | null
	updatedAt: string
}

type SyncProgressInput = {
	phase: SyncProgressPhase
	message: string
	processed?: number
	total?: number | null
	force?: boolean
}

type SyncProgressReporter = {
	report(input: SyncProgressInput): Promise<void>
}

function readMoySkladString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : ''
}

function readMoySkladNullableString(value: unknown): string | null {
	const normalized = readMoySkladString(value)
	return normalized || null
}

function resolveExternalProductKey(product: MoySkladProduct): string {
	return readMoySkladString(product.externalCode)
}

function resolveExternalVariantKey(product: MoySkladProduct): string {
	return readMoySkladString(product.id)
}

function hasProductFolder(product: MoySkladProduct): boolean {
	return Boolean(
		readMoySkladString(product.productFolder?.id) ||
		readMoySkladString(product.productFolder?.meta?.href)
	)
}

function extractMoySkladEntityIdFromHref(
	href: unknown,
	entityType: string
): string | null {
	const normalized = readMoySkladString(href)
	if (!normalized) return null

	const escapedType = entityType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
	const match = normalized.match(
		new RegExp(`/entity/${escapedType}/([^/?#]+)`, 'i')
	)
	return match?.[1] ? decodeURIComponent(match[1]) : null
}

function resolveVariantParentProductExternalId(
	product: MoySkladProduct
): string | null {
	return (
		readMoySkladString(product.product?.id) ||
		extractMoySkladEntityIdFromHref(product.product?.meta?.href, 'product')
	)
}

function resolveExternalEntityType(
	product: MoySkladProduct
): MoySkladEntityType {
	switch (product.meta?.type) {
		case 'service':
		case 'bundle':
		case 'variant':
			return product.meta.type
		default:
			return 'product'
	}
}

function isSupportedAssortmentItem(product: MoySkladProduct): boolean {
	return SUPPORTED_ASSORTMENT_TYPES.has(resolveExternalEntityType(product))
}

function isProductAssortmentItem(product: MoySkladProduct): boolean {
	return PRODUCT_ASSORTMENT_TYPES.has(resolveExternalEntityType(product))
}

function isVariantAssortmentItem(product: MoySkladProduct): boolean {
	return resolveExternalEntityType(product) === 'variant'
}

function isSyncableProductAssortmentItem(product: MoySkladProduct): boolean {
	return (
		isSupportedAssortmentItem(product) &&
		isProductAssortmentItem(product) &&
		hasProductFolder(product) &&
		Boolean(resolveExternalProductKey(product))
	)
}

function isSyncableVariantAssortmentItem(product: MoySkladProduct): boolean {
	return (
		isSupportedAssortmentItem(product) &&
		isVariantAssortmentItem(product) &&
		Boolean(resolveExternalVariantKey(product)) &&
		Boolean(resolveVariantParentProductExternalId(product))
	)
}

@Injectable()
export class MoySkladSyncService {
	private readonly logger = new Logger(MoySkladSyncService.name)

	constructor(
		private readonly repo: IntegrationRepository,
		private readonly cache: CacheService,
		private readonly metadataCrypto: MoySkladMetadataCryptoService,
		private readonly missingProducts: MoySkladMissingProductSyncService,
		private readonly products: MoySkladProductSyncService,
		private readonly stockSync: MoySkladStockSyncService,
		private readonly variantSync: MoySkladVariantSyncService,
		private readonly featureEntitlements: CapabilityService
	) {}

	async testConnection(token: string): Promise<{ ok: true }> {
		try {
			const client = new MoySkladClient({ token })
			await client.ping()
			return { ok: true }
		} catch (error) {
			throw new BadGatewayException(
				`Не удалось подключиться к MoySklad: ${this.renderErrorMessage(error)}`
			)
		}
	}

	async syncCatalog(
		catalogId: string,
		options: SyncCatalogOptions = {}
	): Promise<MoySkladCatalogSyncResult> {
		const startedAt = Date.now()
		const progress = this.createProgressReporter(options.runId)
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
		await this.beginSyncOrThrow(catalogId)

		try {
			const integration = await this.getActiveIntegration(catalogId)
			const metadata = this.metadataCrypto.parseStoredMetadata(
				integration.metadata
			)
			const features = await this.featureEntitlements.getCurrentFeatures(catalogId)
			const canSyncVariants =
				features.canUseProductTypes && features.canUseProductVariants
			const client = new MoySkladClient({ token: metadata.token })
			const updatedFrom = options.updatedFrom ?? undefined
			const isIncrementalSync = Boolean(updatedFrom)
			await progress.report({
				phase: 'FETCHING_ASSORTMENT',
				message:
					'Получаем товары, услуги, комплекты и модификации из МойСклад',
				processed: 0,
				total: null,
				force: true
			})
			this.logger.log(
				`Starting MoySklad catalog sync for catalog ${catalogId}: integration=${integration.id}, updatedFrom=${updatedFrom?.toISOString() ?? 'full-snapshot'}, importImages=${metadata.importImages}, syncStock=${metadata.syncStock}`
			)
			const assortment = await client.getAllAssortment(updatedFrom)
			const supportedItems = assortment.filter(isSupportedAssortmentItem)
			const productItems = supportedItems.filter(isProductAssortmentItem)
			const variantItems = supportedItems.filter(isVariantAssortmentItem)
			const products = productItems.filter(isSyncableProductAssortmentItem)
			const syncableVariants = variantItems.filter(isSyncableVariantAssortmentItem)
			const variants = canSyncVariants ? syncableVariants : []
			const totalSyncItems = products.length + variants.length
			const skippedUnsupported = assortment.length - supportedItems.length
			const skippedWithoutCategory = productItems.filter(
				product => !hasProductFolder(product)
			).length
			const skippedWithoutExternalCode = productItems.filter(
				product => hasProductFolder(product) && !resolveExternalProductKey(product)
			).length
			const skippedVariantsWithoutParent = variantItems.filter(
				product =>
					!resolveExternalVariantKey(product) ||
					!resolveVariantParentProductExternalId(product)
			).length
			const stats = new MoySkladCatalogSyncStats()
			this.logger.log(
				`Fetched ${assortment.length} assortment items from MoySklad for catalog ${catalogId}; syncing ${products.length} products/services/bundles and ${variants.length} variants`
			)
			await progress.report({
				phase: products.length > 0 ? 'SYNCING_PRODUCTS' : 'SYNCING_VARIANTS',
				message:
					totalSyncItems > 0
						? 'Синхронизируем позиции из МойСклад'
						: 'В МойСклад не найдено подходящих позиций для синхронизации',
				processed: 0,
				total: totalSyncItems,
				force: true
			})
			if (skippedUnsupported > 0) {
				stats.recordWarning({
					code: 'MOYSKLAD_UNSUPPORTED_ASSORTMENT_SKIPPED',
					message: 'Unsupported MoySklad assortment items were skipped',
					externalId: null,
					count: skippedUnsupported
				})
				this.logger.log(
					`Skipped ${skippedUnsupported} unsupported assortment items from MoySklad for catalog ${catalogId}`
				)
			}
			if (skippedWithoutCategory > 0) {
				stats.recordWarning({
					code: 'MOYSKLAD_PRODUCT_FOLDER_MISSING',
					message: 'Supported MoySklad items without productFolder were skipped',
					externalId: null,
					count: skippedWithoutCategory
				})
				this.logger.log(
					`Skipped ${skippedWithoutCategory} supported MoySklad items without productFolder for catalog ${catalogId}`
				)
			}
			if (skippedWithoutExternalCode > 0) {
				stats.recordWarning({
					code: 'MOYSKLAD_EXTERNAL_CODE_MISSING',
					message: 'Supported MoySklad items without externalCode were skipped',
					externalId: null,
					count: skippedWithoutExternalCode
				})
				this.logger.log(
					`Skipped ${skippedWithoutExternalCode} supported MoySklad items without externalCode for catalog ${catalogId}`
				)
			}
			if (skippedVariantsWithoutParent > 0) {
				stats.recordWarning({
					code: 'MOYSKLAD_VARIANT_PARENT_MISSING',
					message:
						'MoySklad variants without id or parent product reference were skipped',
					externalId: null,
					count: skippedVariantsWithoutParent
				})
				this.logger.log(
					`Skipped ${skippedVariantsWithoutParent} MoySklad variants without id or parent product reference for catalog ${catalogId}`
				)
			}
			if (!canSyncVariants && syncableVariants.length > 0) {
				stats.recordWarning({
					code: 'MOYSKLAD_VARIANTS_DISABLED',
					message:
						'MoySklad variants were skipped because product type or product variant capability is disabled for this catalog',
					externalId: null,
					count: syncableVariants.length
				})
				this.logger.log(
					`Skipped ${syncableVariants.length} MoySklad variants for catalog ${catalogId}: product type or variant capability is disabled`
				)
			}
			if (totalSyncItems === 0) {
				if (isIncrementalSync) {
					this.logger.log(
						`No supported MoySklad assortment changes found for catalog ${catalogId} since ${updatedFrom?.toISOString()}`
					)
				} else {
					this.logger.warn(
						`MoySklad returned 0 supported assortment items for catalog ${catalogId}. Check token permissions, filters, archived products, product folders, external codes, and whether the account really has product/service/bundle/variant entries in the selected entity scope.`
					)
				}
			}

			let processed = 0
			const localProductIdByMoySkladId = new Map<string, string>()
			const parentExternalIdsWithVariants = new Set(
				variants
					.map(resolveVariantParentProductExternalId)
					.filter((id): id is string => Boolean(id))
			)
			const presentProductExternalIds = new Set<string>()
			for (const product of productItems) {
				const externalKey = resolveExternalProductKey(product)
				const rawId = readMoySkladString(product.id)
				if (externalKey) presentProductExternalIds.add(externalKey)
				if (rawId) presentProductExternalIds.add(rawId)
			}

			// Avoid a long-lived interactive transaction here because image
			// downloads/uploads can easily exceed Prisma's default timeout.
			for (const product of products) {
				processed += 1
				if (processed % 100 === 0) {
					this.logger.log(`Processed ${processed} products...`)
				}

				try {
					const result = await this.products.syncExternalProduct({
						catalogId,
						integration,
						client,
						product,
						priceTypeName: metadata.priceTypeName,
						importImages: metadata.importImages,
						syncStock: metadata.syncStock,
						ensureDefaultVariant: !parentExternalIdsWithVariants.has(
							readMoySkladString(product.id)
						)
					})

					stats.recordProductResult(result)
					const rawProductId = readMoySkladString(product.id)
					if (rawProductId) {
						localProductIdByMoySkladId.set(rawProductId, result.productId)
					}
				} catch (error) {
					const issue = this.buildSyncItemIssue(
						'MOYSKLAD_PRODUCT_SYNC_FAILED',
						product,
						error
					)
					stats.recordError(issue)
					this.logger.error('MoySklad product sync item failed', {
						catalogId,
						integrationId: integration.id,
						externalId: issue.externalId,
						error: issue.message
					})
				} finally {
					await progress.report({
						phase: 'SYNCING_PRODUCTS',
						message: `Синхронизируем товары: ${processed}/${products.length}`,
						processed,
						total: totalSyncItems
					})
				}
			}

			this.logger.log(
				`Finished product sync loop for catalog ${catalogId}: processed=${processed}, created=${stats.created}, updated=${stats.updated}`
			)

			let productLinks: IntegrationProductLinkRecord[] | null = null
			if (variants.length > 0 || !isIncrementalSync) {
				productLinks = await this.repo.findProductLinksByIntegration(integration.id)
				for (const link of productLinks) {
					const moySkladId = this.readRawMetaString(link.rawMeta, 'id')
					if (moySkladId) {
						localProductIdByMoySkladId.set(moySkladId, link.productId)
					}
				}
			}

			let seenVariants = 0
			for (const variant of variants) {
				seenVariants += 1
				const parentExternalId = resolveVariantParentProductExternalId(variant)
				const parentProductId = parentExternalId
					? localProductIdByMoySkladId.get(parentExternalId)
					: null
				if (!parentExternalId || !parentProductId) {
					stats.recordWarning({
						code: 'MOYSKLAD_VARIANT_PARENT_NOT_LINKED',
						message: `MoySklad variant parent product ${parentExternalId ?? '<unknown>'} is not linked locally`,
						externalId: this.resolveSyncItemExternalId(variant)
					})
					this.logger.warn(
						`Skipped MoySklad variant ${variant.id} for catalog ${catalogId}: parent product ${parentExternalId ?? '<unknown>'} is not linked locally`
					)
					await progress.report({
						phase: 'SYNCING_VARIANTS',
						message: `Синхронизируем модификации: ${seenVariants}/${variants.length}`,
						processed: products.length + seenVariants,
						total: totalSyncItems
					})
					continue
				}

				const parentProduct = await this.repo.findProductById(
					catalogId,
					parentProductId
				)
				if (!parentProduct) {
					stats.recordWarning({
						code: 'MOYSKLAD_VARIANT_PARENT_NOT_FOUND',
						message: `MoySklad variant parent local product ${parentProductId} was not found`,
						externalId: this.resolveSyncItemExternalId(variant)
					})
					this.logger.warn(
						`Skipped MoySklad variant ${variant.id} for catalog ${catalogId}: parent local product ${parentProductId} was not found`
					)
					await progress.report({
						phase: 'SYNCING_VARIANTS',
						message: `Синхронизируем модификации: ${seenVariants}/${variants.length}`,
						processed: products.length + seenVariants,
						total: totalSyncItems
					})
					continue
				}

				try {
					const result = await this.variantSync.syncExternalVariant({
						catalogId,
						integration,
						product: variant,
						priceTypeName: metadata.priceTypeName,
						syncStock: metadata.syncStock,
						parentProductId,
						parentProduct
					})

					stats.recordVariantResult(result)
				} catch (error) {
					const issue = this.buildSyncItemIssue(
						'MOYSKLAD_VARIANT_SYNC_FAILED',
						variant,
						error
					)
					stats.recordError(issue)
					this.logger.error('MoySklad variant sync item failed', {
						catalogId,
						integrationId: integration.id,
						externalId: issue.externalId,
						parentExternalId,
						parentProductId,
						variantName: readMoySkladNullableString(variant.name),
						variantCode: readMoySkladNullableString(variant.code),
						error: issue.message
					})
				} finally {
					await progress.report({
						phase: 'SYNCING_VARIANTS',
						message: `Синхронизируем модификации: ${seenVariants}/${variants.length}`,
						processed: products.length + seenVariants,
						total: totalSyncItems
					})
				}
			}

			const skippedProducts = productItems.length - products.length
			const skippedVariants = variantItems.length - stats.processedVariants

			if (stats.allAttemptedItemsFailed(totalSyncItems)) {
				throw new BadGatewayException('All MoySklad catalog items failed to sync')
			}

			if (variants.length > 0) {
				this.logger.log(
					`Finished variant sync loop for catalog ${catalogId}: processed=${stats.processedVariants}, skipped=${variants.length - stats.processedVariants}`
				)
			}

			// Handle deleted products
			if (!isIncrementalSync && productItems.length > 0) {
				await progress.report({
					phase: 'ARCHIVING_MISSING',
					message:
						'Проверяем товары, удаленные или скрытые в МойСклад',
					processed: totalSyncItems,
					total: totalSyncItems,
					force: true
				})
				stats.setDeleted(
					await this.missingProducts.hideMissingProducts({
						catalogId,
						integrationId: integration.id,
						currentExternalIds: presentProductExternalIds,
						productLinks
					})
				)
			} else if (!isIncrementalSync) {
				this.logger.warn(
					`Skipped missing-product archival for catalog ${catalogId} because MoySklad returned no product/service/bundle items`
				)
			} else {
				this.logger.log(
					`Skipped missing-product archival for catalog ${catalogId} because sync used updatedFrom=${updatedFrom?.toISOString()}`
				)
			}

			this.logger.log(
				`Hidden ${stats.deleted} missing products after MoySklad sync for catalog ${catalogId}`
			)

			const syncedAt = new Date()
			await this.repo.finishMoySkladSync(catalogId, {
				totalProducts: totalSyncItems,
				createdProducts: stats.created,
				updatedProducts: stats.updated,
				deletedProducts: stats.deleted,
				syncedAt
			})
			await this.invalidateProductCaches(catalogId)

			const durationMs = Date.now() - startedAt
			await progress.report({
				phase: 'COMPLETED',
				message: 'Синхронизация МойСклад завершена',
				processed: totalSyncItems,
				total: totalSyncItems,
				force: true
			})
			this.logger.log(
				`Completed MoySklad catalog sync for catalog ${catalogId}: total=${totalSyncItems}, created=${stats.created}, updated=${stats.updated}, deleted=${stats.deleted}, durationMs=${durationMs}`
			)

			return stats.toCatalogResult({
				total: totalSyncItems,
				totalProducts: products.length,
				totalVariants: variants.length,
				skippedProducts,
				skippedVariants,
				durationMs,
				syncedAt
			})
		} catch (error) {
			await progress.report({
				phase: 'FAILED',
				message: this.renderErrorMessage(error),
				force: true
			})
			this.logger.error(
				`MoySklad catalog sync failed for catalog ${catalogId}: ${this.renderErrorMessage(error)}`
			)
			await this.repo.failMoySkladSync(catalogId, this.renderErrorMessage(error))
			throw this.wrapSyncError(error)
		}
	}

	async syncProduct(
		catalogId: string,
		productId: string,
		options: SyncProgressOptions = {}
	): Promise<SyncProductResult> {
		const startedAt = Date.now()
		const progress = this.createProgressReporter(options.runId)
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
		await this.beginSyncOrThrow(catalogId)
		this.logger.log(
			`Starting MoySklad product sync for catalog ${catalogId}, product ${productId}`
		)

		try {
			const integration = await this.getActiveIntegration(catalogId)
			const metadata = this.metadataCrypto.parseStoredMetadata(
				integration.metadata
			)
			const features = await this.featureEntitlements.getCurrentFeatures(catalogId)
			const canSyncVariants =
				features.canUseProductTypes && features.canUseProductVariants
			const client = new MoySkladClient({ token: metadata.token })
			const localProduct = await this.repo.findProductById(catalogId, productId)

			if (!localProduct) {
				throw new NotFoundException('Товар не найден')
			}

			const link = await this.repo.findProductLinkByProductId(
				integration.id,
				productId
			)
			if (!link) {
				throw new NotFoundException('Товар не связан с MoySklad')
			}

			await progress.report({
				phase: 'FETCHING_PRODUCT',
				message: 'Получаем товар из MoySklad',
				processed: 0,
				total: null,
				force: true
			})
			let externalProduct: MoySkladProduct
			try {
				externalProduct = await client.getAssortmentItemByExternalCode(
					link.externalId
				)
			} catch {
				externalProduct = await client.getAssortmentItemById(link.externalId)
			}

			const externalProductRawId = readMoySkladString(externalProduct.id)
			const shouldSyncExternalVariants =
				resolveExternalEntityType(externalProduct) === 'product' &&
				Boolean(externalProductRawId) &&
				canSyncVariants
			const externalVariants = shouldSyncExternalVariants
				? await this.variantSync.loadProductVariants({
						client,
						productExternalId: externalProductRawId,
						syncStock: metadata.syncStock,
						progress
					})
				: []
			const totalSyncItems = 1 + externalVariants.length
			await progress.report({
				phase: 'SYNCING_PRODUCTS',
				message: 'Синхронизируем карточку товара',
				processed: 0,
				total: totalSyncItems,
				force: true
			})
			const externalVariantIds = externalVariants
				.map(resolveExternalVariantKey)
				.filter((id): id is string => Boolean(id))

			const result = await this.products.syncExternalProduct({
				catalogId,
				integration,
				client,
				product: externalProduct,
				priceTypeName: metadata.priceTypeName,
				importImages: metadata.importImages,
				refreshImagesForExistingProduct: true,
				syncStock: metadata.syncStock,
				ensureDefaultVariant: externalVariants.length === 0,
				existingProduct: localProduct,
				existingLinkExternalId: link.externalId
			})
			await progress.report({
				phase: 'SYNCING_PRODUCTS',
				message: 'Карточка товара синхронизирована',
				processed: 1,
				total: totalSyncItems,
				force: true
			})
			const archivedMissingVariants = shouldSyncExternalVariants
				? await this.repo.archiveMissingIntegratedProductVariants({
						integrationId: integration.id,
						productId: result.productId,
						externalIds: externalVariantIds
					})
				: 0
			if (archivedMissingVariants > 0) {
				this.logger.log(
					`Archived ${archivedMissingVariants} missing MoySklad variants during product sync: catalog=${catalogId}, productId=${result.productId}, externalProductId=${externalProductRawId}`
				)
			}
			const defaultVariantRecovered =
				externalVariants.length === 0 && archivedMissingVariants > 0
					? await this.variantSync.recoverDefaultVariantAfterMissingExternalVariants(
							{
								catalogId,
								integration,
								product: externalProduct,
								productId: result.productId,
								priceTypeName: metadata.priceTypeName,
								syncStock: metadata.syncStock
							}
						)
					: false
			const variantStats =
				externalVariants.length > 0
					? await this.variantSync.syncProductVariants({
							catalogId,
							integration,
							variants: externalVariants,
							priceTypeName: metadata.priceTypeName,
							syncStock: metadata.syncStock,
							parentProductId: result.productId,
							progress,
							baseProcessed: 1,
							total: totalSyncItems
						})
					: this.variantSync.createEmptyStats()
			variantStats.deleted += archivedMissingVariants
			const variantsChanged =
				variantStats.created > 0 ||
				variantStats.updated > 0 ||
				variantStats.deleted > 0 ||
				variantStats.productStatusUpdated ||
				defaultVariantRecovered

			const syncedAt = new Date()
			await this.repo.finishMoySkladSync(catalogId, {
				totalProducts: 1 + variantStats.total,
				createdProducts: (result.created ? 1 : 0) + variantStats.created,
				updatedProducts:
					(result.updated ||
					variantStats.productStatusUpdated ||
					defaultVariantRecovered
						? 1
						: 0) + variantStats.updated,
				deletedProducts: variantStats.deleted,
				syncedAt
			})
			await this.invalidateProductCaches(catalogId)
			const durationMs = Date.now() - startedAt
			await progress.report({
				phase: 'COMPLETED',
				message: 'Синхронизация товара завершена',
				processed: totalSyncItems,
				total: totalSyncItems,
				force: true
			})
			this.logger.log(
				`Completed MoySklad product sync for catalog ${catalogId}, product ${productId}: externalId=${result.externalId}, created=${result.created}, updated=${result.updated || variantsChanged}, variants=${variantStats.total}, variantCreated=${variantStats.created}, variantUpdated=${variantStats.updated}, variantDeleted=${variantStats.deleted}, imagesImported=${result.imagesImported}, durationMs=${durationMs}`
			)

			return {
				ok: true,
				productId: result.productId,
				externalId: result.externalId,
				created: result.created,
				updated: result.updated || variantsChanged,
				productUpdated:
					result.updated ||
					variantStats.productStatusUpdated ||
					defaultVariantRecovered,
				imagesImported: result.imagesImported,
				totalVariants: variantStats.total,
				createdVariants: variantStats.created,
				updatedVariants: variantStats.updated,
				deletedVariants: variantStats.deleted,
				skippedVariants: variantStats.skipped,
				warnings: variantStats.warnings,
				errors: variantStats.errors,
				durationMs
			}
		} catch (error) {
			await progress.report({
				phase: 'FAILED',
				message: this.renderErrorMessage(error),
				force: true
			})
			this.logger.error(
				`MoySklad product sync failed for catalog ${catalogId}, product ${productId}: ${this.renderErrorMessage(error)}`
			)
			await this.repo.failMoySkladSync(catalogId, this.renderErrorMessage(error))
			throw this.wrapSyncError(error)
		}
	}

	async syncStock(
		catalogId: string,
		options: SyncProgressOptions = {}
	): Promise<SyncStockResult> {
		const startedAt = Date.now()
		const progress = this.createProgressReporter(options.runId)
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
		await this.beginSyncOrThrow(catalogId)
		this.logger.log(`Starting MoySklad stock sync for catalog ${catalogId}`)

		try {
			const integration = await this.getActiveIntegration(catalogId)
			const metadata = this.metadataCrypto.parseStoredMetadata(
				integration.metadata
			)
			if (!metadata.syncStock) {
				throw new ConflictException(
					'MoySklad stock sync is disabled in integration settings'
				)
			}

			const inventoryMode = await this.repo.findCatalogInventoryMode(catalogId)
			if (inventoryMode === CATALOG_INVENTORY_MODE_INTERNAL) {
				const syncedAt = new Date()
				await this.repo.finishMoySkladSync(catalogId, {
					totalProducts: 0,
					createdProducts: 0,
					updatedProducts: 0,
					deletedProducts: 0,
					syncedAt,
					lastStockSyncedAt: syncedAt
				})
				const durationMs = Date.now() - startedAt
				await progress.report({
					phase: 'COMPLETED',
					message:
						'Синхронизация остатков не требуется для внутреннего склада',
					processed: 0,
					total: 0,
					force: true
				})
				this.logger.log(
					`Completed MoySklad stock reconciliation for INTERNAL inventory catalog ${catalogId}: stockRows=0, applied=0, skipped=0, durationMs=${durationMs}`
				)

				return {
					ok: true,
					total: 0,
					updated: 0,
					updatedProducts: 0,
					updatedVariants: 0,
					skipped: 0,
					durationMs,
					syncedAt
				}
			}
			const client = new MoySkladClient({ token: metadata.token })
			const features = await this.featureEntitlements.getCurrentFeatures(catalogId)
			const canSyncVariants =
				features.canUseProductTypes && features.canUseProductVariants
			const stockResult = await this.stockSync.syncExternalStock({
				catalogId,
				integrationId: integration.id,
				client,
				canSyncVariants,
				progress
			})

			const syncedAt = new Date()
			await this.repo.finishMoySkladSync(catalogId, {
				totalProducts: stockResult.total,
				createdProducts: 0,
				updatedProducts: stockResult.updated,
				deletedProducts: 0,
				syncedAt,
				lastStockSyncedAt: syncedAt
			})
			if (stockResult.updated > 0) {
				await this.invalidateProductCaches(catalogId)
			}

			const durationMs = Date.now() - startedAt
			await progress.report({
				phase: 'COMPLETED',
				message: 'Синхронизация остатков завершена',
				processed: stockResult.total,
				total: stockResult.total,
				force: true
			})
			this.logger.log(
				`Completed MoySklad stock sync for catalog ${catalogId}: stockRows=${stockResult.total}, updatedProducts=${stockResult.updatedProducts}, updatedVariants=${stockResult.updatedVariants}, skipped=${stockResult.skipped}, durationMs=${durationMs}`
			)

			return {
				ok: true,
				total: stockResult.total,
				updated: stockResult.updated,
				updatedProducts: stockResult.updatedProducts,
				updatedVariants: stockResult.updatedVariants,
				skipped: stockResult.skipped,
				durationMs,
				syncedAt
			}
		} catch (error) {
			await progress.report({
				phase: 'FAILED',
				message: this.renderErrorMessage(error),
				force: true
			})
			this.logger.error(
				`MoySklad stock sync failed for catalog ${catalogId}: ${this.renderErrorMessage(error)}`
			)
			await this.repo.failMoySkladSync(catalogId, this.renderErrorMessage(error))
			throw this.wrapSyncError(error)
		}
	}

	async syncWebhookStock(
		catalogId: string,
		options: SyncProgressOptions & { reportUrls: string[] }
	): Promise<SyncStockResult> {
		const startedAt = Date.now()
		const progress = this.createProgressReporter(options.runId)
		await this.featureEntitlements.assertCanUseMoySkladIntegration(catalogId)
		await this.beginSyncOrThrow(catalogId)
		this.logger.log(
			`Starting MoySklad webhook stock sync for catalog ${catalogId}: reportUrls=${options.reportUrls.length}`
		)

		try {
			const integration = await this.getActiveIntegration(catalogId)
			const metadata = this.metadataCrypto.parseStoredMetadata(
				integration.metadata
			)
			if (!metadata.syncStock) {
				throw new ConflictException(
					'MoySklad stock sync is disabled in integration settings'
				)
			}

			const inventoryMode = await this.repo.findCatalogInventoryMode(catalogId)
			if (inventoryMode === CATALOG_INVENTORY_MODE_INTERNAL) {
				const syncedAt = new Date()
				await this.repo.finishMoySkladSync(catalogId, {
					totalProducts: 0,
					createdProducts: 0,
					updatedProducts: 0,
					deletedProducts: 0,
					syncedAt,
					lastStockSyncedAt: syncedAt
				})
				const durationMs = Date.now() - startedAt
				await progress.report({
					phase: 'COMPLETED',
					message:
						'MoySklad webhook stock sync skipped for INTERNAL inventory catalog',
					processed: 0,
					total: 0,
					force: true
				})

				return {
					ok: true,
					total: 0,
					updated: 0,
					updatedProducts: 0,
					updatedVariants: 0,
					skipped: 0,
					durationMs,
					syncedAt
				}
			}

			await progress.report({
				phase: 'SYNCING_STOCK',
				message: 'Fetching MoySklad webhook stock reports',
				processed: 0,
				total: options.reportUrls.length,
				force: true
			})

			const client = new MoySkladClient({ token: metadata.token })
			const stockMap = new Map<string, number>()
			for (const reportUrl of options.reportUrls) {
				const reportStockMap = await client.getStockFromReportUrl(reportUrl)
				for (const [externalId, stock] of reportStockMap) {
					stockMap.set(externalId, stock)
				}
			}

			const features = await this.featureEntitlements.getCurrentFeatures(catalogId)
			const canSyncVariants =
				features.canUseProductTypes && features.canUseProductVariants
			const stockResult = await this.stockSync.applyExternalStockMap({
				catalogId,
				integrationId: integration.id,
				stockMap,
				canSyncVariants,
				progress
			})

			const syncedAt = new Date()
			await this.repo.finishMoySkladSync(catalogId, {
				totalProducts: stockResult.total,
				createdProducts: 0,
				updatedProducts: stockResult.updated,
				deletedProducts: 0,
				syncedAt,
				lastStockSyncedAt: syncedAt
			})
			if (stockResult.updated > 0) {
				await this.invalidateProductCaches(catalogId)
			}

			const durationMs = Date.now() - startedAt
			await progress.report({
				phase: 'COMPLETED',
				message: 'MoySklad webhook stock sync completed',
				processed: stockResult.total,
				total: stockResult.total,
				force: true
			})
			this.logger.log(
				`Completed MoySklad webhook stock sync for catalog ${catalogId}: stockRows=${stockResult.total}, updatedProducts=${stockResult.updatedProducts}, updatedVariants=${stockResult.updatedVariants}, skipped=${stockResult.skipped}, durationMs=${durationMs}`
			)

			return {
				ok: true,
				total: stockResult.total,
				updated: stockResult.updated,
				updatedProducts: stockResult.updatedProducts,
				updatedVariants: stockResult.updatedVariants,
				skipped: stockResult.skipped,
				durationMs,
				syncedAt
			}
		} catch (error) {
			await progress.report({
				phase: 'FAILED',
				message: this.renderErrorMessage(error),
				force: true
			})
			this.logger.error(
				`MoySklad webhook stock sync failed for catalog ${catalogId}: ${this.renderErrorMessage(error)}`
			)
			await this.repo.failMoySkladSync(catalogId, this.renderErrorMessage(error))
			throw this.wrapSyncError(error)
		}
	}

	private createProgressReporter(runId?: string | null): SyncProgressReporter {
		let lastReportedAt = 0
		let lastProcessed = -1
		let lastTotal: number | null = null

		return {
			report: async input => {
				if (!runId) return

				const processed = Math.max(0, Math.trunc(input.processed ?? 0))
				const total =
					typeof input.total === 'number' && Number.isFinite(input.total)
						? Math.max(0, Math.trunc(input.total))
						: null
				const percent =
					total !== null && total > 0
						? Math.min(100, Math.max(0, Math.round((processed / total) * 100)))
						: total === 0
							? 100
							: null
				const now = Date.now()
				const shouldReport =
					input.force ||
					now - lastReportedAt >= SYNC_PROGRESS_MIN_INTERVAL_MS ||
					Math.abs(processed - lastProcessed) >= SYNC_PROGRESS_MIN_ITEM_DELTA ||
					total !== lastTotal

				if (!shouldReport) return

				lastReportedAt = now
				lastProcessed = processed
				lastTotal = total

				const snapshot: SyncProgressSnapshot = {
					phase: input.phase,
					message: input.message,
					processed,
					total,
					percent,
					updatedAt: new Date().toISOString()
				}

				try {
					await this.repo.updateSyncRunProgress(
						runId,
						snapshot as unknown as Prisma.InputJsonValue
					)
				} catch (error) {
					this.logger.warn(
						`Failed to persist MoySklad sync progress for run ${runId}: ${this.renderErrorMessage(error)}`
					)
				}
			}
		}
	}

	private async beginSyncOrThrow(catalogId: string): Promise<void> {
		const staleBefore = new Date(Date.now() - SYNC_LOCK_TIMEOUT_MS)
		const started = await this.repo.beginMoySkladSync(catalogId, staleBefore)
		if (started) return

		const integration = await this.repo.findMoySklad(catalogId)
		if (!integration) {
			throw new NotFoundException(
				'Интеграция MoySklad не настроена'
			)
		}
		if (!integration.isActive) {
			throw new ConflictException(
				'Интеграция MoySklad отключена'
			)
		}

		throw new ConflictException(
			'Синхронизация MoySklad уже выполняется'
		)
	}

	private async getActiveIntegration(
		catalogId: string
	): Promise<IntegrationRecord> {
		const integration = await this.repo.findMoySklad(catalogId)
		if (!integration) {
			throw new NotFoundException(
				'Интеграция MoySklad не настроена'
			)
		}
		if (!integration.isActive) {
			throw new ConflictException(
				'Интеграция MoySklad отключена'
			)
		}
		return integration
	}

	private readRawMetaString(
		rawMeta: Prisma.JsonValue | null,
		key: string
	): string | null {
		if (!rawMeta || typeof rawMeta !== 'object' || Array.isArray(rawMeta)) {
			return null
		}
		const value = (rawMeta as Record<string, unknown>)[key]
		return typeof value === 'string' && value.trim() ? value.trim() : null
	}

	private buildSyncItemIssue(
		code: string,
		product: MoySkladProduct,
		error: unknown
	): MoySkladSyncItemIssue {
		return {
			code,
			message: this.renderErrorMessage(error),
			externalId: this.resolveSyncItemExternalId(product)
		}
	}

	private resolveSyncItemExternalId(product: MoySkladProduct): string | null {
		if (isVariantAssortmentItem(product)) {
			return (
				resolveExternalVariantKey(product) ||
				readMoySkladNullableString(product.externalCode)
			)
		}

		return (
			resolveExternalProductKey(product) || readMoySkladNullableString(product.id)
		)
	}

	private async invalidateProductCaches(catalogId: string): Promise<void> {
		await this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId)
		await this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId)
	}

	private renderErrorMessage(error: unknown): string {
		return renderSafeProviderErrorMessage(error)
	}

	private wrapSyncError(error: unknown): Error {
		if (error instanceof HttpException) {
			return error
		}

		return new BadGatewayException(this.renderErrorMessage(error))
	}
}

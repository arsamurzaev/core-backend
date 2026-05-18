import type { Prisma } from '@generated/client'
import { ProductStatus, ProductVariantStatus } from '@generated/enums'
import {
	BadGatewayException,
	Inject,
	Injectable,
	Logger,
	Optional
} from '@nestjs/common'
import { createHash } from 'crypto'
import slugify from 'slugify'

import { createDomainEvent } from '@/shared/domain-events/domain-event.utils'
import {
	DOMAIN_EVENT_DISPATCHER,
	type DomainEventDispatcher
} from '@/shared/domain-events/domain-events.contract'

import { IntegrationRepository } from '../../integration.repository'

import { MoySkladClient } from './moysklad.client'
import type {
	MoySkladEntityType,
	MoySkladProduct,
	MoySkladVariant
} from './moysklad.types'
import { MoySkladVariantAttributeResolverService } from './moysklad.variant-attribute-resolver.service'

const PRODUCT_SKU_FALLBACK = 'SKU'
const PRODUCT_SKU_MAX_LENGTH = 100

export type MoySkladVariantSyncIssue = {
	code: string
	message: string
	externalId: string | null
	count?: number | null
}

export type MoySkladProductVariantSyncStats = {
	total: number
	created: number
	updated: number
	deleted: number
	skipped: number
	productStatusUpdated: boolean
	warnings: MoySkladVariantSyncIssue[]
	errors: MoySkladVariantSyncIssue[]
}

type VariantSyncProgressReporter = {
	report(input: {
		phase: 'FETCHING_VARIANTS' | 'SYNCING_VARIANTS' | 'SYNCING_STOCK'
		message: string
		processed?: number
		total?: number | null
		force?: boolean
	}): Promise<void>
}

type MoySkladIntegrationContext = {
	id: string
	catalogId: string
	metadata: unknown
}

type LocalProductSnapshot = {
	id: string
	sku: string
	price: number
	status: ProductStatus
}

type VariantUpsertResult = {
	variant: {
		id: string
		sku: string
		variantKey: string
	}
	created: boolean
	updated: boolean
	priceChanged: boolean
	previousPrice: number | null
	nextPrice: number | null
	stockChanged: boolean
	previousStock: number | null
	nextStock: number | null
}

type ProductTypeSyncResult = {
	productTypeId: string | null
	created: boolean
	assigned: boolean
	changed: boolean
}

type DefaultVariantResult = {
	variantId: string | null
	created: boolean
	updated: boolean
	priceChanged: boolean
	previousPrice: number | null
	nextPrice: number | null
	stockChanged: boolean
	previousStock: number | null
	nextStock: number | null
}

@Injectable()
export class MoySkladVariantSyncService {
	private readonly logger = new Logger(MoySkladVariantSyncService.name)

	constructor(
		private readonly repo: IntegrationRepository,
		private readonly variantAttributes: MoySkladVariantAttributeResolverService,
		@Optional()
		@Inject(DOMAIN_EVENT_DISPATCHER)
		private readonly events?: DomainEventDispatcher
	) {}

	createEmptyStats(): MoySkladProductVariantSyncStats {
		return {
			total: 0,
			created: 0,
			updated: 0,
			deleted: 0,
			skipped: 0,
			productStatusUpdated: false,
			warnings: [],
			errors: []
		}
	}

	async loadProductVariants(params: {
		client: MoySkladClient
		productExternalId: string
		syncStock: boolean
		progress?: VariantSyncProgressReporter
	}): Promise<MoySkladVariant[]> {
		await params.progress?.report({
			phase: 'FETCHING_VARIANTS',
			message: 'Получаем модификации товара из MoySklad',
			processed: 0,
			total: null,
			force: true
		})
		const variants = (
			await params.client.getVariantsByProduct(params.productExternalId)
		).filter(
			variant =>
				isSyncableVariantAssortmentItem(variant) &&
				resolveVariantParentProductExternalId(variant) === params.productExternalId
		)

		if (!params.syncStock || variants.length === 0) {
			return variants
		}

		const variantIds = variants.map(resolveExternalVariantKey).filter(Boolean)
		try {
			await params.progress?.report({
				phase: 'SYNCING_STOCK',
				message: 'Получаем остатки модификаций',
				processed: 0,
				total: variants.length,
				force: true
			})
			const stockMap = await params.client.getStockAll({
				assortmentId: variantIds
			})
			const variantsWithStock = variants.map(variant => {
				const externalId = resolveExternalVariantKey(variant)
				const stock = stockMap.get(externalId)
				return stock === undefined
					? variant
					: {
							...variant,
							stock: normalizeStockQuantity(stock)
						}
			})
			await params.progress?.report({
				phase: 'SYNCING_STOCK',
				message: 'Остатки модификаций получены',
				processed: variants.length,
				total: variants.length,
				force: true
			})
			return variantsWithStock
		} catch (error) {
			this.logger.warn(
				`Could not refresh MoySklad variant stock report for product ${params.productExternalId}; using variant entity stock: ${renderErrorMessage(error)}`
			)
			return variants
		}
	}

	async syncProductVariants(params: {
		catalogId: string
		integration: MoySkladIntegrationContext
		variants: MoySkladVariant[]
		priceTypeName: string
		syncStock: boolean
		syncPrice: boolean
		syncContent: boolean
		parentProductId: string
		progress?: VariantSyncProgressReporter
		baseProcessed?: number
		total?: number
	}): Promise<MoySkladProductVariantSyncStats> {
		const stats = this.createEmptyStats()
		stats.total = params.variants.length
		const baseProcessed = params.baseProcessed ?? 0
		const total = params.total ?? params.variants.length

		const parentProduct = await this.findLocalProduct(
			params.catalogId,
			params.parentProductId
		)
		if (!parentProduct) {
			stats.skipped = params.variants.length
			stats.warnings.push({
				code: 'MOYSKLAD_VARIANT_PARENT_NOT_FOUND',
				message: `MoySklad variant parent local product ${params.parentProductId} was not found during product sync`,
				externalId: null,
				count: params.variants.length
			})
			await params.progress?.report({
				phase: 'SYNCING_VARIANTS',
				message: 'Модификации пропущены: локальный товар не найден',
				processed: baseProcessed,
				total,
				force: true
			})
			return stats
		}

		let processed = 0
		for (const variant of params.variants) {
			try {
				const result = await this.syncExternalVariant({
					catalogId: params.catalogId,
					integration: params.integration,
					product: variant,
					priceTypeName: params.priceTypeName,
					syncStock: params.syncStock,
					syncPrice: params.syncPrice,
					syncContent: params.syncContent,
					parentProductId: params.parentProductId,
					parentProduct
				})

				if (result.created) {
					stats.created += 1
				} else if (result.updated) {
					stats.updated += 1
				}
			} catch (error) {
				stats.skipped += 1
				const issue = buildSyncItemIssue(
					'MOYSKLAD_VARIANT_SYNC_FAILED',
					variant,
					error
				)
				stats.errors.push(issue)
				this.logger.error('MoySklad product variant sync item failed', {
					catalogId: params.catalogId,
					integrationId: params.integration.id,
					parentProductId: params.parentProductId,
					externalId: issue.externalId,
					error: issue.message
				})
			} finally {
				processed += 1
				await params.progress?.report({
					phase: 'SYNCING_VARIANTS',
					message: `Синхронизируем модификации: ${processed}/${params.variants.length}`,
					processed: baseProcessed + processed,
					total
				})
			}
		}

		stats.productStatusUpdated =
			await this.repo.recomputeProductStatusFromVariants(
				params.catalogId,
				params.parentProductId
			)

		return stats
	}

	async syncExternalVariant(params: {
		catalogId: string
		integration: MoySkladIntegrationContext
		product: MoySkladProduct
		priceTypeName: string
		syncStock: boolean
		syncPrice: boolean
		syncContent: boolean
		parentProductId: string
		parentProduct?: unknown
		tx?: Prisma.TransactionClient
	}): Promise<{
		variantId: string
		externalId: string
		created: boolean
		updated: boolean
	}> {
		const externalId = resolveExternalVariantKey(params.product)
		if (!externalId) {
			throw new BadGatewayException(
				'MoySklad variant id is required for variant sync'
			)
		}

		const externalCode = resolveExternalCode(params.product)
		const externalUpdatedAt = parseMoySkladDate(params.product.updated)
		const stock =
			typeof params.product.stock === 'number' &&
			Number.isFinite(params.product.stock)
				? params.product.stock
				: 0
		const resolvedAttributes = await this.variantAttributes.resolveForVariant({
			catalogId: params.catalogId,
			metadata: params.integration.metadata,
			characteristics: params.product.characteristics ?? [],
			tx: params.tx
		})
		const variantKey =
			this.variantAttributes.buildVariantKey(resolvedAttributes) ||
			`moysklad=${externalId}`
		const sku = buildVariantSku(params.product, externalId)
		const parentPrice = readNumberField(params.parentProduct, 'price')
		const resolvedPrice = resolvePrice(params.product, params.priceTypeName)
		const price = params.syncPrice
			? resolvedPrice > 0
				? resolvedPrice
				: parentPrice
			: null
		const status = resolveVariantStatus(params.product, stock, params.syncStock)
		const productTypeSync = params.syncContent
			? await this.ensureVariantProductType({
					catalogId: params.catalogId,
					productId: params.parentProductId,
					attributes: resolvedAttributes,
					tx: params.tx
				})
			: {
					productTypeId: null,
					created: false,
					assigned: false,
					changed: false
				}
		if (productTypeSync.created) {
			this.logger.log(
				`Created MoySklad product type for variants: catalog=${params.catalogId}, productId=${params.parentProductId}, productTypeId=${productTypeSync.productTypeId}`
			)
		}
		if (productTypeSync.assigned) {
			this.logger.log(
				`Assigned MoySklad product type to product: catalog=${params.catalogId}, productId=${params.parentProductId}, productTypeId=${productTypeSync.productTypeId}`
			)
		}

		const result = await this.upsertIntegratedVariant({
			catalogId: params.catalogId,
			integrationId: params.integration.id,
			productId: params.parentProductId,
			externalId,
			externalCode: externalCode || null,
			externalUpdatedAt,
			rawMeta: buildRawMeta(params.product),
			sku,
			variantKey,
			price,
			syncPrice: params.syncPrice,
			syncContent: params.syncContent,
			stock,
			status,
			attributes: resolvedAttributes.map(attribute => ({
				attributeId: attribute.attributeId,
				value: attribute.value,
				displayName: attribute.displayName
			})),
			tx: params.tx
		})

		if (result.created) {
			this.logger.log(
				`Created product variant from MoySklad: catalog=${params.catalogId}, externalId=${externalId}, productId=${params.parentProductId}, variantId=${result.variant.id}, sku=${result.variant.sku}, variantKey=${result.variant.variantKey}`
			)
		} else if (result.updated) {
			this.logger.log(
				`Updated product variant from MoySklad: catalog=${params.catalogId}, externalId=${externalId}, productId=${params.parentProductId}, variantId=${result.variant.id}, sku=${result.variant.sku}`
			)
		}

		if (!params.tx) {
			await this.publishVariantFieldEvents({
				catalogId: params.catalogId,
				integrationId: params.integration.id,
				productId: params.parentProductId,
				variantId: result.variant.id,
				externalId,
				priceChanged: result.priceChanged,
				previousPrice: result.previousPrice,
				nextPrice: result.nextPrice,
				stockChanged: result.stockChanged,
				previousStock: result.previousStock,
				nextStock: result.nextStock,
				reason: 'moysklad_variant_sync'
			})
		}

		return {
			variantId: result.variant.id,
			externalId,
			created: result.created,
			updated: result.updated || productTypeSync.changed
		}
	}

	async recoverDefaultVariantAfterMissingExternalVariants(params: {
		catalogId: string
		integration: MoySkladIntegrationContext
		product: MoySkladProduct
		productId: string
		priceTypeName: string
		syncStock: boolean
		syncPrice: boolean
	}): Promise<boolean> {
		const product = await this.findLocalProduct(
			params.catalogId,
			params.productId
		)
		if (!product) {
			return false
		}

		const stock =
			typeof params.product.stock === 'number' &&
			Number.isFinite(params.product.stock)
				? params.product.stock
				: undefined
		const price = params.syncPrice
			? resolvePrice(params.product, params.priceTypeName)
			: null

		return this.ensureDefaultVariantForSyncedProduct({
			integration: params.integration,
			product: params.product,
			productId: params.productId,
			sku: product.sku,
			price,
			stock,
			productStatus: product.status,
			syncStock: params.syncStock,
			syncPrice: params.syncPrice
		})
	}

	async ensureDefaultVariantForSyncedProduct(params: {
		integration: MoySkladIntegrationContext
		product: MoySkladProduct
		productId: string
		sku: string
		price: number | null
		stock?: number
		productStatus: ProductStatus
		syncStock: boolean
		syncPrice: boolean
		tx?: Prisma.TransactionClient
	}): Promise<boolean> {
		const rawResult: unknown = await this.repo.ensureDefaultVariantForProduct(
			{
				integrationId: params.integration.id,
				productId: params.productId,
				sku: params.sku,
				price: params.price,
				syncPrice: params.syncPrice,
				stock: params.stock ?? 0,
				status: resolveDefaultVariantStatus(
					params.product,
					params.productStatus,
					params.stock,
					params.syncStock
				)
			},
			params.tx
		)
		const result = normalizeDefaultVariantResult(rawResult)

		if (result.created) {
			this.logger.log(
				`Created default product variant from MoySklad product: catalog=${params.integration.catalogId}, productId=${params.productId}, variantId=${result.variantId ?? '<unknown>'}`
			)
		}

		if (!params.tx && result.variantId) {
			await this.publishVariantFieldEvents({
				catalogId: params.integration.catalogId,
				integrationId: params.integration.id,
				productId: params.productId,
				variantId: result.variantId,
				externalId: resolveSyncItemExternalId(params.product),
				priceChanged: result.priceChanged,
				previousPrice: result.previousPrice,
				nextPrice: result.nextPrice,
				stockChanged: result.stockChanged,
				previousStock: result.previousStock,
				nextStock: result.nextStock,
				reason: 'moysklad_default_variant_sync'
			})
		}

		return result.created || result.updated
	}

	private async findLocalProduct(
		catalogId: string,
		productId: string
	): Promise<LocalProductSnapshot | null> {
		const rawProduct: unknown = await this.repo.findProductById(
			catalogId,
			productId
		)
		return normalizeLocalProduct(rawProduct)
	}

	private async ensureVariantProductType(params: {
		catalogId: string
		productId: string
		attributes: Parameters<
			IntegrationRepository['ensureMoySkladProductTypeForVariantAttributes']
		>[0]['attributes']
		tx?: Prisma.TransactionClient
	}): Promise<ProductTypeSyncResult> {
		const rawResult: unknown =
			await this.repo.ensureMoySkladProductTypeForVariantAttributes(
				{
					catalogId: params.catalogId,
					productId: params.productId,
					attributes: params.attributes
				},
				params.tx
			)
		return normalizeProductTypeSyncResult(rawResult)
	}

	private async upsertIntegratedVariant(
		params: Parameters<
			IntegrationRepository['upsertIntegratedProductVariant']
		>[0] & {
			tx?: Prisma.TransactionClient
		}
	): Promise<VariantUpsertResult> {
		const { tx, ...payload } = params
		const rawResult: unknown = await this.repo.upsertIntegratedProductVariant(
			payload,
			tx
		)
		const result = normalizeVariantUpsertResult(rawResult)
		if (!result) {
			throw new Error('MoySklad variant upsert did not return a variant')
		}
		return result
	}

	private async publishVariantFieldEvents(params: {
		catalogId: string
		integrationId: string
		productId: string
		variantId: string
		externalId: string | null
		priceChanged: boolean
		previousPrice: number | null
		nextPrice: number | null
		stockChanged: boolean
		previousStock: number | null
		nextStock: number | null
		reason: string
	}): Promise<void> {
		if (!this.events) return

		const events = []
		if (
			params.priceChanged &&
			hasNumericFieldChanged(params.previousPrice, params.nextPrice)
		) {
			events.push(
				createDomainEvent({
					type: 'variant.price_changed',
					catalogId: params.catalogId,
					productId: params.productId,
					variantId: params.variantId,
					previousPrice: params.previousPrice,
					nextPrice: params.nextPrice,
					source: 'integration',
					reason: params.reason,
					integrationId: params.integrationId,
					externalId: params.externalId
				})
			)
		}

		if (
			params.stockChanged &&
			hasNumericFieldChanged(params.previousStock, params.nextStock)
		) {
			events.push(
				createDomainEvent({
					type: 'variant.stock_changed',
					catalogId: params.catalogId,
					productId: params.productId,
					variantId: params.variantId,
					previousStock: params.previousStock,
					nextStock: params.nextStock,
					source: 'integration',
					reason: params.reason,
					integrationId: params.integrationId,
					externalId: params.externalId
				})
			)
		}

		if (events.length) {
			await this.events.dispatchMany(events)
		}
	}
}

function normalizeLocalProduct(value: unknown): LocalProductSnapshot | null {
	if (!isRecord(value)) {
		return null
	}

	const id = readMoySkladString(value.id)
	const sku = readMoySkladString(value.sku)
	const status = value.status
	if (
		!id ||
		!sku ||
		(status !== ProductStatus.ACTIVE &&
			status !== ProductStatus.HIDDEN &&
			status !== ProductStatus.DRAFT)
	) {
		return null
	}

	return {
		id,
		sku,
		price: readNumberField(value, 'price'),
		status
	}
}

function normalizeProductTypeSyncResult(value: unknown): ProductTypeSyncResult {
	if (!isRecord(value)) {
		return {
			productTypeId: null,
			created: false,
			assigned: false,
			changed: false
		}
	}

	return {
		productTypeId: readMoySkladNullableString(value.productTypeId),
		created: value.created === true,
		assigned: value.assigned === true,
		changed: value.changed === true
	}
}

function normalizeVariantUpsertResult(
	value: unknown
): VariantUpsertResult | null {
	if (!isRecord(value)) {
		return null
	}

	const variant = normalizeVariantResult(value.variant)
	if (!variant) {
		return null
	}

	return {
		variant,
		created: value.created === true,
		updated: value.updated === true,
		priceChanged: value.priceChanged === true,
		previousPrice: readNullableNumberField(value, 'previousPrice'),
		nextPrice: readNullableNumberField(value, 'nextPrice'),
		stockChanged: value.stockChanged === true,
		previousStock: readNullableNumberField(value, 'previousStock'),
		nextStock: readNullableNumberField(value, 'nextStock')
	}
}

function normalizeVariantResult(
	value: unknown
): VariantUpsertResult['variant'] | null {
	if (!isRecord(value)) {
		return null
	}

	const id = readMoySkladString(value.id)
	const sku = readMoySkladString(value.sku)
	const variantKey = readMoySkladString(value.variantKey)
	if (!id || !sku) {
		return null
	}

	return {
		id,
		sku,
		variantKey
	}
}

function normalizeDefaultVariantResult(value: unknown): DefaultVariantResult {
	if (!isRecord(value)) {
		return {
			variantId: null,
			created: false,
			updated: false,
			priceChanged: false,
			previousPrice: null,
			nextPrice: null,
			stockChanged: false,
			previousStock: null,
			nextStock: null
		}
	}

	return {
		variantId: isRecord(value.variant)
			? readMoySkladNullableString(value.variant.id)
			: null,
		created: value.created === true,
		updated: value.updated === true,
		priceChanged: value.priceChanged === true,
		previousPrice: readNullableNumberField(value, 'previousPrice'),
		nextPrice: readNullableNumberField(value, 'nextPrice'),
		stockChanged: value.stockChanged === true,
		previousStock: readNullableNumberField(value, 'previousStock'),
		nextStock: readNullableNumberField(value, 'nextStock')
	}
}

function buildSyncItemIssue(
	code: string,
	product: MoySkladProduct,
	error: unknown
): MoySkladVariantSyncIssue {
	return {
		code,
		message: renderErrorMessage(error),
		externalId: resolveSyncItemExternalId(product)
	}
}

function resolveSyncItemExternalId(product: MoySkladProduct): string | null {
	return (
		resolveExternalVariantKey(product) ||
		readMoySkladNullableString(product.externalCode)
	)
}

function resolveExternalCode(product: MoySkladProduct): string {
	return (
		readMoySkladString(product.code) ||
		readMoySkladString(product.article) ||
		readMoySkladString(product.externalCode) ||
		readMoySkladString(product.name) ||
		''
	)
}

function resolveExternalVariantKey(product: MoySkladProduct): string {
	return readMoySkladString(product.id)
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

function isSyncableVariantAssortmentItem(product: MoySkladProduct): boolean {
	return (
		resolveExternalEntityType(product) === 'variant' &&
		Boolean(resolveExternalVariantKey(product)) &&
		Boolean(resolveVariantParentProductExternalId(product))
	)
}

function resolvePrice(product: MoySkladProduct, priceTypeName: string): number {
	const normalizedPriceTypeName = readMoySkladString(priceTypeName)
	const salePrices = Array.isArray(product.salePrices) ? product.salePrices : []
	const selected =
		salePrices.find(
			price =>
				readMoySkladString(price.priceType?.name) === normalizedPriceTypeName
		) ?? salePrices[0]

	const rawValue = Number(selected?.value ?? 0)
	if (!Number.isFinite(rawValue) || rawValue <= 0) return 0
	return Math.round(rawValue) / 100
}

function parseMoySkladDate(value?: unknown): Date | null {
	const raw = readMoySkladString(value)
	if (!raw) return null

	const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
	const withTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
		? normalized
		: `${normalized}Z`
	const parsed = new Date(withTimezone)

	return Number.isNaN(parsed.getTime()) ? null : parsed
}

function buildVariantSku(product: MoySkladProduct, externalId: string): string {
	const base =
		buildSkuBase(
			resolveExternalCode(product) ||
				readMoySkladString(product.name) ||
				externalId
		) || PRODUCT_SKU_FALLBACK
	const hash = createHash('sha1')
		.update(externalId)
		.digest('hex')
		.slice(0, 8)
		.toUpperCase()
	const separator = '-'
	const headLength = Math.max(
		0,
		PRODUCT_SKU_MAX_LENGTH - separator.length - hash.length
	)
	const head = base.slice(0, headLength).replace(/-+$/g, '')
	return `${head || PRODUCT_SKU_FALLBACK}${separator}${hash}`.toUpperCase()
}

function resolveVariantStatus(
	product: MoySkladProduct,
	stock: number,
	syncStock: boolean
): ProductVariantStatus {
	if (product.archived) {
		return ProductVariantStatus.OUT_OF_STOCK
	}

	if (!syncStock) {
		return ProductVariantStatus.ACTIVE
	}

	return stock > 0
		? ProductVariantStatus.ACTIVE
		: ProductVariantStatus.OUT_OF_STOCK
}

function resolveDefaultVariantStatus(
	product: MoySkladProduct,
	productStatus: ProductStatus,
	stock: number | undefined,
	syncStock: boolean
): ProductVariantStatus {
	if (productStatus !== ProductStatus.ACTIVE || product.archived) {
		return ProductVariantStatus.OUT_OF_STOCK
	}

	if (
		!syncStock ||
		resolveExternalEntityType(product) === 'service' ||
		stock === undefined
	) {
		return ProductVariantStatus.ACTIVE
	}

	return stock > 0
		? ProductVariantStatus.ACTIVE
		: ProductVariantStatus.OUT_OF_STOCK
}

function buildRawMeta(product: MoySkladProduct): Prisma.InputJsonValue {
	const barcodes = Array.isArray(product.barcodes) ? product.barcodes : []
	const characteristics = Array.isArray(product.characteristics)
		? product.characteristics
		: []

	return {
		id: readMoySkladNullableString(product.id),
		type: resolveExternalEntityType(product),
		name: readMoySkladNullableString(product.name),
		code: readMoySkladNullableString(product.code),
		article: readMoySkladNullableString(product.article),
		externalCode: readMoySkladNullableString(product.externalCode),
		stock:
			typeof product.stock === 'number' && Number.isFinite(product.stock)
				? product.stock
				: null,
		barcodes: barcodes.map(barcode => ({
			ean13: readMoySkladNullableString(barcode.ean13),
			ean8: readMoySkladNullableString(barcode.ean8),
			code128: readMoySkladNullableString(barcode.code128),
			gtin: readMoySkladNullableString(barcode.gtin)
		})),
		productFolder: product.productFolder
			? {
					id: readMoySkladNullableString(product.productFolder.id),
					name: readMoySkladNullableString(product.productFolder.name)
				}
			: null,
		product: product.product
			? {
					id:
						readMoySkladNullableString(product.product.id) ??
						extractMoySkladEntityIdFromHref(product.product.meta?.href, 'product'),
					name: readMoySkladNullableString(product.product.name)
				}
			: null,
		characteristics: characteristics.map(characteristic => ({
			id: readMoySkladNullableString(characteristic.id),
			name: readMoySkladNullableString(characteristic.name),
			value: readMoySkladNullableString(characteristic.value)
		})),
		archived: Boolean(product.archived),
		updated: readMoySkladNullableString(product.updated)
	}
}

function buildSkuBase(value: string): string {
	return slugifyValue(value, false).toUpperCase()
}

function slugifyValue(value: string, lower: boolean): string {
	const slug = slugify(value, { lower, strict: true, trim: true })
	return slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
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

function normalizeStockQuantity(value: number): number {
	if (!Number.isFinite(value)) {
		return 0
	}

	return Math.max(0, Math.trunc(value))
}

function readNumberField(value: unknown, key: string): number {
	if (!isRecord(value)) {
		return 0
	}

	const numeric = Number(value[key] ?? 0)
	return Number.isFinite(numeric) ? numeric : 0
}

function readNullableNumberField(value: unknown, key: string): number | null {
	if (!isRecord(value)) {
		return null
	}

	const raw = value[key]
	if (raw === null || raw === undefined) return null
	const numeric = Number(raw)
	return Number.isFinite(numeric) ? numeric : null
}

function hasNumericFieldChanged(
	previous: number | null,
	next: number | null
): boolean {
	return previous !== next
}

function readMoySkladString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : ''
}

function readMoySkladNullableString(value: unknown): string | null {
	const normalized = readMoySkladString(value)
	return normalized || null
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function renderErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message
	}
	return 'Неизвестная ошибка'
}

import type { Prisma } from '@generated/client'
import { ProductStatus } from '@generated/enums'
import {
	BadGatewayException,
	ConflictException,
	HttpException,
	Injectable,
	Logger,
	NotFoundException
} from '@nestjs/common'
import { createHash } from 'crypto'
import slugify from 'slugify'

import { S3Service } from '@/modules/s3/s3.service'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { MediaRepository } from '@/shared/media/media.repository'

import {
	IntegrationRecord,
	IntegrationRepository,
	type ProductSyncRecord
} from '../../integration.repository'

import { MoySkladClient } from './moysklad.client'
import { MoySkladMetadataCryptoService } from './moysklad.metadata'
import type { MoySkladProduct } from './moysklad.types'

type CategorySyncRecord = { id: string; name: string }

const SYNC_LOCK_TIMEOUT_MS = 10 * 60 * 1000
const PRODUCT_SLUG_FALLBACK = 'product'
const PRODUCT_SKU_FALLBACK = 'SKU'
const PRODUCT_NAME_FALLBACK = 'Product'
const PRODUCT_SLUG_MAX_LENGTH = 255
const PRODUCT_SKU_MAX_LENGTH = 100
const IMAGE_IMPORT_PATH = 'integrations/moysklad/products'
const ALLOWED_IMAGE_MIME_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/avif'
])

type SyncCatalogResult = {
	ok: true
	total: number
	created: number
	updated: number
	deleted: number
	durationMs: number
	syncedAt: Date
}

type SyncCatalogOptions = {
	updatedFrom?: Date | null
}

type SyncProductResult = {
	ok: true
	productId: string
	externalId: string
	created: boolean
	updated: boolean
	imagesImported: number
	durationMs: number
}

type SyncExternalProductParams = {
	catalogId: string
	integration: IntegrationRecord
	client: MoySkladClient
	product: MoySkladProduct
	priceTypeName: string
	importImages: boolean
	refreshImagesForExistingProduct?: boolean
	syncStock: boolean
	stockByExternalId?: Map<string, number>
	existingProduct?: ProductSyncRecord | null
	existingLinkExternalId?: string | null
	tx?: Prisma.TransactionClient
}

type SyncExternalProductOutcome = {
	productId: string
	externalId: string
	created: boolean
	updated: boolean
	imagesImported: number
}

type ImportedProductImages = {
	mediaIds: string[]
	sourceCount: number
}

function slugifyValue(value: string, lower: boolean): string {
	const slug = slugify(value, { lower, strict: true, trim: true })
	return slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
}

function buildSlugBase(value: string): string {
	return slugifyValue(value, true)
}

function buildSkuBase(value: string): string {
	return slugifyValue(value, false).toUpperCase()
}

function applySuffix(base: string, suffix: number, maxLength: number): string {
	const suffixPart = suffix > 0 ? `-${suffix}` : ''
	const headLength = Math.max(0, maxLength - suffixPart.length)
	const head = base.slice(0, headLength).replace(/-+$/g, '')
	return `${head}${suffixPart}`
}

function buildHashedCandidate(base: string, maxLength: number): string {
	const hash = createHash('sha1').update(base).digest('hex').slice(0, 8)
	const separator = base ? '-' : ''
	const headLength = Math.max(0, maxLength - hash.length - separator.length)
	const head = base.slice(0, headLength).replace(/-+$/g, '')
	return `${head}${separator}${hash}`
}

function normalizeProductName(value?: string | null): string {
	const normalized = value?.trim()
	return normalized || PRODUCT_NAME_FALLBACK
}

function parseMoySkladDate(value?: string | null): Date | null {
	const raw = value?.trim()
	if (!raw) return null

	const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
	const withTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)
		? normalized
		: `${normalized}Z`
	const parsed = new Date(withTimezone)

	return Number.isNaN(parsed.getTime()) ? null : parsed
}

function resolveExternalCode(product: MoySkladProduct): string {
	return (
		product.code?.trim() ||
		product.article?.trim() ||
		product.externalCode?.trim() ||
		product.name?.trim() ||
		''
	)
}

function resolvePrice(product: MoySkladProduct, priceTypeName: string): number {
	const selected =
		product.salePrices?.find(
			price => price.priceType?.name?.trim() === priceTypeName.trim()
		) ?? product.salePrices?.[0]

	const rawValue = Number(selected?.value ?? 0)
	if (!Number.isFinite(rawValue) || rawValue <= 0) return 0
	return Math.round(rawValue) / 100
}

function resolveProductStatus(
	product: MoySkladProduct,
	stock: number | undefined,
	syncStock: boolean,
	currentStatus?: ProductStatus | null
): ProductStatus {
	if (currentStatus === ProductStatus.DRAFT || currentStatus === ProductStatus.DELETE) {
		return currentStatus
	}

	if (product.archived) {
		return ProductStatus.HIDDEN
	}

	if (!syncStock) {
		return currentStatus ?? ProductStatus.ACTIVE
	}

	return (stock ?? 0) > 0 ? ProductStatus.ACTIVE : ProductStatus.HIDDEN
}

@Injectable()
export class MoySkladSyncService {
	private readonly logger = new Logger(MoySkladSyncService.name)

	constructor(
		private readonly repo: IntegrationRepository,
		private readonly s3Service: S3Service,
		private readonly mediaRepo: MediaRepository,
		private readonly cache: CacheService,
		private readonly metadataCrypto: MoySkladMetadataCryptoService
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
	): Promise<SyncCatalogResult> {
		const startedAt = Date.now()
		await this.beginSyncOrThrow(catalogId)

		try {
			const integration = await this.getActiveIntegration(catalogId)
			const metadata = this.metadataCrypto.parseStoredMetadata(
				integration.metadata
			)
			const client = new MoySkladClient({ token: metadata.token })
			const updatedFrom = options.updatedFrom ?? undefined
			const isIncrementalSync = Boolean(updatedFrom)
			this.logger.log(
				`Starting MoySklad catalog sync for catalog ${catalogId}: integration=${integration.id}, updatedFrom=${updatedFrom?.toISOString() ?? 'full-snapshot'}, importImages=${metadata.importImages}, syncStock=${metadata.syncStock}`
			)
			const stockByExternalId = metadata.syncStock
				? await client.getStockAll()
				: undefined
			this.logger.log(
				`Fetched MoySklad stock snapshot for catalog ${catalogId}: ${stockByExternalId?.size ?? 0} items`
			)
			const products = await client.getAllProducts(updatedFrom)
			this.logger.log(
				`Fetched ${products.length} products from MoySklad for catalog ${catalogId}`
			)
			if (products.length === 0) {
				if (isIncrementalSync) {
					this.logger.log(
						`No MoySklad product changes found for catalog ${catalogId} since ${updatedFrom?.toISOString()}`
					)
				} else {
					this.logger.warn(
						`MoySklad returned 0 products for catalog ${catalogId}. Check token permissions, filters, archived products, and whether the account really has products in the selected entity scope.`
					)
				}
			}

			let created = 0
			let updated = 0
			let processed = 0

			// Avoid a long-lived interactive transaction here because image
			// downloads/uploads can easily exceed Prisma's default timeout.
			for (const product of products) {
				processed += 1
				if (processed % 100 === 0) {
					this.logger.log(`Processed ${processed} products...`)
				}

				const result = await this.syncExternalProduct({
					catalogId,
					integration,
					client,
					product,
					priceTypeName: metadata.priceTypeName,
					importImages: metadata.importImages,
					syncStock: metadata.syncStock,
					stockByExternalId
				})

				if (result.created) {
					created += 1
				} else if (result.updated) {
					updated += 1
				}
			}

			this.logger.log(
				`Finished product sync loop for catalog ${catalogId}: processed=${processed}, created=${created}, updated=${updated}`
			)

			// Handle deleted products
			let deleted = 0
			if (!isIncrementalSync) {
				const currentExternalIds = new Set(products.map(p => p.id))
				const links = await this.repo.findProductLinksByIntegration(integration.id)
				for (const link of links) {
					if (!currentExternalIds.has(link.externalId)) {
						const product = await this.repo.findProductById(
							catalogId,
							link.productId
						)
						if (product && product.status === ProductStatus.ACTIVE) {
							await this.repo.updateProduct({
								productId: product.id,
								catalogId,
								data: { status: ProductStatus.HIDDEN }
							})
							deleted += 1
						}
					}
				}
			} else {
				this.logger.log(
					`Skipped missing-product archival for catalog ${catalogId} because sync used updatedFrom=${updatedFrom?.toISOString()}`
				)
			}

			this.logger.log(
				`Hidden ${deleted} missing products after MoySklad sync for catalog ${catalogId}`
			)

			const syncedAt = new Date()
			await this.repo.finishMoySkladSync(catalogId, {
				totalProducts: products.length,
				createdProducts: created,
				updatedProducts: updated,
				deletedProducts: deleted,
				syncedAt
			})
			await this.invalidateProductCaches(catalogId)

			const durationMs = Date.now() - startedAt
			this.logger.log(
				`Completed MoySklad catalog sync for catalog ${catalogId}: total=${products.length}, created=${created}, updated=${updated}, deleted=${deleted}, durationMs=${durationMs}`
			)

			return {
				ok: true,
				total: products.length,
				created,
				updated,
				deleted,
				durationMs,
				syncedAt
			}
		} catch (error) {
			this.logger.error(
				`MoySklad catalog sync failed for catalog ${catalogId}: ${this.renderErrorMessage(error)}`
			)
			await this.repo.failMoySkladSync(catalogId, this.renderErrorMessage(error))
			throw this.wrapSyncError(error)
		}
	}

	async syncProduct(
		catalogId: string,
		productId: string
	): Promise<SyncProductResult> {
		const startedAt = Date.now()
		await this.beginSyncOrThrow(catalogId)
		this.logger.log(
			`Starting MoySklad product sync for catalog ${catalogId}, product ${productId}`
		)

		try {
			const integration = await this.getActiveIntegration(catalogId)
			const metadata = this.metadataCrypto.parseStoredMetadata(
				integration.metadata
			)
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

			const stockByExternalId = metadata.syncStock
				? await client.getStockAll()
				: undefined
			const externalProduct = await client.getProduct(link.externalId)
			const result = await this.syncExternalProduct({
				catalogId,
				integration,
				client,
				product: externalProduct,
				priceTypeName: metadata.priceTypeName,
				importImages: metadata.importImages,
				refreshImagesForExistingProduct: true,
				syncStock: metadata.syncStock,
				stockByExternalId,
				existingProduct: localProduct,
				existingLinkExternalId: link.externalId
			})

			const syncedAt = new Date()
			await this.repo.finishMoySkladSync(catalogId, {
				totalProducts: 1,
				createdProducts: result.created ? 1 : 0,
				updatedProducts: result.updated ? 1 : 0,
				deletedProducts: 0,
				syncedAt
			})
			await this.invalidateProductCaches(catalogId)
			const durationMs = Date.now() - startedAt
			this.logger.log(
				`Completed MoySklad product sync for catalog ${catalogId}, product ${productId}: externalId=${result.externalId}, created=${result.created}, updated=${result.updated}, imagesImported=${result.imagesImported}, durationMs=${durationMs}`
			)

			return {
				ok: true,
				productId: result.productId,
				externalId: result.externalId,
				created: result.created,
				updated: result.updated,
				imagesImported: result.imagesImported,
				durationMs
			}
		} catch (error) {
			this.logger.error(
				`MoySklad product sync failed for catalog ${catalogId}, product ${productId}: ${this.renderErrorMessage(error)}`
			)
			await this.repo.failMoySkladSync(catalogId, this.renderErrorMessage(error))
			throw this.wrapSyncError(error)
		}
	}

	private async syncExternalProduct(
		params: SyncExternalProductParams
	): Promise<SyncExternalProductOutcome> {
		const externalId = params.product.id
		const externalCode = resolveExternalCode(params.product)
		const externalUpdatedAt = parseMoySkladDate(params.product.updated)
		const stock = params.stockByExternalId?.get(externalId)
		const name = normalizeProductName(params.product.name || externalCode)

		const link = params.existingLinkExternalId
			? await this.repo.findProductLinkByExternalId(
					params.integration.id,
					params.existingLinkExternalId,
					params.tx
				)
			: await this.repo.findProductLinkByExternalId(
					params.integration.id,
					externalId,
					params.tx
				)
		let product = params.existingProduct ?? null

		if (!product && link) {
			product = await this.repo.findProductById(
				params.catalogId,
				link.productId,
				params.tx
			)
		}

		if (!product && externalCode) {
			const fallbackSku = buildSkuBase(externalCode) || PRODUCT_SKU_FALLBACK
			product = await this.repo.findProductByCatalogAndSku(
				params.catalogId,
				fallbackSku,
				params.tx
			)
		}

		const status = resolveProductStatus(
			params.product,
			stock,
			params.syncStock,
			product?.status
		)
		const price = resolvePrice(params.product, params.priceTypeName)

		if (!product) {
			const slug = await this.buildUniqueSlug(
				params.catalogId,
				name,
				undefined,
				params.tx
			)
			const sku = await this.buildUniqueSku(
				externalCode || name,
				undefined,
				params.tx
			)
			const createdProduct = await this.repo.createProduct(
				{
					catalogId: params.catalogId,
					name,
					sku,
					slug,
					price,
					status
				},
				params.tx
			)

			const imagesImported = params.importImages
				? await this.refreshProductImages({
						catalogId: params.catalogId,
						productId: createdProduct.id,
						client: params.client,
						product: params.product,
						forceImages: true,
						tx: params.tx
					})
				: 0

			await this.repo.upsertProductLink(
				{
					integrationId: params.integration.id,
					productId: createdProduct.id,
					externalId,
					externalCode: externalCode || null,
					externalUpdatedAt,
					rawMeta: this.buildRawMeta(params.product)
				},
				params.tx
			)

			if (imagesImported > 0) {
				this.logger.log(`Imported ${imagesImported} images for new product ${name}`)
			}
			this.logger.log(
				`Created product from MoySklad: catalog=${params.catalogId}, externalId=${externalId}, productId=${createdProduct.id}, sku=${sku}, name="${name}"`
			)

			return {
				productId: createdProduct.id,
				externalId,
				created: true,
				updated: false,
				imagesImported
			}
		}

		const nextSku =
			externalCode &&
			buildSkuBase(externalCode) &&
			buildSkuBase(externalCode) !== product.sku
				? await this.buildUniqueSku(externalCode, product.id, params.tx)
				: product.sku

		const data: Prisma.ProductUpdateManyMutationInput = {}
		if (product.name !== name) {
			data.name = name
		}
		if (nextSku !== product.sku) {
			data.sku = nextSku
		}
		if (Number(product.price) !== price) {
			data.price = price
		}
		if (product.status !== status) {
			data.status = status
		}

		let updated = false
		if (Object.keys(data).length > 0) {
			const updatedProduct = await this.repo.updateProduct(
				{
					productId: product.id,
					catalogId: params.catalogId,
					data
				},
				params.tx
			)
			if (!updatedProduct) {
				throw new NotFoundException('Товар не найден')
			}
			product = updatedProduct
			updated = true
			this.logger.log(
				`Updated product from MoySklad: catalog=${params.catalogId}, externalId=${externalId}, productId=${product.id}, changedFields=${Object.keys(data).join(',') || 'none'}`
			)
		}

		const imagesImported =
			params.importImages && params.refreshImagesForExistingProduct
				? await this.refreshProductImages({
						catalogId: params.catalogId,
						productId: product.id,
						client: params.client,
						product: params.product,
						forceImages: false,
						tx: params.tx
					})
				: 0

		await this.repo.upsertProductLink(
			{
				integrationId: params.integration.id,
				productId: product.id,
				externalId,
				externalCode: externalCode || null,
				externalUpdatedAt,
				rawMeta: this.buildRawMeta(params.product)
			},
			params.tx
		)

		// Sync category if productFolder exists
		if (params.product.productFolder) {
			const category = await this.syncProductFolder(
				params.catalogId,
				params.product.productFolder,
				params.tx
			)
			if (category) {
				await this.repo.syncProductCategories(
					product.id,
					params.catalogId,
					[category.id],
					params.tx
				)
				this.logger.log(`Synced category ${category.name} for product ${name}`)
			}
		}

		if (imagesImported > 0) {
			this.logger.log(`Imported ${imagesImported} images for product ${name}`)
		}
		if (!updated && imagesImported === 0 && link) {
			this.logger.log(
				`Skipped product update because nothing changed: catalog=${params.catalogId}, externalId=${externalId}, productId=${product.id}`
			)
		}

		return {
			productId: product.id,
			externalId,
			created: false,
			updated: updated || imagesImported > 0 || !link,
			imagesImported
		}
	}

	private async refreshProductImages(params: {
		catalogId: string
		productId: string
		client: MoySkladClient
		product: MoySkladProduct
		forceImages: boolean
		tx?: Prisma.TransactionClient
	}): Promise<number> {
		const previousMediaIds = await this.repo.findProductMediaIds(
			params.productId,
			params.catalogId,
			params.tx
		)
		const imported = await this.importProductImages(
			params.catalogId,
			params.productId,
			params.client,
			params.product
		)
		if (!imported) {
			return 0
		}
		if (imported.sourceCount > 0 && imported.mediaIds.length === 0) {
			return 0
		}

		const mediaIds = imported.mediaIds
		const changed =
			params.forceImages ||
			mediaIds.length !== previousMediaIds.length ||
			mediaIds.length > 0 ||
			(previousMediaIds.length > 0 && imported.sourceCount === 0)

		if (!changed) {
			return 0
		}

		const replaced = await this.repo.replaceProductMedia(
			params.productId,
			params.catalogId,
			mediaIds,
			params.tx
		)
		if (!replaced) {
			throw new NotFoundException('Товар не найден')
		}

		await this.cleanupOrphanedMedia(previousMediaIds, params.catalogId)
		return mediaIds.length
	}

	private async importProductImages(
		catalogId: string,
		productId: string,
		client: MoySkladClient,
		product: MoySkladProduct
	): Promise<ImportedProductImages | null> {
		let imageUrls: string[]

		// Try to use expanded images from product first
		if (product.images?.rows && product.images.rows.length > 0) {
			imageUrls = product.images.rows
				.filter(img => img.meta.downloadHref)
				.map(img => img.meta.downloadHref!)
		} else {
			// Fallback to separate API call
			try {
				imageUrls = await client.getProductImages(product.id)
			} catch (error) {
				this.logger.warn(
					`Не удалось загрузить список изображений MoySklad для товара ${product.id}: ${this.renderErrorMessage(error)}`
				)
				return null
			}
		}

		if (!imageUrls.length) {
			return { mediaIds: [], sourceCount: 0 }
		}

		const mediaIds: string[] = []
		const uploadedKeys: string[] = []

		try {
			const uploadPromises = imageUrls.map(async imageUrl => {
				try {
					const downloaded = await client.downloadImage(imageUrl)
					if (!downloaded) return null

					const uploaded = await this.s3Service.uploadImage(
						{
							buffer: downloaded.buffer,
							size: downloaded.buffer.length,
							mimetype: this.normalizeImageContentType(downloaded.contentType),
							originalname: `${product.id}.jpg`
						},
						{
							catalogId,
							path: IMAGE_IMPORT_PATH,
							entityId: productId
						}
					)

					return { mediaId: uploaded.mediaId, key: uploaded.key }
				} catch (error) {
					this.logger.warn(
						`Не удалось импортировать изображение MoySklad для товара ${product.id}: ${this.renderErrorMessage(error)}`
					)
					return null
				}
			})

			const results = await Promise.allSettled(uploadPromises)

			for (const result of results) {
				if (result.status === 'fulfilled' && result.value) {
					mediaIds.push(result.value.mediaId)
					uploadedKeys.push(result.value.key)
				}
			}
		} catch (error) {
			// If any critical error, cleanup uploaded images
			if (uploadedKeys.length > 0) {
				try {
					await this.s3Service.deleteObjectsByKeys(uploadedKeys)
				} catch (cleanupError) {
					this.logger.error(
						`Не удалось очистить загруженные изображения после ошибки: ${this.renderErrorMessage(cleanupError)}`
					)
				}
			}
			throw error
		}

		return {
			mediaIds,
			sourceCount: imageUrls.length
		}
	}

	private async cleanupOrphanedMedia(
		previousMediaIds: string[],
		catalogId: string
	): Promise<void> {
		if (!previousMediaIds.length) return

		const orphans = await this.mediaRepo.findOrphanedByIds(
			previousMediaIds,
			catalogId
		)
		if (!orphans.length) return

		const keys = orphans.flatMap(orphan => [
			orphan.key,
			...orphan.variants
				.filter(variant => variant.storage === 's3' && variant.key)
				.map(variant => variant.key)
		])

		try {
			await this.s3Service.deleteObjectsByKeys(keys)
			await this.mediaRepo.deleteOrphanedByIds(
				orphans.map(orphan => orphan.id),
				catalogId
			)
		} catch (error) {
			this.logger.warn(
				`Не удалось очистить orphaned media после sync MoySklad: ${this.renderErrorMessage(error)}`
			)
		}
	}

	private async beginSyncOrThrow(catalogId: string): Promise<void> {
		const staleBefore = new Date(Date.now() - SYNC_LOCK_TIMEOUT_MS)
		const started = await this.repo.beginMoySkladSync(catalogId, staleBefore)
		if (started) return

		const integration = await this.repo.findMoySklad(catalogId)
		if (!integration) {
			throw new NotFoundException('Интеграция MoySklad не настроена')
		}
		if (!integration.isActive) {
			throw new ConflictException('Интеграция MoySklad отключена')
		}

		throw new ConflictException('Синхронизация MoySklad уже выполняется')
	}

	private async getActiveIntegration(
		catalogId: string
	): Promise<IntegrationRecord> {
		const integration = await this.repo.findMoySklad(catalogId)
		if (!integration) {
			throw new NotFoundException('Интеграция MoySklad не настроена')
		}
		if (!integration.isActive) {
			throw new ConflictException('Интеграция MoySklad отключена')
		}
		return integration
	}

	private async buildUniqueSlug(
		catalogId: string,
		source: string,
		excludeId?: string,
		tx?: Prisma.TransactionClient
	): Promise<string> {
		const base = buildSlugBase(source) || PRODUCT_SLUG_FALLBACK

		for (let suffix = 0; suffix < 10; suffix += 1) {
			const candidate = applySuffix(base, suffix, PRODUCT_SLUG_MAX_LENGTH)
			const exists = await this.repo.existsProductSlug(
				catalogId,
				candidate,
				excludeId,
				tx
			)
			if (!exists) return candidate
		}

		return buildHashedCandidate(base, PRODUCT_SLUG_MAX_LENGTH)
	}

	private async buildUniqueSku(
		source: string,
		excludeId?: string,
		tx?: Prisma.TransactionClient
	): Promise<string> {
		const base = buildSkuBase(source) || PRODUCT_SKU_FALLBACK

		for (let suffix = 0; suffix < 10; suffix += 1) {
			const candidate = applySuffix(base, suffix, PRODUCT_SKU_MAX_LENGTH)
			const exists = await this.repo.existsProductSku(candidate, excludeId, tx)
			if (!exists) return candidate
		}

		return buildHashedCandidate(base, PRODUCT_SKU_MAX_LENGTH).toUpperCase()
	}

	private async syncProductFolder(
		catalogId: string,
		folder: MoySkladProduct['productFolder'],
		tx?: Prisma.TransactionClient
	): Promise<CategorySyncRecord | null> {
		if (!folder?.name) return null

		let category = await this.repo.findCategoryByName(catalogId, folder.name, tx)
		if (category) return category

		// For simplicity, create without parent
		category = await this.repo.createCategory(
			catalogId,
			folder.name,
			undefined,
			tx
		)
		return category
	}

	private normalizeImageContentType(contentType?: string | null): string {
		const normalized = contentType?.split(';')[0]?.trim().toLowerCase()
		if (normalized === 'image/jpg') {
			return 'image/jpeg'
		}
		if (normalized && ALLOWED_IMAGE_MIME_TYPES.has(normalized)) {
			return normalized
		}
		return 'image/jpeg'
	}

	private buildRawMeta(product: MoySkladProduct): Prisma.InputJsonValue {
		return {
			id: product.id,
			name: product.name ?? null,
			code: product.code ?? null,
			article: product.article ?? null,
			externalCode: product.externalCode ?? null,
			archived: Boolean(product.archived),
			updated: product.updated ?? null
		}
	}

	private async invalidateProductCaches(catalogId: string): Promise<void> {
		await this.cache.bumpVersion(PRODUCTS_CACHE_VERSION, catalogId)
		await this.cache.bumpVersion(CATEGORY_PRODUCTS_CACHE_VERSION, catalogId)
	}

	private renderErrorMessage(error: unknown): string {
		if (error instanceof Error && error.message) {
			return error.message
		}
		return 'Неизвестная ошибка'
	}

	private wrapSyncError(error: unknown): Error {
		if (error instanceof HttpException) {
			return error
		}

		return new BadGatewayException(this.renderErrorMessage(error))
	}
}

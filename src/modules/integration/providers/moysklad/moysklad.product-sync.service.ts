import type { Prisma } from '@generated/client'
import { ProductStatus } from '@generated/enums'
import {
	BadGatewayException,
	Inject,
	Injectable,
	Logger,
	NotFoundException
} from '@nestjs/common'
import { createHash } from 'crypto'
import slugify from 'slugify'

import {
	PRODUCT_EXTERNAL_SYNC_PORT,
	type ProductExternalProductUpdateInput,
	type ProductExternalSyncPort,
	type ProductExternalSyncProductRecord
} from '@/modules/product/public'

import {
	type IntegrationProductLinkRecord,
	type IntegrationRecord,
	IntegrationRepository
} from '../../integration.repository'

import { MoySkladClient } from './moysklad.client'
import { MoySkladImageImportService } from './moysklad.image-import.service'
import { MoySkladProductFolderSyncService } from './moysklad.product-folder-sync.service'
import type { MoySkladEntityType, MoySkladProduct } from './moysklad.types'
import { MoySkladVariantSyncService } from './moysklad.variant-sync.service'

const PRODUCT_SLUG_FALLBACK = 'product'
const PRODUCT_SKU_FALLBACK = 'SKU'
const PRODUCT_NAME_FALLBACK = 'Product'
const PRODUCT_SLUG_MAX_LENGTH = 255
const PRODUCT_SKU_MAX_LENGTH = 100

export type MoySkladProductSyncOutcome = {
	productId: string
	externalId: string
	created: boolean
	updated: boolean
	imagesImported: number
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
	syncPrice: boolean
	syncContent: boolean
	ensureDefaultVariant?: boolean
	existingProduct?: ProductExternalSyncProductRecord | null
	existingLinkExternalId?: string | null
	tx?: Prisma.TransactionClient
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

function readMoySkladString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : ''
}

function readMoySkladNullableString(value: unknown): string | null {
	const normalized = readMoySkladString(value)
	return normalized || null
}

function normalizeProductName(value?: unknown): string {
	const normalized = readMoySkladString(value)
	return normalized || PRODUCT_NAME_FALLBACK
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

function resolveExternalCode(product: MoySkladProduct): string {
	return (
		readMoySkladString(product.code) ||
		readMoySkladString(product.article) ||
		readMoySkladString(product.externalCode) ||
		readMoySkladString(product.name) ||
		''
	)
}

function resolveExternalProductKey(product: MoySkladProduct): string {
	return readMoySkladString(product.externalCode)
}

function hasProductFolder(product: MoySkladProduct): boolean {
	return Boolean(
		readMoySkladString(product.productFolder?.id) ||
		readMoySkladString(product.productFolder?.meta?.href)
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

function resolveProductStatus(
	product: MoySkladProduct,
	stock: number | undefined,
	syncStock: boolean,
	currentStatus?: ProductStatus | null
): ProductStatus {
	if (
		currentStatus === ProductStatus.DRAFT ||
		currentStatus === ProductStatus.DELETE
	) {
		return currentStatus
	}

	if (product.archived) {
		return ProductStatus.HIDDEN
	}

	if (!syncStock) {
		return currentStatus ?? ProductStatus.ACTIVE
	}

	if (resolveExternalEntityType(product) === 'service') {
		return currentStatus ?? ProductStatus.ACTIVE
	}

	if (stock === undefined) {
		return currentStatus ?? ProductStatus.ACTIVE
	}

	return stock > 0 ? ProductStatus.ACTIVE : ProductStatus.HIDDEN
}

@Injectable()
export class MoySkladProductSyncService {
	private readonly logger = new Logger(MoySkladProductSyncService.name)

	constructor(
		private readonly repo: IntegrationRepository,
		@Inject(PRODUCT_EXTERNAL_SYNC_PORT)
		private readonly products: ProductExternalSyncPort,
		private readonly images: MoySkladImageImportService,
		private readonly productFolders: MoySkladProductFolderSyncService,
		private readonly variantSync: MoySkladVariantSyncService
	) {}

	async syncExternalProduct(
		params: SyncExternalProductParams
	): Promise<MoySkladProductSyncOutcome> {
		const externalId = resolveExternalProductKey(params.product)
		if (!externalId) {
			throw new BadGatewayException(
				'MoySklad product externalCode is required for product sync'
			)
		}
		if (!hasProductFolder(params.product)) {
			throw new BadGatewayException(
				'MoySklad product productFolder is required for product sync'
			)
		}
		const legacyExternalId = readMoySkladNullableString(params.product.id)
		const externalCode = resolveExternalCode(params.product)
		const externalUpdatedAt = parseMoySkladDate(params.product.updated)
		const stock =
			typeof params.product.stock === 'number' &&
			Number.isFinite(params.product.stock)
				? params.product.stock
				: undefined
		const name = normalizeProductName(params.product.name || externalCode)
		const description = readMoySkladNullableString(params.product.description)

		const linkExternalIds = [
			params.existingLinkExternalId,
			externalId,
			legacyExternalId
		].filter(
			(item, index, items): item is string =>
				Boolean(item) && items.indexOf(item) === index
		)
		let link: IntegrationProductLinkRecord | null = null
		for (const linkExternalId of linkExternalIds) {
			link = await this.repo.findProductLinkByExternalId(
				params.integration.id,
				linkExternalId,
				params.tx
			)
			if (link) break
		}
		let product = params.existingProduct ?? null

		if (!product && link) {
			product = await this.products.findExternalProductById({
				catalogId: params.catalogId,
				productId: link.productId,
				tx: params.tx
			})
		}

		if (!product && externalCode) {
			const fallbackSku = buildSkuBase(externalCode) || PRODUCT_SKU_FALLBACK
			product = await this.products.findExternalProductBySku({
				catalogId: params.catalogId,
				sku: fallbackSku,
				tx: params.tx
			})
		}

		const status = resolveProductStatus(
			params.product,
			stock,
			params.syncStock,
			product?.status
		)
		const price = params.syncPrice
			? resolvePrice(params.product, params.priceTypeName)
			: null

		if (!product) {
			return this.createLinkedProduct({
				...params,
				externalId,
				externalCode,
				externalUpdatedAt,
				name,
				price,
				status,
				stock,
				description
			})
		}

		return this.updateLinkedProduct({
			...params,
			externalId,
			externalCode,
			externalUpdatedAt,
			link,
			localProduct: product,
			name,
			price,
			status,
			stock,
			description
		})
	}

	private async createLinkedProduct(
		params: SyncExternalProductParams & {
			externalId: string
			externalCode: string
			externalUpdatedAt: Date | null
			name: string
			price: number | null
			status: ProductStatus
			stock: number | undefined
			description: string | null
		}
	): Promise<MoySkladProductSyncOutcome> {
		const slug = await this.buildUniqueSlug(
			params.catalogId,
			params.name,
			undefined,
			params.tx
		)
		const sku = await this.buildUniqueSku(
			params.externalCode || params.name,
			undefined,
			params.tx
		)
		const createdProduct = await this.products.createExternalProduct({
			catalogId: params.catalogId,
			name: params.name,
			sku,
			slug,
			price: params.price,
			status: params.status,
			tx: params.tx
		})

		const imagesImported = params.importImages
			? await this.images.refreshProductImages({
					catalogId: params.catalogId,
					productId: createdProduct.id,
					client: params.client,
					product: params.product,
					forceImages: true,
					tx: params.tx
				})
			: 0

		const descriptionChanged = await this.syncProductDescription({
			...params,
			productId: createdProduct.id
		})

		await this.repo.upsertProductLink(
			{
				integrationId: params.integration.id,
				productId: createdProduct.id,
				externalId: params.externalId,
				externalCode: params.externalCode || null,
				externalUpdatedAt: params.externalUpdatedAt,
				priceSynced: params.syncPrice,
				stockSynced: params.syncStock && params.stock !== undefined,
				rawMeta: this.buildRawMeta(params.product)
			},
			params.tx
		)

		const categorySyncChanged = await this.productFolders.syncProductCategories({
			catalogId: params.catalogId,
			integrationId: params.integration.id,
			productId: createdProduct.id,
			productName: params.name,
			client: params.client,
			folder: params.product.productFolder,
			tx: params.tx
		})
		const defaultVariantChanged =
			params.ensureDefaultVariant === false
				? false
				: await this.variantSync.ensureDefaultVariantForSyncedProduct({
						integration: params.integration,
						product: params.product,
						productId: createdProduct.id,
						sku,
						price: params.price,
						stock: params.stock,
						productStatus: params.status,
						syncStock: params.syncStock,
						syncPrice: params.syncPrice,
						tx: params.tx
					})

		if (imagesImported > 0) {
			this.logger.log(
				`Imported ${imagesImported} images for new product ${params.name}`
			)
		}
		this.logger.log(
			`Created product from MoySklad: catalog=${params.catalogId}, externalId=${params.externalId}, productId=${createdProduct.id}, sku=${sku}, name="${params.name}"`
		)

		return {
			productId: createdProduct.id,
			externalId: params.externalId,
			created: true,
			updated: categorySyncChanged || defaultVariantChanged || descriptionChanged,
			imagesImported
		}
	}

	private async updateLinkedProduct(
		params: SyncExternalProductParams & {
			externalId: string
			externalCode: string
			externalUpdatedAt: Date | null
			link: IntegrationProductLinkRecord | null
			localProduct: ProductExternalSyncProductRecord
			name: string
			price: number | null
			status: ProductStatus
			stock: number | undefined
			description: string | null
		}
	): Promise<MoySkladProductSyncOutcome> {
		let product = params.localProduct
		const nextSku =
			params.externalCode &&
			buildSkuBase(params.externalCode) &&
			buildSkuBase(params.externalCode) !== product.sku
				? await this.buildUniqueSku(params.externalCode, product.id, params.tx)
				: product.sku

		const data: ProductExternalProductUpdateInput['data'] = {}
		if (params.syncContent && product.name !== params.name) {
			data.name = params.name
		}
		if (params.syncContent && nextSku !== product.sku) {
			data.sku = nextSku
		}
		if (params.syncPrice && Number(product.price) !== params.price) {
			data.price = params.price
		}
		if (product.status !== params.status) {
			data.status = params.status
		}

		let updated = false
		if (Object.keys(data).length > 0) {
			const updatedProduct = await this.products.updateExternalProduct({
				productId: product.id,
				catalogId: params.catalogId,
				data,
				tx: params.tx
			})
			if (!updatedProduct) {
				throw new NotFoundException('Product not found')
			}
			product = updatedProduct
			updated = true
			this.logger.log(
				`Updated product from MoySklad: catalog=${params.catalogId}, externalId=${params.externalId}, productId=${product.id}, changedFields=${Object.keys(data).join(',') || 'none'}`
			)
		}

		const imagesImported =
			params.importImages && params.refreshImagesForExistingProduct
				? await this.images.refreshProductImages({
						catalogId: params.catalogId,
						productId: product.id,
						client: params.client,
						product: params.product,
						forceImages: false,
						tx: params.tx
					})
				: 0

		const descriptionChanged = params.syncContent
			? await this.syncProductDescription({
					...params,
					productId: product.id
				})
			: false

		await this.repo.upsertProductLink(
			{
				integrationId: params.integration.id,
				productId: product.id,
				externalId: params.externalId,
				externalCode: params.externalCode || null,
				externalUpdatedAt: params.externalUpdatedAt,
				priceSynced: params.syncPrice,
				stockSynced: params.syncStock && params.stock !== undefined,
				rawMeta: this.buildRawMeta(params.product)
			},
			params.tx
		)
		const categorySyncChanged = params.syncContent
			? await this.productFolders.syncProductCategories({
					catalogId: params.catalogId,
					integrationId: params.integration.id,
					productId: product.id,
					productName: params.name,
					client: params.client,
					folder: params.product.productFolder,
					tx: params.tx
				})
			: false
		const defaultVariantChanged =
			params.ensureDefaultVariant === false
				? false
				: await this.variantSync.ensureDefaultVariantForSyncedProduct({
						integration: params.integration,
						product: params.product,
						productId: product.id,
						sku: product.sku,
						price: params.price,
						stock: params.stock,
						productStatus: product.status,
						syncStock: params.syncStock,
						syncPrice: params.syncPrice,
						tx: params.tx
					})

		if (imagesImported > 0) {
			this.logger.log(
				`Imported ${imagesImported} images for product ${params.name}`
			)
		}
		if (
			!updated &&
			imagesImported === 0 &&
			!categorySyncChanged &&
			!defaultVariantChanged &&
			!descriptionChanged &&
			params.link
		) {
			this.logger.log(
				`Skipped product update because nothing changed: catalog=${params.catalogId}, externalId=${params.externalId}, productId=${product.id}`
			)
		}

		return {
			productId: product.id,
			externalId: params.externalId,
			created: false,
			updated:
				updated ||
				imagesImported > 0 ||
				!params.link ||
				categorySyncChanged ||
				defaultVariantChanged ||
				descriptionChanged,
			imagesImported
		}
	}

	private syncProductDescription(params: {
		catalogId: string
		productId: string
		description: string | null
		tx?: Prisma.TransactionClient
	}): Promise<boolean> {
		return this.products.syncExternalProductDescription({
			catalogId: params.catalogId,
			productId: params.productId,
			description: params.description,
			tx: params.tx
		})
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
			const exists = await this.products.existsExternalProductSlug({
				catalogId,
				slug: candidate,
				excludeId,
				tx
			})
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
			const exists = await this.products.existsExternalProductSku({
				sku: candidate,
				excludeId,
				tx
			})
			if (!exists) return candidate
		}

		return buildHashedCandidate(base, PRODUCT_SKU_MAX_LENGTH).toUpperCase()
	}

	private buildRawMeta(product: MoySkladProduct): Prisma.InputJsonValue {
		return {
			type: resolveExternalEntityType(product),
			id: readMoySkladNullableString(product.id),
			name: readMoySkladNullableString(product.name),
			code: readMoySkladNullableString(product.code),
			article: readMoySkladNullableString(product.article),
			externalCode: readMoySkladNullableString(product.externalCode),
			archived: Boolean(product.archived),
			barcodes: Array.isArray(product.barcodes)
				? product.barcodes.map(barcode => ({
						ean13: readMoySkladNullableString(barcode.ean13),
						ean8: readMoySkladNullableString(barcode.ean8),
						code128: readMoySkladNullableString(barcode.code128),
						gtin: readMoySkladNullableString(barcode.gtin)
					}))
				: [],
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
							readMoySkladNullableString(product.product.meta?.href),
						name: readMoySkladNullableString(product.product.name)
					}
				: null,
			characteristics: Array.isArray(product.characteristics)
				? product.characteristics.map(characteristic => ({
						id: readMoySkladNullableString(characteristic.id),
						name: readMoySkladNullableString(characteristic.name),
						value: readMoySkladNullableString(characteristic.value)
					}))
				: [],
			updated: readMoySkladNullableString(product.updated)
		}
	}
}

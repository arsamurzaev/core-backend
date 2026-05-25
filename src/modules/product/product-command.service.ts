import type { ProductStatus } from '@generated/enums'
import type { ProductCreateInput, ProductUpdateInput } from '@generated/models'
import {
	BadRequestException,
	Inject,
	Injectable,
	NotFoundException
} from '@nestjs/common'
import { createHash } from 'crypto'
import slugify from 'slugify'

import {
	CAPABILITY_ASSERT_PORT,
	CAPABILITY_READER_PORT,
	type CapabilityAssertPort,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'
import { S3Service } from '@/modules/s3/public'
import { MediaRepository } from '@/shared/media/media.repository'
import { mustCatalogId, mustTypeId } from '@/shared/tenancy/ctx'
import {
	assertHasUpdateFields,
	normalizeNullableTrimmedString,
	normalizeRequiredString
} from '@/shared/utils'

import { CreateProductDtoReq } from './dto/requests/create-product.dto.req'
import {
	SetProductVariantMatrixDtoReq,
	SetProductVariantsDtoReq
} from './dto/requests/set-product-variants.dto.req'
import { UpdateProductDtoReq } from './dto/requests/update-product.dto.req'
import {
	ProductAttributeBuilder,
	type ProductAttributeValueData
} from './product-attribute.builder'
import type { ProductValidationScopeInput } from './product-validation-scope'
import type { ProductVariantData } from './product-variant.builder'
import {
	type ProductVariantReplacementResult,
	ProductVariantService
} from './product-variant.service'
import { ProductWriteFinalizer } from './product-write-finalizer.service'
import {
	type ProductDetailsItem,
	ProductRepository,
	type ProductTypeValidationSchema,
	type ProductValidationRef,
	type ProductVariantUpdateData
} from './product.repository'

type PreparedProductCreatePayload = {
	data: ProductCreateInput
	attributes: ProductAttributeValueData[]
	variants?: ProductVariantData[]
	categoryIds: string[]
}

type PreparedProductUpdatePayload = {
	data: ProductUpdateInput
	attributes?: ProductAttributeValueData[]
	removeAttributeIds?: string[]
	variants?: ProductVariantUpdateData[]
	variantMatrix?: ProductVariantData[]
	hasCustomVariantValues: boolean
	mediaIds?: string[]
	removeVariantAttributeIds?: string[]
	categoryIds?: string[]
	categoryId?: string
	categoryPosition: number
}

const PRODUCT_NAME_MAX_LENGTH = 255
const SLUG_MAX_LENGTH = 255
const SKU_MAX_LENGTH = 100
const PRODUCT_SLUG_FALLBACK = 'product'
const PRODUCT_SKU_FALLBACK = 'SKU'
const PRODUCT_DUPLICATE_SUFFIX = ' (копия)'

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

function buildDuplicateNameCandidate(name: string, copyIndex = 1): string {
	const suffixPart = copyIndex > 1 ? ` ${copyIndex}` : ''
	const headLength = Math.max(
		0,
		PRODUCT_NAME_MAX_LENGTH - PRODUCT_DUPLICATE_SUFFIX.length - suffixPart.length
	)
	const head = name.slice(0, headLength).trimEnd()
	return `${head}${PRODUCT_DUPLICATE_SUFFIX}${suffixPart}`
}

function buildHashedSku(base: string): string {
	const hash = createHash('sha1')
		.update(base)
		.digest('hex')
		.slice(0, 8)
		.toUpperCase()
	const separator = base ? '-' : ''
	const maxBaseLength = SKU_MAX_LENGTH - hash.length - separator.length
	const head = maxBaseLength > 0 ? base.slice(0, maxBaseLength) : ''
	return `${head}${separator}${hash}`
}

@Injectable()
export class ProductCommandService {
	constructor(
		private readonly repo: ProductRepository,
		private readonly attributeBuilder: ProductAttributeBuilder,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly featureAssertions: CapabilityAssertPort,
		@Inject(CAPABILITY_READER_PORT)
		private readonly featureReader: CapabilityReaderPort,
		private readonly finalizer: ProductWriteFinalizer,
		private readonly mediaRepo: MediaRepository,
		private readonly s3Service: S3Service,
		private readonly variants: ProductVariantService
	) {}

	async create(dto: CreateProductDtoReq) {
		const { mediaIds, attributes, brandId, categories, variants, ...rest } = dto
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		await this.assertManualProductCreateAllowed(catalogId)
		const payload = await this.prepareCreatePayload(
			{ mediaIds, attributes, brandId, categories, variants, ...rest },
			catalogId,
			typeId
		)

		const product = await this.repo.create(
			catalogId,
			payload.data,
			payload.attributes,
			payload.variants
		)
		await this.assignProductToCategories(
			product.id,
			payload.categoryIds,
			catalogId
		)

		const created = await this.repo.findById(product.id, catalogId, true)
		if (!created) throw new NotFoundException('Товар не найден')

		const hasCustomVariantValues = payload.variants?.some(variant =>
			variant.attributes.some(attribute => Boolean(attribute.value))
		)
		return this.finalizer.finalizeProduct(created, catalogId, {
			bumpCatalogTypeId: hasCustomVariantValues ? typeId : null,
			invalidateCatalogProducts: true,
			invalidateCategoryProducts: true,
			syncSeo: true
		})
	}

	async update(id: string, dto: UpdateProductDtoReq) {
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		const payload = await this.prepareUpdatePayload(id, dto, catalogId, typeId)
		await this.ensureDefaultVariantForLegacyUpdate(id, dto, catalogId)

		const updateArgs: [
			string,
			ProductUpdateInput,
			string,
			ProductAttributeValueData[] | undefined,
			string[] | undefined,
			ProductVariantUpdateData[] | undefined,
			string[] | undefined
		] = [
			id,
			payload.data,
			catalogId,
			payload.attributes,
			payload.removeAttributeIds,
			payload.variants,
			payload.mediaIds
		]
		const updated =
			payload.removeVariantAttributeIds === undefined &&
			payload.variantMatrix === undefined
				? await this.repo.update(...updateArgs)
				: await this.repo.update(
						...updateArgs,
						payload.removeVariantAttributeIds,
						payload.variantMatrix
					)
		if (!updated) throw new NotFoundException('Товар не найден')

		if (payload.categoryIds !== undefined) {
			await this.repo.syncProductCategories(id, catalogId, payload.categoryIds)
		}

		if (payload.categoryId) {
			await this.repo.upsertCategoryProductPosition(
				id,
				payload.categoryId,
				catalogId,
				payload.categoryPosition
			)
		}

		const product =
			payload.categoryIds !== undefined || payload.categoryId
				? await this.repo.findById(id, catalogId, true)
				: updated
		if (!product) throw new NotFoundException('Товар не найден')

		return this.finalizer.finalizeProduct(product, catalogId, {
			bumpCatalogTypeId: payload.hasCustomVariantValues ? typeId : null,
			invalidateCatalogProducts: true,
			invalidateCategoryProducts: true,
			syncSeo: true
		})
	}

	async setVariants(id: string, dto: SetProductVariantsDtoReq) {
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		return this.finalizeVariantReplacement(
			await this.variants.setVariants(id, dto, catalogId, typeId),
			catalogId,
			typeId
		)
	}

	async setVariantMatrix(id: string, dto: SetProductVariantMatrixDtoReq) {
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		return this.finalizeVariantReplacement(
			await this.variants.setVariantMatrix(id, dto, catalogId, typeId),
			catalogId,
			typeId
		)
	}

	async toggleStatus(id: string) {
		const catalogId = mustCatalogId()
		await this.ensureDefaultVariantForLegacyUpdate(id, {}, catalogId)
		const product = await this.repo.toggleStatus(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')

		return this.finalizer.finalizeProduct(product, catalogId, {
			invalidateCatalogProducts: true,
			invalidateCategoryProducts: true,
			syncSeo: true
		})
	}

	async togglePopular(id: string) {
		const catalogId = mustCatalogId()
		const product = await this.repo.togglePopular(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')

		return this.finalizer.finalizeProduct(product, catalogId, {
			invalidateCatalogProducts: true,
			invalidateCategoryProducts: true
		})
	}

	async duplicate(id: string) {
		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		await this.assertManualProductCreateAllowed(catalogId)
		const source = await this.repo.findById(id, catalogId, true)
		if (!source) throw new NotFoundException('Товар не найден')

		await this.assertCanDuplicateSource(source, catalogId)
		const duplicatedName = await this.generateDuplicatedProductName(
			source.name,
			catalogId
		)
		const duplicatedSlug = await this.generateProductSlug(
			duplicatedName,
			catalogId
		)
		const duplicatedSku = await this.generateProductSku(duplicatedName)
		const duplicatedVariants = await this.variants.buildDuplicatedVariants(
			source,
			this.buildValidationScope(typeId, catalogId, source.productType?.id ?? null),
			duplicatedSku
		)
		const duplicatedCategoryIds = [
			...new Set(
				source.categoryProducts
					.map(item => item.category?.id?.trim() ?? '')
					.filter(Boolean)
			)
		]
		const brandId = source.brand?.id
			? await this.resolveExistingBrandId(source.brand.id, catalogId)
			: null

		const product = await this.repo.create(
			catalogId,
			this.buildDuplicatedProductData(
				source,
				catalogId,
				duplicatedName,
				duplicatedSlug,
				duplicatedSku,
				brandId
			),
			this.buildDuplicatedProductAttributes(source),
			duplicatedVariants
		)
		await this.assignProductToCategories(
			product.id,
			duplicatedCategoryIds,
			catalogId
		)

		const duplicated = await this.repo.findById(product.id, catalogId, true)
		if (!duplicated) throw new NotFoundException('Товар не найден')

		return this.finalizer.finalizeProduct(duplicated, catalogId, {
			invalidateCatalogProducts: true,
			invalidateCategoryProducts: true,
			syncSeo: true
		})
	}

	async remove(id: string) {
		const catalogId = mustCatalogId()
		await this.assertManualProductDeleteAllowed(id, catalogId)
		const product = await this.repo.softDelete(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')
		await this.finalizer.removeProductSeo(id, catalogId)

		if (product.mediaIds.length) {
			const orphanedMedia = await this.mediaRepo.findOrphanedByIds(
				product.mediaIds,
				catalogId
			)
			const s3Keys = this.collectS3MediaKeys(orphanedMedia)
			if (s3Keys.length) {
				await this.s3Service.deleteObjectsByKeys(s3Keys)
			}
			if (orphanedMedia.length) {
				await this.mediaRepo.deleteOrphanedByIds(
					orphanedMedia.map(m => m.id),
					catalogId
				)
			}
		}

		await this.finalizer.invalidateCatalogProductsCache(catalogId)
		await this.finalizer.invalidateCategoryProductsCache(catalogId)
		return { ok: true }
	}

	private async ensureDefaultVariantForLegacyUpdate(
		id: string,
		dto: Pick<
			UpdateProductDtoReq,
			'price' | 'status' | 'variants' | 'variantMatrix'
		>,
		catalogId: string
	): Promise<void> {
		if (dto.variants !== undefined) return
		if (dto.variantMatrix !== undefined) return

		const product = await this.repo.findSkuById(id, catalogId)
		if (!product) return

		const price = Object.hasOwn(dto, 'price') ? dto.price : product.price
		const status = Object.hasOwn(dto, 'status') ? dto.status : product.status
		const defaultVariant = await this.variants.buildDefaultVariantData(
			product.sku,
			price,
			{ productStatus: status }
		)
		await this.repo.ensureDefaultVariant(id, catalogId, defaultVariant)
	}

	private async finalizeVariantReplacement(
		result: ProductVariantReplacementResult,
		catalogId: string,
		typeId: string
	) {
		return this.finalizer.finalizeProduct(result.product, catalogId, {
			bumpCatalogTypeId: result.hasCustomVariantValues ? typeId : null,
			invalidateCatalogProducts: true,
			invalidateCategoryProducts: true,
			syncSeo: true
		})
	}

	private async prepareCreatePayload(
		dto: CreateProductDtoReq,
		catalogId: string,
		typeId: string
	): Promise<PreparedProductCreatePayload> {
		const {
			mediaIds,
			attributes,
			brandId,
			productTypeId,
			categories,
			variants,
			...rest
		} = dto
		const normalizedName = normalizeRequiredString(dto.name, 'name')
		const resolvedSlug = await this.generateProductSlug(normalizedName, catalogId)
		const resolvedSku = await this.generateProductSku(normalizedName)

		const normalizedMediaIds = this.normalizeMediaIds(mediaIds)
		await this.ensureMediaIds(normalizedMediaIds, catalogId)

		const normalizedBrandId = normalizeNullableTrimmedString(brandId)
		if (normalizedBrandId) {
			await this.ensureBrandExists(normalizedBrandId, catalogId)
		}
		const normalizedProductTypeId = normalizeNullableTrimmedString(productTypeId)
		if (normalizedProductTypeId) {
			await this.featureAssertions.assertCanUseProductTypes(catalogId)
		}
		if (this.variants.hasVariantAttributeInputs(variants)) {
			await this.featureAssertions.assertCanUseProductVariants(catalogId)
		}
		await this.variants.assertCanUseSaleUnitsFromVariantInputs(
			catalogId,
			variants
		)
		const productType = normalizedProductTypeId
			? await this.loadActiveProductTypeValidationSchema(
					normalizedProductTypeId,
					catalogId
				)
			: null
		if (this.variants.hasProductTypeVariantAttributes(productType)) {
			await this.featureAssertions.assertCanUseProductVariants(catalogId)
		}
		const validationScope = this.buildValidationScope(
			typeId,
			catalogId,
			productType?.id ?? null
		)

		const normalizedCategoryIds = this.normalizeCategoryIds(categories)
		await this.ensureCategoriesExist(normalizedCategoryIds, catalogId)
		if (
			!variants?.length &&
			this.variants.hasProductTypeVariantAttributes(productType)
		) {
			throw new BadRequestException(
				'Product type variant attributes require explicit variants'
			)
		}
		const preparedVariants = variants?.length
			? await this.variants.prepareCreateVariants(
					validationScope,
					resolvedSku,
					variants,
					productType,
					rest.price,
					rest.status
				)
			: [
					await this.variants.buildDefaultVariantData(resolvedSku, rest.price, {
						productStatus: rest.status
					})
				]

		return {
			data: {
				...rest,
				name: normalizedName,
				slug: resolvedSlug,
				sku: resolvedSku,
				catalog: { connect: { id: catalogId } },
				...(normalizedBrandId
					? { brand: { connect: { id: normalizedBrandId } } }
					: {}),
				...(normalizedProductTypeId
					? { productType: { connect: { id: normalizedProductTypeId } } }
					: {}),
				...(normalizedMediaIds.length
					? {
							media: {
								create: normalizedMediaIds.map((mediaId, index) => ({
									position: index,
									media: { connect: { id: mediaId } }
								}))
							}
						}
					: {})
			},
			attributes: await this.attributeBuilder.buildForCreate(
				validationScope,
				attributes
			),
			variants: preparedVariants,
			categoryIds: normalizedCategoryIds
		}
	}

	private async prepareUpdatePayload(
		id: string,
		dto: UpdateProductDtoReq,
		catalogId: string,
		typeId: string
	): Promise<PreparedProductUpdatePayload> {
		const mediaIds =
			dto.mediaIds !== undefined ? this.normalizeMediaIds(dto.mediaIds) : undefined
		const categoryIds =
			dto.categories !== undefined
				? this.normalizeCategoryIds(dto.categories)
				: undefined
		if (categoryIds !== undefined) {
			await this.ensureCategoriesExist(categoryIds, catalogId)
		}
		const categoryId = await this.resolveUpdatedCategoryId(
			dto,
			catalogId,
			categoryIds
		)
		const hasAttributeChanges = dto.attributes !== undefined
		const hasRemovedAttributeChanges = dto.removeAttributeIds !== undefined
		const hasVariantChanges = dto.variants !== undefined
		const hasVariantMatrixChanges = dto.variantMatrix !== undefined
		if (hasVariantChanges && hasVariantMatrixChanges) {
			throw new BadRequestException(
				'Use either variants updates or variantMatrix replacement, not both'
			)
		}
		const hasMediaChanges = mediaIds !== undefined
		const hasCategoryChanges =
			categoryIds !== undefined || dto.categoryId !== undefined
		if (dto.productTypeId !== undefined) {
			await this.featureAssertions.assertCanUseProductTypes(catalogId)
		}
		if (hasVariantChanges) {
			await this.featureAssertions.assertCanUseProductVariants(catalogId)
			await this.variants.assertCanUseSaleUnitsFromVariantUpdates(
				catalogId,
				dto.variants ?? []
			)
		}
		if (hasVariantMatrixChanges) {
			await this.featureAssertions.assertCanUseProductVariants(catalogId)
			await this.variants.assertCanUseSaleUnitsFromVariantInputs(
				catalogId,
				dto.variantMatrix ?? []
			)
		}
		const requestedProductType = await this.resolveRequestedProductType(
			dto.productTypeId,
			catalogId
		)
		const requestedProductTypeId =
			dto.productTypeId === undefined
				? undefined
				: (requestedProductType?.id ?? null)
		const needsProductValidationRef =
			dto.productTypeId !== undefined ||
			hasAttributeChanges ||
			hasRemovedAttributeChanges ||
			hasVariantChanges ||
			hasVariantMatrixChanges
		const productRef = needsProductValidationRef
			? await this.loadProductValidationRef(id, catalogId)
			: null
		const currentProductTypeId = productRef?.productTypeId ?? null
		const effectiveProductTypeId =
			requestedProductTypeId !== undefined
				? requestedProductTypeId
				: currentProductTypeId
		const productType =
			requestedProductType ??
			(effectiveProductTypeId
				? await this.loadExistingProductTypeValidationSchema(
						effectiveProductTypeId,
						catalogId
					)
				: null)
		if (
			(hasAttributeChanges || hasRemovedAttributeChanges) &&
			effectiveProductTypeId
		) {
			await this.featureAssertions.assertCanUseProductTypes(catalogId)
		}
		if (
			requestedProductTypeId !== undefined &&
			(hasVariantChanges || hasVariantMatrixChanges) &&
			this.variants.hasProductTypeVariantAttributes(productType)
		) {
			await this.featureAssertions.assertCanUseProductVariants(catalogId)
		}
		const validationScope = this.buildValidationScope(
			typeId,
			catalogId,
			productType?.id ?? null
		)
		const hasProductTypeChange =
			requestedProductTypeId !== undefined &&
			requestedProductTypeId !== currentProductTypeId
		await this.assertIntegratedProductStructureEditable(id, catalogId, {
			hasProductTypeChange,
			hasVariantChanges: hasVariantChanges || hasVariantMatrixChanges
		})
		const shouldRemoveFromCurrentProductTypeScope =
			hasRemovedAttributeChanges &&
			hasProductTypeChange &&
			Boolean(currentProductTypeId)
		const removalValidationScope = shouldRemoveFromCurrentProductTypeScope
			? this.buildValidationScope(typeId, catalogId, currentProductTypeId)
			: validationScope
		const data = await this.buildUpdateData(
			dto,
			catalogId,
			requestedProductTypeId
		)

		if (
			!hasAttributeChanges &&
			!hasRemovedAttributeChanges &&
			!hasVariantChanges &&
			!hasVariantMatrixChanges &&
			!hasMediaChanges &&
			!hasCategoryChanges
		) {
			assertHasUpdateFields(data)
		}

		if (mediaIds !== undefined) {
			await this.ensureMediaIds(mediaIds, catalogId)
		}

		const attributes = hasAttributeChanges
			? await this.attributeBuilder.buildForUpdate(
					validationScope,
					dto.attributes ?? []
				)
			: undefined
		const removeAttributeIds = hasRemovedAttributeChanges
			? await this.attributeBuilder.prepareRemovedAttributeIdsForUpdate(
					removalValidationScope,
					dto.removeAttributeIds ?? [],
					{ allowRequired: shouldRemoveFromCurrentProductTypeScope }
				)
			: undefined
		const variants = hasVariantChanges
			? this.variants.prepareVariantUpdates(dto.variants ?? [])
			: undefined
		const variantMatrix = hasVariantMatrixChanges
			? await this.buildUpdateVariantMatrix(
					id,
					catalogId,
					validationScope,
					productType,
					dto.variantMatrix ?? [],
					data,
					productRef
				)
			: undefined
		this.assertNoAttributeRemovalConflicts(attributes, removeAttributeIds)

		return {
			data,
			attributes,
			removeAttributeIds,
			variants,
			variantMatrix,
			hasCustomVariantValues: this.variants.hasCustomVariantValues(
				dto.variantMatrix
			),
			mediaIds,
			categoryIds,
			categoryId,
			categoryPosition: dto.categoryPosition ?? 0
		}
	}

	private buildValidationScope(
		catalogTypeId: string,
		catalogId: string,
		productTypeId?: string | null
	): ProductValidationScopeInput {
		return { catalogTypeId, catalogId, productTypeId }
	}

	private async assertManualProductCreateAllowed(
		catalogId: string
	): Promise<void> {
		const hasIntegrations = await this.repo.hasCatalogIntegrations(catalogId)
		if (!hasIntegrations) return

		throw new BadRequestException(
			'Создание товаров вручную отключено: каталог управляется интеграцией.'
		)
	}

	private async assertManualProductDeleteAllowed(
		id: string,
		catalogId: string
	): Promise<void> {
		const isIntegrated = await this.repo.hasIntegrationProductOwnership(
			id,
			catalogId
		)
		if (!isIntegrated) return

		throw new BadRequestException(
			'Integrated product deletion is disabled; the product is managed by integration'
		)
	}

	private async assertIntegratedProductStructureEditable(
		id: string,
		catalogId: string,
		options: { hasProductTypeChange: boolean; hasVariantChanges: boolean }
	): Promise<void> {
		if (!options.hasProductTypeChange && !options.hasVariantChanges) return

		const isIntegrated = await this.repo.hasIntegrationProductOwnership(
			id,
			catalogId
		)
		if (!isIntegrated) return

		throw new BadRequestException(
			'Integrated product structure is managed by integration; product type and variants cannot be changed manually'
		)
	}

	private async buildUpdateVariantMatrix(
		id: string,
		catalogId: string,
		validationScope: ProductValidationScopeInput,
		productType: ProductTypeValidationSchema | null,
		items: UpdateProductDtoReq['variantMatrix'],
		data: ProductUpdateInput,
		productRef: ProductValidationRef | null
	): Promise<ProductVariantData[]> {
		if (items?.length) {
			return this.variants.buildProductTypeChangeVariantMatrix(
				id,
				catalogId,
				validationScope,
				productType,
				items
			)
		}

		const sku = normalizeRequiredString(
			productRef?.sku ?? (await this.repo.findSkuById(id, catalogId))?.sku,
			'product.sku'
		)
		const price = Object.hasOwn(data, 'price')
			? (data as { price?: unknown }).price
			: productRef?.price
		const status = Object.hasOwn(data, 'status')
			? (data as { status?: ProductStatus }).status
			: productRef?.status

		return [
			await this.variants.buildDefaultVariantData(sku, price, {
				productStatus: status
			})
		]
	}

	private async assertCanDuplicateSource(
		source: ProductDetailsItem,
		catalogId: string
	): Promise<void> {
		const features = await this.featureReader.getCurrentFeatures(catalogId)

		if (source.productType && !features.canUseProductTypes) {
			throw new BadRequestException(
				'Product type capability is disabled for this catalog'
			)
		}

		if (
			source.variants.some(variant => variant.attributes.length > 0) &&
			!features.canUseProductVariants
		) {
			throw new BadRequestException(
				'Product variant capability is disabled for this catalog'
			)
		}

		if (
			source.variants.some(variant => (variant.saleUnits?.length ?? 0) > 0) &&
			!features.canUseCatalogSaleUnits
		) {
			throw new BadRequestException(
				'Catalog sale unit capability is disabled for this catalog'
			)
		}
	}

	private async resolveExistingBrandId(
		brandId: string,
		catalogId: string
	): Promise<string | null> {
		const brand = await this.repo.findBrandById(brandId, catalogId)
		return brand ? brand.id : null
	}

	private async assignProductToCategories(
		productId: string,
		categoryIds: string[],
		catalogId: string
	): Promise<void> {
		if (!categoryIds.length) return
		await this.repo.prependProductToCategories(productId, catalogId, categoryIds)
	}

	private normalizeMediaIds(value?: string[]): string[] {
		if (!value) return []
		const normalized = value.map(item => String(item).trim())
		if (normalized.some(item => item.length === 0)) {
			throw new BadRequestException('mediaIds must not contain empty values')
		}
		const unique = new Set(normalized)
		if (unique.size !== normalized.length) {
			throw new BadRequestException('mediaIds must not contain duplicates')
		}
		return normalized
	}

	private normalizeCategoryIds(value?: string[]): string[] {
		if (!value) return []
		const normalized = value.map(item => String(item).trim())
		if (normalized.some(item => item.length === 0)) {
			throw new BadRequestException('categories must not contain empty values')
		}
		const unique = new Set(normalized)
		if (unique.size !== normalized.length) {
			throw new BadRequestException('categories must not contain duplicates')
		}
		return normalized
	}

	private async buildUpdateData(
		dto: UpdateProductDtoReq,
		catalogId: string,
		resolvedProductTypeId?: string | null
	): Promise<ProductUpdateInput> {
		const data: ProductUpdateInput = {}

		if (dto.name !== undefined) {
			const normalizedName = normalizeRequiredString(dto.name, 'name')
			data.name = normalizedName
		}
		if (dto.price !== undefined) data.price = dto.price
		if (dto.isPopular !== undefined) data.isPopular = dto.isPopular
		if (dto.status !== undefined) data.status = dto.status
		if (dto.position !== undefined) data.position = dto.position
		if (dto.brandId !== undefined) {
			if (dto.brandId === null) {
				data.brand = { disconnect: true }
			} else {
				const brandId = normalizeRequiredString(dto.brandId, 'brandId')
				await this.ensureBrandExists(brandId, catalogId)
				data.brand = { connect: { id: brandId } }
			}
		}
		if (dto.productTypeId !== undefined) {
			if (resolvedProductTypeId === null) {
				data.productType = { disconnect: true }
			} else {
				if (!resolvedProductTypeId) {
					throw new BadRequestException('productTypeId is required')
				}
				data.productType = { connect: { id: resolvedProductTypeId } }
			}
		}

		return data
	}

	private async resolveUpdatedCategoryId(
		dto: UpdateProductDtoReq,
		catalogId: string,
		categoryIds?: string[]
	): Promise<string | undefined> {
		if (dto.categoryPosition !== undefined && dto.categoryId === undefined) {
			throw new BadRequestException(
				'categoryPosition можно передать только вместе с categoryId'
			)
		}
		if (dto.categoryId === undefined) return undefined

		const normalizedCategoryId = normalizeRequiredString(
			dto.categoryId ?? '',
			'categoryId'
		)
		await this.ensureCategoryExists(normalizedCategoryId, catalogId)
		if (
			categoryIds !== undefined &&
			!categoryIds.includes(normalizedCategoryId)
		) {
			throw new BadRequestException(
				'categoryId должен входить в categories, если они переданы вместе'
			)
		}
		return normalizedCategoryId
	}

	private async ensureMediaIds(ids: string[], catalogId: string): Promise<void> {
		if (!ids.length) return
		const found = await this.mediaRepo.findByIds(ids, catalogId)
		const foundSet = new Set(found.map(item => item.id))
		const missing = ids.filter(id => !foundSet.has(id))
		if (missing.length) {
			throw new BadRequestException(
				`Media were not found in catalog: ${missing.join(', ')}`
			)
		}
	}

	private async ensureBrandExists(
		brandId: string,
		catalogId: string
	): Promise<void> {
		const brand = await this.repo.findBrandById(brandId, catalogId)
		if (!brand) {
			throw new BadRequestException(
				`Brand ${brandId} is not available for this catalog`
			)
		}
	}

	private async ensureCategoryExists(
		categoryId: string,
		catalogId: string
	): Promise<void> {
		const category = await this.repo.findCategoryById(categoryId, catalogId)
		if (!category) {
			throw new BadRequestException(
				`Category ${categoryId} is not available for this catalog`
			)
		}
	}

	private async loadActiveProductTypeValidationSchema(
		productTypeId: string,
		catalogId: string
	): Promise<ProductTypeValidationSchema> {
		const productType = await this.repo.findProductTypeValidationSchemaById(
			productTypeId,
			catalogId
		)
		if (!productType) {
			throw new BadRequestException(
				`Product type ${productTypeId} is not available for this catalog`
			)
		}
		return productType
	}

	private async loadExistingProductTypeValidationSchema(
		productTypeId: string,
		catalogId: string
	): Promise<ProductTypeValidationSchema> {
		const productType = await this.repo.findProductTypeValidationSchemaById(
			productTypeId,
			catalogId,
			{ includeArchived: true }
		)
		if (!productType) {
			throw new BadRequestException(
				`Product type ${productTypeId} is not available for this catalog`
			)
		}
		return productType
	}

	private async resolveRequestedProductType(
		productTypeId: string | null | undefined,
		catalogId: string
	): Promise<ProductTypeValidationSchema | null> {
		if (productTypeId === undefined || productTypeId === null) return null

		const normalizedProductTypeId = normalizeRequiredString(
			productTypeId,
			'productTypeId'
		)
		return this.loadActiveProductTypeValidationSchema(
			normalizedProductTypeId,
			catalogId
		)
	}

	private async loadProductValidationRef(
		id: string,
		catalogId: string
	): Promise<ProductValidationRef> {
		const product = await this.repo.findProductValidationRef(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')
		return product
	}

	private async ensureCategoriesExist(
		categoryIds: string[],
		catalogId: string
	): Promise<void> {
		if (!categoryIds.length) return
		const found: Awaited<ReturnType<ProductRepository['findCategoriesByIds']>> =
			await this.repo.findCategoriesByIds(categoryIds, catalogId)
		const foundSet = new Set<string>(found.map((item: { id: string }) => item.id))
		const missing = categoryIds.filter(id => !foundSet.has(id))
		if (missing.length) {
			throw new BadRequestException(
				`Categories were not found in catalog: ${missing.join(', ')}`
			)
		}
	}

	private assertNoAttributeRemovalConflicts(
		attributes?: ProductAttributeValueData[],
		removeAttributeIds?: string[]
	): void {
		if (!attributes?.length || !removeAttributeIds?.length) return

		const updatedIds = new Set(attributes.map(attribute => attribute.attributeId))
		const conflicts = removeAttributeIds.filter(id => updatedIds.has(id))
		if (conflicts.length) {
			throw new BadRequestException(
				`Атрибуты нельзя одновременно обновлять и удалять: ${conflicts.join(', ')}`
			)
		}
	}

	private async generateProductSlug(
		name: string,
		catalogId: string
	): Promise<string> {
		const base = buildSlugBase(name) || PRODUCT_SLUG_FALLBACK
		return this.ensureUniqueSlug(base, catalogId)
	}

	private async generateProductSku(name: string): Promise<string> {
		const base = buildSkuBase(name) || PRODUCT_SKU_FALLBACK
		const normalizedBase =
			base.length > SKU_MAX_LENGTH ? buildHashedSku(base) : base
		return this.ensureUniqueSku(normalizedBase)
	}

	private async generateDuplicatedProductName(
		name: string,
		catalogId: string
	): Promise<string> {
		const normalizedName = normalizeRequiredString(name, 'name')
		let copyIndex = 1
		let candidate = buildDuplicateNameCandidate(normalizedName, copyIndex)
		while (await this.repo.existsName(candidate, catalogId)) {
			copyIndex += 1
			candidate = buildDuplicateNameCandidate(normalizedName, copyIndex)
		}
		return candidate
	}

	private async ensureUniqueSlug(
		base: string,
		catalogId: string
	): Promise<string> {
		let candidate = applySuffix(base, 0, SLUG_MAX_LENGTH)
		let suffix = 1
		while (await this.repo.existsSlug(candidate, catalogId)) {
			candidate = applySuffix(base, suffix, SLUG_MAX_LENGTH)
			suffix += 1
		}
		return candidate
	}

	private async ensureUniqueSku(base: string): Promise<string> {
		let candidate = applySuffix(base, 0, SKU_MAX_LENGTH)
		let suffix = 1
		while (await this.repo.existsSku(candidate)) {
			candidate = applySuffix(base, suffix, SKU_MAX_LENGTH)
			suffix += 1
		}
		return candidate
	}

	private buildDuplicatedProductData(
		source: ProductDetailsItem,
		catalogId: string,
		name: string,
		slug: string,
		sku: string,
		brandId: string | null
	): ProductCreateInput {
		const price =
			source.price === null
				? null
				: typeof source.price === 'number'
					? source.price
					: Number(source.price)

		return {
			name,
			slug,
			sku,
			price,
			isPopular: source.isPopular,
			status: source.status,
			position: source.position,
			catalog: { connect: { id: catalogId } },
			...(brandId ? { brand: { connect: { id: brandId } } } : {}),
			...(source.productType
				? { productType: { connect: { id: source.productType.id } } }
				: {}),
			...(source.media.length
				? {
						media: {
							create: source.media.map(item => ({
								position: item.position,
								kind: item.kind ?? null,
								media: { connect: { id: item.media.id } }
							}))
						}
					}
				: {})
		}
	}

	private buildDuplicatedProductAttributes(
		source: ProductDetailsItem
	): ProductAttributeValueData[] {
		return source.productAttributes.map(attribute => ({
			attributeId: attribute.attributeId,
			enumValueId: attribute.enumValueId ?? null,
			valueString: attribute.valueString ?? null,
			valueInteger: attribute.valueInteger ?? null,
			valueDecimal:
				attribute.valueDecimal === null ? null : Number(attribute.valueDecimal),
			valueBoolean: attribute.valueBoolean ?? null,
			valueDateTime: attribute.valueDateTime
				? new Date(attribute.valueDateTime)
				: null
		}))
	}

	private collectS3MediaKeys(
		media: Array<{
			key: string
			storage: string
			variants: { key: string; storage: string }[]
		}>
	): string[] {
		const keys = new Set<string>()
		for (const item of media) {
			if (item.storage === 's3' && item.key.trim()) keys.add(item.key.trim())
			for (const variant of item.variants) {
				if (variant.storage === 's3' && variant.key.trim()) {
					keys.add(variant.key.trim())
				}
			}
		}
		return [...keys]
	}
}

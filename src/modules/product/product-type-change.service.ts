import type { ProductUpdateInput } from '@generated/models'
import {
	BadRequestException,
	ConflictException,
	Inject,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import {
	CAPABILITY_ASSERT_PORT,
	type CapabilityAssertPort
} from '@/modules/capability/contracts'
import {
	assertCurrentCatalogCanManageCatalogContent,
	mustCatalogId,
	mustTypeId
} from '@/shared/tenancy/ctx'
import { normalizeRequiredString } from '@/shared/utils'

import { ApplyProductTypeChangeDtoReq } from './dto/requests/apply-product-type-change.dto.req'
import { ProductTypeCompatibilityPreviewDtoReq } from './dto/requests/product-type-compatibility-preview.dto.req'
import {
	ProductTypeCompatibilityIssueDto,
	ProductTypeCompatibilityPreviewDto
} from './dto/responses/product.dto.res'
import {
	ProductAttributeBuilder,
	type ProductAttributeValueData
} from './product-attribute.builder'
import type { ProductValidationScopeInput } from './product-validation-scope'
import { ProductVariantService } from './product-variant.service'
import { ProductWriteFinalizer } from './product-write-finalizer.service'
import {
	ProductRepository,
	type ProductTypeCompatibilityPreviewRef,
	type ProductTypeValidationSchema
} from './product.repository'

type ScopedProductDataRef = {
	productAttributes: unknown[]
	variants: { attributes: unknown[] }[]
}

type ProductTypeAttributeSchema =
	ProductTypeValidationSchema['attributes'][number]
type ProductTypeCompatibilityProductAttribute =
	ProductTypeCompatibilityPreviewRef['productAttributes'][number]

type ProductTypeCompatibilityReason =
	| 'MISSING_IN_TARGET_TYPE'
	| 'SCOPE_MISMATCH'
	| 'TARGET_TYPE_EMPTY'

@Injectable()
export class ProductTypeChangeService {
	constructor(
		private readonly repo: ProductRepository,
		private readonly attributeBuilder: ProductAttributeBuilder,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly featureEntitlements: CapabilityAssertPort,
		private readonly finalizer: ProductWriteFinalizer,
		private readonly variants: ProductVariantService
	) {}

	async previewProductTypeCompatibility(
		id: string,
		dto: ProductTypeCompatibilityPreviewDtoReq
	): Promise<ProductTypeCompatibilityPreviewDto> {
		if (dto.productTypeId === undefined) {
			throw new BadRequestException('Не указан тип товара')
		}

		const catalogId = mustCatalogId()
		await this.featureEntitlements.assertCanUseProductTypes(catalogId)
		const product = await this.loadProductTypeCompatibilityPreviewRef(
			id,
			catalogId
		)
		const requestedProductTypeId =
			dto.productTypeId === null
				? null
				: normalizeRequiredString(dto.productTypeId, 'productTypeId')
		await this.assertIntegratedProductTypeEditable(
			product,
			catalogId,
			requestedProductTypeId,
			false
		)
		const requestedProductType =
			requestedProductTypeId === null
				? null
				: await this.loadActiveProductTypeValidationSchema(
						requestedProductTypeId,
						catalogId
					)

		return this.buildProductTypeCompatibilityPreview(
			product,
			requestedProductType
		)
	}

	async applyProductTypeChange(id: string, dto: ApplyProductTypeChangeDtoReq) {
		assertCurrentCatalogCanManageCatalogContent()
		if (dto.productTypeId === undefined) {
			throw new BadRequestException('Не указан тип товара')
		}
		if (dto.confirm !== true) {
			throw new BadRequestException('Подтверждение обязательно')
		}

		const catalogId = mustCatalogId()
		const typeId = mustTypeId()
		await this.featureEntitlements.assertCanUseProductTypes(catalogId)
		if (dto.items !== undefined) {
			await this.featureEntitlements.assertCanUseProductVariants(catalogId)
			await this.variants.assertCanUseSaleUnitsFromVariantInputs(
				catalogId,
				dto.items
			)
		}
		const product = await this.loadProductTypeCompatibilityPreviewRef(
			id,
			catalogId
		)
		this.assertExpectedProductType(product, dto.expectedCurrentProductTypeId)
		const requestedProductTypeId =
			dto.productTypeId === null
				? null
				: normalizeRequiredString(dto.productTypeId, 'productTypeId')
		await this.assertIntegratedProductTypeEditable(
			product,
			catalogId,
			requestedProductTypeId,
			dto.items !== undefined
		)

		const requestedProductType =
			requestedProductTypeId === null
				? null
				: await this.loadActiveProductTypeValidationSchema(
						requestedProductTypeId,
						catalogId
					)
		if (this.variants.hasProductTypeVariantAttributes(requestedProductType)) {
			await this.featureEntitlements.assertCanUseProductVariants(catalogId)
			if (dto.items === undefined) {
				throw new BadRequestException(
					'Тип товара с вариациями требует явного списка вариаций'
				)
			}
		}
		const preview = this.buildProductTypeCompatibilityPreview(
			product,
			requestedProductType
		)
		const removeAttributeIds = this.normalizeExplicitAttributeIds(
			dto.removeAttributeIds
		)
		this.assertProductTypeChangeResolution(
			preview,
			removeAttributeIds,
			dto.items !== undefined
		)

		const validationScope = this.buildValidationScope(
			typeId,
			catalogId,
			requestedProductType?.id ?? null
		)
		const attributes =
			dto.attributes !== undefined
				? await this.attributeBuilder.buildForUpdate(
						validationScope,
						dto.attributes
					)
				: undefined
		this.assertNoAttributeRemovalConflicts(attributes, removeAttributeIds)

		const variants =
			dto.items !== undefined
				? await this.variants.buildProductTypeChangeVariantMatrix(
						id,
						catalogId,
						validationScope,
						requestedProductType,
						dto.items
					)
				: undefined
		const updated = await this.repo.applyProductTypeChange(
			id,
			catalogId,
			this.buildProductTypeChangeData(preview.requestedProductTypeId),
			removeAttributeIds,
			attributes,
			variants
		)
		if (!updated) throw new NotFoundException('Товар не найден')
		return this.finalizer.finalizeProduct(updated, catalogId, {
			bumpCatalogTypeId: this.variants.hasCustomVariantValues(dto.items)
				? typeId
				: null,
			invalidateCatalogProducts: true,
			invalidateCategoryProducts: true,
			syncSeo: true
		})
	}

	private buildValidationScope(
		catalogTypeId: string,
		catalogId: string,
		productTypeId?: string | null
	): ProductValidationScopeInput {
		return { catalogTypeId, catalogId, productTypeId }
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
				`Тип товара ${productTypeId} недоступен для этого каталога`
			)
		}
		return productType
	}

	private async loadProductTypeCompatibilityPreviewRef(
		id: string,
		catalogId: string
	): Promise<ProductTypeCompatibilityPreviewRef> {
		const product = await this.repo.findProductTypeCompatibilityPreviewRef(
			id,
			catalogId
		)
		if (!product) throw new NotFoundException('Товар не найден')
		return product
	}

	private async assertIntegratedProductTypeEditable(
		product: ProductTypeCompatibilityPreviewRef,
		catalogId: string,
		requestedProductTypeId: string | null,
		hasVariantReplacement: boolean
	): Promise<void> {
		const hasProductTypeChange =
			(product.productTypeId ?? null) !== requestedProductTypeId
		if (!hasProductTypeChange && !hasVariantReplacement) return

		const isIntegrated = await this.repo.hasIntegrationProductOwnership(
			product.id,
			catalogId
		)
		if (!isIntegrated) return

		throw new BadRequestException(
			'Структура интеграционного товара управляется интеграцией; тип товара и вариации нельзя менять вручную'
		)
	}

	private hasScopedProductData(product: ScopedProductDataRef): boolean {
		return (
			product.productAttributes.length > 0 ||
			product.variants.some(variant => variant.attributes.length > 0)
		)
	}

	private assertExpectedProductType(
		product: ProductTypeCompatibilityPreviewRef,
		expectedProductTypeId?: string | null
	): void {
		if (expectedProductTypeId === undefined) return

		const normalizedExpected =
			expectedProductTypeId === null
				? null
				: normalizeRequiredString(
						expectedProductTypeId,
						'expectedCurrentProductTypeId'
					)
		if ((product.productTypeId ?? null) === normalizedExpected) return

		throw new ConflictException('Product type changed after preview')
	}

	private normalizeExplicitAttributeIds(value?: string[]): string[] {
		if (!value) return []

		const normalized = value.map(item =>
			normalizeRequiredString(item, 'removeAttributeIds')
		)
		const unique = new Set(normalized)
		if (unique.size !== normalized.length) {
			throw new BadRequestException(
				'removeAttributeIds must not contain duplicates'
			)
		}
		return normalized
	}

	private assertProductTypeChangeResolution(
		preview: ProductTypeCompatibilityPreviewDto,
		removeAttributeIds: string[],
		hasVariantMatrix: boolean
	): void {
		const removed = new Set(removeAttributeIds)
		const missingProductAttributeResolutions =
			preview.productAttributeConflicts.filter(
				conflict => !removed.has(conflict.attributeId)
			)
		if (missingProductAttributeResolutions.length) {
			const attributeIds = missingProductAttributeResolutions.map(
				conflict => conflict.attributeId
			)
			throw new BadRequestException(
				`Incompatible product attributes require explicit removal or remap: ${attributeIds.join(', ')}`
			)
		}

		if (preview.variantAttributeConflicts.length > 0 && !hasVariantMatrix) {
			throw new BadRequestException(
				'Incompatible variant attributes require full variant matrix replacement'
			)
		}
	}

	private buildProductTypeChangeData(
		productTypeId: string | null
	): ProductUpdateInput {
		return productTypeId
			? { productType: { connect: { id: productTypeId } } }
			: { productType: { disconnect: true } }
	}

	private buildProductTypeCompatibilityPreview(
		product: ProductTypeCompatibilityPreviewRef,
		requestedProductType: ProductTypeValidationSchema | null
	): ProductTypeCompatibilityPreviewDto {
		const requestedProductTypeId = requestedProductType?.id ?? null
		const sameProductType =
			(product.productTypeId ?? null) === requestedProductTypeId
		const productAttributeCount = product.productAttributes.length
		const variantAttributeCount = product.variants.reduce(
			(total, variant) => total + variant.attributes.length,
			0
		)
		const hasScopedData = this.hasScopedProductData(product)
		const productAttributeConflicts =
			this.collectProductTypeProductAttributeConflicts(
				product,
				requestedProductType
			)
		const variantAttributeConflicts =
			this.collectProductTypeVariantAttributeConflicts(
				product,
				requestedProductType
			)
		const compatible =
			productAttributeConflicts.length === 0 &&
			variantAttributeConflicts.length === 0
		const canChangeNow = sameProductType || compatible

		return {
			productId: product.id,
			currentProductTypeId: product.productTypeId ?? null,
			requestedProductTypeId,
			sameProductType,
			hasScopedData,
			canChangeNow,
			compatible,
			requiresUserDecision: !canChangeNow,
			blockingReason: canChangeNow ? null : 'STRICT_POLICY_BLOCK',
			productAttributeCount,
			variantAttributeCount,
			productAttributeConflicts,
			variantAttributeConflicts
		}
	}

	private collectProductTypeProductAttributeConflicts(
		product: ProductTypeCompatibilityPreviewRef,
		requestedProductType: ProductTypeValidationSchema | null
	): ProductTypeCompatibilityIssueDto[] {
		const targetAttributes =
			this.buildProductTypeAttributeMap(requestedProductType)

		return product.productAttributes.flatMap(productAttribute => {
			const targetAttribute = targetAttributes.get(productAttribute.attributeId)
			const reason = this.resolveProductAttributeCompatibilityReason(
				product,
				productAttribute,
				targetAttribute,
				requestedProductType
			)
			if (!reason) return []

			return [
				this.buildProductTypeCompatibilityIssue({
					attributeId: productAttribute.attributeId,
					key: productAttribute.attribute.key,
					displayName: productAttribute.attribute.displayName,
					variantKeys: [],
					reason,
					targetAttribute
				})
			]
		})
	}

	private collectProductTypeVariantAttributeConflicts(
		product: ProductTypeCompatibilityPreviewRef,
		requestedProductType: ProductTypeValidationSchema | null
	): ProductTypeCompatibilityIssueDto[] {
		const targetAttributes =
			this.buildProductTypeAttributeMap(requestedProductType)
		const conflicts = new Map<
			string,
			{
				attributeId: string
				key: string
				displayName: string
				reason: ProductTypeCompatibilityReason
				targetAttribute: ProductTypeAttributeSchema | undefined
				variantKeys: Set<string>
			}
		>()

		for (const variant of product.variants) {
			for (const variantAttribute of variant.attributes) {
				const targetAttribute = targetAttributes.get(variantAttribute.attributeId)
				const reason = this.resolveProductTypeCompatibilityReason(
					targetAttribute,
					true,
					requestedProductType === null
				)
				if (!reason) continue

				const existing = conflicts.get(variantAttribute.attributeId)
				if (existing) {
					existing.variantKeys.add(variant.variantKey)
					continue
				}

				conflicts.set(variantAttribute.attributeId, {
					attributeId: variantAttribute.attributeId,
					key: variantAttribute.attribute.key,
					displayName: variantAttribute.attribute.displayName,
					reason,
					targetAttribute,
					variantKeys: new Set([variant.variantKey])
				})
			}
		}

		return [...conflicts.values()].map(conflict =>
			this.buildProductTypeCompatibilityIssue({
				...conflict,
				variantKeys: [...conflict.variantKeys]
			})
		)
	}

	private resolveProductAttributeCompatibilityReason(
		product: ProductTypeCompatibilityPreviewRef,
		productAttribute: ProductTypeCompatibilityProductAttribute,
		targetAttribute: ProductTypeAttributeSchema | undefined,
		requestedProductType: ProductTypeValidationSchema | null
	): ProductTypeCompatibilityReason | null {
		if (targetAttribute) {
			return targetAttribute.isVariant ? 'SCOPE_MISMATCH' : null
		}

		if (
			product.catalog?.typeId &&
			this.isCatalogProductAttribute(
				productAttribute.attribute,
				product.catalog.typeId
			)
		) {
			return null
		}

		return requestedProductType === null
			? 'TARGET_TYPE_EMPTY'
			: 'MISSING_IN_TARGET_TYPE'
	}

	private isCatalogProductAttribute(
		attribute: ProductTypeCompatibilityProductAttribute['attribute'],
		catalogTypeId: string
	): boolean {
		return (
			!attribute.isHidden &&
			attribute.isVariantAttribute === false &&
			attribute.types.some(type => type.id === catalogTypeId)
		)
	}

	private buildProductTypeAttributeMap(
		productType: ProductTypeValidationSchema | null
	): Map<string, ProductTypeAttributeSchema> {
		return new Map(
			(productType?.attributes ?? []).map(attribute => [
				attribute.attributeId,
				attribute
			])
		)
	}

	private resolveProductTypeCompatibilityReason(
		targetAttribute: ProductTypeAttributeSchema | undefined,
		expectedVariant: boolean,
		targetTypeEmpty: boolean
	): ProductTypeCompatibilityReason | null {
		if (!targetAttribute) {
			return targetTypeEmpty ? 'TARGET_TYPE_EMPTY' : 'MISSING_IN_TARGET_TYPE'
		}
		return targetAttribute.isVariant === expectedVariant ? null : 'SCOPE_MISMATCH'
	}

	private buildProductTypeCompatibilityIssue(params: {
		attributeId: string
		key: string
		displayName: string
		variantKeys: string[]
		reason: ProductTypeCompatibilityReason
		targetAttribute: ProductTypeAttributeSchema | undefined
	}): ProductTypeCompatibilityIssueDto {
		return {
			attributeId: params.attributeId,
			key: params.key,
			displayName: params.displayName,
			variantKeys: params.variantKeys,
			reason: params.reason,
			targetIsVariant: params.targetAttribute?.isVariant ?? null
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
}

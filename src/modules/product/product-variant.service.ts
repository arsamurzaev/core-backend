import {
	ProductStatus,
	ProductVariantKind,
	ProductVariantStatus
} from '@generated/enums'
import {
	BadRequestException,
	Inject,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import {
	CAPABILITY_ASSERT_PORT,
	type CapabilityAssertPort
} from '@/modules/capability/contracts'
import {
	assertProductTypeVariantCombinations,
	type ProductTypeVariantCombinationInput
} from '@/modules/product-type/public'
import { normalizeRequiredString } from '@/shared/utils'

import { ProductVariantUpdateDtoReq } from './dto/requests/product-variant-update.dto.req'
import { ProductVariantDtoReq } from './dto/requests/product-variant.dto.req'
import {
	SetProductVariantMatrixDtoReq,
	SetProductVariantsDtoReq
} from './dto/requests/set-product-variants.dto.req'
import type { ProductValidationScopeInput } from './product-validation-scope'
import {
	ProductVariantBuilder,
	type ProductVariantData
} from './product-variant.builder'
import {
	type ProductDetailsItem,
	ProductRepository,
	type ProductTypeValidationSchema,
	type ProductVariantUpdateData
} from './product.repository'

type VariantBuildOptions = {
	variantAttributeId?: string
	defaultPrice?: number | null
}

export type ProductVariantReplacementResult = {
	hasCustomVariantValues: boolean
	product: ProductDetailsItem
}

const SKU_MAX_LENGTH = 100
const PRODUCT_SKU_FALLBACK = 'SKU'
const DEFAULT_VARIANT_KEY = 'default'
const DEFAULT_VARIANT_SKU_SUFFIX = 'DEFAULT'

function normalizeVariantKey(value: string): string {
	return value.trim()
}

function applySuffix(base: string, suffix: number, maxLength: number): string {
	const suffixPart = suffix > 0 ? `-${suffix}` : ''
	const headLength = Math.max(0, maxLength - suffixPart.length)
	const head = base.slice(0, headLength).replace(/-+$/g, '')
	return `${head}${suffixPart}`
}

@Injectable()
export class ProductVariantService {
	constructor(
		private readonly repo: ProductRepository,
		private readonly variantBuilder: ProductVariantBuilder,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly featureEntitlements: CapabilityAssertPort
	) {}

	async setVariants(
		id: string,
		dto: SetProductVariantsDtoReq,
		catalogId: string,
		typeId: string
	): Promise<ProductVariantReplacementResult> {
		await this.featureEntitlements.assertCanUseProductVariants(catalogId)
		await this.assertCanUseSaleUnitsFromVariantInputs(catalogId, dto.items)

		const variantAttributeId = normalizeRequiredString(
			dto.variantAttributeId,
			'variantAttributeId'
		)
		const inputs = (dto.items ?? []).map(item => ({
			price: item.price,
			stock: item.stock,
			status: item.status,
			saleUnits: item.saleUnits,
			attributes: [
				{
					attributeId: variantAttributeId,
					enumValueId: item.enumValueId,
					value: item.value
				}
			]
		}))

		return this.replaceProductVariantMatrix(id, catalogId, typeId, inputs, {
			variantAttributeId
		})
	}

	async setVariantMatrix(
		id: string,
		dto: SetProductVariantMatrixDtoReq,
		catalogId: string,
		typeId: string
	): Promise<ProductVariantReplacementResult> {
		await this.featureEntitlements.assertCanUseProductVariants(catalogId)
		await this.assertCanUseSaleUnitsFromVariantInputs(catalogId, dto.items)

		return this.replaceProductVariantMatrix(
			id,
			catalogId,
			typeId,
			dto.items ?? []
		)
	}

	async prepareCreateVariants(
		scope: ProductValidationScopeInput,
		sku: string,
		variants: ProductVariantDtoReq[],
		productType?: ProductTypeValidationSchema | null,
		defaultPrice?: unknown,
		productStatus?: ProductStatus | null
	): Promise<ProductVariantData[]> {
		if (variants.length === 1 && !variants[0].attributes?.length) {
			this.assertDefaultVariantAllowed(productType)
			const input = variants[0]
			return [
				await this.buildDefaultVariantData(sku, input.price ?? defaultPrice, {
					stock: input.stock,
					status: input.status,
					productStatus,
					saleUnits: input.saleUnits
				})
			]
		}

		this.assertProductTypeVariantInputs(productType, variants)
		return this.variantBuilder.build(scope, variants, sku, {
			defaultPrice: this.normalizeVariantPrice(defaultPrice)
		})
	}

	async buildDefaultVariantData(
		sku: string,
		price: unknown,
		options: {
			stock?: number | null
			status?: ProductVariantStatus
			productStatus?: ProductStatus | null
			saleUnits?: ProductVariantDtoReq['saleUnits']
		} = {}
	): Promise<ProductVariantData> {
		const stock = options.stock ?? null
		const status =
			options.status ??
			this.resolveDefaultVariantStatus(options.productStatus, stock)

		return {
			sku: await this.ensureUniqueDefaultVariantSku(sku),
			variantKey: DEFAULT_VARIANT_KEY,
			kind: ProductVariantKind.DEFAULT,
			stock,
			price: this.normalizeVariantPrice(price),
			status,
			attributes: [],
			saleUnits: options.saleUnits
		}
	}

	prepareVariantUpdates(
		variants: ProductVariantUpdateDtoReq[]
	): ProductVariantUpdateData[] {
		if (!variants.length) return []
		const keySet = new Set<string>()

		return variants.map(variant => {
			const variantKey = normalizeVariantKey(variant.variantKey)
			if (keySet.has(variantKey)) {
				throw new BadRequestException(`Duplicate variant key: ${variantKey}`)
			}
			keySet.add(variantKey)

			if (
				variant.price === undefined &&
				variant.stock === undefined &&
				variant.status === undefined &&
				variant.saleUnits === undefined
			) {
				throw new BadRequestException(
					`Variant ${variantKey} requires price, stock, status or saleUnits`
				)
			}

			return {
				variantKey,
				price: variant.price,
				stock: variant.stock,
				status: variant.status,
				saleUnits: variant.saleUnits
			}
		})
	}

	async buildProductTypeChangeVariantMatrix(
		id: string,
		catalogId: string,
		validationScope: ProductValidationScopeInput,
		productType: ProductTypeValidationSchema | null,
		items: ProductVariantDtoReq[]
	): Promise<ProductVariantData[]> {
		const product = await this.repo.findSkuById(id, catalogId)
		if (!product) throw new NotFoundException('Product not found')

		this.assertProductTypeVariantInputs(productType, items)

		const productPrice =
			product.price === null
				? null
				: typeof product.price === 'number'
					? product.price
					: Number(product.price)
		const defaultPrice =
			productPrice === null || Number.isFinite(productPrice)
				? productPrice
				: undefined
		return this.variantBuilder.build(validationScope, items, product.sku, {
			defaultPrice
		})
	}

	async buildDuplicatedVariants(
		source: ProductDetailsItem,
		scope: ProductValidationScopeInput,
		sku: string
	): Promise<ProductVariantData[]> {
		const variantInputs = this.buildDuplicatedVariantInputs(source)
		if (variantInputs.length) {
			return this.variantBuilder.build(scope, variantInputs, sku)
		}

		const sourceDefaultVariant =
			source.variants.find(variant => isDefaultVariant(variant)) ??
			source.variants[0]

		return [
			await this.buildDefaultVariantData(
				sku,
				sourceDefaultVariant?.price ?? source.price,
				{
					stock: sourceDefaultVariant?.stock ?? null,
					status: sourceDefaultVariant?.status
				}
			)
		]
	}

	private async replaceProductVariantMatrix(
		id: string,
		catalogId: string,
		typeId: string,
		inputs: ProductVariantDtoReq[],
		options: VariantBuildOptions = {}
	): Promise<ProductVariantReplacementResult> {
		const product = await this.repo.findSkuById(id, catalogId)
		if (!product) throw new NotFoundException('Товар не найден')

		await this.assertIntegratedProductVariantsEditable(id, catalogId)

		const productPrice =
			product.price === null
				? null
				: typeof product.price === 'number'
					? product.price
					: Number(product.price)
		const defaultPrice =
			options.defaultPrice ??
			(productPrice === null || Number.isFinite(productPrice)
				? productPrice
				: undefined)

		if (!inputs.length) {
			const defaultVariant = await this.buildDefaultVariantData(
				product.sku,
				defaultPrice,
				{ productStatus: product.status }
			)
			const updated = await this.repo.setVariants(id, catalogId, [defaultVariant])
			if (!updated) throw new NotFoundException('Товар не найден')

			return {
				hasCustomVariantValues: false,
				product: updated
			}
		}

		const productType = product.productTypeId
			? await this.loadExistingProductTypeValidationSchema(
					product.productTypeId,
					catalogId
				)
			: null
		const validationScope = this.buildValidationScope(
			typeId,
			catalogId,
			productType?.id ?? null
		)

		this.assertProductTypeVariantInputs(productType, inputs)

		const variants = await this.variantBuilder.build(
			validationScope,
			inputs,
			product.sku,
			{
				...options,
				defaultPrice
			}
		)
		const hasCustomVariantValues = variants.some(variant =>
			variant.attributes.some(attribute => Boolean(attribute.value))
		)
		const updated = await this.repo.setVariants(id, catalogId, variants)
		if (!updated) throw new NotFoundException('Товар не найден')

		return {
			hasCustomVariantValues,
			product: updated
		}
	}

	private async assertIntegratedProductVariantsEditable(
		id: string,
		catalogId: string
	): Promise<void> {
		const isIntegrated = await this.repo.hasIntegrationProductOwnership(
			id,
			catalogId
		)
		if (!isIntegrated) return

		throw new BadRequestException(
			'Integrated product variants are managed by integration; variants cannot be changed manually'
		)
	}

	private buildValidationScope(
		catalogTypeId: string,
		catalogId: string,
		productTypeId?: string | null
	): ProductValidationScopeInput {
		return { catalogTypeId, catalogId, productTypeId }
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

	assertProductTypeVariantInputs(
		productType: ProductTypeValidationSchema | null | undefined,
		variants?: ProductTypeVariantCombinationInput[]
	): void {
		if (!productType) return
		assertProductTypeVariantCombinations(productType, variants)
	}

	hasProductTypeVariantAttributes(
		productType: ProductTypeValidationSchema | null | undefined
	): boolean {
		return Boolean(productType?.attributes.some(attribute => attribute.isVariant))
	}

	hasVariantAttributeInputs(
		variants: ProductTypeVariantCombinationInput[] | undefined
	): boolean {
		return Boolean(variants?.some(variant => variant.attributes?.length))
	}

	async assertCanUseSaleUnitsFromVariantInputs(
		catalogId: string,
		variants?: ProductVariantDtoReq[]
	): Promise<void> {
		if (!variants?.some(variant => variant.saleUnits !== undefined)) return
		await this.featureEntitlements.assertCanUseCatalogSaleUnits(catalogId)
	}

	async assertCanUseSaleUnitsFromVariantUpdates(
		catalogId: string,
		variants: ProductVariantUpdateDtoReq[]
	): Promise<void> {
		if (!variants.some(variant => variant.saleUnits !== undefined)) return
		await this.featureEntitlements.assertCanUseCatalogSaleUnits(catalogId)
	}

	hasCustomVariantValues(items?: ProductVariantDtoReq[]): boolean {
		return Boolean(
			items?.some(item =>
				item.attributes?.some(attribute => Boolean(attribute.value))
			)
		)
	}

	private assertDefaultVariantAllowed(
		productType: ProductTypeValidationSchema | null | undefined
	): void {
		if (!this.hasProductTypeVariantAttributes(productType)) return
		throw new BadRequestException(
			'Product type variant attributes require explicit variants'
		)
	}

	private resolveDefaultVariantStatus(
		productStatus?: ProductStatus | null,
		stock: number | null = null
	): ProductVariantStatus {
		if (productStatus && productStatus !== ProductStatus.ACTIVE) {
			return ProductVariantStatus.OUT_OF_STOCK
		}

		return stock === 0
			? ProductVariantStatus.OUT_OF_STOCK
			: ProductVariantStatus.ACTIVE
	}

	private async ensureUniqueDefaultVariantSku(base: string): Promise<string> {
		const normalizedBase = base.trim() || PRODUCT_SKU_FALLBACK
		let candidate = applySuffix(normalizedBase, 0, SKU_MAX_LENGTH)
		if (!(await this.repo.existsVariantSku(candidate))) {
			return candidate
		}

		const defaultBase = `${normalizedBase}-${DEFAULT_VARIANT_SKU_SUFFIX}`
		let suffix = 0
		while (true) {
			candidate = applySuffix(defaultBase, suffix, SKU_MAX_LENGTH)
			if (!(await this.repo.existsVariantSku(candidate))) {
				return candidate
			}
			suffix += 1
		}
	}

	private normalizeVariantPrice(price: unknown): number | null {
		if (price === null || price === undefined) return null
		const value = Number(price)
		if (!Number.isFinite(value) || value < 0) {
			throw new BadRequestException('Некорректная цена варианта')
		}
		return value
	}

	private buildDuplicatedVariantInputs(
		source: ProductDetailsItem
	): ProductVariantDtoReq[] {
		return source.variants
			.filter(variant => variant.attributes.length > 0)
			.map(variant => ({
				price:
					variant.price === null
						? null
						: typeof variant.price === 'number'
							? variant.price
							: Number(variant.price),
				stock: variant.stock,
				status: variant.status,
				saleUnits: variant.saleUnits?.map(unit => ({
					catalogSaleUnitId: unit.catalogSaleUnitId ?? undefined,
					code: unit.code,
					name: unit.name,
					baseQuantity: Number(unit.baseQuantity),
					price: Number(unit.price),
					barcode: unit.barcode,
					isDefault: unit.isDefault,
					isActive: unit.isActive,
					displayOrder: unit.displayOrder
				})),
				attributes: variant.attributes.map(attribute => ({
					attributeId: attribute.attributeId,
					enumValueId: attribute.enumValueId
				}))
			}))
	}
}

function isDefaultVariant(variant: {
	variantKey: string
	kind?: ProductVariantKind | null
}): boolean {
	return (
		variant.kind === ProductVariantKind.DEFAULT ||
		variant.variantKey === DEFAULT_VARIANT_KEY
	)
}

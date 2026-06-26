import {
	ProductStatus,
	ProductVariantKind,
	ProductVariantStatus
} from '@generated/enums'
import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
	CAPABILITY_READER_PORT,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'
import {
	CATALOG_PRICE_LIST_RESOLVER_PORT,
	type CatalogPriceListProductPriceContext,
	type CatalogPriceListResolverPort
} from '@/modules/catalog-price-list/public'

import type {
	ProductSellableAvailabilityState,
	ProductSellableProjection,
	ProductSellableReader,
	ProductSellableResolveOptions
} from './contracts'

const DEFAULT_VARIANT_KEY = 'default'

const productSellableSelect = {
	id: true,
	catalogId: true,
	price: true,
	status: true,
	variants: {
		where: { deleteAt: null },
		select: {
			id: true,
			variantKey: true,
			kind: true,
			price: true,
			stock: true,
			status: true,
			isAvailable: true,
			saleUnits: {
				where: {
					deleteAt: null,
					isActive: true
				},
				select: {
					id: true,
					price: true,
					baseQuantity: true,
					isDefault: true,
					displayOrder: true,
					createdAt: true
				},
				orderBy: [
					{ isDefault: 'desc' as const },
					{ displayOrder: 'asc' as const },
					{ createdAt: 'asc' as const }
				]
			},
			attributes: {
				where: { deleteAt: null },
				select: { id: true }
			}
		},
		orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
	}
}

type ProductSellableRow = NonNullable<
	Awaited<ReturnType<ProductSellableService['findProduct']>>
>
type ProductVariantRow = ProductSellableRow['variants'][number]

@Injectable()
export class ProductSellableService implements ProductSellableReader {
	constructor(
		private readonly prisma: PrismaService,
		@Optional()
		@Inject(CATALOG_PRICE_LIST_RESOLVER_PORT)
		private readonly priceLists?: CatalogPriceListResolverPort,
		@Optional()
		@Inject(CAPABILITY_READER_PORT)
		private readonly capabilities?: CapabilityReaderPort
	) {}

	async resolveProductSellable(
		catalogId: string,
		productId: string,
		options: ProductSellableResolveOptions = {}
	): Promise<ProductSellableProjection> {
		const product = await this.findProduct(catalogId, productId)
		if (!product) {
			throw new NotFoundException('Товар не найден')
		}

		const priceContext = await this.resolvePriceContext({
			buyerCatalogId: options.buyerCatalogId ?? catalogId,
			ownerCatalogId: catalogId,
			productIds: [product.id],
			...(options.ignorePriceList === true ? { ignorePriceList: true } : {})
		})

		return this.buildProjection(
			product,
			options,
			priceContext,
			await this.resolveBuyerFeatures(options.buyerCatalogId ?? catalogId)
		)
	}

	async resolveProductsSellable(
		catalogId: string,
		productIds: string[],
		options: ProductSellableResolveOptions = {}
	): Promise<Map<string, ProductSellableProjection>> {
		const uniqueProductIds = [...new Set(productIds.filter(Boolean))]
		if (!uniqueProductIds.length) return new Map()

		const products = await this.findProducts(catalogId, uniqueProductIds)
		const features = await this.resolveBuyerFeatures(
			options.buyerCatalogId ?? catalogId
		)
		const priceContext = await this.resolvePriceContext({
			buyerCatalogId: options.buyerCatalogId ?? catalogId,
			ownerCatalogId: catalogId,
			productIds: products.map(product => product.id),
			...(options.ignorePriceList === true ? { ignorePriceList: true } : {})
		})
		return new Map(
			products.map(product => [
				product.id,
				this.buildProjection(product, options, priceContext, features)
			])
		)
	}

	async resolveVariantSellable(
		catalogId: string,
		productId: string,
		variantId: string,
		options: ProductSellableResolveOptions = {}
	): Promise<ProductSellableProjection> {
		return this.resolveProductSellable(catalogId, productId, {
			...options,
			variantId
		})
	}

	private findProduct(catalogId: string, productId: string) {
		return this.prisma.product.findFirst({
			where: {
				id: productId,
				catalogId,
				deleteAt: null
			},
			select: productSellableSelect
		})
	}

	private findProducts(catalogId: string, productIds: string[]) {
		return this.prisma.product.findMany({
			where: {
				id: { in: productIds },
				catalogId,
				deleteAt: null
			},
			select: productSellableSelect
		})
	}

	private resolvePriceContext(params: {
		buyerCatalogId: string
		ownerCatalogId: string
		productIds: string[]
		ignorePriceList?: boolean
	}): Promise<CatalogPriceListProductPriceContext> {
		if (params.ignorePriceList) return Promise.resolve(this.emptyPriceContext())
		if (this.priceLists) {
			return this.priceLists.resolveProductPriceContext(params)
		}
		return Promise.resolve(this.emptyPriceContext())
	}

	private emptyPriceContext(): CatalogPriceListProductPriceContext {
		return {
			priceList: null,
			productPrices: new Map(),
			variantPrices: new Map(),
			saleUnitPrices: new Map()
		}
	}

	private buildProjection(
		product: ProductSellableRow,
		options: ProductSellableResolveOptions,
		priceContext: CatalogPriceListProductPriceContext,
		features: {
			canUseCatalogSaleUnits: boolean
			canUseProductVariants: boolean
		}
	): ProductSellableProjection {
		const defaultVariant = this.findDefaultVariant(product.variants)
		const matrixVariants = features.canUseProductVariants
			? product.variants.filter(variant => this.isMatrixVariant(variant))
			: []
		const mode = matrixVariants.length ? 'MATRIX' : 'SIMPLE'
		const selectedVariant = options.variantId
			? (product.variants.find(variant => variant.id === options.variantId) ??
				null)
			: this.resolveImplicitVariant(mode, defaultVariant, product.variants)
		if (options.variantId && !selectedVariant) {
			throw new NotFoundException('Вариация товара не найдена')
		}
		const priceCandidates = this.resolvePriceCandidates(
			product.variants,
			mode,
			selectedVariant,
			defaultVariant
		)
		const prices = priceCandidates
			.map(variant =>
				this.resolveDisplayPrice(product, variant, mode, priceContext, features)
			)
			.filter((price): price is number => price !== null)
		const legacyPrice = this.toNumber(product.price)
		const canUseLegacyPrice =
			!priceContext.priceList &&
			this.canUseLegacyProductPrice(mode, selectedVariant)
		const resolvedPrices = prices.length
			? prices
			: canUseLegacyPrice && legacyPrice !== null
				? [legacyPrice]
				: []
		const minPrice = resolvedPrices.length ? Math.min(...resolvedPrices) : null
		const maxPrice = resolvedPrices.length ? Math.max(...resolvedPrices) : null
		const availabilityCandidates = selectedVariant
			? [selectedVariant]
			: this.resolveAvailabilityCandidates(product.variants, mode, defaultVariant)
		const pricedAvailabilityCandidates = priceContext.priceList
			? availabilityCandidates.filter(variant =>
					this.hasPriceListPrice(product, variant, mode, priceContext, features)
				)
			: availabilityCandidates

		return {
			catalogId: product.catalogId,
			productId: product.id,
			mode,
			variantId: selectedVariant?.id ?? null,
			defaultVariantId: defaultVariant?.id ?? null,
			requiresVariantSelection: mode === 'MATRIX' && !selectedVariant,
			priceState: this.resolvePriceState(minPrice, maxPrice),
			displayPrice: this.formatPrice(minPrice),
			minPrice: this.formatPrice(minPrice),
			maxPrice: this.formatPrice(maxPrice),
			availabilityState: this.resolveAvailabilityState(
				product.status,
				pricedAvailabilityCandidates,
				options,
				this.shouldIgnoreTechnicalVariantAvailability(
					features,
					options,
					selectedVariant
				)
			),
			stock: this.resolveTotalStock(pricedAvailabilityCandidates),
			usesPriceList: Boolean(priceContext.priceList),
			priceListId: priceContext.priceList?.id ?? null,
			priceListCode: priceContext.priceList?.code ?? null,
			priceListName: priceContext.priceList?.name ?? null
		}
	}

	private findDefaultVariant(
		variants: ProductVariantRow[]
	): ProductVariantRow | null {
		return (
			variants.find(variant => this.isDefaultVariant(variant)) ??
			variants.find(variant => !variant.attributes.length) ??
			null
		)
	}

	private resolveImplicitVariant(
		mode: 'SIMPLE' | 'MATRIX',
		defaultVariant: ProductVariantRow | null,
		variants: ProductVariantRow[]
	): ProductVariantRow | null {
		if (mode === 'MATRIX') return null
		return defaultVariant ?? variants[0] ?? null
	}

	private resolvePriceCandidates(
		variants: ProductVariantRow[],
		mode: 'SIMPLE' | 'MATRIX',
		selectedVariant: ProductVariantRow | null,
		defaultVariant: ProductVariantRow | null
	): ProductVariantRow[] {
		if (selectedVariant) return [selectedVariant]
		if (mode === 'SIMPLE') return defaultVariant ? [defaultVariant] : variants
		return variants.filter(
			variant =>
				this.isMatrixVariant(variant) &&
				variant.status !== ProductVariantStatus.DISABLED
		)
	}

	private resolveAvailabilityCandidates(
		variants: ProductVariantRow[],
		mode: 'SIMPLE' | 'MATRIX',
		defaultVariant: ProductVariantRow | null
	): ProductVariantRow[] {
		if (mode === 'SIMPLE') return defaultVariant ? [defaultVariant] : variants
		return variants.filter(variant => this.isMatrixVariant(variant))
	}

	private isMatrixVariant(variant: ProductVariantRow): boolean {
		return (
			!this.isDefaultVariant(variant) &&
			(variant.kind === ProductVariantKind.MATRIX || variant.attributes.length > 0)
		)
	}

	private isDefaultVariant(variant: ProductVariantRow): boolean {
		return (
			variant.kind === ProductVariantKind.DEFAULT ||
			variant.variantKey === DEFAULT_VARIANT_KEY
		)
	}

	private resolveDisplayPrice(
		product: ProductSellableRow,
		variant: ProductVariantRow,
		mode: 'SIMPLE' | 'MATRIX',
		priceContext: CatalogPriceListProductPriceContext,
		features: {
			canUseCatalogSaleUnits: boolean
			canUseProductVariants: boolean
		}
	): number | null {
		if (priceContext.priceList) {
			return this.resolvePriceListDisplayPrice(
				product,
				variant,
				mode,
				priceContext,
				features
			)
		}

		const defaultSaleUnit = features.canUseCatalogSaleUnits
			? this.resolveDefaultSaleUnit(variant)
			: null
		return this.toNumber(defaultSaleUnit?.price ?? variant.price)
	}

	private resolveDefaultSaleUnit(variant: ProductVariantRow) {
		return variant.saleUnits?.[0] ?? null
	}

	private resolvePriceListDisplayPrice(
		product: ProductSellableRow,
		variant: ProductVariantRow,
		mode: 'SIMPLE' | 'MATRIX',
		priceContext: CatalogPriceListProductPriceContext,
		features: {
			canUseCatalogSaleUnits: boolean
			canUseProductVariants: boolean
		}
	): number | null {
		if (features.canUseCatalogSaleUnits) {
			const saleUnits = variant.saleUnits ?? []
			if (saleUnits.length > 0) {
				const saleUnitPrice = saleUnits
					.map(saleUnit => priceContext.saleUnitPrices.get(saleUnit.id) ?? null)
					.find((price): price is string => price !== null)
				return saleUnitPrice !== undefined ? this.toNumber(saleUnitPrice) : null
			}
		}

		if (mode === 'MATRIX' && this.isMatrixVariant(variant)) {
			return this.toNumber(priceContext.variantPrices.get(variant.id))
		}

		return this.toNumber(priceContext.productPrices.get(product.id))
	}

	private hasPriceListPrice(
		product: ProductSellableRow,
		variant: ProductVariantRow,
		mode: 'SIMPLE' | 'MATRIX',
		priceContext: CatalogPriceListProductPriceContext,
		features: {
			canUseCatalogSaleUnits: boolean
			canUseProductVariants: boolean
		}
	): boolean {
		return (
			this.resolvePriceListDisplayPrice(
				product,
				variant,
				mode,
				priceContext,
				features
			) !== null
		)
	}

	private async resolveBuyerFeatures(catalogId: string): Promise<{
		canUseCatalogSaleUnits: boolean
		canUseProductVariants: boolean
	}> {
		if (!this.capabilities) {
			return {
				canUseCatalogSaleUnits: true,
				canUseProductVariants: true
			}
		}

		const [canUseCatalogSaleUnits, canUseProductVariants] = await Promise.all([
			this.capabilities.canUseCatalogSaleUnits(catalogId),
			this.capabilities.canUseProductVariants(catalogId)
		])
		return {
			canUseCatalogSaleUnits,
			canUseProductVariants
		}
	}

	private resolvePriceState(minPrice: number | null, maxPrice: number | null) {
		if (minPrice === null || maxPrice === null) return 'UNKNOWN'
		return minPrice === maxPrice ? 'KNOWN' : 'RANGE'
	}

	private canUseLegacyProductPrice(
		mode: 'SIMPLE' | 'MATRIX',
		selectedVariant: ProductVariantRow | null
	): boolean {
		if (mode === 'MATRIX') return false
		if (selectedVariant && this.isMatrixVariant(selectedVariant)) return false
		return true
	}

	private resolveAvailabilityState(
		productStatus: ProductStatus,
		variants: ProductVariantRow[],
		options: ProductSellableResolveOptions,
		ignoreTechnicalVariantAvailability: boolean
	): ProductSellableAvailabilityState {
		if (productStatus !== ProductStatus.ACTIVE) return 'UNAVAILABLE'
		if (ignoreTechnicalVariantAvailability) return 'AVAILABLE'

		const quantity = Math.max(1, Math.ceil(options.quantity ?? 1))
		const enabledVariants = variants.filter(
			variant => variant.status !== ProductVariantStatus.DISABLED
		)
		if (!enabledVariants.length) return 'UNAVAILABLE'

		const availableVariants = enabledVariants.filter(
			variant =>
				variant.status === ProductVariantStatus.ACTIVE && variant.isAvailable
		)
		if (!availableVariants.length) return 'OUT_OF_STOCK'

		if (!options.enforceStock) return 'AVAILABLE'

		const hasEnoughStock = availableVariants.some(
			variant => variant.stock === null || variant.stock >= quantity
		)
		if (hasEnoughStock) return 'AVAILABLE'

		return 'OUT_OF_STOCK'
	}

	private shouldIgnoreTechnicalVariantAvailability(
		features: { canUseProductVariants: boolean },
		options: ProductSellableResolveOptions,
		selectedVariant: ProductVariantRow | null
	): boolean {
		if (features.canUseProductVariants || options.enforceStock) return false
		if (!options.variantId) return true
		return Boolean(selectedVariant && this.isDefaultVariant(selectedVariant))
	}

	private resolveTotalStock(variants: ProductVariantRow[]): number | null {
		if (!variants.length) return null
		if (variants.some(variant => variant.stock === null)) return null
		return variants.reduce(
			(sum, variant) => sum + Math.max(0, variant.stock ?? 0),
			0
		)
	}

	private formatPrice(value: number | null): string | null {
		return value === null ? null : value.toFixed(2)
	}

	private toNumber(value: unknown): number | null {
		if (value === null || value === undefined) return null
		if (typeof value === 'number') return Number.isFinite(value) ? value : null
		if (typeof value === 'string') {
			const parsed = Number(value)
			return Number.isFinite(parsed) ? parsed : null
		}
		if (typeof value === 'bigint') return Number(value)
		if (this.hasToNumber(value)) {
			const parsed = value.toNumber()
			return Number.isFinite(parsed) ? parsed : null
		}
		return null
	}

	private hasToNumber(value: unknown): value is { toNumber: () => number } {
		if (typeof value !== 'object' || value === null) return false
		return typeof (value as { toNumber?: unknown }).toNumber === 'function'
	}
}

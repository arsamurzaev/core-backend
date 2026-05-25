import {
	ProductStatus,
	ProductVariantKind,
	ProductVariantStatus
} from '@generated/enums'
import { Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'

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
	constructor(private readonly prisma: PrismaService) {}

	async resolveProductSellable(
		catalogId: string,
		productId: string,
		options: ProductSellableResolveOptions = {}
	): Promise<ProductSellableProjection> {
		const product = await this.findProduct(catalogId, productId)
		if (!product) {
			throw new NotFoundException('Товар не найден')
		}

		return this.buildProjection(product, options)
	}

	async resolveProductsSellable(
		catalogId: string,
		productIds: string[],
		options: ProductSellableResolveOptions = {}
	): Promise<Map<string, ProductSellableProjection>> {
		const uniqueProductIds = [...new Set(productIds.filter(Boolean))]
		if (!uniqueProductIds.length) return new Map()

		const products = await this.findProducts(catalogId, uniqueProductIds)
		return new Map(
			products.map(product => [
				product.id,
				this.buildProjection(product, options)
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

	private buildProjection(
		product: ProductSellableRow,
		options: ProductSellableResolveOptions
	): ProductSellableProjection {
		const defaultVariant = this.findDefaultVariant(product.variants)
		const matrixVariants = product.variants.filter(variant =>
			this.isMatrixVariant(variant)
		)
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
			.map(variant => this.resolveDisplayPrice(variant))
			.filter((price): price is number => price !== null)
		const legacyPrice = this.toNumber(product.price)
		const canUseLegacyPrice = this.canUseLegacyProductPrice(
			mode,
			selectedVariant
		)
		const resolvedPrices = prices.length
			? prices
			: canUseLegacyPrice && legacyPrice !== null
				? [legacyPrice]
				: []
		const minPrice = resolvedPrices.length ? Math.min(...resolvedPrices) : null
		const maxPrice = resolvedPrices.length ? Math.max(...resolvedPrices) : null
		const availabilityCandidates = selectedVariant
			? [selectedVariant]
			: this.resolveAvailabilityCandidates(
					product.variants,
					mode,
					defaultVariant
				)

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
				availabilityCandidates,
				options
			),
			stock: this.resolveTotalStock(availabilityCandidates)
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
			(variant.kind === ProductVariantKind.MATRIX ||
				variant.attributes.length > 0)
		)
	}

	private isDefaultVariant(variant: ProductVariantRow): boolean {
		return (
			variant.kind === ProductVariantKind.DEFAULT ||
			variant.variantKey === DEFAULT_VARIANT_KEY
		)
	}

	private resolveDisplayPrice(variant: ProductVariantRow): number | null {
		const defaultSaleUnit = this.resolveDefaultSaleUnit(variant)
		return this.toNumber(defaultSaleUnit?.price ?? variant.price)
	}

	private resolveDefaultSaleUnit(variant: ProductVariantRow) {
		return variant.saleUnits?.[0] ?? null
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
		options: ProductSellableResolveOptions
	): ProductSellableAvailabilityState {
		if (productStatus !== ProductStatus.ACTIVE) return 'UNAVAILABLE'

		const quantity = Math.max(1, Math.ceil(options.quantity ?? 1))
		const enabledVariants = variants.filter(
			variant => variant.status !== ProductVariantStatus.DISABLED
		)
		if (!enabledVariants.length) return 'UNAVAILABLE'

		if (!options.enforceStock) return 'AVAILABLE'

		const hasEnoughStock = enabledVariants.some(
			variant =>
				variant.status === ProductVariantStatus.ACTIVE &&
				variant.isAvailable &&
				(variant.stock === null || variant.stock >= quantity)
		)
		if (hasEnoughStock) return 'AVAILABLE'

		return enabledVariants.some(
			variant => variant.status === ProductVariantStatus.ACTIVE
		)
			? 'OUT_OF_STOCK'
			: 'UNAVAILABLE'
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

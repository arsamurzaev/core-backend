import type { Prisma } from '@generated/client'
import { BadRequestException, Injectable } from '@nestjs/common'

import type { ProductSellableProjection } from '@/modules/product/contracts'

import { resolveCartItemPricing } from './cart.utils'

export type CartSaleUnitSelection = {
	id: string
	variantId: string
	baseQuantity: Prisma.Decimal | number | string
	price: Prisma.Decimal | number | string
} | null

export type CartProductSnapshotSource = {
	catalogId?: string
	price: Prisma.Decimal | number | string | null
	productAttributes?: {
		valueDecimal?: Prisma.Decimal | number | string | null
		valueInteger?: number | null
		valueString?: string | null
		valueDateTime?: Date | string | null
		attribute?: { key?: string | null } | null
	}[]
}

export type CartVariantSnapshotSource = CartProductSnapshotSource | null

export type CartResolvedLineSnapshot = {
	baseQuantity: number
	unitPriceSnapshot: Prisma.Decimal | number | null
}

@Injectable()
export class CartLinePricingService {
	async resolveSaleUnit(
		tx: Prisma.TransactionClient,
		variantId: string | null,
		saleUnitId: string | null
	): Promise<CartSaleUnitSelection> {
		if (!variantId) {
			if (saleUnitId) {
				throw new BadRequestException(
					'Единица продажи недоступна для выбранного товара'
				)
			}
			return null
		}

		if (saleUnitId) {
			const saleUnit = await tx.productVariantSaleUnit.findFirst({
				where: {
					id: saleUnitId,
					variantId,
					isActive: true,
					deleteAt: null
				},
				select: {
					id: true,
					variantId: true,
					baseQuantity: true,
					price: true
				}
			})

			if (!saleUnit) {
				throw new BadRequestException(
					'Единица продажи недоступна для выбранной вариации'
				)
			}

			return saleUnit
		}

		return null
	}

	resolveLineSnapshot(params: {
		variantId: string | null
		saleUnit: CartSaleUnitSelection
		quantity: number
		productSnapshot: CartProductSnapshotSource
		variantSnapshot: CartVariantSnapshotSource
		commercialProjection?: ProductSellableProjection | null
	}): CartResolvedLineSnapshot {
		const commercialPrice = this.resolveCommercialPrice(
			params.commercialProjection
		)
		const pricingProduct = params.variantId
			? params.productSnapshot
			: this.withCommercialPrice(params.productSnapshot, commercialPrice)
		const pricingVariant = params.variantId
			? this.withCommercialPrice(params.variantSnapshot, commercialPrice)
			: params.variantSnapshot
		const hasKnownPrice = this.hasKnownPrice(
			params.saleUnit?.price ??
				commercialPrice ??
				params.variantSnapshot?.price ??
				params.productSnapshot.price
		)
		const pricing = resolveCartItemPricing({
			product: pricingProduct,
			variant: pricingVariant,
			saleUnit: params.saleUnit,
			quantity: params.quantity
		})

		if (params.saleUnit) {
			return {
				baseQuantity: this.resolveBaseQuantity(
					params.quantity,
					params.saleUnit.baseQuantity
				),
				unitPriceSnapshot: hasKnownPrice ? pricing.unitPrice : null
			}
		}

		if (params.variantId && params.variantSnapshot) {
			return {
				baseQuantity: this.resolveBaseQuantity(params.quantity, 1),
				unitPriceSnapshot: hasKnownPrice ? pricing.unitPrice : null
			}
		}

		if (params.variantId) {
			throw new BadRequestException('Товар не найден')
		}

		return {
			baseQuantity: this.resolveBaseQuantity(params.quantity, 1),
			unitPriceSnapshot: hasKnownPrice ? pricing.unitPrice : null
		}
	}

	isSameMoney(left: unknown, right: unknown): boolean {
		return this.toMoneyNumber(left) === this.toMoneyNumber(right)
	}

	private resolveCommercialPrice(
		projection: ProductSellableProjection | null | undefined
	): string | null {
		if (!projection || projection.priceState === 'UNKNOWN') return null
		return typeof projection.displayPrice === 'string'
			? projection.displayPrice
			: null
	}

	private withCommercialPrice<T extends { price: unknown } | null>(
		source: T,
		commercialPrice: string | null
	): T {
		if (commercialPrice === null || !source) return source
		return { ...source, price: commercialPrice }
	}

	private resolveBaseQuantity(quantity: number, baseQuantity: unknown): number {
		const multiplier = this.toFiniteNumber(baseQuantity)
		return Math.max(0, Math.ceil(quantity * (multiplier > 0 ? multiplier : 1)))
	}

	private toFiniteNumber(value: unknown): number {
		const parsed = this.readFiniteNumber(value)
		return Number.isFinite(parsed) ? parsed : 0
	}

	private toMoneyNumber(value: unknown): number {
		const parsed = this.readFiniteNumber(value)
		return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0
	}

	private hasKnownPrice(value: unknown): boolean {
		return Number.isFinite(this.readFiniteNumber(value))
	}

	private readFiniteNumber(value: unknown): number {
		if (typeof value === 'number') return value
		if (typeof value === 'string') return Number(value)
		if (typeof value === 'bigint') return Number(value)
		if (this.hasToNumber(value)) return value.toNumber()
		return Number.NaN
	}

	private hasToNumber(value: unknown): value is { toNumber: () => number } {
		if (typeof value !== 'object' || value === null) return false
		const candidate = value as { toNumber?: unknown }
		return typeof candidate.toNumber === 'function'
	}
}

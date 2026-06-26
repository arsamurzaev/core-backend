import type { Prisma } from '@generated/client'
import { CatalogPriceListPriceTarget } from '@generated/enums'
import { Inject, Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
	CAPABILITY_READER_PORT,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'

import type {
	CatalogPriceListActivePriceListParams,
	CatalogPriceListLinePrice,
	CatalogPriceListLinePriceParams,
	CatalogPriceListProductPriceContext,
	CatalogPriceListProductPriceContextParams,
	CatalogPriceListResolverPort,
	CatalogPriceListSnapshot
} from './contracts'

const priceListSnapshotSelect = {
	id: true,
	code: true,
	name: true
}

const priceListPriceResolverSelect = {
	target: true,
	targetId: true,
	productId: true,
	variantId: true,
	saleUnitId: true,
	price: true
} as const

type PriceDatabase = PrismaService | Prisma.TransactionClient

@Injectable()
export class CatalogPriceListResolverService implements CatalogPriceListResolverPort {
	constructor(
		private readonly prisma: PrismaService,
		@Inject(CAPABILITY_READER_PORT)
		private readonly capabilities: CapabilityReaderPort
	) {}

	async resolveProductPriceContext(
		params: CatalogPriceListProductPriceContextParams
	): Promise<CatalogPriceListProductPriceContext> {
		const priceList = await this.resolveActivePriceList({
			buyerCatalogId: params.buyerCatalogId,
			ownerCatalogId: params.ownerCatalogId,
			tx: params.tx
		})
		if (!priceList) return this.emptyContext()

		const productIds = [...new Set(params.productIds.filter(Boolean))]
		if (!productIds.length) {
			return {
				...this.emptyContext(),
				priceList
			}
		}

		const rows = await this.db(params.tx).catalogPriceListPrice.findMany({
			where: {
				priceListId: priceList.id,
				productId: { in: productIds },
				deleteAt: null
			},
			select: priceListPriceResolverSelect
		})

		const context: CatalogPriceListProductPriceContext = {
			priceList,
			productPrices: new Map(),
			variantPrices: new Map(),
			saleUnitPrices: new Map()
		}

		for (const row of rows) {
			const price = this.toDecimalString(row.price)
			if (row.target === CatalogPriceListPriceTarget.PRODUCT) {
				context.productPrices.set(row.productId, price)
			}
			if (row.target === CatalogPriceListPriceTarget.VARIANT && row.variantId) {
				context.variantPrices.set(row.variantId, price)
			}
			if (row.target === CatalogPriceListPriceTarget.SALE_UNIT && row.saleUnitId) {
				context.saleUnitPrices.set(row.saleUnitId, price)
			}
		}

		return context
	}

	async resolveLinePrice(
		params: CatalogPriceListLinePriceParams
	): Promise<CatalogPriceListLinePrice> {
		const priceList = await this.resolveActivePriceList({
			buyerCatalogId: params.buyerCatalogId,
			ownerCatalogId: params.ownerCatalogId,
			tx: params.tx
		})
		if (!priceList) {
			return { priceList: null, price: null, target: null, targetId: null }
		}

		const { target, targetId } = this.resolveLineTarget(params)
		const row = await this.db(params.tx).catalogPriceListPrice.findFirst({
			where: {
				priceListId: priceList.id,
				target,
				targetId,
				productId: params.productId,
				deleteAt: null
			},
			select: { price: true }
		})
		return {
			priceList,
			price: row ? this.toDecimalString(row.price) : null,
			target,
			targetId
		}
	}

	async resolveActivePriceList(
		params: CatalogPriceListActivePriceListParams
	): Promise<CatalogPriceListSnapshot | null> {
		if (
			!(await this.capabilities.canUseCatalogPriceLists(params.buyerCatalogId))
		) {
			return null
		}

		const catalog = await this.db(params.tx).catalog.findFirst({
			where: { id: params.buyerCatalogId, deleteAt: null },
			select: {
				id: true,
				parentId: true,
				settings: { select: { activePriceListId: true } }
			}
		})
		if (!catalog?.settings?.activePriceListId) return null

		const ownerCatalogId = catalog.parentId ?? catalog.id
		if (params.ownerCatalogId && ownerCatalogId !== params.ownerCatalogId) {
			return null
		}
		if (
			ownerCatalogId !== params.buyerCatalogId &&
			!(await this.capabilities.canUseCatalogPriceLists(ownerCatalogId))
		) {
			return null
		}

		return this.db(params.tx).catalogPriceList.findFirst({
			where: {
				id: catalog.settings.activePriceListId,
				catalogId: ownerCatalogId,
				isActive: true,
				deleteAt: null
			},
			select: priceListSnapshotSelect
		})
	}

	private resolveLineTarget(params: {
		productId: string
		variantId?: string | null
		saleUnitId?: string | null
		mode: 'SIMPLE' | 'MATRIX'
	}): {
		target: CatalogPriceListPriceTarget
		targetId: string
	} {
		if (params.saleUnitId) {
			return {
				target: CatalogPriceListPriceTarget.SALE_UNIT,
				targetId: params.saleUnitId
			}
		}
		if (params.mode === 'MATRIX' && params.variantId) {
			return {
				target: CatalogPriceListPriceTarget.VARIANT,
				targetId: params.variantId
			}
		}
		return {
			target: CatalogPriceListPriceTarget.PRODUCT,
			targetId: params.productId
		}
	}

	private emptyContext(): CatalogPriceListProductPriceContext {
		return {
			priceList: null,
			productPrices: new Map(),
			variantPrices: new Map(),
			saleUnitPrices: new Map()
		}
	}

	private db(tx?: Prisma.TransactionClient): PriceDatabase {
		return tx ?? this.prisma
	}

	private toDecimalString(value: unknown): string {
		if (typeof value === 'string') return Number(value).toFixed(2)
		if (typeof value === 'number') return value.toFixed(2)
		if (typeof value === 'bigint') return Number(value).toFixed(2)
		if (value && typeof value === 'object') {
			const candidate = value as {
				toNumber?: () => unknown
				toString?: () => string
			}
			if (typeof candidate.toNumber === 'function') {
				try {
					const parsed = candidate.toNumber()
					if (typeof parsed === 'number' && Number.isFinite(parsed)) {
						return parsed.toFixed(2)
					}
				} catch {
					// Fall back to a custom toString implementation below.
				}
			}
			if (
				typeof candidate.toString === 'function' &&
				candidate.toString !== Object.prototype.toString
			) {
				const normalized = candidate.toString()
				const parsed = Number(normalized)
				return Number.isFinite(parsed) ? parsed.toFixed(2) : normalized
			}
		}
		return '0.00'
	}
}

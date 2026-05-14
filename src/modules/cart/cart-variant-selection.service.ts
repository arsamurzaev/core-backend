import type { Prisma } from '@generated/client'
import { ProductVariantStatus } from '@generated/client'
import type { CatalogInventoryMode } from '@generated/enums'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'

import {
	CAPABILITY_READER_PORT,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'

import type { NormalizedCartItemInput } from './cart.utils'

const INVENTORY_MODE_NONE: CatalogInventoryMode = 'NONE'

@Injectable()
export class CartVariantSelectionService {
	constructor(
		@Inject(CAPABILITY_READER_PORT)
		private readonly capabilities: CapabilityReaderPort
	) {}

	async resolveCartVariantId(
		tx: Prisma.TransactionClient,
		catalogId: string,
		input: NormalizedCartItemInput,
		inventoryMode: CatalogInventoryMode
	): Promise<string | null> {
		const canUseVariants =
			await this.capabilities.canUseProductVariants(catalogId)
		if (!canUseVariants) return null

		if (input.variantId) return input.variantId

		if (input.saleUnitId) {
			const saleUnit = await tx.productVariantSaleUnit.findFirst({
				where: {
					id: input.saleUnitId,
					isActive: true,
					deleteAt: null,
					variant: {
						productId: input.productId,
						deleteAt: null
					}
				},
				select: { variantId: true }
			})

			if (!saleUnit) {
				throw new BadRequestException(
					'Единица продажи недоступна для выбранного товара'
				)
			}

			return saleUnit.variantId
		}

		if (input.quantity <= 0) return input.variantId

		const variants = await tx.productVariant.findMany({
			where: { productId: input.productId, deleteAt: null },
			select: {
				id: true,
				stock: true,
				status: true,
				isAvailable: true,
				attributes: {
					where: { deleteAt: null },
					select: { id: true }
				}
			},
			orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
		})

		if (!variants.length) return null

		const purchasable = variants.filter(variant =>
			this.isVariantPurchasable(variant, input.quantity, inventoryMode)
		)

		if (purchasable.length === 1) return purchasable[0].id
		if (purchasable.length > 1) {
			throw new BadRequestException('Выберите вариацию товара')
		}

		throw new BadRequestException('Вариация товара недоступна')
	}

	async ensureVariantPurchasable(
		tx: Prisma.TransactionClient,
		variantId: string,
		quantity: number,
		productId: string | undefined,
		inventoryMode: CatalogInventoryMode
	): Promise<void> {
		const variant = await tx.productVariant.findFirst({
			where: {
				id: variantId,
				...(productId ? { productId } : {}),
				deleteAt: null
			},
			select: { stock: true, isAvailable: true, status: true }
		})

		if (!variant) {
			throw new BadRequestException('Вариация товара недоступна')
		}

		if (this.isVariantPurchasable(variant, quantity, inventoryMode)) return

		if (this.shouldEnforceStock(inventoryMode)) {
			throw new BadRequestException(
				`Недостаточно товара на складе. Доступно: ${variant.stock}`
			)
		}

		throw new BadRequestException('Вариация товара недоступна')
	}

	private isVariantPurchasable(
		variant: {
			stock: number
			isAvailable: boolean
			status: ProductVariantStatus
		},
		quantity: number,
		inventoryMode: CatalogInventoryMode
	): boolean {
		if (!this.shouldEnforceStock(inventoryMode)) {
			return variant.status !== ProductVariantStatus.DISABLED
		}

		return (
			variant.status === ProductVariantStatus.ACTIVE &&
			variant.isAvailable &&
			variant.stock >= quantity
		)
	}

	private shouldEnforceStock(inventoryMode: CatalogInventoryMode): boolean {
		return inventoryMode !== INVENTORY_MODE_NONE
	}
}

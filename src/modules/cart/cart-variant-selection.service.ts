import type { Prisma } from '@generated/client'
import type { CatalogInventoryMode } from '@generated/enums'
import {
	BadRequestException,
	Inject,
	Injectable,
	NotFoundException
} from '@nestjs/common'

import {
	CAPABILITY_READER_PORT,
	type CapabilityReaderPort
} from '@/modules/capability/contracts'
import {
	PRODUCT_SELLABLE_READER_PORT,
	type ProductSellableReader
} from '@/modules/product/contracts'

import type { NormalizedCartItemInput } from './cart.utils'

const INVENTORY_MODE_NONE: CatalogInventoryMode = 'NONE'

type EnsureCartVariantPurchasableInput = {
	catalogId: string
	buyerCatalogId?: string | null
	productId: string
	variantId: string
	quantity: number
	inventoryMode: CatalogInventoryMode
}

@Injectable()
export class CartVariantSelectionService {
	constructor(
		@Inject(CAPABILITY_READER_PORT)
		private readonly capabilities: CapabilityReaderPort,
		@Inject(PRODUCT_SELLABLE_READER_PORT)
		private readonly sellableReader: ProductSellableReader
	) {}

	async resolveCartVariantId(
		tx: Prisma.TransactionClient,
		catalogId: string,
		input: NormalizedCartItemInput,
		inventoryMode: CatalogInventoryMode,
		options: { buyerCatalogId?: string | null } = {}
	): Promise<string | null> {
		const canUseVariants =
			await this.capabilities.canUseProductVariants(catalogId)

		if (input.quantity <= 0) return input.variantId

		if (canUseVariants && input.variantId) return input.variantId

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

		if (!canUseVariants) {
			return this.resolveImplicitProductVariantId(
				catalogId,
				input,
				inventoryMode,
				{
					requireExplicitSelection: false,
					buyerCatalogId: options.buyerCatalogId
				}
			)
		}

		return this.resolveImplicitProductVariantId(catalogId, input, inventoryMode, {
			requireExplicitSelection: true,
			buyerCatalogId: options.buyerCatalogId
		})
	}

	async ensureVariantPurchasable(
		input: EnsureCartVariantPurchasableInput
	): Promise<void> {
		const sellable = await this.resolveVariantSellableOrBadRequest(input)

		if (sellable.variantId !== input.variantId) {
			throw new BadRequestException('Вариация товара недоступна')
		}

		if (sellable.availabilityState === 'AVAILABLE') return

		if (sellable.availabilityState === 'OUT_OF_STOCK') {
			throw new BadRequestException(
				`Недостаточно товара на складе. Доступно: ${sellable.stock ?? 0}`
			)
		}

		if (sellable.availabilityState === 'UNAVAILABLE') {
			throw new BadRequestException('Вариация товара недоступна')
		}
	}

	private async resolveImplicitProductVariantId(
		catalogId: string,
		input: NormalizedCartItemInput,
		inventoryMode: CatalogInventoryMode,
		options: { buyerCatalogId?: string | null; requireExplicitSelection: boolean }
	): Promise<string | null> {
		const sellable = await this.sellableReader.resolveProductSellable(
			catalogId,
			input.productId,
			{
				quantity: input.quantity,
				enforceStock: this.shouldEnforceStock(inventoryMode),
				...(options.buyerCatalogId
					? { buyerCatalogId: options.buyerCatalogId }
					: {})
			}
		)

		if (sellable.requiresVariantSelection) {
			if (options.requireExplicitSelection) {
				throw new BadRequestException('Выберите вариацию товара')
			}
			return null
		}

		return sellable.variantId
	}

	private async resolveVariantSellableOrBadRequest(
		input: EnsureCartVariantPurchasableInput
	) {
		try {
			return await this.sellableReader.resolveVariantSellable(
				input.catalogId,
				input.productId,
				input.variantId,
				{
					quantity: input.quantity,
					enforceStock: this.shouldEnforceStock(input.inventoryMode),
					...(input.buyerCatalogId ? { buyerCatalogId: input.buyerCatalogId } : {})
				}
			)
		} catch (error) {
			if (error instanceof NotFoundException) {
				throw new BadRequestException('Вариация товара недоступна')
			}
			throw error
		}
	}

	private shouldEnforceStock(inventoryMode: CatalogInventoryMode): boolean {
		return inventoryMode !== INVENTORY_MODE_NONE
	}
}

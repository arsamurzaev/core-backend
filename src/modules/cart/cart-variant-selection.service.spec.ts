import { NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { CAPABILITY_READER_PORT } from '@/modules/capability/contracts'
import { PRODUCT_SELLABLE_READER_PORT } from '@/modules/product/contracts'

import { CartVariantSelectionService } from './cart-variant-selection.service'

describe('CartVariantSelectionService', () => {
	let service: CartVariantSelectionService
	let capabilities: { canUseProductVariants: jest.Mock }
	let sellableReader: {
		resolveProductSellable: jest.Mock
		resolveVariantSellable: jest.Mock
	}
	let tx: {
		productVariantSaleUnit: { findFirst: jest.Mock }
		productVariant: { findMany: jest.Mock; findFirst: jest.Mock }
	}

	beforeEach(async () => {
		capabilities = {
			canUseProductVariants: jest.fn().mockResolvedValue(true)
		}
		sellableReader = {
			resolveProductSellable: jest.fn().mockResolvedValue({
				mode: 'SIMPLE',
				variantId: null,
				requiresVariantSelection: false,
				availabilityState: 'AVAILABLE'
			}),
			resolveVariantSellable: jest.fn().mockResolvedValue({
				variantId: 'variant-1',
				availabilityState: 'AVAILABLE',
				stock: 5
			})
		}
		tx = {
			productVariantSaleUnit: {
				findFirst: jest.fn()
			},
			productVariant: {
				findMany: jest.fn(),
				findFirst: jest.fn()
			}
		}

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				CartVariantSelectionService,
				{
					provide: CAPABILITY_READER_PORT,
					useValue: capabilities
				},
				{
					provide: PRODUCT_SELLABLE_READER_PORT,
					useValue: sellableReader
				}
			]
		}).compile()

		service = module.get(CartVariantSelectionService)
	})

	it('resolves a variant through selected sale unit', async () => {
		tx.productVariantSaleUnit.findFirst.mockResolvedValue({
			variantId: 'variant-from-sale-unit'
		})

		await expect(
			service.resolveCartVariantId(
				tx as never,
				'catalog-1',
				{
					productId: 'product-1',
					variantId: null,
					saleUnitId: 'sale-unit-1',
					quantity: 2
				},
				'NONE'
			)
		).resolves.toBe('variant-from-sale-unit')
		expect(sellableReader.resolveProductSellable).not.toHaveBeenCalled()
	})

	it('resolves simple default variant through sellable projection', async () => {
		sellableReader.resolveProductSellable.mockResolvedValue({
			mode: 'SIMPLE',
			variantId: 'default-variant',
			requiresVariantSelection: false,
			availabilityState: 'AVAILABLE'
		})

		await expect(
			service.resolveCartVariantId(
				tx as never,
				'catalog-1',
				{
					productId: 'product-1',
					variantId: null,
					saleUnitId: null,
					quantity: 1
				},
				'NONE'
			)
		).resolves.toBe('default-variant')
		expect(tx.productVariant.findMany).not.toHaveBeenCalled()
		expect(sellableReader.resolveProductSellable).toHaveBeenCalledWith(
			'catalog-1',
			'product-1',
			{ quantity: 1, enforceStock: false }
		)
	})

	it('uses buyer catalog context while resolving an implicit variant', async () => {
		sellableReader.resolveProductSellable.mockResolvedValue({
			mode: 'SIMPLE',
			variantId: 'default-variant',
			requiresVariantSelection: false,
			availabilityState: 'AVAILABLE'
		})

		await expect(
			service.resolveCartVariantId(
				tx as never,
				'parent-catalog',
				{
					productId: 'product-1',
					variantId: null,
					saleUnitId: null,
					quantity: 1
				},
				'NONE',
				{ buyerCatalogId: 'child-catalog' }
			)
		).resolves.toBe('default-variant')
		expect(sellableReader.resolveProductSellable).toHaveBeenCalledWith(
			'parent-catalog',
			'product-1',
			{ quantity: 1, enforceStock: false, buyerCatalogId: 'child-catalog' }
		)
	})

	it('resolves hidden default variant when product variants are disabled', async () => {
		capabilities.canUseProductVariants.mockResolvedValue(false)
		sellableReader.resolveProductSellable.mockResolvedValue({
			mode: 'SIMPLE',
			variantId: 'default-variant',
			requiresVariantSelection: false,
			availabilityState: 'AVAILABLE'
		})

		await expect(
			service.resolveCartVariantId(
				tx as never,
				'catalog-1',
				{
					productId: 'product-1',
					variantId: null,
					saleUnitId: null,
					quantity: 1
				},
				'NONE'
			)
		).resolves.toBe('default-variant')
		expect(tx.productVariant.findMany).not.toHaveBeenCalled()
		expect(sellableReader.resolveProductSellable).toHaveBeenCalledWith(
			'catalog-1',
			'product-1',
			{ quantity: 1, enforceStock: false }
		)
	})

	it('resolves selected sale unit even when product variants are disabled', async () => {
		capabilities.canUseProductVariants.mockResolvedValue(false)
		tx.productVariantSaleUnit.findFirst.mockResolvedValue({
			variantId: 'default-variant'
		})

		await expect(
			service.resolveCartVariantId(
				tx as never,
				'catalog-1',
				{
					productId: 'product-1',
					variantId: null,
					saleUnitId: 'sale-unit-1',
					quantity: 1
				},
				'NONE'
			)
		).resolves.toBe('default-variant')
		expect(tx.productVariantSaleUnit.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: 'sale-unit-1',
					isActive: true,
					deleteAt: null,
					variant: expect.objectContaining({
						productId: 'product-1',
						deleteAt: null
					})
				})
			})
		)
		expect(sellableReader.resolveProductSellable).not.toHaveBeenCalled()
	})

	it('does not auto-select matrix variants when product variants are disabled', async () => {
		capabilities.canUseProductVariants.mockResolvedValue(false)
		sellableReader.resolveProductSellable.mockResolvedValue({
			mode: 'MATRIX',
			variantId: null,
			requiresVariantSelection: true,
			availabilityState: 'AVAILABLE'
		})

		await expect(
			service.resolveCartVariantId(
				tx as never,
				'catalog-1',
				{
					productId: 'product-1',
					variantId: null,
					saleUnitId: null,
					quantity: 1
				},
				'EXTERNAL'
			)
		).resolves.toBeNull()
		expect(tx.productVariant.findMany).not.toHaveBeenCalled()
		expect(sellableReader.resolveProductSellable).toHaveBeenCalledWith(
			'catalog-1',
			'product-1',
			{ quantity: 1, enforceStock: false }
		)
	})

	it('does not resolve hidden default variant when removing a line', async () => {
		capabilities.canUseProductVariants.mockResolvedValue(false)

		await expect(
			service.resolveCartVariantId(
				tx as never,
				'catalog-1',
				{
					productId: 'product-1',
					variantId: null,
					saleUnitId: null,
					quantity: 0
				},
				'EXTERNAL'
			)
		).resolves.toBeNull()
		expect(sellableReader.resolveProductSellable).not.toHaveBeenCalled()
		expect(tx.productVariant.findMany).not.toHaveBeenCalled()
	})

	it('requires explicit selection for matrix products', async () => {
		sellableReader.resolveProductSellable.mockResolvedValue({
			mode: 'MATRIX',
			variantId: null,
			requiresVariantSelection: true,
			availabilityState: 'AVAILABLE'
		})

		await expect(
			service.resolveCartVariantId(
				tx as never,
				'catalog-1',
				{
					productId: 'product-1',
					variantId: null,
					saleUnitId: null,
					quantity: 1
				},
				'NONE'
			)
		).rejects.toThrow('Выберите вариацию товара')
		expect(tx.productVariant.findMany).not.toHaveBeenCalled()
	})

	it('checks selected variant through sellable projection', async () => {
		await expect(
			service.ensureVariantPurchasable({
				catalogId: 'catalog-1',
				productId: 'product-1',
				variantId: 'variant-1',
				quantity: 1,
				inventoryMode: 'NONE'
			})
		).resolves.toBeUndefined()
		expect(sellableReader.resolveVariantSellable).toHaveBeenCalledWith(
			'catalog-1',
			'product-1',
			'variant-1',
			{ quantity: 1, enforceStock: false }
		)
	})

	it('blocks unavailable variants in external inventory mode', async () => {
		sellableReader.resolveVariantSellable.mockResolvedValue({
			variantId: 'variant-1',
			availabilityState: 'OUT_OF_STOCK',
			stock: 0
		})

		await expect(
			service.ensureVariantPurchasable({
				catalogId: 'catalog-1',
				productId: 'product-1',
				variantId: 'variant-1',
				quantity: 1,
				inventoryMode: 'EXTERNAL'
			})
		).rejects.toThrow('Недостаточно товара')
	})

	it('maps missing selected variant to a cart validation error', async () => {
		sellableReader.resolveVariantSellable.mockRejectedValue(
			new NotFoundException('missing')
		)

		await expect(
			service.ensureVariantPurchasable({
				catalogId: 'catalog-1',
				productId: 'product-1',
				variantId: 'missing-variant',
				quantity: 1,
				inventoryMode: 'NONE'
			})
		).rejects.toThrow('Вариация товара недоступна')
	})
})

import { ProductVariantStatus } from '@generated/client'
import { Test, TestingModule } from '@nestjs/testing'

import { CAPABILITY_READER_PORT } from '@/modules/capability/contracts'

import { CartVariantSelectionService } from './cart-variant-selection.service'

describe('CartVariantSelectionService', () => {
	let service: CartVariantSelectionService
	let capabilities: { canUseProductVariants: jest.Mock }
	let tx: {
		productVariantSaleUnit: { findFirst: jest.Mock }
		productVariant: { findMany: jest.Mock; findFirst: jest.Mock }
	}

	beforeEach(async () => {
		capabilities = {
			canUseProductVariants: jest.fn().mockResolvedValue(true)
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
	})

	it('does not resolve hidden variants when product variants are disabled', async () => {
		capabilities.canUseProductVariants.mockResolvedValue(false)
		tx.productVariant.findMany.mockResolvedValue([
			{
				id: 'variant-with-attribute',
				stock: 5,
				status: ProductVariantStatus.ACTIVE,
				isAvailable: true,
				attributes: [{ id: 'attribute-link' }]
			},
			{
				id: 'default-variant',
				stock: 5,
				status: ProductVariantStatus.ACTIVE,
				isAvailable: true,
				attributes: []
			}
		])

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
		).resolves.toBeNull()
		expect(tx.productVariant.findMany).not.toHaveBeenCalled()
	})

	it('requires explicit selection when variants are enabled', async () => {
		tx.productVariant.findMany.mockResolvedValue([
			{
				id: 'variant-1',
				stock: 5,
				status: ProductVariantStatus.ACTIVE,
				isAvailable: true,
				attributes: [{ id: 'attribute-link-1' }]
			},
			{
				id: 'variant-2',
				stock: 5,
				status: ProductVariantStatus.ACTIVE,
				isAvailable: true,
				attributes: [{ id: 'attribute-link-2' }]
			}
		])

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
	})

	it('keeps stock enforcement in external inventory mode', async () => {
		tx.productVariant.findFirst.mockResolvedValue({
			stock: 0,
			status: ProductVariantStatus.ACTIVE,
			isAvailable: true
		})

		await expect(
			service.ensureVariantPurchasable(
				tx as never,
				'variant-1',
				1,
				'product-1',
				'EXTERNAL'
			)
		).rejects.toThrow('Недостаточно товара')
	})
})

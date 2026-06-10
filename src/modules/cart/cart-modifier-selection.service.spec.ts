import { BadRequestException } from '@nestjs/common'

import { CartModifierSelectionService } from './cart-modifier-selection.service'

function createModifierGroup(overrides: Record<string, unknown> = {}) {
	return {
		id: 'group-1',
		variantId: null,
		catalogModifierGroupId: null,
		code: 'addons',
		name: 'Добавки',
		isRequired: false,
		minSelected: 0,
		maxSelected: null,
		isActive: true,
		displayOrder: 0,
		options: [
			{
				id: 'option-1',
				catalogModifierOptionId: null,
				code: 'cheese',
				name: 'Сыр',
				price: 100,
				maxQuantity: null,
				isAvailable: true,
				displayOrder: 0
			}
		],
		...overrides
	}
}

describe('CartModifierSelectionService', () => {
	let service: CartModifierSelectionService
	let tx: {
		productModifierGroup: {
			findMany: jest.Mock
		}
	}

	beforeEach(() => {
		service = new CartModifierSelectionService()
		tx = {
			productModifierGroup: {
				findMany: jest.fn()
			}
		}
	})

	it('does not require an optional group even when minSelected is stored', async () => {
		tx.productModifierGroup.findMany.mockResolvedValue([
			createModifierGroup({ isRequired: false, minSelected: 2 })
		])

		await expect(
			service.resolveModifiers(tx as never, {
				productId: 'product-1',
				variantId: null,
				canUseCatalogModifiers: true,
				modifiers: []
			})
		).resolves.toEqual({ signature: '', items: [] })
	})

	it('ignores groups without available options', async () => {
		tx.productModifierGroup.findMany.mockResolvedValue([
			createModifierGroup({ isRequired: true, minSelected: 1, options: [] })
		])

		await expect(
			service.resolveModifiers(tx as never, {
				productId: 'product-1',
				variantId: null,
				canUseCatalogModifiers: true,
				modifiers: []
			})
		).resolves.toEqual({ signature: '', items: [] })
	})

	it('still rejects unavailable modifier input when no applicable groups remain', async () => {
		tx.productModifierGroup.findMany.mockResolvedValue([
			createModifierGroup({ options: [] })
		])

		await expect(
			service.resolveModifiers(tx as never, {
				productId: 'product-1',
				variantId: null,
				canUseCatalogModifiers: true,
				modifiers: [
					{
						productModifierGroupId: 'group-1',
						productModifierOptionId: 'option-1',
						quantity: 1
					}
				]
			})
		).rejects.toBeInstanceOf(BadRequestException)
	})
})

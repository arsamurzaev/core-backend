import {
	buildIikoExternalMenuPreview,
	normalizeIikoExternalMenu
} from './iiko.external-menu-normalizer'

describe('iiko external menu normalizer', () => {
	it('normalizes V4 itemGroups and selects organization price', () => {
		const menu = normalizeIikoExternalMenu({
			organizationId: 'org-1',
			externalMenuId: '81651',
			externalMenuName: 'Main menu',
			menu: {
				id: 81651,
				name: 'Main menu',
				revision: 12,
				formatVersion: 4,
				itemGroups: [
					{
						id: 'cat-1',
						name: 'Pizza',
						items: [
							{
								id: 'product-1',
								sku: 'PIZZA',
								name: 'Pizza',
								type: 'DISH',
								orderItemType: 'Product',
								itemSizes: [
									{
										id: 'size-small',
										sizeName: 'Small',
										prices: [
											{ organizations: ['org-2'], price: 390 },
											{ organizations: ['org-1'], price: 490 }
										]
									}
								]
							}
						]
					}
				]
			}
		})

		expect(menu.products[0]).toEqual(
			expect.objectContaining({
				id: 'product-1',
				type: 'dish',
				groupId: 'cat-1'
			})
		)
		expect(menu.products[0]?.sizePrices?.[0]).toEqual(
			expect.objectContaining({
				sizeId: 'size-small',
				sizeName: 'Small',
				price: expect.objectContaining({ currentPrice: 490 })
			})
		)
	})

	it('builds preview counts and skips hidden/combo as visible items', () => {
		const menu = normalizeIikoExternalMenu({
			organizationId: 'org-1',
			menu: {
				id: 'menu-1',
				itemCategories: [
					{
						id: 'cat-1',
						name: 'Menu',
						items: [
							{
								itemId: 'dish-1',
								name: 'Dish',
								type: 'DISH',
								orderItemType: 'Product',
								itemSizes: [
									{
										sizeId: null,
										prices: [{ organizations: ['org-1'], price: 100 }],
										itemModifierGroups: [{ name: 'Sauce' }]
									}
								]
							},
							{
								itemId: 'combo-1',
								name: 'Combo',
								type: 'COMBO',
								orderItemType: 'Product',
								itemSizes: [
									{ sizeId: null, prices: [{ organizations: ['org-1'], price: 200 }] }
								]
							},
							{
								itemId: 'product-type-1',
								name: 'Product type',
								type: 'Product',
								orderItemType: 'Product',
								itemSizes: [
									{ sizeId: null, prices: [{ organizations: ['org-1'], price: 250 }] }
								]
							},
							{
								itemId: 'hidden-1',
								name: 'Hidden',
								type: 'DISH',
								isHidden: true,
								itemSizes: [
									{ sizeId: null, prices: [{ organizations: ['org-1'], price: 300 }] }
								]
							},
							{
								itemId: 'no-price-1',
								name: 'No price',
								type: 'DISH',
								itemSizes: [{ sizeId: null, prices: [] }]
							}
						]
					}
				]
			}
		})

		const preview = buildIikoExternalMenuPreview(menu)

		expect(preview.stats).toEqual(
			expect.objectContaining({
				categories: 1,
				items: 5,
				visibleItems: 2,
				hiddenItems: 1,
				itemsWithoutPrice: 1,
				itemsWithModifiers: 1,
				combos: 1
			})
		)
		expect(preview.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: 'dish-1',
					willImport: true,
					skipReasons: []
				}),
				expect.objectContaining({
					id: 'combo-1',
					willImport: false,
					skipReasons: ['combo']
				}),
				expect.objectContaining({
					id: 'hidden-1',
					willImport: false,
					skipReasons: ['hidden']
				}),
				expect.objectContaining({
					id: 'no-price-1',
					willImport: false,
					skipReasons: ['no_price']
				})
			])
		)
	})
})

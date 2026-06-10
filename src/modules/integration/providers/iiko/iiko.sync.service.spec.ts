import { ProductStatus } from '@generated/enums'

import { IikoClient } from './iiko.client'
import { IikoSyncService } from './iiko.sync.service'

describe('IikoSyncService', () => {
	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('imports sellable external menu products and skips combos', async () => {
		jest.spyOn(IikoClient.prototype, 'getExternalMenuById').mockResolvedValue({
			id: '81651',
			name: 'Main menu',
			itemGroups: [
				{
					id: 'group-1',
					name: 'Pizza',
					items: [
						{
							id: 'product-1',
							sku: 'PIZZA',
							name: 'Pizza Margherita',
							type: 'DISH',
							orderItemType: 'Product',
							itemSizes: [
								{
									id: 'size-default',
									sizeName: 'Default',
									isDefault: true,
									prices: [{ organizations: ['org-1'], price: 490 }]
								}
							]
						},
						{
							id: 'combo-1',
							name: 'Combo',
							type: 'COMBO',
							orderItemType: 'Product',
							itemSizes: [
								{
									id: 'size-default',
									prices: [{ organizations: ['org-1'], price: 990 }]
								}
							]
						}
					]
				}
			],
			revision: 7
		})

		const repo = createRepoMock()
		const products = createProductsMock()
		const events = { dispatch: jest.fn().mockResolvedValue(undefined) }
		const service = new IikoSyncService(
			repo as any,
			{
				parseStoredMetadata: jest.fn().mockReturnValue({
					apiLogin: 'login',
					organizationId: 'org-1',
					organizationName: 'Demo',
					externalMenuId: '81651',
					externalMenuName: 'Main menu',
					priceCategoryId: 'price-1',
					priceCategoryName: 'Base',
					menuVersion: 4,
					syncSource: 'external_menu',
					importImages: false,
					lastRevision: null,
					lastMenuSyncedAt: null
				})
			} as any,
			{ refreshProductImages: jest.fn() } as any,
			products as any,
			{
				assertCanUseIikoIntegration: jest.fn().mockResolvedValue(undefined),
				assertCanUseProductVariants: jest.fn().mockResolvedValue(undefined),
				assertCanUseCatalogModifiers: jest.fn().mockResolvedValue(undefined)
			} as any,
			{
				get: jest.fn().mockReturnValue({
					iikoApiBaseUrl: 'https://iiko.example'
				})
			} as any,
			undefined,
			events as any
		)

		const result = await service.syncCatalog('catalog-1')

		expect(result.totalProducts).toBe(1)
		expect(products.createExternalProduct).toHaveBeenCalledTimes(1)
		expect(products.createExternalProduct).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Pizza Margherita',
				price: 490,
				status: ProductStatus.ACTIVE
			})
		)
		expect(repo.upsertProductLink).toHaveBeenCalledWith(
			expect.objectContaining({
				externalId: 'product-1'
			})
		)
		expect(repo.upsertProductLink).not.toHaveBeenCalledWith(
			expect.objectContaining({
				externalId: 'combo-1'
			})
		)
		expect(products.ensureDefaultVariant).toHaveBeenCalledWith(
			expect.objectContaining({
				productId: 'local-product-1',
				price: 490
			})
		)
		expect(repo.finishIikoSync).toHaveBeenCalledWith(
			'catalog-1',
			expect.objectContaining({
				totalProducts: 1,
				lastRevision: 7
			})
		)
		expect(events.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'product.changed',
				catalogId: 'catalog-1',
				productId: '*',
				changes: ['catalog_products', 'category_products', 'category_list']
			})
		)
	})

	it('creates matrix variants for multiple iiko sizes', async () => {
		jest.spyOn(IikoClient.prototype, 'getExternalMenuById').mockResolvedValue({
			itemGroups: [
				{
					id: 'group-1',
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
									isDefault: true,
									prices: [{ organizations: ['org-1'], price: 390 }]
								},
								{
									id: 'size-large',
									sizeName: 'Large',
									isDefault: false,
									prices: [{ organizations: ['org-1'], price: 690 }]
								}
							]
						}
					]
				}
			],
			revision: 8
		})

		const repo = createRepoMock()
		const service = createService(repo, createProductsMock())

		const result = await service.syncCatalog('catalog-1')

		expect(result.createdVariants).toBe(2)
		expect(repo.upsertIikoSizeVariantAttribute).toHaveBeenCalledWith('catalog-1')
		expect(repo.ensureIikoSizeProductTypeForProduct).toHaveBeenCalledWith({
			catalogId: 'catalog-1',
			productId: 'local-product-1',
			attributeId: 'attribute-size'
		})
		expect(repo.upsertIntegratedProductVariant).toHaveBeenCalledTimes(2)
		expect(repo.upsertIntegratedProductVariant).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				externalId: 'product-1:size-small',
				price: 390,
				variantKey: 'iiko_size=size-small',
				attributes: [
					expect.objectContaining({
						attributeId: 'attribute-size',
						value: 'size-small',
						displayName: 'Small'
					})
				]
			})
		)
		expect(repo.upsertIntegratedProductVariant).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				externalId: 'product-1:size-large',
				price: 690,
				variantKey: 'iiko_size=size-large',
				attributes: [
					expect.objectContaining({
						attributeId: 'attribute-size',
						value: 'size-large',
						displayName: 'Large'
					})
				]
			})
		)
	})

	it('imports external menu item modifier groups as beta catalog modifiers', async () => {
		jest.spyOn(IikoClient.prototype, 'getExternalMenuById').mockResolvedValue({
			itemGroups: [
				{
					id: 'group-1',
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
									id: 'size-default',
									sizeName: 'Default',
									isDefault: true,
									prices: [{ organizations: ['org-1'], price: 490 }],
									itemModifierGroups: [
										{
											itemGroupId: 'modifier-group-cheese',
											sku: 'CHEESE',
											name: 'Cheese',
											restrictions: {
												minQuantity: 0,
												maxQuantity: 2,
												byDefault: 0
											},
											items: [
												{
													itemId: 'modifier-extra-cheese',
													sku: 'EXTRA_CHEESE',
													name: 'Extra cheese',
													prices: [{ organizations: ['org-1'], price: 79 }],
													restrictions: [
														{
															minQuantity: 0,
															maxQuantity: 2,
															byDefault: 0
														}
													]
												}
											]
										}
									]
								}
							]
						}
					]
				}
			],
			revision: 12
		})

		const repo = createRepoMock()
		const service = createService(repo, createProductsMock())

		await service.syncCatalog('catalog-1')

		expect(repo.syncIikoProductModifiers).toHaveBeenCalledWith(
			expect.objectContaining({
				catalogId: 'catalog-1',
				integrationId: 'integration-1',
				productId: 'local-product-1',
				groups: [
					expect.objectContaining({
						externalId: 'modifier-group-cheese',
						code: 'iiko-cheese',
						name: 'Cheese',
						variantId: null,
						maxSelected: 2,
						options: [
							expect.objectContaining({
								externalId: 'modifier-extra-cheese',
								code: 'iiko-extra-cheese',
								name: 'Extra cheese',
								price: 79,
								maxQuantity: 2
							})
						]
					})
				]
			})
		)
	})

	it('preserves linked product text fields and updates price on repeat sync', async () => {
		jest.spyOn(IikoClient.prototype, 'getExternalMenuById').mockResolvedValue({
			itemGroups: [
				{
					id: 'group-1',
					name: 'Pizza',
					items: [
						{
							id: 'product-1',
							sku: 'PIZZA',
							name: 'Updated Pizza',
							description: 'Updated iiko description',
							type: 'DISH',
							orderItemType: 'Product',
							itemSizes: [
								{
									id: 'size-default',
									sizeName: 'Default',
									isDefault: true,
									prices: [{ organizations: ['org-1'], price: 540 }]
								}
							]
						}
					]
				}
			],
			revision: 9
		})

		const repo = createRepoMock()
		repo.findProductLinkByExternalId.mockResolvedValue({
			id: 'product-link-1',
			productId: 'local-product-1',
			externalId: 'product-1'
		})
		repo.syncManagedProductCategories.mockResolvedValue({ added: 0, removed: 0 })
		const products = createProductsMock()
		products.findExternalProductById.mockResolvedValue({
			id: 'local-product-1',
			catalogId: 'catalog-1',
			productTypeId: null,
			name: 'Old Pizza',
			sku: 'PIZZA',
			slug: 'old-pizza',
			price: 490,
			status: ProductStatus.ACTIVE,
			deleteAt: null
		})
		products.updateExternalProduct.mockResolvedValue({
			id: 'local-product-1',
			catalogId: 'catalog-1',
			productTypeId: null,
			name: 'Old Pizza',
			sku: 'PIZZA',
			slug: 'old-pizza',
			price: 540,
			status: ProductStatus.ACTIVE,
			deleteAt: null
		})
		const service = createService(repo, products)

		const result = await service.syncCatalog('catalog-1')

		expect(result.updatedProducts).toBe(1)
		expect(products.createExternalProduct).not.toHaveBeenCalled()
		expect(products.updateExternalProduct).toHaveBeenCalledWith({
			catalogId: 'catalog-1',
			productId: 'local-product-1',
			data: {
				price: 540
			}
		})
		expect(products.syncExternalProductDescription).not.toHaveBeenCalled()
	})

	it('syncs one linked iiko product without hiding missing products', async () => {
		jest.spyOn(IikoClient.prototype, 'getExternalMenuById').mockResolvedValue({
			itemGroups: [
				{
					id: 'group-1',
					name: 'Pizza',
					items: [
						{
							id: 'product-1',
							sku: 'PIZZA',
							name: 'Updated Pizza',
							type: 'DISH',
							orderItemType: 'Product',
							itemSizes: [
								{
									id: 'size-default',
									sizeName: 'Default',
									isDefault: true,
									prices: [{ organizations: ['org-1'], price: 540 }]
								}
							]
						},
						{
							id: 'product-2',
							sku: 'PASTA',
							name: 'Pasta',
							type: 'DISH',
							orderItemType: 'Product',
							itemSizes: [
								{
									id: 'size-default',
									sizeName: 'Default',
									isDefault: true,
									prices: [{ organizations: ['org-1'], price: 450 }]
								}
							]
						}
					]
				}
			],
			revision: 11
		})

		const repo = createRepoMock()
		const link = {
			id: 'product-link-1',
			productId: 'local-product-1',
			externalId: 'product-1'
		}
		repo.findProductLinkByProductId.mockResolvedValue(link)
		repo.findProductLinkByExternalId.mockResolvedValue(link)
		repo.syncManagedProductCategories.mockResolvedValue({ added: 0, removed: 0 })
		const products = createProductsMock()
		products.findExternalProductById.mockResolvedValue({
			id: 'local-product-1',
			catalogId: 'catalog-1',
			productTypeId: null,
			name: 'Old Pizza',
			sku: 'PIZZA',
			slug: 'old-pizza',
			price: 490,
			status: ProductStatus.ACTIVE,
			deleteAt: null
		})
		products.updateExternalProduct.mockResolvedValue({
			id: 'local-product-1',
			catalogId: 'catalog-1',
			productTypeId: null,
			name: 'Updated Pizza',
			sku: 'PIZZA',
			slug: 'old-pizza',
			price: 540,
			status: ProductStatus.ACTIVE,
			deleteAt: null
		})
		const service = createService(repo, products)

		const result = await service.syncProduct('catalog-1', 'local-product-1')

		expect(result.ok).toBe(true)
		expect(result.externalId).toBe('product-1')
		expect(result.updated).toBe(true)
		expect(result.totalVariants).toBe(1)
		expect(products.createExternalProduct).not.toHaveBeenCalled()
		expect(repo.archiveMissingIntegratedProductVariants).toHaveBeenCalled()
		expect(repo.findProductLinksByIntegration).not.toHaveBeenCalled()
		expect(repo.finishIikoSync).toHaveBeenCalledWith(
			'catalog-1',
			expect.objectContaining({
				totalProducts: 1,
				lastRevision: 11
			})
		)
	})

	it('hides linked products missing from the full snapshot after confirmations', async () => {
		jest.spyOn(IikoClient.prototype, 'getExternalMenuById').mockResolvedValue({
			itemGroups: [],
			revision: 10
		})

		const repo = createRepoMock()
		repo.findProductLinksByIntegration.mockResolvedValue([
			{
				id: 'product-link-missing',
				productId: 'local-product-missing',
				externalId: 'gone-product'
			}
		])
		repo.markProductLinkMissingFromSnapshot.mockResolvedValue({
			id: 'product-link-missing',
			productId: 'local-product-missing',
			externalId: 'gone-product',
			missingSyncCount: 2
		})
		const products = createProductsMock()
		const service = createService(repo, products)

		const result = await service.syncCatalog('catalog-1')

		expect(result.deletedProducts).toBe(1)
		expect(products.softDeleteExternalProduct).toHaveBeenCalledWith({
			catalogId: 'catalog-1',
			productId: 'local-product-missing'
		})
		expect(repo.markProductLinkHiddenAfterMissing).toHaveBeenCalledWith(
			'product-link-missing'
		)
	})

	it('returns inactive terminal groups from test connection', async () => {
		jest.spyOn(IikoClient.prototype, 'getOrganizations').mockResolvedValue({
			organizations: [{ id: 'org-1', name: 'Demo', isActive: true }]
		})
		jest.spyOn(IikoClient.prototype, 'getMenus').mockResolvedValue({
			externalMenus: [{ id: '81651', name: 'Main menu' }],
			priceCategories: [{ id: 'price-1', name: 'Base' }]
		})
		const getTerminalGroups = jest
			.spyOn(IikoClient.prototype, 'getTerminalGroups')
			.mockResolvedValue({
				terminalGroups: [],
				terminalGroupsInSleep: [
					{
						organizationId: 'org-1',
						items: [{ id: 'terminal-1', name: 'Main' }]
					}
				]
			})
		const getTerminalGroupsIsAlive = jest
			.spyOn(IikoClient.prototype, 'getTerminalGroupsIsAlive')
			.mockResolvedValue({
				isAliveStatus: [
					{
						organizationId: 'org-1',
						terminalGroupId: 'terminal-1',
						isAlive: false
					}
				]
			})

		const service = createService(createRepoMock(), createProductsMock())

		const result = await service.testConnection({ apiLogin: 'login' })

		expect(getTerminalGroups).toHaveBeenCalledWith(['org-1'], {
			includeDisabled: true
		})
		expect(getTerminalGroupsIsAlive).toHaveBeenCalledWith({
			organizationIds: ['org-1'],
			terminalGroupIds: ['terminal-1']
		})
		expect(result.terminalGroups).toEqual([
			{
				id: 'terminal-1',
				name: 'Main',
				organizationId: 'org-1',
				isActive: false,
				isAlive: false
			}
		])
	})

	it('applies iiko stop-list availability to linked variants', async () => {
		jest.spyOn(IikoClient.prototype, 'getStopLists').mockResolvedValue({
			terminalGroupStopLists: [
				{
					organizationId: 'org-1',
					items: [
						{
							terminalGroupId: 'terminal-1',
							items: [
								{ productId: 'product-1', sizeId: 'size-small', balance: 0 },
								{ productId: 'product-2', sizeId: null, balance: 3 }
							]
						}
					]
				}
			]
		})

		const repo = createRepoMock()
		repo.applyIikoStopListAvailability.mockResolvedValue({
			totalStopListItems: 2,
			stoppedStopListItems: 1,
			matchedStopListItems: 1,
			unmatchedStopListItems: 0,
			totalVariants: 2,
			stoppedVariants: 1,
			restoredVariants: 1,
			changedVariants: 2,
			changedProducts: 1
		})
		const events = { dispatch: jest.fn().mockResolvedValue(undefined) }
		const service = createService(
			repo,
			createProductsMock(),
			{
				terminalGroupId: 'terminal-1',
				terminalGroupName: 'Main terminal'
			},
			{
				events
			}
		)

		const result = await service.syncStopList('catalog-1')

		expect(repo.applyIikoStopListAvailability).toHaveBeenCalledWith(
			expect.objectContaining({
				catalogId: 'catalog-1',
				integrationId: 'integration-1',
				items: [
					expect.objectContaining({
						productId: 'product-1',
						sizeId: 'size-small',
						balance: 0
					}),
					expect.objectContaining({
						productId: 'product-2',
						sizeId: null,
						balance: 3
					})
				]
			})
		)
		expect(events.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'product.changed',
				catalogId: 'catalog-1',
				productId: '*',
				changes: ['catalog_products', 'category_products', 'category_list']
			})
		)
		expect(repo.finishIikoStockSync).toHaveBeenCalledWith('catalog-1', {
			syncedAt: expect.any(Date)
		})
		expect(result.stoppedVariants).toBe(1)
		expect(result.terminalGroupIds).toEqual(['terminal-1'])
	})
})

function createRepoMock() {
	return {
		beginIikoSync: jest.fn().mockResolvedValue({
			id: 'integration-1',
			catalogId: 'catalog-1',
			metadata: {}
		}),
		updateSyncRunProgress: jest.fn(),
		findCategoryLinkByExternalId: jest.fn().mockResolvedValue(null),
		createCategory: jest.fn().mockResolvedValue({
			id: 'category-1',
			name: 'Pizza',
			parentId: null
		}),
		updateCategory: jest.fn(),
		upsertCategoryLink: jest.fn().mockResolvedValue({ id: 'category-link-1' }),
		findProductLinkByExternalId: jest.fn().mockResolvedValue(null),
		findProductLinkByProductId: jest.fn().mockResolvedValue(null),
		syncManagedProductCategories: jest
			.fn()
			.mockResolvedValue({ added: 1, removed: 0 }),
		upsertProductLink: jest.fn().mockResolvedValue({ id: 'product-link-1' }),
		upsertIikoSizeVariantAttribute: jest.fn().mockResolvedValue({
			id: 'attribute-size'
		}),
		ensureIikoSizeProductTypeForProduct: jest
			.fn()
			.mockResolvedValue({ id: 'product-type-iiko-size' }),
		upsertIntegratedProductVariant: jest.fn().mockResolvedValue({
			created: true,
			updated: false,
			variant: { id: 'variant-1' },
			link: { id: 'variant-link-1' },
			priceChanged: false,
			previousPrice: null,
			nextPrice: null,
			stockChanged: false,
			previousStock: null,
			nextStock: null
		}),
		findDefaultProductVariant: jest.fn().mockResolvedValue({
			id: 'default-variant',
			productId: 'local-product-1',
			sku: 'PIZZA',
			variantKey: 'default',
			kind: 'DEFAULT',
			stock: 0,
			price: 490,
			status: 'ACTIVE',
			isAvailable: true,
			deleteAt: null
		}),
		syncIikoProductModifiers: jest
			.fn()
			.mockResolvedValue({ groups: 0, options: 0 }),
		archiveMissingIntegratedProductVariants: jest.fn().mockResolvedValue(0),
		applyIikoStopListAvailability: jest.fn(),
		findProductLinksByIntegration: jest.fn().mockResolvedValue([]),
		markProductLinkMissingFromSnapshot: jest.fn(),
		markProductLinkHiddenAfterMissing: jest.fn(),
		finishIikoSync: jest.fn().mockResolvedValue({ id: 'integration-1' }),
		finishIikoStockSync: jest.fn().mockResolvedValue({ id: 'integration-1' }),
		failIikoSync: jest.fn()
	}
}

function createProductsMock() {
	const product = {
		id: 'local-product-1',
		catalogId: 'catalog-1',
		productTypeId: null,
		name: 'Pizza Margherita',
		sku: 'PIZZA',
		slug: 'pizza-margherita',
		price: 490,
		status: ProductStatus.ACTIVE,
		deleteAt: null
	}

	return {
		existsExternalProductSku: jest.fn().mockResolvedValue(false),
		existsExternalProductSlug: jest.fn().mockResolvedValue(false),
		createExternalProduct: jest.fn().mockResolvedValue(product),
		updateExternalProduct: jest.fn(),
		syncExternalProductDescription: jest.fn().mockResolvedValue(false),
		ensureDefaultVariant: jest.fn().mockResolvedValue(false),
		recomputeProductCommercialState: jest.fn().mockResolvedValue(true),
		findExternalProductById: jest.fn(),
		softDeleteExternalProduct: jest.fn().mockResolvedValue(true)
	}
}

function createService(
	repo: ReturnType<typeof createRepoMock>,
	products: ReturnType<typeof createProductsMock>,
	metadata: Record<string, unknown> = {},
	options: {
		cache?: { bumpVersion: jest.Mock }
		events?: { dispatch: jest.Mock }
	} = {}
) {
	return new IikoSyncService(
		repo as any,
		{
			parseStoredMetadata: jest.fn().mockReturnValue({
				apiLogin: 'login',
				organizationId: 'org-1',
				organizationName: 'Demo',
				externalMenuId: '81651',
				externalMenuName: 'Main menu',
				priceCategoryId: 'price-1',
				priceCategoryName: 'Base',
				terminalGroupId: null,
				terminalGroupName: null,
				menuVersion: 4,
				syncSource: 'external_menu',
				importImages: false,
				lastRevision: null,
				lastMenuSyncedAt: null,
				lastStopListSyncedAt: null,
				...metadata
			})
		} as any,
		{ refreshProductImages: jest.fn() } as any,
		products as any,
		{
			assertCanUseIikoIntegration: jest.fn().mockResolvedValue(undefined),
			assertCanUseProductVariants: jest.fn().mockResolvedValue(undefined),
			assertCanUseCatalogModifiers: jest.fn().mockResolvedValue(undefined)
		} as any,
		{
			get: jest.fn().mockReturnValue({
				iikoApiBaseUrl: 'https://iiko.example'
			})
		} as any,
		options.cache as any,
		options.events as any
	)
}

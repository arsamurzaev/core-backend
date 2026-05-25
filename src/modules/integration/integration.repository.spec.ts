import {
	ProductStatus,
	ProductVariantKind,
	ProductVariantStatus
} from '@generated/enums'

import { IntegrationRepository } from './integration.repository'

describe('IntegrationRepository', () => {
	it('hides the parent product when default variant stock reaches zero', async () => {
		const db = {
			product: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'product-1',
					status: ProductStatus.ACTIVE,
					integrationLinks: []
				}),
				update: jest.fn()
			},
			productVariant: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'variant-1',
					productId: 'product-1',
					sku: 'SKU-1',
					variantKey: 'default',
					kind: ProductVariantKind.DEFAULT,
					stock: 5,
					price: 100,
					status: ProductVariantStatus.ACTIVE,
					isAvailable: true,
					deleteAt: null
				}),
				update: jest.fn().mockResolvedValue({})
			}
		}
		const repo = new IntegrationRepository(db as any)

		const result = await repo.updateLinkedProductStock(
			'catalog-1',
			'product-1',
			0
		)

		expect(result).toEqual(
			expect.objectContaining({
				changed: true,
				productId: 'product-1',
				variantId: 'variant-1',
				previousStock: 5,
				nextStock: 0
			})
		)
		expect(db.product.update).toHaveBeenCalledWith({
			where: { id: 'product-1' },
			data: { status: ProductStatus.HIDDEN }
		})
		expect(db.productVariant.update).toHaveBeenCalledWith({
			where: { id: 'variant-1' },
			data: {
				stock: 0,
				status: ProductVariantStatus.OUT_OF_STOCK,
				isAvailable: false
			}
		})
	})

	it('keeps stockless MoySklad services visible and purchasable', async () => {
		const db = {
			product: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'product-1',
					status: ProductStatus.ACTIVE,
					integrationLinks: [{ rawMeta: { type: 'service' } }]
				}),
				update: jest.fn()
			},
			productVariant: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'variant-1',
					productId: 'product-1',
					sku: 'SKU-1',
					variantKey: 'default',
					kind: ProductVariantKind.DEFAULT,
					stock: 5,
					price: 100,
					status: ProductVariantStatus.OUT_OF_STOCK,
					isAvailable: false,
					deleteAt: null
				}),
				update: jest.fn().mockResolvedValue({})
			}
		}
		const repo = new IntegrationRepository(db as any)

		await repo.updateLinkedProductStock('catalog-1', 'product-1', 0)

		expect(db.product.update).not.toHaveBeenCalled()
		expect(db.productVariant.update).toHaveBeenCalledWith({
			where: { id: 'variant-1' },
			data: {
				stock: 0,
				status: ProductVariantStatus.ACTIVE,
				isAvailable: true
			}
		})
	})

	it('hides a matrix product when all integrated variants are out of stock', async () => {
		const db = {
			product: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'product-1',
					status: ProductStatus.ACTIVE
				}),
				update: jest.fn()
			},
			productVariant: {
				count: jest.fn().mockResolvedValue(0)
			}
		}
		const repo = new IntegrationRepository(db as any)

		const changed = await repo.recomputeProductStatusFromVariants(
			'catalog-1',
			'product-1'
		)

		expect(changed).toBe(true)
		expect(db.productVariant.count).toHaveBeenCalledWith({
			where: {
				productId: 'product-1',
				deleteAt: null,
				status: ProductVariantStatus.ACTIVE,
				isAvailable: true
			}
		})
		expect(db.product.update).toHaveBeenCalledWith({
			where: { id: 'product-1' },
			data: { status: ProductStatus.HIDDEN }
		})
	})

	it('marks product and variant stock links with skipped reasons', async () => {
		const at = new Date('2026-05-17T09:00:00.000Z')
		const prisma = {
			integrationProductLink: {
				updateMany: jest.fn().mockResolvedValue({ count: 1 })
			},
			integrationVariantLink: {
				updateMany: jest.fn().mockResolvedValue({ count: 1 })
			}
		}
		const repo = new IntegrationRepository(prisma as any)

		await expect(
			repo.markProductLinkStockSkipped(
				'integration-1',
				'product-1',
				'stock_missing_in_external_report',
				at
			)
		).resolves.toBe(1)
		await expect(
			repo.markVariantLinkStockSkipped(
				'integration-1',
				'variant-1',
				'variants_capability_disabled',
				at
			)
		).resolves.toBe(1)

		expect(prisma.integrationProductLink.updateMany).toHaveBeenCalledWith({
			where: { integrationId: 'integration-1', productId: 'product-1' },
			data: {
				lastSeenAt: at,
				skippedReason: 'stock_missing_in_external_report',
				lastExternalError: null
			}
		})
		expect(prisma.integrationVariantLink.updateMany).toHaveBeenCalledWith({
			where: { integrationId: 'integration-1', variantId: 'variant-1' },
			data: {
				lastSeenAt: at,
				skippedReason: 'variants_capability_disabled',
				lastExternalError: null
			}
		})
	})

	it('applies iiko stop-list by hiding default-only products from storefront', async () => {
		const at = new Date('2026-05-21T06:00:00.000Z')
		const defaultVariant = {
			id: 'variant-1',
			productId: 'product-1',
			sku: 'SKU-1',
			variantKey: 'default',
			kind: ProductVariantKind.DEFAULT,
			stock: null,
			price: 100,
			status: ProductVariantStatus.ACTIVE,
			isAvailable: true,
			deleteAt: null
		}
		const db = {
			integrationProductLink: {
				findMany: jest.fn().mockResolvedValue([
					{
						id: 'product-link-1',
						productId: 'product-1',
						externalId: 'iiko-product-1',
						product: {
							id: 'product-1',
							variants: [defaultVariant]
						}
					}
				]),
				update: jest.fn()
			},
			integrationVariantLink: {
				findMany: jest.fn().mockResolvedValue([]),
				update: jest.fn()
			},
			productVariant: {
				update: jest.fn(),
				count: jest.fn().mockResolvedValue(0)
			},
			product: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'product-1',
					status: ProductStatus.ACTIVE
				}),
				update: jest.fn()
			}
		}
		const repo = new IntegrationRepository({} as any)

		const result = await repo.applyIikoStopListAvailability(
			{
				catalogId: 'catalog-1',
				integrationId: 'integration-1',
				syncedAt: at,
				items: [
					{
						productId: 'iiko-product-1',
						sizeId: null,
						balance: 0
					}
				]
			},
			db as any
		)

		expect(result).toEqual(
			expect.objectContaining({
				stoppedVariants: 1,
				changedVariants: 1,
				changedProducts: 1
			})
		)
		expect(db.productVariant.update).toHaveBeenCalledWith({
			where: { id: 'variant-1' },
			data: {
				stock: 0,
				status: ProductVariantStatus.OUT_OF_STOCK,
				isAvailable: false
			}
		})
		expect(db.product.update).toHaveBeenCalledWith({
			where: { id: 'product-1' },
			data: { status: ProductStatus.HIDDEN }
		})
		expect(db.integrationProductLink.update).toHaveBeenCalledWith({
			where: { id: 'product-link-1' },
			data: expect.objectContaining({
				lastSeenAt: at,
				lastStockSyncAt: at
			})
		})
	})

	it('creates and assigns a MoySklad-managed product type for variant attributes', async () => {
		const db = {
			product: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'product-1',
					productTypeId: null,
					productType: null
				}),
				update: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			productType: {
				findFirst: jest.fn().mockResolvedValue(null),
				create: jest.fn().mockResolvedValue({ id: 'product-type-1' })
			}
		}
		const prisma = {
			$transaction: jest.fn((callback: (tx: typeof db) => unknown) => callback(db))
		}
		const repo = new IntegrationRepository(prisma as any)

		const result = await repo.ensureMoySkladProductTypeForVariantAttributes({
			catalogId: 'catalog-1',
			productId: 'product-1',
			attributes: [
				{
					attributeId: 'attr-size',
					key: 'moysklad_size',
					attributeDisplayName: 'Size',
					displayName: 'Size',
					displayOrder: 10,
					value: '42'
				},
				{
					attributeId: 'attr-color',
					key: 'moysklad_color',
					attributeDisplayName: 'Color',
					displayName: 'Color',
					displayOrder: 20,
					value: 'black'
				}
			]
		})

		expect(result).toEqual({
			productTypeId: 'product-type-1',
			created: true,
			assigned: true,
			changed: true
		})
		expect(db.productType.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					catalogId: 'catalog-1',
					scope: 'CATALOG',
					code: expect.stringMatching(/^moysklad-size-color-[a-f0-9]{10}$/),
					name: 'МойСклад: Size + Color',
					attributes: {
						create: [
							{
								attribute: { connect: { id: 'attr-size' } },
								isVariant: true,
								isRequired: true,
								displayOrder: 0
							},
							{
								attribute: { connect: { id: 'attr-color' } },
								isVariant: true,
								isRequired: true,
								displayOrder: 1
							}
						]
					}
				}),
				select: { id: true }
			})
		)
		expect(db.product.update).toHaveBeenCalledWith({
			where: { id: 'product-1' },
			data: { productTypeId: 'product-type-1' }
		})
	})

	it('keeps a manual product type when it already supports MoySklad attributes', async () => {
		const db = {
			product: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'product-1',
					productTypeId: 'manual-type',
					productType: {
						id: 'manual-type',
						code: 'manual-shoes',
						attributes: [{ attributeId: 'attr-size', isVariant: true }]
					}
				}),
				update: jest.fn()
			},
			productType: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'auto-type',
					name: 'МойСклад: Size',
					attributes: [
						{
							attributeId: 'attr-size',
							isVariant: true,
							isRequired: true,
							displayOrder: 0
						}
					]
				}),
				create: jest.fn(),
				update: jest.fn()
			},
			productTypeAttribute: {
				upsert: jest.fn()
			}
		}
		const prisma = {
			$transaction: jest.fn((callback: (tx: typeof db) => unknown) => callback(db))
		}
		const repo = new IntegrationRepository(prisma as any)

		const result = await repo.ensureMoySkladProductTypeForVariantAttributes({
			catalogId: 'catalog-1',
			productId: 'product-1',
			attributes: [
				{
					attributeId: 'attr-size',
					key: 'moysklad_size',
					attributeDisplayName: 'Size',
					displayName: 'Size',
					displayOrder: 0,
					value: '42'
				}
			]
		})

		expect(result).toEqual({
			productTypeId: 'auto-type',
			created: false,
			assigned: false,
			changed: false
		})
		expect(db.product.update).not.toHaveBeenCalled()
	})

	it('relinks a MoySklad variant when its stored link points to another product', async () => {
		const staleVariant = {
			id: 'old-variant',
			productId: 'old-product',
			sku: 'OLD-SKU',
			variantKey: 'old',
			stock: 3,
			price: 120,
			status: ProductVariantStatus.ACTIVE,
			isAvailable: true,
			deleteAt: null
		}
		const createdVariant = {
			id: 'new-variant',
			productId: 'new-product',
			sku: 'NEW-SKU',
			variantKey: 'moysklad_size=42',
			stock: 7,
			price: 150,
			status: ProductVariantStatus.ACTIVE,
			isAvailable: true,
			deleteAt: null
		}
		const staleLink = {
			id: 'link-1',
			integrationId: 'integration-1',
			variantId: staleVariant.id,
			externalId: 'external-variant',
			externalCode: 'MS-42',
			externalUpdatedAt: null,
			lastSyncedAt: null,
			rawMeta: null,
			createdAt: new Date(),
			updatedAt: new Date()
		}

		const db = {
			integrationVariantLink: {
				findUnique: jest
					.fn()
					.mockResolvedValueOnce(staleLink)
					.mockResolvedValueOnce(staleLink),
				update: jest.fn().mockResolvedValue({
					...staleLink,
					variantId: createdVariant.id
				})
			},
			productVariant: {
				findUnique: jest
					.fn()
					.mockResolvedValueOnce(staleVariant)
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce(null),
				update: jest.fn().mockResolvedValue({
					...staleVariant,
					sku: 'OLD-SKU-MOVED-old-vari',
					stock: 0,
					status: ProductVariantStatus.OUT_OF_STOCK,
					isAvailable: false
				}),
				create: jest.fn().mockResolvedValue(createdVariant),
				updateMany: jest.fn().mockResolvedValue({ count: 0 })
			},
			variantAttribute: {
				updateMany: jest.fn().mockResolvedValue({ count: 0 }),
				findUnique: jest.fn().mockResolvedValue(null),
				create: jest.fn().mockResolvedValue({ id: 'variant-attribute-1' })
			},
			attributeEnumValue: {
				findFirst: jest.fn().mockResolvedValue(null),
				aggregate: jest.fn().mockResolvedValue({ _max: { displayOrder: 0 } }),
				create: jest.fn().mockResolvedValue({ id: 'enum-size-42' })
			},
			attributeEnumValueAlias: {
				findFirst: jest.fn().mockResolvedValue(null)
			}
		}
		const prisma = {
			$transaction: jest.fn((callback: (tx: typeof db) => unknown) => callback(db))
		}
		const repo = new IntegrationRepository(prisma as any)

		const result = await repo.upsertIntegratedProductVariant({
			catalogId: 'catalog-1',
			integrationId: 'integration-1',
			productId: 'new-product',
			externalId: 'external-variant',
			externalCode: 'MS-42',
			externalUpdatedAt: null,
			rawMeta: { id: 'external-variant' },
			sku: 'NEW-SKU',
			variantKey: 'moysklad_size=42',
			price: 150,
			stock: 7,
			status: ProductVariantStatus.ACTIVE,
			attributes: [
				{
					attributeId: 'size-attribute',
					value: '42',
					displayName: '42'
				}
			]
		})

		expect(result.created).toBe(true)
		expect(result.variant).toBe(createdVariant)
		expect(db.productVariant.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: staleVariant.id },
				data: expect.objectContaining({
					stock: 0,
					status: ProductVariantStatus.OUT_OF_STOCK,
					isAvailable: false
				})
			})
		)
		expect(db.productVariant.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					productId: 'new-product',
					sku: 'NEW-SKU'
				})
			})
		)
		expect(db.integrationVariantLink.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: staleLink.id },
				data: expect.objectContaining({
					variantId: createdVariant.id
				})
			})
		)
	})

	it('rejects creating a MoySklad matrix variant without attributes', async () => {
		const db = {
			integrationVariantLink: {
				findUnique: jest.fn().mockResolvedValue(null)
			},
			productVariant: {
				findUnique: jest.fn().mockResolvedValue(null),
				create: jest.fn()
			}
		}
		const prisma = {
			$transaction: jest.fn((callback: (tx: typeof db) => unknown) => callback(db))
		}
		const repo = new IntegrationRepository(prisma as any)

		await expect(
			repo.upsertIntegratedProductVariant({
				catalogId: 'catalog-1',
				integrationId: 'integration-1',
				productId: 'product-1',
				externalId: 'external-variant',
				sku: 'SKU-1',
				variantKey: 'moysklad=external-variant',
				price: 150,
				stock: 7,
				status: ProductVariantStatus.ACTIVE,
				attributes: []
			})
		).rejects.toThrow('must have at least one variant attribute')

		expect(db.productVariant.create).not.toHaveBeenCalled()
	})

	it('quarantines missing variants before archiving after confirmed product syncs', async () => {
		const db = {
			integrationVariantLink: {
				findMany: jest.fn().mockResolvedValue([
					{
						id: 'link-first-miss',
						variantId: 'variant-first-miss',
						missingSince: null,
						missingSyncCount: 0
					},
					{
						id: 'link-confirmed-miss',
						variantId: 'variant-confirmed-miss',
						missingSince: new Date('2026-03-23T00:00:00.000Z'),
						missingSyncCount: 1
					}
				]),
				update: jest.fn().mockResolvedValue({})
			},
			productVariant: {
				updateMany: jest.fn().mockResolvedValue({ count: 1 })
			}
		}
		const repo = new IntegrationRepository(db as any)

		const count = await repo.archiveMissingIntegratedProductVariants({
			integrationId: 'integration-1',
			productId: 'product-1',
			externalIds: ['variant-1', 'variant-2', 'variant-1']
		})

		expect(count).toBe(1)
		expect(db.integrationVariantLink.findMany).toHaveBeenCalledWith({
			where: {
				integrationId: 'integration-1',
				externalId: { notIn: ['variant-1', 'variant-2'] },
				variant: {
					productId: 'product-1',
					deleteAt: null
				}
			},
			select: {
				id: true,
				missingSince: true,
				missingSyncCount: true,
				variantId: true
			}
		})
		expect(db.integrationVariantLink.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'link-first-miss' },
				data: expect.objectContaining({
					missingSyncCount: 1,
					skippedReason: 'missing_from_complete_snapshot'
				})
			})
		)
		expect(db.integrationVariantLink.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'link-confirmed-miss' },
				data: expect.objectContaining({
					missingSyncCount: 2,
					skippedReason: 'hidden_after_missing_confirmations'
				})
			})
		)
		expect(db.productVariant.updateMany).toHaveBeenCalledWith({
			where: {
				id: 'variant-confirmed-miss',
				productId: 'product-1',
				deleteAt: null
			},
			data: {
				stock: 0,
				status: ProductVariantStatus.OUT_OF_STOCK,
				isAvailable: false,
				deleteAt: expect.any(Date)
			}
		})
	})
})

import { ProductVariantStatus } from '@generated/enums'

import { IntegrationRepository } from './integration.repository'

describe('IntegrationRepository', () => {
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
				updateMany: jest.fn().mockResolvedValue({ count: 0 })
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
			attributes: []
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

	it('archives integrated variants missing from a single product sync', async () => {
		const db = {
			productVariant: {
				updateMany: jest.fn().mockResolvedValue({ count: 2 })
			}
		}
		const repo = new IntegrationRepository(db as any)

		const count = await repo.archiveMissingIntegratedProductVariants({
			integrationId: 'integration-1',
			productId: 'product-1',
			externalIds: ['variant-1', 'variant-2', 'variant-1']
		})

		expect(count).toBe(2)
		expect(db.productVariant.updateMany).toHaveBeenCalledWith({
			where: {
				productId: 'product-1',
				deleteAt: null,
				integrationLinks: {
					some: {
						integrationId: 'integration-1',
						externalId: { notIn: ['variant-1', 'variant-2'] }
					}
				}
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

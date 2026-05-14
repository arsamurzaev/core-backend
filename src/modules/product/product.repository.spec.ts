import { ProductRepository } from './product.repository'

describe('ProductRepository', () => {
	it('prepends product to multiple categories in one transaction', async () => {
		const tx = {
			product: {
				findFirst: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			category: {
				findMany: jest
					.fn()
					.mockResolvedValue([{ id: 'category-1' }, { id: 'category-2' }])
			},
			categoryProduct: {
				createMany: jest.fn().mockResolvedValue({ count: 2 })
			},
			$executeRaw: jest.fn().mockResolvedValue(2)
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma)

		await repository.prependProductToCategories('product-1', 'catalog-1', [
			'category-1',
			'category-2'
		])

		expect(prisma.$transaction).toHaveBeenCalledTimes(1)
		expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
		const shiftSql = (
			tx.$executeRaw.mock.calls[1]?.[0] as { strings?: string[] }
		).strings?.join(' ')
		expect(shiftSql).toContain('category_product."position" >= CAST(')
		expect(shiftSql).toContain('AS integer')
		expect(shiftSql).toContain('active_product."delete_at" IS NULL')
		expect(tx.categoryProduct.createMany).toHaveBeenCalledWith({
			data: [
				{ categoryId: 'category-1', productId: 'product-1', position: 0 },
				{ categoryId: 'category-2', productId: 'product-1', position: 0 }
			]
		})
	})

	it('syncs removed and added categories in batch operations', async () => {
		const tx = {
			categoryProduct: {
				findMany: jest.fn().mockResolvedValue([
					{ categoryId: 'category-1', position: 3 },
					{ categoryId: 'category-2', position: 0 }
				]),
				deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
				createMany: jest.fn().mockResolvedValue({ count: 1 })
			},
			$executeRaw: jest.fn().mockResolvedValue(1)
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma)

		await repository.syncProductCategories('product-1', 'catalog-1', [
			'category-2',
			'category-3'
		])

		expect(prisma.$transaction).toHaveBeenCalledTimes(1)
		expect(tx.$executeRaw).toHaveBeenCalledTimes(3)
		const closeGapsSql = (
			tx.$executeRaw.mock.calls[1]?.[0] as { strings?: string[] }
		).strings?.join(' ')
		expect(closeGapsSql).toContain('CAST(')
		expect(closeGapsSql).toContain('AS integer')
		expect(closeGapsSql).toContain(
			'category_product."position" > input."position"'
		)
		expect(closeGapsSql).toContain('active_product."delete_at" IS NULL')
		expect(tx.categoryProduct.deleteMany).toHaveBeenCalledWith({
			where: {
				productId: 'product-1',
				categoryId: { in: ['category-1'] }
			}
		})
		expect(tx.categoryProduct.createMany).toHaveBeenCalledWith({
			data: [{ categoryId: 'category-3', productId: 'product-1', position: 0 }]
		})
	})

	it('removes all product category links when syncing an empty category list', async () => {
		const tx = {
			categoryProduct: {
				findMany: jest.fn().mockResolvedValue([
					{ categoryId: 'category-1', position: 0 },
					{ categoryId: 'category-2', position: 2 }
				]),
				deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
				createMany: jest.fn().mockResolvedValue({ count: 0 })
			},
			$executeRaw: jest.fn().mockResolvedValue(1)
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma)

		await repository.syncProductCategories('product-1', 'catalog-1', [])

		expect(prisma.$transaction).toHaveBeenCalledTimes(1)
		expect(tx.categoryProduct.deleteMany).toHaveBeenCalledWith({
			where: {
				productId: 'product-1',
				categoryId: { in: ['category-1', 'category-2'] }
			}
		})
		expect(tx.categoryProduct.createMany).not.toHaveBeenCalled()
	})

	it('normalizes category product positions before moving product inside category', async () => {
		const tx = {
			category: {
				findFirst: jest.fn().mockResolvedValue({ id: 'category-1' })
			},
			product: {
				findFirst: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			categoryProduct: {
				findUnique: jest.fn().mockResolvedValue({ position: 2 }),
				count: jest.fn().mockResolvedValue(3),
				updateMany: jest.fn().mockResolvedValue({ count: 1 }),
				update: jest.fn().mockResolvedValue({ count: 1 })
			},
			$executeRaw: jest.fn().mockResolvedValue(2)
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma)

		await repository.upsertCategoryProductPosition(
			'product-1',
			'category-1',
			'catalog-1',
			1
		)

		expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
		expect(tx.categoryProduct.count).toHaveBeenCalledWith({
			where: {
				categoryId: 'category-1',
				product: { deleteAt: null },
				productId: { not: 'product-1' }
			}
		})
		expect(tx.categoryProduct.updateMany).toHaveBeenCalledWith({
			where: {
				categoryId: 'category-1',
				product: { deleteAt: null },
				position: { gte: 1, lt: 2 }
			},
			data: { position: { increment: 1 } }
		})
		expect(tx.categoryProduct.update).toHaveBeenCalledWith({
			where: {
				categoryId_productId: {
					categoryId: 'category-1',
					productId: 'product-1'
				}
			},
			data: { position: 1 }
		})
	})

	it('builds tokenized search clause across name, sku and slug', () => {
		const repository = new ProductRepository({} as any)

		const clause = (repository as any).buildSearchFilterClause(
			'  Jeans   HM-001  '
		)

		expect(clause).not.toBeNull()
		expect(clause.strings.join(' ')).toContain('LOWER(p.name) LIKE')
		expect(clause.strings.join(' ')).toContain('LOWER(p.sku) LIKE')
		expect(clause.strings.join(' ')).toContain('LOWER(p.slug) LIKE')
		expect(clause.values).toEqual([
			'%jeans%',
			'%jeans%',
			'%jeans%',
			'%hm-001%',
			'%hm-001%',
			'%hm-001%'
		])
	})

	it('builds product type filter clause', () => {
		const repository = new ProductRepository({} as any)

		const clause = (repository as any).buildProductTypeFilterClause(
			'product-type-1'
		)

		expect(clause).not.toBeNull()
		expect(clause.strings.join(' ')).toContain('p.product_type_id =')
		expect(clause.values).toEqual(['product-type-1'])
	})

	it('keeps product type filtered product pages scoped to the current catalog', async () => {
		const prisma = {
			$queryRaw: jest.fn().mockResolvedValue([])
		}
		const repository = new ProductRepository(prisma as any)

		await repository.findFilteredProductIdsPageDefault({
			catalogId: 'catalog-1',
			productTypeId: 'product-type-1',
			categoryIds: [],
			brandIds: [],
			attributeFilters: [],
			take: 3
		})

		const sql = prisma.$queryRaw.mock.calls[0]?.[0]
		const text = sql.strings.join(' ')
		expect(text).toContain('p.catalog_id =')
		expect(text).toContain('p.product_type_id =')
		expect(sql.values).toContain('catalog-1')
		expect(sql.values).toContain('product-type-1')
	})

	it('does not let a cross-catalog productTypeId remove the catalog boundary', async () => {
		const prisma = {
			$queryRaw: jest.fn().mockResolvedValue([])
		}
		const repository = new ProductRepository(prisma as any)

		await repository.findFilteredProductIdsPageDefault({
			catalogId: 'catalog-1',
			productTypeId: 'product-type-from-catalog-2',
			categoryIds: [],
			brandIds: [],
			attributeFilters: [],
			take: 3
		})

		const sql = prisma.$queryRaw.mock.calls[0]?.[0]
		const text = sql.strings.join(' ')
		expect(text).toContain('p.catalog_id =')
		expect(text).toContain('p.product_type_id =')
		expect(sql.values).toContain('catalog-1')
		expect(sql.values).toContain('product-type-from-catalog-2')
	})

	it('finds only simple products that need a technical default variant repair', async () => {
		const prisma = {
			product: {
				findMany: jest.fn().mockResolvedValue([])
			}
		}
		const repository = new ProductRepository(prisma as any)

		await repository.findDefaultVariantRepairCandidates(
			'catalog-1',
			25,
			'cursor-product'
		)

		expect(prisma.product.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					catalogId: 'catalog-1',
					deleteAt: null,
					AND: expect.arrayContaining([
						expect.objectContaining({
							variants: expect.objectContaining({
								none: expect.objectContaining({
									OR: expect.any(Array)
								})
							})
						}),
						expect.objectContaining({
							variants: {
								none: {
									deleteAt: null,
									variantKey: { not: 'default' }
								}
							}
						})
					])
				}),
				select: {
					id: true,
					sku: true,
					price: true,
					status: true
				},
				orderBy: { id: 'asc' },
				take: 25,
				cursor: { id: 'cursor-product' },
				skip: 1
			})
		)
	})

	it('loads product type compatibility preview refs inside current catalog', async () => {
		const prisma = {
			product: {
				findFirst: jest.fn().mockResolvedValue(null)
			}
		}
		const repository = new ProductRepository(prisma as any)

		await repository.findProductTypeCompatibilityPreviewRef(
			'product-1',
			'catalog-1'
		)

		expect(prisma.product.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					id: 'product-1',
					catalogId: 'catalog-1',
					deleteAt: null
				}
			})
		)

		const query = prisma.product.findFirst.mock.calls[0][0]
		expect(query.select.productAttributes.select.attribute.select).toEqual({
			id: true,
			key: true,
			displayName: true,
			dataType: true,
			isHidden: true,
			isVariantAttribute: true,
			types: {
				select: {
					id: true
				}
			}
		})
		expect(
			query.select.variants.select.attributes.select.attribute.select
		).toEqual({
			id: true,
			key: true,
			displayName: true,
			dataType: true,
			isHidden: true,
			isVariantAttribute: true,
			types: {
				select: {
					id: true
				}
			}
		})
	})

	it('applies product type change with attribute removals in one transaction', async () => {
		const tx = {
			product: {
				findFirst: jest
					.fn()
					.mockResolvedValueOnce({ id: 'product-1' })
					.mockResolvedValueOnce({ status: 'HIDDEN' })
					.mockResolvedValueOnce({ id: 'product-1', media: [], variants: [] }),
				update: jest.fn()
			},
			productAttribute: {
				updateMany: jest.fn()
			},
			productVariant: {
				findFirst: jest.fn()
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await repository.applyProductTypeChange(
			'product-1',
			'catalog-1',
			{ productType: { connect: { id: 'product-type-1' } } } as any,
			['material-attribute']
		)

		expect(prisma.$transaction).toHaveBeenCalledTimes(1)
		expect(tx.product.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'product-1', catalogId: 'catalog-1', deleteAt: null },
				select: { id: true }
			})
		)
		expect(tx.product.update).toHaveBeenCalledWith({
			where: { id: 'product-1' },
			data: { productType: { connect: { id: 'product-type-1' } } }
		})
		expect(tx.productAttribute.updateMany).toHaveBeenCalledWith({
			where: {
				productId: 'product-1',
				attributeId: { in: ['material-attribute'] },
				deleteAt: null
			},
			data: { deleteAt: expect.any(Date) }
		})
	})

	it('removes variant attributes during product update when requested', async () => {
		const tx = {
			product: {
				findFirst: jest
					.fn()
					.mockResolvedValueOnce({ id: 'product-1' })
					.mockResolvedValueOnce({ status: 'HIDDEN' })
					.mockResolvedValueOnce({ id: 'product-1', media: [], variants: [] }),
				update: jest.fn()
			},
			variantAttribute: {
				updateMany: jest.fn()
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await repository.update(
			'product-1',
			{ productType: { disconnect: true } } as any,
			'catalog-1',
			undefined,
			undefined,
			undefined,
			undefined,
			['size-attribute', 'color-attribute']
		)

		expect(prisma.$transaction).toHaveBeenCalledTimes(1)
		expect(tx.variantAttribute.updateMany).toHaveBeenCalledWith({
			where: {
				attributeId: { in: ['size-attribute', 'color-attribute'] },
				deleteAt: null,
				variant: { productId: 'product-1', deleteAt: null }
			},
			data: { deleteAt: expect.any(Date) }
		})
	})

	it('syncs single unlinked default variant price when product price changes', async () => {
		const prisma = {
			$transaction: jest.fn(async callback => callback(prisma)),
			product: {
				updateMany: jest.fn().mockResolvedValue({ count: 1 }),
				findFirst: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			productVariant: {
				findMany: jest.fn().mockResolvedValue([
					{
						id: 'variant-1',
						variantKey: 'default',
						price: 100,
						attributes: [],
						integrationLinks: []
					}
				]),
				update: jest.fn().mockResolvedValue({ id: 'variant-1' })
			}
		}
		const repository = new ProductRepository(prisma)

		await repository.update('product-1', { price: 120 }, 'catalog-1')

		expect(prisma.productVariant.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { productId: 'product-1', deleteAt: null },
				take: 2
			})
		)
		expect(prisma.productVariant.update).toHaveBeenCalledWith({
			where: { id: 'variant-1' },
			data: { price: 120 }
		})
	})

	it('clears single unlinked default variant price when product price is cleared', async () => {
		const prisma = {
			$transaction: jest.fn(async callback => callback(prisma)),
			product: {
				updateMany: jest.fn().mockResolvedValue({ count: 1 }),
				findFirst: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			productVariant: {
				findMany: jest.fn().mockResolvedValue([
					{
						id: 'variant-1',
						variantKey: 'default',
						price: 100,
						attributes: [],
						integrationLinks: []
					}
				]),
				update: jest.fn().mockResolvedValue({ id: 'variant-1' })
			}
		}
		const repository = new ProductRepository(prisma)

		await repository.update('product-1', { price: null }, 'catalog-1')

		expect(prisma.productVariant.update).toHaveBeenCalledWith({
			where: { id: 'variant-1' },
			data: { price: null }
		})
	})

	it('does not sync variant price when product has real variants', async () => {
		const prisma = {
			$transaction: jest.fn(async callback => callback(prisma)),
			product: {
				updateMany: jest.fn().mockResolvedValue({ count: 1 }),
				findFirst: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			productVariant: {
				findMany: jest.fn().mockResolvedValue([
					{
						id: 'variant-1',
						variantKey: 'size=s',
						price: 100,
						attributes: [{ id: 'attribute-1' }],
						integrationLinks: []
					},
					{
						id: 'variant-2',
						variantKey: 'size=m',
						price: 120,
						attributes: [{ id: 'attribute-2' }],
						integrationLinks: []
					}
				]),
				update: jest.fn()
			}
		}
		const repository = new ProductRepository(prisma)

		await repository.update('product-1', { price: 140 }, 'catalog-1')

		expect(prisma.productVariant.update).not.toHaveBeenCalled()
	})

	it('creates a default variant while repairing a legacy product without variants', async () => {
		const tx = {
			product: {
				findFirst: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			productVariant: {
				findFirst: jest
					.fn()
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce(null),
				create: jest.fn().mockResolvedValue({ id: 'variant-default' })
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.ensureDefaultVariant('product-1', 'catalog-1', {
				sku: 'LEGACY-PRODUCT',
				variantKey: 'default',
				price: 120,
				stock: 0,
				status: 'OUT_OF_STOCK',
				attributes: []
			} as any)
		).resolves.toBe(true)

		expect(tx.productVariant.create).toHaveBeenCalledWith({
			data: {
				productId: 'product-1',
				sku: 'LEGACY-PRODUCT',
				variantKey: 'default',
				stock: 0,
				price: 120,
				status: 'OUT_OF_STOCK',
				isAvailable: false
			}
		})
	})

	it('does not repair default variant when product has custom variants', async () => {
		const tx = {
			product: {
				findFirst: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			productVariant: {
				findFirst: jest
					.fn()
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce({ id: 'variant-custom' }),
				create: jest.fn()
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.ensureDefaultVariant('product-1', 'catalog-1', {
				sku: 'CUSTOM-PRODUCT',
				variantKey: 'default',
				price: 120,
				stock: 0,
				status: 'OUT_OF_STOCK',
				attributes: []
			} as any)
		).resolves.toBe(false)

		expect(tx.productVariant.create).not.toHaveBeenCalled()
	})

	it('rejects toggling a product to active without a valid variant', async () => {
		const tx = {
			product: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'product-1',
					status: 'HIDDEN'
				}),
				update: jest.fn()
			},
			productVariant: {
				findFirst: jest.fn().mockResolvedValue(null)
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.toggleStatus('product-1', 'catalog-1')
		).rejects.toThrow('Активный товар должен иметь активный или default variant')

		expect(tx.product.update).not.toHaveBeenCalled()
		expect(tx.productVariant.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					productId: 'product-1',
					deleteAt: null,
					OR: expect.any(Array)
				})
			})
		)
	})

	it('allows toggling a product to active with an out-of-stock default variant', async () => {
		const tx = {
			product: {
				findFirst: jest
					.fn()
					.mockResolvedValueOnce({
						id: 'product-1',
						status: 'HIDDEN'
					})
					.mockResolvedValueOnce({
						id: 'product-1',
						status: 'ACTIVE',
						variants: []
					}),
				update: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			productVariant: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'variant-default',
					variantKey: 'default',
					status: 'OUT_OF_STOCK'
				})
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.toggleStatus('product-1', 'catalog-1')
		).resolves.toMatchObject({
			id: 'product-1',
			status: 'ACTIVE'
		})

		expect(tx.product.update).toHaveBeenCalledWith({
			where: { id: 'product-1' },
			data: { status: 'ACTIVE' }
		})
	})

	it('rejects direct activation when no valid variant remains', async () => {
		const tx = {
			product: {
				updateMany: jest.fn().mockResolvedValue({ count: 1 }),
				findFirst: jest.fn().mockResolvedValue({
					id: 'product-1',
					status: 'ACTIVE'
				})
			},
			productVariant: {
				findFirst: jest.fn().mockResolvedValue(null)
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.update('product-1', { status: 'ACTIVE' } as any, 'catalog-1')
		).rejects.toThrow('default variant')
	})

	it('rejects variant updates that disable the last valid variant of an active product', async () => {
		const tx = {
			product: {
				findFirst: jest
					.fn()
					.mockResolvedValueOnce({ id: 'product-1' })
					.mockResolvedValueOnce({
						id: 'product-1',
						status: 'ACTIVE'
					}),
				update: jest.fn()
			},
			productVariant: {
				findMany: jest.fn().mockResolvedValue([
					{
						id: 'variant-1',
						variantKey: 'size=s',
						status: 'ACTIVE'
					}
				]),
				update: jest.fn().mockResolvedValue({ id: 'variant-1' }),
				findFirst: jest.fn().mockResolvedValue(null)
			},
			productAttribute: {
				updateMany: jest.fn(),
				upsert: jest.fn()
			},
			productMedia: {
				deleteMany: jest.fn(),
				createMany: jest.fn()
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.update(
				'product-1',
				{} as any,
				'catalog-1',
				undefined,
				undefined,
				[
					{
						variantKey: 'size=s',
						status: 'DISABLED'
					}
				] as any
			)
		).rejects.toThrow('default variant')
		expect(tx.productVariant.update).toHaveBeenCalledWith({
			where: { id: 'variant-1' },
			data: {
				status: 'DISABLED',
				isAvailable: false
			}
		})
	})

	it('rejects replacing variants with an empty set on an active product', async () => {
		const tx = {
			product: {
				findFirst: jest
					.fn()
					.mockResolvedValueOnce({ id: 'product-1' })
					.mockResolvedValueOnce({
						id: 'product-1',
						status: 'ACTIVE'
					})
			},
			variantAttribute: {
				updateMany: jest.fn()
			},
			productVariant: {
				updateMany: jest.fn(),
				findFirst: jest.fn().mockResolvedValue(null)
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.setVariants('product-1', 'catalog-1', [])
		).rejects.toThrow('default variant')
		expect(tx.productVariant.updateMany).toHaveBeenCalledWith({
			where: { productId: 'product-1', deleteAt: null },
			data: expect.objectContaining({
				deleteAt: expect.any(Date)
			})
		})
	})

	it('rejects creating an active product with only disabled custom variants', async () => {
		const tx = {
			product: {
				create: jest.fn().mockResolvedValue({ id: 'product-1' }),
				findFirst: jest.fn().mockResolvedValue({
					id: 'product-1',
					status: 'ACTIVE'
				})
			},
			productAttribute: {
				createMany: jest.fn()
			},
			variantAttribute: {
				updateMany: jest.fn()
			},
			productVariant: {
				updateMany: jest.fn(),
				findMany: jest.fn().mockResolvedValue([]),
				create: jest.fn().mockResolvedValue({ id: 'variant-disabled' }),
				findFirst: jest.fn().mockResolvedValue(null)
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.create(
				{
					name: 'Product',
					slug: 'product',
					sku: 'PRODUCT',
					price: 100,
					status: 'ACTIVE',
					catalog: { connect: { id: 'catalog-1' } }
				} as any,
				[],
				[
					{
						sku: 'PRODUCT-S',
						variantKey: 'size=s',
						price: 100,
						stock: 0,
						status: 'DISABLED',
						attributes: []
					}
				] as any
			)
		).rejects.toThrow('default variant')
	})

	it('removes category links and closes category position gaps on soft delete', async () => {
		const tx = {
			product: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'product-1',
					media: [{ mediaId: 'media-1' }],
					categoryProducts: [
						{ categoryId: 'category-1', position: 3 },
						{ categoryId: 'category-2', position: 0 }
					]
				}),
				update: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			categoryProduct: {
				findMany: jest.fn().mockResolvedValue([
					{ categoryId: 'category-1', position: 1 },
					{ categoryId: 'category-2', position: 0 }
				]),
				deleteMany: jest.fn().mockResolvedValue({ count: 2 })
			},
			productMedia: {
				deleteMany: jest.fn().mockResolvedValue({ count: 1 })
			},
			$executeRaw: jest.fn().mockResolvedValue(2)
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.softDelete('product-1', 'catalog-1')
		).resolves.toEqual({
			id: 'product-1',
			mediaIds: ['media-1']
		})

		expect(tx.product.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'product-1', catalogId: 'catalog-1', deleteAt: null },
				select: expect.objectContaining({
					categoryProducts: {
						where: { category: { catalogId: 'catalog-1', deleteAt: null } },
						select: { categoryId: true, position: true }
					}
				})
			})
		)
		expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
		const normalizeSql = (
			tx.$executeRaw.mock.calls[0]?.[0] as { strings?: string[] }
		).strings?.join(' ')
		const closeGapsSql = (
			tx.$executeRaw.mock.calls[1]?.[0] as { strings?: string[] }
		).strings?.join(' ')
		expect(normalizeSql).toContain('INNER JOIN "products" AS active_product')
		expect(closeGapsSql).toContain(
			'category_product."position" > input."position"'
		)
		expect(closeGapsSql).toContain('active_product."delete_at" IS NULL')
		expect(tx.categoryProduct.findMany).toHaveBeenCalledWith({
			where: {
				productId: 'product-1',
				category: { catalogId: 'catalog-1', deleteAt: null }
			},
			select: { categoryId: true, position: true }
		})
		expect(tx.categoryProduct.deleteMany).toHaveBeenCalledWith({
			where: { productId: 'product-1' }
		})
		expect(tx.$executeRaw.mock.invocationCallOrder[1]).toBeLessThan(
			tx.categoryProduct.deleteMany.mock.invocationCallOrder[0]
		)
		expect(tx.product.update).toHaveBeenCalledWith({
			where: { id: 'product-1' },
			data: { deleteAt: expect.any(Date), brandId: null }
		})
	})

	it('expires scheduled discounts in bulk and returns affected products', async () => {
		const tx = {
			product: {
				findMany: jest.fn().mockResolvedValue([
					{ id: 'product-1', catalogId: 'catalog-1' },
					{ id: 'product-2', catalogId: 'catalog-2' }
				])
			},
			productAttribute: {
				updateMany: jest.fn().mockResolvedValue({ count: 2 })
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)
		const now = new Date('2026-04-01T01:00:00.000Z')

		const result = await repository.expireScheduledDiscounts(now)

		expect(prisma.$transaction).toHaveBeenCalledTimes(1)
		expect(tx.product.findMany).toHaveBeenCalledWith({
			where: {
				deleteAt: null,
				productAttributes: {
					some: {
						deleteAt: null,
						valueDateTime: { lte: now },
						attribute: {
							is: {
								key: 'discountEndAt'
							}
						}
					}
				}
			},
			select: {
				id: true,
				catalogId: true
			}
		})
		expect(tx.productAttribute.updateMany).toHaveBeenCalledTimes(4)
		expect(result).toEqual([
			{ productId: 'product-1', catalogId: 'catalog-1' },
			{ productId: 'product-2', catalogId: 'catalog-2' }
		])
	})
})

import {
	DataType,
	ProductVariantKind,
	ProductVariantStatus
} from '@generated/enums'

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

	it('builds price filter over commercial variant prices with product price fallback', () => {
		const repository = new ProductRepository({} as any)

		const clauses = (repository as any).buildPriceFilterClauses(100, 500)

		expect(clauses).toHaveLength(1)
		const text = clauses[0].strings.join(' ')
		expect(text).toContain('FROM product_variants pv')
		expect(text).toContain('FROM product_variant_sale_units pvsu')
		expect(text).toContain('COALESCE(default_sale_unit.price, pv.price)')
		expect(text).toContain(
			'COALESCE(fallback_sale_unit.price, fallback_pv.price)'
		)
		expect(text).toContain('UNION ALL')
		expect(text).toContain('SELECT p.price')
		expect(text).toContain('NOT EXISTS')
		expect(text).toContain('matrix_pv')
		expect(text).toContain('commercial_price.price >=')
		expect(text).toContain('commercial_price.price <=')
		expect(clauses[0].values).toEqual(
			expect.arrayContaining([
				ProductVariantStatus.DISABLED,
				ProductVariantKind.DEFAULT,
				'default',
				100,
				500
			])
		)
	})

	it('requires existing catalog sale unit id for variant sale unit bindings', async () => {
		const repository = new ProductRepository({} as any)
		const tx = {
			catalogSaleUnit: {
				findFirst: jest.fn()
			}
		}

		await expect(
			(repository as any).normalizeVariantSaleUnits(tx, 'catalog-1', [
				{
					name: 'Box',
					baseQuantity: 12,
					price: 500
				}
			])
		).rejects.toThrow('catalogSaleUnitId')
		expect(tx.catalogSaleUnit.findFirst).not.toHaveBeenCalled()
	})

	it('normalizes variant sale unit bindings from active catalog sale units', async () => {
		const repository = new ProductRepository({} as any)
		const tx = {
			catalogSaleUnit: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'catalog-sale-unit-1',
					code: 'box',
					name: 'Box',
					defaultBaseQuantity: 1,
					barcode: '4601234567890'
				})
			}
		}

		await expect(
			(repository as any).normalizeVariantSaleUnits(tx, 'catalog-1', [
				{
					catalogSaleUnitId: 'catalog-sale-unit-1',
					baseQuantity: 12,
					price: 500,
					isDefault: true
				}
			])
		).resolves.toEqual([
			expect.objectContaining({
				catalogSaleUnitId: 'catalog-sale-unit-1',
				code: 'box',
				name: 'Box',
				baseQuantity: 12,
				price: 500,
				barcode: '4601234567890',
				isDefault: true
			})
		])
		expect(tx.catalogSaleUnit.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: 'catalog-sale-unit-1',
					catalogId: 'catalog-1',
					isActive: true,
					deleteAt: null
				})
			})
		)
	})

	it('can resolve a legacy default variant update by kind', async () => {
		const repository = new ProductRepository({} as any)
		const tx = {
			productVariant: {
				findMany: jest.fn().mockResolvedValue([
					{
						id: 'legacy-default-variant',
						variantKey: 'legacy-sku',
						kind: ProductVariantKind.DEFAULT,
						status: ProductVariantStatus.ACTIVE
					}
				])
			}
		}

		const result = await (repository as any).loadExistingVariantsForUpdate(
			tx,
			'product-1',
			[{ variantKey: 'default', saleUnits: [] }]
		)

		expect(result.get('default')).toEqual(
			expect.objectContaining({ id: 'legacy-default-variant' })
		)
		expect(tx.productVariant.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					productId: 'product-1',
					deleteAt: null,
					OR: expect.arrayContaining([
						{ variantKey: { in: ['default'] } },
						{ kind: ProductVariantKind.DEFAULT }
					])
				})
			})
		)
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

	it('finds products that need a technical default variant repair', async () => {
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
					variants: {
						none: {
							deleteAt: null,
							OR: [{ kind: ProductVariantKind.DEFAULT }, { variantKey: 'default' }],
							status: { not: ProductVariantStatus.DISABLED }
						}
					}
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

	it('builds default variant diagnostics with counts and samples', async () => {
		const prisma = {
			$queryRaw: jest
				.fn()
				.mockResolvedValueOnce([{ count: 1 }])
				.mockResolvedValueOnce([
					{
						productId: 'product-1',
						productName: 'Legacy product',
						productSku: 'LEGACY',
						variantId: null,
						variantKey: null,
						variantSku: null,
						details: 'No custom variants and no technical default variant'
					}
				])
				.mockResolvedValueOnce([{ count: 0 }])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ count: 2 }])
				.mockResolvedValueOnce([
					{
						productId: 'product-2',
						productName: 'Matrix product',
						productSku: 'MATRIX',
						variantId: 'variant-2',
						variantKey: 'size=s',
						variantSku: 'MATRIX-S',
						details: 'Custom variant has no variant attributes'
					}
				])
				.mockResolvedValueOnce([{ count: 0 }])
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ count: 1 }])
				.mockResolvedValueOnce([
					{
						productId: 'product-3',
						productName: 'Price mismatch product',
						productSku: 'PRICE',
						variantId: 'variant-3',
						variantKey: 'default',
						variantSku: 'PRICE',
						details: 'productPrice=100.00; variantPrice=null'
					}
				])
		}
		const repository = new ProductRepository(prisma as any)

		const result = await repository.findDefaultVariantDiagnostics('catalog-1', 5)

		expect(prisma.$queryRaw).toHaveBeenCalledTimes(10)
		expect(result).toEqual([
			expect.objectContaining({
				code: 'SIMPLE_WITHOUT_DEFAULT_VARIANT',
				status: 'warn',
				count: 1,
				samples: [expect.objectContaining({ productId: 'product-1' })]
			}),
			expect.objectContaining({
				code: 'MULTIPLE_DEFAULT_VARIANTS',
				status: 'ok',
				count: 0
			}),
			expect.objectContaining({
				code: 'CUSTOM_VARIANT_WITHOUT_ATTRIBUTES',
				status: 'fail',
				count: 2,
				samples: [expect.objectContaining({ variantId: 'variant-2' })]
			}),
			expect.objectContaining({
				code: 'DEFAULT_VARIANT_WITH_ATTRIBUTES',
				status: 'ok',
				count: 0
			}),
			expect.objectContaining({
				code: 'DEFAULT_VARIANT_PRICE_MISMATCH',
				status: 'warn',
				count: 1,
				samples: [expect.objectContaining({ variantId: 'variant-3' })]
			})
		])
	})

	it('finds safe default variant price mismatch repair candidates', async () => {
		const rows = [
			{
				productId: 'product-1',
				productName: 'Legacy product',
				productSku: 'LEGACY',
				variantId: 'variant-1',
				variantKey: 'default',
				variantSku: 'LEGACY',
				previousProductPrice: '0.00',
				nextProductPrice: null
			}
		]
		const prisma = {
			$queryRaw: jest.fn().mockResolvedValue(rows)
		}
		const repository = new ProductRepository(prisma as any)

		const result =
			await repository.findDefaultVariantPriceMismatchRepairCandidates(
				'catalog-1',
				25,
				'cursor-product'
			)

		expect(result).toBe(rows)
		const sql = prisma.$queryRaw.mock.calls[0]?.[0]
		const text = sql.strings.join(' ')
		expect(text).toContain('p.price IS DISTINCT FROM v.price')
		expect(text).toContain('FROM product_variants other_default')
		expect(text).toContain('FROM product_variants custom_variant')
		expect(text).toContain('FROM variant_attributes attribute')
		expect(text).toContain('AND p.id >')
		expect(text).toContain('ORDER BY p.id ASC')
		expect(sql.values).toContain('catalog-1')
		expect(sql.values).toContain('cursor-product')
	})

	it('applies safe default variant price mismatch repairs', async () => {
		const prisma = {
			$queryRaw: jest.fn().mockResolvedValue([{ productId: 'product-1' }])
		}
		const repository = new ProductRepository(prisma as any)

		const result = await repository.applyDefaultVariantPriceMismatchRepairs(
			'catalog-1',
			['product-1', 'product-2']
		)

		expect(result).toEqual(['product-1'])
		const sql = prisma.$queryRaw.mock.calls[0]?.[0]
		const text = sql.strings.join(' ')
		expect(text).toContain('WITH safe_candidates AS')
		expect(text).toContain('UPDATE products p')
		expect(text).toContain('SET price = safe_candidates.next_price')
		expect(text).toContain('FROM variant_attributes attribute')
		expect(text).toContain('RETURNING p.id::text AS "productId"')
		expect(sql.values).toContain('catalog-1')
		expect(sql.values).toContain('product-1')
		expect(sql.values).toContain('product-2')
	})

	it('does not run price mismatch repair update for an empty product list', async () => {
		const prisma = {
			$queryRaw: jest.fn()
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.applyDefaultVariantPriceMismatchRepairs('catalog-1', [])
		).resolves.toEqual([])
		expect(prisma.$queryRaw).not.toHaveBeenCalled()
	})

	it('syncs external description into the description product attribute', async () => {
		const prisma = {
			attribute: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'description-attribute'
				})
			},
			productAttribute: {
				findUnique: jest.fn().mockResolvedValue(null),
				upsert: jest.fn().mockResolvedValue({ id: 'product-attribute-1' })
			}
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.syncExternalDescription({
				catalogId: 'catalog-1',
				productId: 'product-1',
				description: '  Fresh description  '
			})
		).resolves.toBe(true)

		expect(prisma.attribute.findFirst).toHaveBeenCalledWith({
			where: {
				key: 'description',
				dataType: DataType.STRING,
				isVariantAttribute: false,
				deleteAt: null,
				types: {
					some: {
						catalogs: {
							some: { id: 'catalog-1' }
						}
					}
				}
			},
			select: { id: true }
		})
		expect(prisma.productAttribute.findUnique).toHaveBeenCalledWith({
			where: {
				productId_attributeId: {
					productId: 'product-1',
					attributeId: 'description-attribute'
				}
			},
			select: {
				id: true,
				valueString: true,
				deleteAt: true
			}
		})
		expect(prisma.productAttribute.upsert).toHaveBeenCalledWith({
			where: {
				productId_attributeId: {
					productId: 'product-1',
					attributeId: 'description-attribute'
				}
			},
			create: {
				productId: 'product-1',
				attributeId: 'description-attribute',
				enumValueId: null,
				valueString: 'Fresh description',
				valueInteger: null,
				valueDecimal: null,
				valueBoolean: null,
				valueDateTime: null
			},
			update: {
				enumValueId: null,
				valueString: 'Fresh description',
				valueInteger: null,
				valueDecimal: null,
				valueBoolean: null,
				valueDateTime: null,
				deleteAt: null
			}
		})
	})

	it('soft deletes the description product attribute when external description is empty', async () => {
		const prisma = {
			attribute: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'description-attribute'
				})
			},
			productAttribute: {
				findUnique: jest.fn().mockResolvedValue({
					id: 'product-attribute-1',
					valueString: 'Old description',
					deleteAt: null
				}),
				updateMany: jest.fn().mockResolvedValue({ count: 1 }),
				upsert: jest.fn()
			}
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.syncExternalDescription({
				catalogId: 'catalog-1',
				productId: 'product-1',
				description: '   '
			})
		).resolves.toBe(true)

		expect(prisma.productAttribute.updateMany).toHaveBeenCalledWith({
			where: {
				id: 'product-attribute-1',
				deleteAt: null
			},
			data: { deleteAt: expect.any(Date) }
		})
		expect(prisma.productAttribute.upsert).not.toHaveBeenCalled()
	})

	it('skips external description sync when the description attribute is not configured', async () => {
		const prisma = {
			attribute: {
				findFirst: jest.fn().mockResolvedValue(null)
			},
			productAttribute: {
				findUnique: jest.fn(),
				updateMany: jest.fn(),
				upsert: jest.fn()
			}
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.syncExternalDescription({
				catalogId: 'catalog-1',
				productId: 'product-1',
				description: 'Fresh description'
			})
		).resolves.toBe(false)

		expect(prisma.productAttribute.findUnique).not.toHaveBeenCalled()
		expect(prisma.productAttribute.updateMany).not.toHaveBeenCalled()
		expect(prisma.productAttribute.upsert).not.toHaveBeenCalled()
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
			productVariant: {
				findMany: jest.fn().mockResolvedValue([])
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
				create: jest.fn().mockResolvedValue({ id: 'variant-default' }),
				findMany: jest.fn().mockResolvedValue([
					{
						id: 'variant-default',
						sku: 'LEGACY-PRODUCT',
						variantKey: 'default',
						kind: ProductVariantKind.DEFAULT,
						attributes: []
					}
				])
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
				kind: ProductVariantKind.DEFAULT,
				stock: 0,
				price: 120,
				status: 'OUT_OF_STOCK',
				isAvailable: false
			}
		})
	})

	it('creates a technical default variant alongside matrix variants', async () => {
		const tx = {
			product: {
				findFirst: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			productVariant: {
				findFirst: jest
					.fn()
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce(null),
				create: jest.fn().mockResolvedValue({ id: 'variant-default' }),
				findMany: jest.fn().mockResolvedValue([
					{
						id: 'variant-default',
						sku: 'CUSTOM-PRODUCT-DEFAULT',
						variantKey: 'default',
						kind: ProductVariantKind.DEFAULT,
						attributes: []
					},
					{
						id: 'variant-custom',
						sku: 'CUSTOM-PRODUCT-S',
						variantKey: 'size=s',
						kind: ProductVariantKind.MATRIX,
						attributes: [{ id: 'attribute-size-s' }]
					}
				])
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
		).resolves.toBe(true)

		expect(tx.productVariant.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				productId: 'product-1',
				variantKey: 'default',
				kind: ProductVariantKind.DEFAULT
			})
		})
	})

	it('converts an unattributed legacy variant into the technical default', async () => {
		const tx = {
			product: {
				findFirst: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			productVariant: {
				findFirst: jest
					.fn()
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce({ id: 'legacy-variant' }),
				update: jest.fn(),
				create: jest.fn(),
				findMany: jest.fn().mockResolvedValue([
					{
						id: 'legacy-variant',
						sku: 'LEGACY-PRODUCT',
						variantKey: 'default',
						kind: ProductVariantKind.DEFAULT,
						attributes: []
					}
				])
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.ensureDefaultVariant('product-1', 'catalog-1', {
				sku: 'LEGACY-PRODUCT-DEFAULT',
				variantKey: 'default',
				price: 120,
				stock: 0,
				status: 'OUT_OF_STOCK',
				attributes: []
			} as any)
		).resolves.toBe(true)

		expect(tx.productVariant.update).toHaveBeenCalledWith({
			where: { id: 'legacy-variant' },
			data: expect.objectContaining({
				variantKey: 'default',
				kind: ProductVariantKind.DEFAULT,
				price: 120,
				stock: 0,
				status: 'OUT_OF_STOCK'
			})
		})
		expect(tx.productVariant.create).not.toHaveBeenCalled()
	})

	it('rejects matrix variants without variant attributes before persisting', async () => {
		const tx = {
			product: {
				findFirst: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			productVariant: {
				updateMany: jest.fn(),
				findMany: jest.fn()
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.setVariants('product-1', 'catalog-1', [
				{
					sku: 'PRODUCT-MATRIX',
					variantKey: 'size=s',
					kind: ProductVariantKind.MATRIX,
					price: 120,
					stock: 1,
					status: 'ACTIVE',
					attributes: []
				}
			] as any)
		).rejects.toThrow('must have variant attributes')

		expect(tx.productVariant.updateMany).not.toHaveBeenCalled()
	})

	it('rejects technical default variants with attributes', async () => {
		const tx = {
			product: {
				findFirst: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			productVariant: {
				findFirst: jest
					.fn()
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce(null),
				create: jest.fn()
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.ensureDefaultVariant('product-1', 'catalog-1', {
				sku: 'PRODUCT',
				variantKey: 'default',
				kind: ProductVariantKind.DEFAULT,
				price: 120,
				stock: 0,
				status: 'OUT_OF_STOCK',
				attributes: [{ attributeId: 'size-attribute', enumValueId: 'size-s' }]
			} as any)
		).rejects.toThrow('must not have variant attributes')

		expect(tx.productVariant.create).not.toHaveBeenCalled()
	})

	it('rejects replacing a product with multiple technical default variants', async () => {
		const tx = {
			product: {
				findFirst: jest.fn().mockResolvedValue({ id: 'product-1' })
			},
			productVariant: {
				updateMany: jest.fn()
			}
		}
		const prisma = {
			$transaction: jest.fn(async callback => callback(tx))
		}
		const repository = new ProductRepository(prisma as any)

		await expect(
			repository.setVariants('product-1', 'catalog-1', [
				{
					sku: 'PRODUCT',
					variantKey: 'default',
					kind: ProductVariantKind.DEFAULT,
					price: 100,
					stock: 0,
					status: 'OUT_OF_STOCK',
					attributes: []
				},
				{
					sku: 'PRODUCT-DEFAULT-2',
					variantKey: 'default',
					kind: ProductVariantKind.DEFAULT,
					price: 100,
					stock: 0,
					status: 'OUT_OF_STOCK',
					attributes: []
				}
			] as any)
		).rejects.toThrow('only one technical default variant')

		expect(tx.productVariant.updateMany).not.toHaveBeenCalled()
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
				findMany: jest.fn().mockResolvedValue([]),
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

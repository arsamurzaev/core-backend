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
		const repository = new ProductRepository(prisma as any)

		await repository.prependProductToCategories('product-1', 'catalog-1', [
			'category-1',
			'category-2'
		])

		expect(prisma.$transaction).toHaveBeenCalledTimes(1)
		expect(tx.$executeRaw).toHaveBeenCalledTimes(2)
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
		const repository = new ProductRepository(prisma as any)

		await repository.syncProductCategories('product-1', 'catalog-1', [
			'category-2',
			'category-3'
		])

		expect(prisma.$transaction).toHaveBeenCalledTimes(1)
		expect(tx.$executeRaw).toHaveBeenCalledTimes(3)
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
		const repository = new ProductRepository(prisma as any)

		await repository.upsertCategoryProductPosition(
			'product-1',
			'category-1',
			'catalog-1',
			1
		)

		expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
		expect(tx.categoryProduct.updateMany).toHaveBeenCalledWith({
			where: {
				categoryId: 'category-1',
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

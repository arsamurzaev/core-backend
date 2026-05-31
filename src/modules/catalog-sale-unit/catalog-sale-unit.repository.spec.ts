import { CatalogSaleUnitRepository } from './catalog-sale-unit.repository'

describe('CatalogSaleUnitRepository', () => {
	let prisma: {
		catalogSaleUnit: { findMany: jest.Mock }
	}
	let repository: CatalogSaleUnitRepository

	beforeEach(() => {
		prisma = {
			catalogSaleUnit: {
				findMany: jest.fn().mockResolvedValue([])
			}
		}
		repository = new CatalogSaleUnitRepository(prisma as never)
	})

	it('lists only active non-archived units by default', async () => {
		await repository.findAll('catalog-1')

		expect(prisma.catalogSaleUnit.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					catalogId: 'catalog-1',
					deleteAt: null,
					isActive: true
				}
			})
		)
	})

	it('can include inactive units without archived units', async () => {
		await repository.findAll('catalog-1', { includeInactive: true })

		expect(prisma.catalogSaleUnit.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					catalogId: 'catalog-1',
					deleteAt: null
				}
			})
		)
	})

	it('can include archived units', async () => {
		await repository.findAll('catalog-1', { includeArchived: true })

		expect(prisma.catalogSaleUnit.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					catalogId: 'catalog-1'
				}
			})
		)
	})
})

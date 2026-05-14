import { ProductTypeScope } from './product-type.constants'
import { ProductTypeRepository } from './product-type.repository'

describe('ProductTypeRepository', () => {
	let repo: ProductTypeRepository
	let prisma: {
		productType: {
			findFirst: jest.Mock
		}
	}

	beforeEach(() => {
		prisma = {
			productType: {
				findFirst: jest.fn()
			}
		}
		repo = new ProductTypeRepository(prisma as any)
	})

	it('loads matrix editor schema for active catalog attributes and enum values', async () => {
		prisma.productType.findFirst.mockResolvedValue(null)

		await repo.findCatalogTypeMatrixEditorSchemaById(
			'product-type-id',
			'catalog-id'
		)

		expect(prisma.productType.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					id: 'product-type-id',
					catalogId: 'catalog-id',
					scope: ProductTypeScope.CATALOG,
					isArchived: false
				}
			})
		)

		const query = prisma.productType.findFirst.mock.calls[0][0]
		expect(query.select.attributes.where).toEqual({
			attribute: { deleteAt: null }
		})
		expect(query.select.attributes.orderBy).toEqual([
			{ displayOrder: 'asc' },
			{ attributeId: 'asc' }
		])
		expect(query.select.attributes.select.attribute.select.enumValues).toEqual({
			where: {
				deleteAt: null,
				OR: [
					{ catalogId: 'catalog-id' },
					{
						catalogId: null,
						OR: [
							{
								productAttributes: {
									some: {
										deleteAt: null,
										product: {
											catalogId: 'catalog-id',
											productTypeId: 'product-type-id',
											deleteAt: null
										}
									}
								}
							},
							{
								variantAttributes: {
									some: {
										deleteAt: null,
										variant: {
											deleteAt: null,
											product: {
												catalogId: 'catalog-id',
												productTypeId: 'product-type-id',
												deleteAt: null
											}
										}
									}
								}
							}
						]
					}
				]
			},
			select: {
				id: true,
				attributeId: true,
				catalogId: true,
				value: true,
				displayName: true,
				displayOrder: true,
				businessId: true,
				source: true,
				mergedIntoId: true,
				aliases: {
					where: { deleteAt: null },
					select: {
						id: true,
						attributeId: true,
						catalogId: true,
						enumValueId: true,
						value: true,
						displayName: true
					},
					orderBy: { value: 'asc' }
				}
			},
			orderBy: [{ displayOrder: 'asc' }, { value: 'asc' }]
		})
	})
})

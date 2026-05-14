import { AttributeRepository } from './attribute.repository'

describe('AttributeRepository', () => {
	it('merges enum values by reassigning product and variant attributes', async () => {
		const source = {
			id: 'source-id',
			value: 'black-old',
			displayName: 'Black old'
		}
		const target = { id: 'target-id', value: 'black', displayName: 'Black' }
		const merged = { id: 'target-id', value: 'black' }
		const tx = {
			attributeEnumValue: {
				findFirst: jest
					.fn()
					.mockResolvedValueOnce(source)
					.mockResolvedValueOnce(target)
					.mockResolvedValueOnce(null)
					.mockResolvedValueOnce(merged),
				update: jest.fn().mockResolvedValue(source)
			},
			productAttribute: {
				updateMany: jest.fn().mockResolvedValue({ count: 2 })
			},
			variantAttribute: {
				updateMany: jest.fn().mockResolvedValue({ count: 3 })
			},
			attributeEnumValueAlias: {
				findMany: jest.fn().mockResolvedValue([]),
				findFirst: jest.fn().mockResolvedValue(null),
				update: jest.fn(),
				create: jest.fn().mockResolvedValue({ id: 'alias-id' })
			}
		}
		const prisma = {
			$transaction: jest.fn((callback: (txArg: typeof tx) => unknown) =>
				callback(tx)
			)
		}
		const repo = new AttributeRepository(prisma as any)

		await expect(
			repo.mergeEnumValues('attribute-id', 'source-id', 'target-id')
		).resolves.toEqual(merged)

		expect(tx.productAttribute.updateMany).toHaveBeenCalledWith({
			where: {
				attributeId: 'attribute-id',
				enumValueId: 'source-id',
				deleteAt: null
			},
			data: { enumValueId: 'target-id' }
		})
		expect(tx.variantAttribute.updateMany).toHaveBeenCalledWith({
			where: {
				attributeId: 'attribute-id',
				enumValueId: 'source-id',
				deleteAt: null
			},
			data: { enumValueId: 'target-id' }
		})
		expect(tx.attributeEnumValue.update).toHaveBeenCalledWith({
			where: { id: 'source-id' },
			data: {
				deleteAt: expect.any(Date),
				mergedIntoId: 'target-id'
			}
		})
		expect(tx.attributeEnumValueAlias.create).toHaveBeenCalledWith({
			data: {
				attributeId: 'attribute-id',
				enumValueId: 'target-id',
				value: 'black-old',
				displayName: 'Black old'
			},
			select: { id: true }
		})
	})
})

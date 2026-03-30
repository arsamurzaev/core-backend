import { CategoryRepository } from './category.repository'

describe('CategoryRepository', () => {
	let repository: CategoryRepository
	let prisma: { $executeRaw: jest.Mock }

	beforeEach(() => {
		prisma = {
			$executeRaw: jest.fn().mockResolvedValue(2)
		}

		repository = new CategoryRepository(prisma as any)
	})

	it('skips batch position update when there is nothing to update', async () => {
		await repository.updatePositions([])

		expect(prisma.$executeRaw).not.toHaveBeenCalled()
	})

	it('updates category positions in a single SQL statement', async () => {
		await repository.updatePositions([
			{ id: '11111111-1111-4111-8111-111111111111', position: 1 },
			{ id: '22222222-2222-4222-8222-222222222222', position: 0 }
		])

		expect(prisma.$executeRaw).toHaveBeenCalledTimes(1)

		const query = prisma.$executeRaw.mock.calls[0]?.[0] as {
			strings?: string[]
			values?: unknown[]
		}
		const sql = query.strings?.join(' ') ?? ''

		expect(sql).toContain('UPDATE "categories" AS category')
		expect(sql).toContain('VALUES')
		expect(sql).toContain('CAST(')
		expect(query.values).toEqual([
			'11111111-1111-4111-8111-111111111111',
			1,
			'22222222-2222-4222-8222-222222222222',
			0
		])
	})
})

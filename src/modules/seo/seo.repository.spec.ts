import { SeoRepository } from './seo.repository'

describe('SeoRepository', () => {
	let repository: SeoRepository
	let prisma: {
		seoSetting: {
			findFirst: jest.Mock
			update: jest.Mock
		}
	}

	beforeEach(() => {
		prisma = {
			seoSetting: {
				findFirst: jest.fn(),
				update: jest.fn()
			}
		}

		repository = new SeoRepository(prisma as any)
	})

	it('uses single-row update for relation-aware seo updates', async () => {
		prisma.seoSetting.findFirst.mockResolvedValueOnce({ id: 'seo-1' })
		prisma.seoSetting.update.mockResolvedValue({ id: 'seo-1' })

		await repository.update('seo-1', 'catalog-1', {
			title: 'Store',
			ogMedia: { connect: { id: 'media-1' } },
			twitterMedia: { connect: { id: 'media-2' } }
		} as any)

		expect(prisma.seoSetting.findFirst).toHaveBeenCalledWith({
			where: {
				id: 'seo-1',
				catalogId: 'catalog-1',
				deleteAt: null
			},
			select: { id: true }
		})
		expect(prisma.seoSetting.update).toHaveBeenCalledWith({
			where: { id: 'seo-1' },
			data: {
				title: 'Store',
				ogMedia: { connect: { id: 'media-1' } },
				twitterMedia: { connect: { id: 'media-2' } }
			},
			select: expect.any(Object)
		})
	})

	it('returns null when seo entry is not active in catalog', async () => {
		prisma.seoSetting.findFirst.mockResolvedValueOnce(null)

		const result = await repository.update('seo-1', 'catalog-1', {
			title: 'Store'
		} as any)

		expect(result).toBeNull()
		expect(prisma.seoSetting.update).not.toHaveBeenCalled()
	})
})

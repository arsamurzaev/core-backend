import { RequestContext } from '@/shared/tenancy/request-context'

import { BrandService } from './brand.service'

const runWithChildCatalog = <T>(fn: () => Promise<T>) =>
	RequestContext.run(
		{
			requestId: 'test',
			host: 'child.catalog.test',
			catalogId: 'child-catalog-1',
			parentId: 'catalog-1'
		},
		fn
	)

describe('BrandService', () => {
	let service: BrandService
	let repo: {
		create: jest.Mock
		existsSlug: jest.Mock
		findAll: jest.Mock
		findById: jest.Mock
		softDelete: jest.Mock
		update: jest.Mock
	}

	beforeEach(() => {
		repo = {
			create: jest.fn(),
			existsSlug: jest.fn(),
			findAll: jest.fn(),
			findById: jest.fn(),
			softDelete: jest.fn(),
			update: jest.fn()
		}
		service = new BrandService(repo as never)
	})

	it('rejects brand creation from child catalog', async () => {
		await expect(
			runWithChildCatalog(() =>
				service.create({
					name: 'Child Brand',
					slug: 'child-brand'
				})
			)
		).rejects.toThrow(
			'Дочерний каталог не может управлять товарами, категориями, брендами и справочниками каталога'
		)

		expect(repo.create).not.toHaveBeenCalled()
	})
})

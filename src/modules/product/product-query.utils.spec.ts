import { parseProductInfiniteQuery } from './product-query.utils'

describe('product-query.utils', () => {
	it('parses productTypeId filter for infinite product query', () => {
		const parsed = parseProductInfiniteQuery(
			{
				productTypeId: ' product-type-1 ',
				limit: '2'
			},
			{
				defaultLimit: 24,
				maxLimit: 50
			}
		)

		expect(parsed).toEqual(
			expect.objectContaining({
				productTypeId: 'product-type-1',
				limit: 2
			})
		)
	})
})

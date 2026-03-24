import { MoySkladClient } from './moysklad.client'

describe('MoySkladClient', () => {
	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('formats updated filter using MoySklad date-time format instead of ISO', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			json: jest.fn().mockResolvedValue({
				rows: [],
				meta: {}
			})
		} as any)

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})

		await client.getAllProducts(new Date(2026, 2, 23, 17, 42, 58, 69))

		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.moysklad.ru/api/remap/1.2/entity/product?limit=1000&offset=0&expand=images,salePrices&filter=updated%3E2026-03-23%2017%3A42%3A58',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer token'
				})
			})
		)
	})
})

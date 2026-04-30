import { MoySkladClient } from './moysklad.client'

describe('MoySkladClient', () => {
	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('formats assortment updated filter using MoySklad date-time format instead of ISO', async () => {
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

		await client.getAllAssortment(new Date(2026, 2, 23, 17, 42, 58, 69))

		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.moysklad.ru/api/remap/1.2/entity/assortment?limit=1000&offset=0&expand=images,salePrices,productFolder&filter=updated%3E2026-03-23%2017%3A42%3A58',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer token'
				})
			})
		)
	})

	it('loads assortment item by externalCode', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			json: jest.fn().mockResolvedValue({
				rows: [
					{
						id: 'internal-1',
						externalCode: 'external-key-1',
						name: 'Product 1'
					}
				],
				meta: {}
			})
		} as any)

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})

		const item = await client.getAssortmentItemByExternalCode('external-key-1')

		expect(item.id).toBe('internal-1')
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.moysklad.ru/api/remap/1.2/entity/assortment?limit=1&filter=externalCode%3Dexternal-key-1&expand=images,salePrices,productFolder',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer token'
				})
			})
		)
	})
})

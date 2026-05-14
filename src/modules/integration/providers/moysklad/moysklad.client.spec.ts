import { MoySkladClient } from './moysklad.client'
import type { MoySkladVariant } from './moysklad.types'

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
			'https://api.moysklad.ru/api/remap/1.2/entity/assortment?limit=100&offset=0&expand=images,salePrices,productFolder&filter=updated%3E2026-03-23%2017%3A42%3A58',
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

	it('loads variants from entity variant with product expand', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			json: jest.fn().mockResolvedValue({
				rows: [
					{
						id: 'variant-1',
						name: 'Product 1 (Size M)',
						archived: false,
						updated: '2026-03-23 17:42:58',
						product: {
							meta: {
								href: 'https://api.moysklad.ru/api/remap/1.2/entity/product/product-1',
								type: 'product',
								mediaType: 'application/json'
							},
							id: 'product-1',
							name: 'Product 1'
						},
						characteristics: [
							{
								id: 'characteristic-1',
								name: 'Size',
								value: 'M'
							}
						]
					}
				],
				meta: {}
			})
		} as any)

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})

		const variants: MoySkladVariant[] = await client.getAllVariants(
			new Date(2026, 2, 23, 17, 42, 58, 69)
		)
		const variant: MoySkladVariant = variants[0]

		expect(variant.product.id).toBe('product-1')
		expect(variant.characteristics[0]?.value).toBe('M')
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.moysklad.ru/api/remap/1.2/entity/variant?limit=100&offset=0&expand=images,salePrices,product&filter=updated%3E2026-03-23%2017%3A42%3A58',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer token'
				})
			})
		)
	})

	it('loads variants by parent product id', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			json: jest.fn().mockResolvedValue({
				rows: [
					{
						id: 'variant-1',
						name: 'Product 1 (Size M)',
						archived: false,
						updated: '2026-03-23 17:42:58',
						product: {
							meta: {
								href: 'https://api.moysklad.ru/api/remap/1.2/entity/product/product-1',
								type: 'product',
								mediaType: 'application/json'
							},
							id: 'product-1',
							name: 'Product 1'
						},
						characteristics: [{ id: 'size', name: 'Size', value: 'M' }]
					}
				],
				meta: {}
			})
		} as any)

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})

		const variants = await client.getVariantsByProduct('product-1')

		expect(variants).toHaveLength(1)
		expect(variants[0]?.id).toBe('variant-1')
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.moysklad.ru/api/remap/1.2/entity/variant?limit=100&offset=0&expand=images,salePrices,product&filter=product%3Dhttps%3A%2F%2Fapi.moysklad.ru%2Fapi%2Fremap%2F1.2%2Fentity%2Fproduct%2Fproduct-1',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer token'
				})
			})
		)
	})

	it('loads variant by id with typed response', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			json: jest.fn().mockResolvedValue({
				id: 'variant-1',
				name: 'Product 1 (Size M)',
				archived: false,
				updated: '2026-03-23 17:42:58',
				product: {
					meta: {
						href: 'https://api.moysklad.ru/api/remap/1.2/entity/product/product-1',
						type: 'product',
						mediaType: 'application/json'
					},
					id: 'product-1',
					name: 'Product 1'
				},
				characteristics: [
					{
						id: 'characteristic-1',
						name: 'Size',
						value: 'M'
					}
				]
			})
		} as any)

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})

		const variant: MoySkladVariant = await client.getVariant('variant-1')

		expect(variant.id).toBe('variant-1')
		expect(variant.product.meta.type).toBe('product')
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.moysklad.ru/api/remap/1.2/entity/variant/variant-1?expand=images,salePrices,product',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer token'
				})
			})
		)
	})

	it('finds customer order by externalCode', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			json: jest.fn().mockResolvedValue({
				rows: [
					{
						id: 'order-1',
						externalCode: 'ctlg-order-local-1'
					}
				],
				meta: {}
			})
		} as any)

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})

		const order =
			await client.findCustomerOrderByExternalCode('ctlg-order-local-1')

		expect(order?.id).toBe('order-1')
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.moysklad.ru/api/remap/1.2/entity/customerorder?limit=1&filter=externalCode%3Dctlg-order-local-1',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer token'
				})
			})
		)
	})

	it('loads order export reference dictionaries', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockImplementation(async input => {
				const url = String(input)
				const name = url.includes('/entity/organization')
					? 'Organization 1'
					: url.includes('/entity/counterparty')
						? 'Counterparty 1'
						: 'Store 1'

				return {
					ok: true,
					status: 200,
					headers: new Headers(),
					json: jest.fn().mockResolvedValue({
						rows: [
							{
								id: `${name.toLowerCase().replaceAll(' ', '-')}-id`,
								name
							}
						],
						meta: {}
					})
				} as any
			})

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})

		const [organizations, counterparties, stores] = await Promise.all([
			client.getAllOrganizations(),
			client.getAllCounterparties(),
			client.getAllStores()
		])

		expect(organizations[0]?.name).toBe('Organization 1')
		expect(counterparties[0]?.name).toBe('Counterparty 1')
		expect(stores[0]?.name).toBe('Store 1')
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.moysklad.ru/api/remap/1.2/entity/organization?limit=100&offset=0',
			expect.any(Object)
		)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.moysklad.ru/api/remap/1.2/entity/counterparty?limit=100&offset=0',
			expect.any(Object)
		)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.moysklad.ru/api/remap/1.2/entity/store?limit=100&offset=0',
			expect.any(Object)
		)
	})

	it('creates customer order with JSON payload', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			json: jest.fn().mockResolvedValue({
				id: 'order-1',
				externalCode: 'ctlg-order-local-1'
			})
		} as any)

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})
		const payload = {
			externalCode: 'ctlg-order-local-1',
			organization: {
				meta: {
					href: 'https://api.moysklad.ru/api/remap/1.2/entity/organization/org-1',
					type: 'organization'
				}
			},
			agent: {
				meta: {
					href: 'https://api.moysklad.ru/api/remap/1.2/entity/counterparty/agent-1',
					type: 'counterparty'
				}
			},
			positions: []
		}

		const created = await client.createCustomerOrder(payload)

		expect(created.id).toBe('order-1')
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.moysklad.ru/api/remap/1.2/entity/customerorder',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify(payload),
				headers: expect.objectContaining({
					Authorization: 'Bearer token',
					'Content-Type': 'application/json'
				})
			})
		)
	})

	it('redacts token-like values from provider error responses', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue({
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			headers: new Headers(),
			text: jest
				.fn()
				.mockResolvedValue(
					'Authorization: Bearer moysklad-secret-token ' +
						'access_token=moysklad-secret-token ' +
						'{"token":"moysklad-secret-token"}'
				)
		} as any)

		const client = new MoySkladClient({
			token: 'moysklad-secret-token',
			maxRetries: 0
		})

		let message = ''
		try {
			await client.getAllAssortment()
		} catch (error) {
			message = (error as Error).message
		}

		expect(message).toContain('[redacted]')
		expect(message).not.toContain('moysklad-secret-token')
	})

	it('does not retry non-retryable provider validation errors', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			ok: false,
			status: 400,
			statusText: 'Bad Request',
			headers: new Headers(),
			text: jest.fn().mockResolvedValue(
				JSON.stringify({
					errors: [
						{
							error: 'Некорректный параметр',
							code: 1001,
							parameter: 'expand'
						}
					]
				})
			)
		} as any)

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 3,
			retryDelayMs: 1
		})

		await expect(client.getAllAssortment()).rejects.toThrow(
			'MoySklad API error 400: Некорректный параметр'
		)
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('throws a clear error for malformed list responses', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			json: jest.fn().mockResolvedValue({
				meta: {}
			})
		} as any)

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})

		await expect(client.getAllVariants()).rejects.toThrow(
			'Invalid MoySklad response for /entity/variant: rows must be an array'
		)
	})

	it('maps product and variant stock report rows by MoySklad id', async () => {
		jest.spyOn(global, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			json: jest.fn().mockResolvedValue({
				rows: [
					{
						meta: {
							href:
								'https://api.moysklad.ru/api/remap/1.2/entity/product/11111111-1111-1111-1111-111111111111',
							type: 'product'
						},
						stock: 5
					},
					{
						meta: {
							href:
								'https://api.moysklad.ru/api/remap/1.2/entity/variant/22222222-2222-2222-2222-222222222222',
							type: 'variant'
						},
						stock: 3
					}
				],
				meta: {}
			})
		} as any)

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})

		const stock = await client.getStockAll()

		expect(stock.get('11111111-1111-1111-1111-111111111111')).toBe(5)
		expect(stock.get('22222222-2222-2222-2222-222222222222')).toBe(3)
	})

	it('filters current stock by assortment id', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			json: jest.fn().mockResolvedValue([
				{
					assortmentId: 'assortment-1',
					stock: 6
				}
			])
		} as any)

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})

		const stock = await client.getStockAll({
			assortmentId: 'assortment-1'
		})

		expect(stock.get('assortment-1')).toBe(6)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.moysklad.ru/api/remap/1.2/report/stock/all/current?filter=assortmentId%3Dassortment-1',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer token'
				})
			})
		)
	})

	it('filters current stock by assortment and warehouse ids', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			json: jest.fn().mockResolvedValue([
				{
					assortmentId: 'assortment-1',
					storeId: 'warehouse-1',
					stock: 2
				},
				{
					assortmentId: 'assortment-1',
					storeId: 'warehouse-2',
					stock: 5
				},
				{
					assortmentId: 'assortment-2',
					storeId: 'warehouse-1',
					stock: 3
				}
			])
		} as any)

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})

		const stock = await client.getStockAll({
			assortmentId: ['assortment-1', 'assortment-2'],
			warehouseId: ['warehouse-1', 'warehouse-2']
		})

		expect(stock.get('assortment-1')).toBe(7)
		expect(stock.get('assortment-2')).toBe(3)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.moysklad.ru/api/remap/1.2/report/stock/bystore/current?filter=assortmentId%3Dassortment-1%2Cassortment-2%3BstoreId%3Dwarehouse-1%2Cwarehouse-2',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer token'
				})
			})
		)
	})

	it('loads stock from a MoySklad webhook reportUrl', async () => {
		const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
			ok: true,
			status: 200,
			headers: new Headers(),
			json: jest.fn().mockResolvedValue([
				{
					assortmentId: 'assortment-1',
					stock: 4
				}
			])
		} as any)

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})

		const stock = await client.getStockFromReportUrl(
			'https://api.moysklad.ru/api/remap/1.2/report/stock/all/current?filter=assortmentId%3Dassortment-1'
		)

		expect(stock.get('assortment-1')).toBe(4)
		expect(fetchMock).toHaveBeenCalledWith(
			'https://api.moysklad.ru/api/remap/1.2/report/stock/all/current?filter=assortmentId%3Dassortment-1',
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: 'Bearer token'
				})
			})
		)
	})

	it('rejects non-MoySklad webhook reportUrl values', async () => {
		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})

		await expect(
			client.getStockFromReportUrl(
				'https://evil.example.test/api/remap/1.2/report/stock/all/current'
			)
		).rejects.toThrow('MoySklad stock reportUrl host or path is not allowed')
	})

	it('creates and disables webhookstock entries', async () => {
		const fetchMock = jest
			.spyOn(global, 'fetch')
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers(),
				json: jest.fn().mockResolvedValue({
					id: 'webhook-1',
					accountId: 'account-1',
					enabled: true,
					reportType: 'all',
					stockType: 'stock',
					url: 'https://api.example.test/webhook'
				})
			} as any)
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				headers: new Headers(),
				json: jest.fn().mockResolvedValue({
					id: 'webhook-1',
					enabled: false,
					reportType: 'all',
					stockType: 'stock',
					url: 'https://api.example.test/webhook'
				})
			} as any)

		const client = new MoySkladClient({
			token: 'token',
			maxRetries: 0
		})

		await client.createWebhookStock({
			url: 'https://api.example.test/webhook',
			enabled: true,
			reportType: 'all',
			stockType: 'stock'
		})
		await client.disableWebhookStock('webhook-1')

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			'https://api.moysklad.ru/api/remap/1.2/entity/webhookstock',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify({
					url: 'https://api.example.test/webhook',
					enabled: true,
					reportType: 'all',
					stockType: 'stock'
				})
			})
		)
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			'https://api.moysklad.ru/api/remap/1.2/entity/webhookstock/webhook-1',
			expect.objectContaining({
				method: 'PUT',
				body: JSON.stringify({ enabled: false })
			})
		)
	})
})

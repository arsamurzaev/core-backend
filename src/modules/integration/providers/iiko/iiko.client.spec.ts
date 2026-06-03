import { IikoClient } from './iiko.client'

describe('IikoClient', () => {
	const originalFetch = global.fetch
	let fetchMock: jest.Mock

	beforeEach(() => {
		fetchMock = jest.fn()
		global.fetch = fetchMock as unknown as typeof fetch
	})

	afterEach(() => {
		global.fetch = originalFetch
		jest.restoreAllMocks()
	})

	it('gets organizations with a cached access token', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ token: 'token-1' }))
			.mockResolvedValueOnce(
				jsonResponse({
					organizations: [{ id: 'org-1', name: 'Demo', isActive: true }]
				})
			)
			.mockResolvedValueOnce(jsonResponse({ organizations: [] }))

		const client = new IikoClient({
			apiLogin: 'login',
			baseUrl: 'https://iiko.example'
		})

		await client.getOrganizations()
		await client.getOrganizations()

		expect(fetchMock).toHaveBeenCalledTimes(3)
		expect(fetchMock.mock.calls[0][0]).toBe(
			'https://iiko.example/api/1/access_token'
		)
		expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
			'Bearer token-1'
		)
		expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe(
			'Bearer token-1'
		)
	})

	it('gets access token with v2 application credentials', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ token: 'token-1' }))
			.mockResolvedValueOnce(jsonResponse({ organizations: [] }))

		const client = new IikoClient({
			apiLogin: 'login',
			appId: '15',
			clientSecret: 'secret-1',
			baseUrl: 'https://iiko.example'
		})

		await client.getOrganizations()

		expect(fetchMock.mock.calls[0][0]).toBe(
			'https://iiko.example/api/v2/access_token'
		)
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
			apiKey: 'login',
			appId: '15',
			clientSecret: 'secret-1'
		})
		expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
			'Bearer token-1'
		)
	})

	it('refreshes token once after 401', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ token: 'token-1' }))
			.mockResolvedValueOnce(jsonResponse({ message: 'expired' }, 401))
			.mockResolvedValueOnce(jsonResponse({ token: 'token-2' }))
			.mockResolvedValueOnce(
				jsonResponse({
					id: 81651,
					itemGroups: [],
					comboCategories: [],
					revision: 1
				})
			)

		const client = new IikoClient({
			apiLogin: 'login',
			baseUrl: 'https://iiko.example'
		})

		const result = await client.getExternalMenuById({
			externalMenuId: '81651',
			organizationIds: ['org-1'],
			priceCategoryId: 'price-1',
			version: 4
		})

		expect(result.revision).toBe(1)
		expect(fetchMock).toHaveBeenCalledTimes(4)
		expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({
			externalMenuId: '81651',
			organizationIds: ['org-1'],
			priceCategoryId: 'price-1',
			version: 4,
			language: null,
			startRevision: null
		})
		expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe(
			'Bearer token-2'
		)
	})

	it('gets external menus and price categories', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ token: 'token-1' }))
			.mockResolvedValueOnce(
				jsonResponse({
					externalMenus: [{ id: '81651', name: 'Main menu' }],
					priceCategories: [{ id: 'price-1', name: 'Base' }]
				})
			)

		const client = new IikoClient({
			apiLogin: 'login',
			baseUrl: 'https://iiko.example'
		})

		const result = await client.getMenus()

		expect(result.externalMenus?.[0]?.id).toBe('81651')
		expect(result.priceCategories?.[0]?.id).toBe('price-1')
		expect(fetchMock.mock.calls[1][0]).toBe('https://iiko.example/api/2/menu')
	})

	it('gets organization address format settings', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ token: 'token-1' }))
			.mockResolvedValueOnce(
				jsonResponse({
					organizations: [{ id: 'org-1', addressFormatType: 'City' }]
				})
			)

		const client = new IikoClient({
			apiLogin: 'login',
			baseUrl: 'https://iiko.example'
		})

		const result = await client.getOrganizationSettings({
			organizationIds: ['org-1'],
			parameters: ['AddressFormatType']
		})

		expect(result.organizations[0]?.addressFormatType).toBe('City')
		expect(fetchMock.mock.calls[1][0]).toBe(
			'https://iiko.example/api/1/organizations/settings'
		)
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
			organizationIds: ['org-1'],
			includeDisabled: false,
			parameters: ['AddressFormatType'],
			returnExternalData: null
		})
	})

	it('requests restaurant address with default organization settings', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ token: 'token-1' }))
			.mockResolvedValueOnce(
				jsonResponse({
					organizations: [
						{
							id: 'org-1',
							addressFormatType: 'Legacy',
							restaurantAddress: 'Moscow, Main street, 1'
						}
					]
				})
			)

		const client = new IikoClient({
			apiLogin: 'login',
			baseUrl: 'https://iiko.example'
		})

		await client.getOrganizationSettings({ organizationIds: ['org-1'] })

		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
			organizationIds: ['org-1'],
			includeDisabled: false,
			parameters: ['AddressFormatType', 'RestaurantAddress'],
			returnExternalData: null
		})
	})

	it('gets terminal groups and stop lists', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ token: 'token-1' }))
			.mockResolvedValueOnce(
				jsonResponse({
					terminalGroups: [
						{
							organizationId: 'org-1',
							items: [{ id: 'terminal-1', name: 'Main' }]
						}
					]
				})
			)
			.mockResolvedValueOnce(
				jsonResponse({
					isAliveStatus: [
						{
							organizationId: 'org-1',
							terminalGroupId: 'terminal-1',
							isAlive: true
						}
					]
				})
			)
			.mockResolvedValueOnce(
				jsonResponse({
					terminalGroupStopLists: [
						{
							terminalGroupId: 'terminal-1',
							items: [{ productId: 'product-1', sizeId: null, balance: 0 }]
						}
					]
				})
			)

		const client = new IikoClient({
			apiLogin: 'login',
			baseUrl: 'https://iiko.example'
		})

		await client.getTerminalGroups(['org-1'])
		await client.getTerminalGroupsIsAlive({
			organizationIds: ['org-1'],
			terminalGroupIds: ['terminal-1']
		})
		await client.getStopLists({
			organizationIds: ['org-1'],
			terminalGroupIds: ['terminal-1']
		})

		expect(fetchMock.mock.calls[1][0]).toBe(
			'https://iiko.example/api/1/terminal_groups'
		)
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
			organizationIds: ['org-1'],
			includeDisabled: true
		})
		expect(fetchMock.mock.calls[2][0]).toBe(
			'https://iiko.example/api/1/terminal_groups/is_alive'
		)
		expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
			organizationIds: ['org-1'],
			terminalGroupIds: ['terminal-1']
		})
		expect(fetchMock.mock.calls[3][0]).toBe(
			'https://iiko.example/api/1/stop_lists'
		)
		expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({
			organizationIds: ['org-1'],
			returnSize: true,
			terminalGroupsIds: ['terminal-1']
		})
	})

	it('gets restaurant sections with tables', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ token: 'token-1' }))
			.mockResolvedValueOnce(
				jsonResponse({
					restaurantSections: [
						{
							id: 'section-1',
							name: 'Hall',
							terminalGroupId: 'terminal-1',
							tables: [{ id: 'table-1', number: 11, name: 'Стол 11' }]
						}
					],
					revision: 10
				})
			)

		const client = new IikoClient({
			apiLogin: 'login',
			baseUrl: 'https://iiko.example'
		})

		const result = await client.getRestaurantSections({
			terminalGroupIds: ['terminal-1']
		})

		expect(result.restaurantSections?.[0]?.tables?.[0]?.number).toBe(11)
		expect(fetchMock.mock.calls[1][0]).toBe(
			'https://iiko.example/api/1/reserve/available_restaurant_sections'
		)
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
			terminalGroupIds: ['terminal-1'],
			returnSchema: false,
			revision: null
		})
	})

	it('creates delivery orders and reads command status', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ token: 'token-1' }))
			.mockResolvedValueOnce(
				jsonResponse({
					correlationId: 'corr-1',
					orderInfo: {
						id: 'iiko-order-1',
						organizationId: 'org-1',
						timestamp: 1,
						creationStatus: 'InProgress'
					}
				})
			)
			.mockResolvedValueOnce(jsonResponse({ state: 'Success' }))

		const client = new IikoClient({
			apiLogin: 'login',
			baseUrl: 'https://iiko.example'
		})

		const created = await client.createDeliveryOrder({
			organizationId: 'org-1',
			terminalGroupId: 'terminal-1',
			order: {
				id: 'order-1',
				phone: '+79990000000',
				orderServiceType: 'DeliveryByClient',
				items: [
					{
						type: 'Product',
						productId: 'product-1',
						amount: 1,
						price: 490
					}
				]
			}
		})
		const status = await client.getCommandStatus({
			organizationId: 'org-1',
			correlationId: 'corr-1'
		})

		expect(created.correlationId).toBe('corr-1')
		expect(status.state).toBe('Success')
		expect(fetchMock.mock.calls[1][0]).toBe(
			'https://iiko.example/api/1/deliveries/create'
		)
		expect(fetchMock.mock.calls[2][0]).toBe(
			'https://iiko.example/api/1/commands/status'
		)
		expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
			organizationId: 'org-1',
			correlationId: 'corr-1'
		})
	})

	it('creates table orders', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ token: 'token-1' }))
			.mockResolvedValueOnce(
				jsonResponse({
					correlationId: 'corr-1',
					orderInfo: {
						id: 'iiko-order-1',
						organizationId: 'org-1',
						timestamp: 1,
						creationStatus: 'InProgress'
					}
				})
			)

		const client = new IikoClient({
			apiLogin: 'login',
			baseUrl: 'https://iiko.example'
		})

		const created = await client.createTableOrder({
			organizationId: 'org-1',
			terminalGroupId: 'terminal-1',
			order: {
				id: 'order-1',
				tableIds: ['table-1'],
				items: [
					{
						type: 'Product',
						productId: 'product-1',
						amount: 1,
						price: 490
					}
				]
			}
		})

		expect(created.correlationId).toBe('corr-1')
		expect(fetchMock.mock.calls[1][0]).toBe(
			'https://iiko.example/api/1/order/create'
		)
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
			organizationId: 'org-1',
			terminalGroupId: 'terminal-1',
			order: {
				id: 'order-1',
				tableIds: ['table-1'],
				items: [
					{
						type: 'Product',
						productId: 'product-1',
						amount: 1,
						price: 490
					}
				]
			}
		})
	})

	it('creates reserve preorder orders', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ token: 'token-1' }))
			.mockResolvedValueOnce(
				jsonResponse({
					correlationId: 'corr-1',
					reserveInfo: {
						id: 'reserve-1',
						organizationId: 'org-1',
						timestamp: 1,
						creationStatus: 'InProgress',
						isDeleted: false
					}
				})
			)

		const client = new IikoClient({
			apiLogin: 'login',
			baseUrl: 'https://iiko.example'
		})

		const created = await client.createReserve({
			organizationId: 'org-1',
			terminalGroupId: 'terminal-1',
			id: 'order-1',
			externalNumber: 'ctlg-order-1',
			customer: {
				type: 'regular',
				name: 'Ivan'
			},
			phone: '+79990000000',
			durationInMinutes: 120,
			shouldRemind: true,
			tableIds: ['table-1'],
			estimatedStartTime: '2026-05-26 19:30:00.000',
			order: {
				items: [
					{
						type: 'Product',
						productId: 'product-1',
						amount: 1,
						price: 490
					}
				]
			}
		})

		expect(created.correlationId).toBe('corr-1')
		expect(fetchMock.mock.calls[1][0]).toBe(
			'https://iiko.example/api/1/reserve/create'
		)
		expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
			organizationId: 'org-1',
			terminalGroupId: 'terminal-1',
			id: 'order-1',
			externalNumber: 'ctlg-order-1',
			customer: {
				type: 'regular',
				name: 'Ivan'
			},
			phone: '+79990000000',
			durationInMinutes: 120,
			shouldRemind: true,
			tableIds: ['table-1'],
			estimatedStartTime: '2026-05-26 19:30:00.000',
			order: {
				items: [
					{
						type: 'Product',
						productId: 'product-1',
						amount: 1,
						price: 490
					}
				]
			}
		})
	})

	it('gets and updates webhook settings', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse({ token: 'token-1' }))
			.mockResolvedValueOnce(
				jsonResponse({
					apiLoginName: 'demo',
					webHooksUri: 'https://app.example/webhook'
				})
			)
			.mockResolvedValueOnce(jsonResponse({ correlationId: 'corr-1' }))

		const client = new IikoClient({
			apiLogin: 'login',
			baseUrl: 'https://iiko.example'
		})

		const settings = await client.getWebhookSettings('org-1')
		const updated = await client.updateWebhookSettings({
			organizationId: 'org-1',
			webHooksUri: 'https://app.example/webhook',
			authToken: 'secret',
			webHooksFilter: {
				stopListUpdateFilter: { updates: true },
				nomenclatureUpdateFilter: { updates: true }
			}
		})

		expect(settings.webHooksUri).toBe('https://app.example/webhook')
		expect(updated.correlationId).toBe('corr-1')
		expect(fetchMock.mock.calls[1][0]).toBe(
			'https://iiko.example/api/1/webhooks/settings'
		)
		expect(fetchMock.mock.calls[2][0]).toBe(
			'https://iiko.example/api/1/webhooks/update_settings'
		)
		expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
			organizationId: 'org-1',
			webHooksUri: 'https://app.example/webhook',
			authToken: 'secret',
			webHooksFilter: {
				stopListUpdateFilter: { updates: true },
				nomenclatureUpdateFilter: { updates: true }
			}
		})
	})
})

function jsonResponse(body: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
		headers: {
			get: jest.fn()
		},
		text: jest.fn().mockResolvedValue(JSON.stringify(body))
	}
}

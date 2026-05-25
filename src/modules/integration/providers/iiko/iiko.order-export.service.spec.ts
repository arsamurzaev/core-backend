import {
	CartCheckoutMethod,
	IntegrationProvider,
	OrderStatus
} from '@generated/enums'
import { ConfigService } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'

import { CapabilityService } from '@/modules/capability/capability.service'
import { CAPABILITY_ASSERT_PORT } from '@/modules/capability/contracts'

import { IntegrationRepository } from '../../integration.repository'

import { IikoClient } from './iiko.client'
import { IikoMetadataCryptoService } from './iiko.metadata'
import {
	IikoOrderExportService,
	NonRetryableIikoOrderExportError
} from './iiko.order-export.service'

describe('IikoOrderExportService', () => {
	let service: IikoOrderExportService
	let repo: jest.Mocked<IntegrationRepository>

	const exportRecord = {
		id: 'export-1',
		integrationId: 'integration-1',
		orderId: '11111111-1111-1111-1111-111111111111',
		provider: IntegrationProvider.IIKO,
		idempotencyKey: 'IIKO:integration-1:11111111-1111-1111-1111-111111111111',
		externalId: null,
		status: 'PENDING',
		attempts: 0,
		lastError: null,
		payload: null,
		response: null,
		requestedAt: new Date('2026-05-21T09:10:00.000Z'),
		startedAt: null,
		exportedAt: null,
		createdAt: new Date('2026-05-21T09:10:00.000Z'),
		updatedAt: new Date('2026-05-21T09:10:00.000Z')
	}

	const integration = {
		id: 'integration-1',
		catalogId: 'catalog-1',
		provider: IntegrationProvider.IIKO,
		metadata: {},
		isActive: true
	}

	const order = {
		id: '11111111-1111-1111-1111-111111111111',
		catalogId: 'catalog-1',
		status: OrderStatus.COMPLETED,
		comment: 'No onion',
		address: 'Main street, 1',
		isDelivery: false,
		checkoutMethod: CartCheckoutMethod.PICKUP,
		checkoutData: { customerName: 'Ivan' },
		checkoutContacts: { PHONE: '+7 (999) 000-00-00' },
		totalAmount: 980,
		createdAt: new Date('2026-05-21T09:10:00.000Z'),
		updatedAt: new Date('2026-05-21T09:10:00.000Z'),
		products: [
			{
				id: 'cart-item-1',
				productId: 'product-1',
				variantId: 'variant-1',
				quantity: 2,
				unitPrice: 490,
				lineTotal: 980,
				externalVariants: [
					{
						integrationId: 'integration-1',
						provider: 'IIKO',
						externalId: 'iiko-product-1:size-small',
						externalCode: null,
						lastSyncedAt: null,
						assortmentRef: null
					}
				],
				product: {
					id: 'product-1',
					name: 'Pizza',
					slug: 'pizza'
				}
			}
		]
	}

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				IikoOrderExportService,
				{
					provide: IntegrationRepository,
					useValue: {
						findOrderForExport: jest.fn(),
						findIiko: jest.fn(),
						setOrderExportPayload: jest.fn(),
						findVariantLinkByVariantId: jest.fn(),
						findProductLinkByProductId: jest.fn()
					}
				},
				{
					provide: IikoMetadataCryptoService,
					useValue: {
						parseStoredMetadata: jest.fn().mockReturnValue({
							apiLogin: 'login',
							organizationId: 'org-1',
							organizationName: 'Demo',
							externalMenuId: '81651',
							externalMenuName: 'Main menu',
							priceCategoryId: 'price-1',
							priceCategoryName: 'Base',
							terminalGroupId: 'terminal-1',
							terminalGroupName: 'Main',
							menuVersion: 4,
							syncSource: 'external_menu',
							importImages: true,
							exportOrders: true,
							orderExportServiceType: null,
							orderExportSourceKey: 'catalog-api',
							lastRevision: null,
							lastMenuSyncedAt: null,
							lastStopListSyncedAt: null
						})
					}
				},
				{
					provide: ConfigService,
					useValue: {
						get: jest.fn((key: string) => {
							if (key === 'integration') {
								return {
									iikoApiBaseUrl: 'https://iiko.example',
									iikoCommandStatusMaxAttempts: 3,
									iikoCommandStatusPollIntervalMs: 0
								}
							}
							return undefined
						})
					}
				},
				{
					provide: CapabilityService,
					useValue: {
						assertCanUseIikoIntegration: jest.fn().mockResolvedValue(undefined)
					}
				},
				{
					provide: CAPABILITY_ASSERT_PORT,
					useExisting: CapabilityService
				}
			]
		}).compile()

		service = module.get(IikoOrderExportService)
		repo = module.get(IntegrationRepository)

		repo.findOrderForExport.mockResolvedValue(order as any)
		repo.findIiko.mockResolvedValue(integration as any)
		repo.setOrderExportPayload.mockResolvedValue(exportRecord as any)
		repo.findVariantLinkByVariantId.mockResolvedValue(null)
		repo.findProductLinkByProductId.mockResolvedValue(null)

		jest.spyOn(IikoClient.prototype, 'createDeliveryOrder').mockResolvedValue({
			correlationId: 'corr-1',
			orderInfo: {
				id: 'iiko-order-1',
				organizationId: 'org-1',
				timestamp: 1,
				creationStatus: 'InProgress'
			}
		})
		jest.spyOn(IikoClient.prototype, 'createTableOrder').mockResolvedValue({
			correlationId: 'table-corr-1',
			orderInfo: {
				id: 'iiko-table-order-1',
				organizationId: 'org-1',
				timestamp: 1,
				creationStatus: 'InProgress'
			}
		})
		jest
			.spyOn(IikoClient.prototype, 'getOrganizationSettings')
			.mockResolvedValue({
				correlationId: 'settings-corr-1',
				organizations: [
					{
						id: 'org-1',
						addressFormatType: 'City',
						restaurantAddress: 'Moscow, Main street, 1'
					}
				]
			})
		jest
			.spyOn(IikoClient.prototype, 'getCommandStatus')
			.mockResolvedValue({ state: 'Success' })
	})

	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('builds iiko delivery payload from a completed admin order', async () => {
		const result = await service.exportOrder(exportRecord as any)
		const payload = repo.setOrderExportPayload.mock.calls[0]?.[1] as any

		expect(payload).toEqual(
			expect.objectContaining({
				organizationId: 'org-1',
				terminalGroupId: 'terminal-1',
				createOrderSettings: {
					transportToFrontTimeout: 8,
					checkStopList: true
				}
			})
		)
		expect(payload.order).toEqual(
			expect.objectContaining({
				id: '11111111-1111-1111-1111-111111111111',
				externalNumber: 'ctlg-11111111-1111-1111-1111-111111111111',
				phone: '+79990000000',
				orderServiceType: 'DeliveryByClient',
				menuId: '81651',
				priceCategoryId: 'price-1',
				sourceKey: 'catalog-api',
				customer: { type: 'one-time', name: 'Ivan' }
			})
		)
		expect(payload.order.items).toEqual([
			{
				type: 'Product',
				productId: 'iiko-product-1',
				productSizeId: 'size-small',
				amount: 2,
				price: 490
			}
		])
		expect(IikoClient.prototype.createDeliveryOrder).toHaveBeenCalledWith(payload)
		expect(IikoClient.prototype.getCommandStatus).toHaveBeenCalledWith({
			organizationId: 'org-1',
			correlationId: 'corr-1'
		})
		expect(result).toEqual(
			expect.objectContaining({
				externalId: 'iiko-order-1',
				correlationId: 'corr-1',
				created: true
			})
		)
	})

	it('prefers customer checkout phone over catalog contact phone', async () => {
		repo.findOrderForExport.mockResolvedValueOnce({
			...order,
			checkoutData: {
				customerName: 'Ivan',
				phone: '+7 (988) 111-22-33'
			},
			checkoutContacts: { PHONE: '+7 (999) 000-00-00' }
		} as any)

		await service.exportOrder(exportRecord as any)
		const payload = repo.setOrderExportPayload.mock.calls[0]?.[1] as any

		expect(payload.order.phone).toBe('+79881112233')
	})

	it('waits until iiko command status is final before marking export successful', async () => {
		jest
			.spyOn(IikoClient.prototype, 'getCommandStatus')
			.mockResolvedValueOnce({ state: 'InProgress' })
			.mockResolvedValueOnce({ state: 'Success' })

		const result = await service.exportOrder(exportRecord as any)

		expect(IikoClient.prototype.getCommandStatus).toHaveBeenCalledTimes(2)
		expect(result.response.commandStatus).toEqual({ state: 'Success' })
	})

	it('does not mark export successful when iiko command stays in progress', async () => {
		jest
			.spyOn(IikoClient.prototype, 'getCommandStatus')
			.mockResolvedValue({ state: 'InProgress' })

		await expect(service.exportOrder(exportRecord as any)).rejects.toThrow(
			/iiko command corr-1 did not finish/
		)
		expect(IikoClient.prototype.getCommandStatus).toHaveBeenCalledTimes(3)
	})

	it('adds city delivery point for courier delivery', async () => {
		repo.findOrderForExport.mockResolvedValueOnce({
			...order,
			address: 'Client street, 2',
			checkoutMethod: CartCheckoutMethod.DELIVERY,
			checkoutData: {
				address: 'Client street, 2',
				customerName: 'Ivan',
				phone: '+7 (988) 111-22-33'
			},
			isDelivery: true
		} as any)

		await service.exportOrder(exportRecord as any)
		const payload = repo.setOrderExportPayload.mock.calls[0]?.[1] as any

		expect(payload.order.orderServiceType).toBe('DeliveryByCourier')
		expect(payload.order.deliveryPoint).toEqual({
			address: {
				type: 'city',
				line1: 'Client street, 2'
			},
			comment: 'Client street, 2'
		})
	})

	it('adds legacy delivery point when iiko organization uses legacy addresses', async () => {
		jest
			.spyOn(IikoClient.prototype, 'getOrganizationSettings')
			.mockResolvedValueOnce({
				correlationId: 'settings-corr-1',
				organizations: [
					{
						id: 'org-1',
						addressFormatType: 'Legacy',
						restaurantAddress: 'Moscow, Main street, 1'
					}
				]
			})
		repo.findOrderForExport.mockResolvedValueOnce({
			...order,
			address: 'Moscow, Client street, 2',
			checkoutMethod: CartCheckoutMethod.DELIVERY,
			checkoutData: {
				address: 'Moscow, Client street, 2',
				customerName: 'Ivan',
				phone: '+7 (988) 111-22-33'
			},
			isDelivery: true
		} as any)

		await service.exportOrder(exportRecord as any)
		const payload = repo.setOrderExportPayload.mock.calls[0]?.[1] as any

		expect(payload.order.deliveryPoint).toEqual({
			address: {
				type: 'legacy',
				street: {
					name: 'Client street',
					city: 'Moscow'
				},
				house: '2'
			},
			comment: 'Moscow, Client street, 2'
		})
	})

	it('uses organization restaurant city for short legacy delivery address', async () => {
		jest
			.spyOn(IikoClient.prototype, 'getOrganizationSettings')
			.mockResolvedValueOnce({
				correlationId: 'settings-corr-1',
				organizations: [
					{
						id: 'org-1',
						addressFormatType: 'Legacy',
						restaurantAddress: 'Moscow, Main street, 1'
					}
				]
			})
		repo.findOrderForExport.mockResolvedValueOnce({
			...order,
			address: 'Client street, 2',
			checkoutMethod: CartCheckoutMethod.DELIVERY,
			checkoutData: {
				address: 'Client street, 2',
				customerName: 'Ivan',
				phone: '+7 (988) 111-22-33'
			},
			isDelivery: true
		} as any)

		await service.exportOrder(exportRecord as any)
		const payload = repo.setOrderExportPayload.mock.calls[0]?.[1] as any

		expect(payload.order.deliveryPoint).toEqual({
			address: {
				type: 'legacy',
				street: {
					name: 'Client street',
					city: 'Moscow'
				},
				house: '2'
			},
			comment: 'Client street, 2'
		})
	})

	it('lets iiko validate legacy street without city when no fallback city exists', async () => {
		jest
			.spyOn(IikoClient.prototype, 'getOrganizationSettings')
			.mockResolvedValueOnce({
				correlationId: 'settings-corr-1',
				organizations: [{ id: 'org-1', addressFormatType: 'Legacy' }]
			})
		repo.findOrderForExport.mockResolvedValueOnce({
			...order,
			address: 'Client street, 2',
			checkoutMethod: CartCheckoutMethod.DELIVERY,
			checkoutData: {
				address: 'Client street, 2',
				customerName: 'Ivan',
				phone: '+7 (988) 111-22-33'
			},
			isDelivery: true
		} as any)

		await service.exportOrder(exportRecord as any)
		const payload = repo.setOrderExportPayload.mock.calls[0]?.[1] as any

		expect(payload.order.deliveryPoint).toEqual({
			address: {
				type: 'legacy',
				street: {
					name: 'Client street'
				},
				house: '2'
			},
			comment: 'Client street, 2'
		})
	})

	it('does not call iiko when courier delivery has no delivery point', async () => {
		repo.findOrderForExport.mockResolvedValueOnce({
			...order,
			address: null,
			checkoutMethod: CartCheckoutMethod.DELIVERY,
			checkoutData: {
				customerName: 'Ivan',
				phone: '+7 (988) 111-22-33'
			},
			isDelivery: true
		} as any)

		await expect(service.exportOrder(exportRecord as any)).rejects.toThrow(
			NonRetryableIikoOrderExportError
		)
		expect(IikoClient.prototype.createDeliveryOrder).not.toHaveBeenCalled()
	})

	it('creates iiko table order for QR hall checkout', async () => {
		repo.findOrderForExport.mockResolvedValueOnce({
			...order,
			address: null,
			checkoutData: {
				orderMode: 'HALL',
				iikoTableId: 'table-1',
				hallTableNumber: '11',
				hallTableName: 'Стол 11',
				personsCount: 2,
				customerName: 'Ivan'
			},
			checkoutContacts: null
		} as any)

		const result = await service.exportOrder(exportRecord as any)
		const payload = repo.setOrderExportPayload.mock.calls[0]?.[1] as any

		expect(payload).toEqual(
			expect.objectContaining({
				organizationId: 'org-1',
				terminalGroupId: 'terminal-1',
				createOrderSettings: {
					servicePrint: false,
					transportToFrontTimeout: 8,
					checkStopList: true
				}
			})
		)
		expect(payload.order).toEqual(
			expect.objectContaining({
				id: '11111111-1111-1111-1111-111111111111',
				externalNumber: 'ctlg-11111111-1111-1111-1111-111111111111',
				tableIds: ['table-1'],
				guests: { count: 2 },
				menuId: '81651',
				priceCategoryId: 'price-1',
				sourceKey: 'catalog-api'
			})
		)
		expect(payload.order.tabName).toBeUndefined()
		expect(payload.order.phone).toBeUndefined()
		expect(payload.order.externalData).toEqual(
			expect.arrayContaining([
				{ key: 'catalogOrderId', value: order.id, isPublic: false },
				{ key: 'catalogMode', value: 'HALL', isPublic: false },
				{ key: 'iikoTableId', value: 'table-1', isPublic: false },
				{ key: 'customerName', value: 'Ivan', isPublic: false }
			])
		)
		expect(payload.order.externalData).not.toEqual(
			expect.arrayContaining([
				{ key: 'hallTableNumber', value: '11', isPublic: false }
			])
		)
		expect(IikoClient.prototype.createTableOrder).toHaveBeenCalledWith(payload)
		expect(IikoClient.prototype.createDeliveryOrder).not.toHaveBeenCalled()
		expect(IikoClient.prototype.getOrganizationSettings).not.toHaveBeenCalled()
		expect(result).toEqual(
			expect.objectContaining({
				externalId: 'iiko-table-order-1',
				correlationId: 'table-corr-1',
				created: true
			})
		)
	})

	it('does not export orders without a phone', async () => {
		repo.findOrderForExport.mockResolvedValueOnce({
			...order,
			checkoutContacts: null
		} as any)

		await expect(service.exportOrder(exportRecord as any)).rejects.toThrow(
			NonRetryableIikoOrderExportError
		)
		expect(IikoClient.prototype.createDeliveryOrder).not.toHaveBeenCalled()
	})
})

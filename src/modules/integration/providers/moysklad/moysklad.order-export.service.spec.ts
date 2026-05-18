import { IntegrationProvider, OrderStatus } from '@generated/enums'
import { Test, TestingModule } from '@nestjs/testing'

import { CapabilityService } from '@/modules/capability/capability.service'
import { CAPABILITY_ASSERT_PORT } from '@/modules/capability/contracts'

import { IntegrationRepository } from '../../integration.repository'

import { MoySkladClient } from './moysklad.client'
import { MoySkladMetadataCryptoService } from './moysklad.metadata'
import { MoySkladOrderExportService } from './moysklad.order-export.service'

describe('MoySkladOrderExportService', () => {
	let service: MoySkladOrderExportService
	let repo: jest.Mocked<IntegrationRepository>
	let metadataCrypto: jest.Mocked<MoySkladMetadataCryptoService>

	const exportRecord = {
		id: 'export-1',
		integrationId: 'integration-1',
		orderId: 'order-1',
		provider: IntegrationProvider.MOYSKLAD,
		idempotencyKey: 'MOYSKLAD:integration-1:order-1',
		externalId: null,
		status: 'PENDING',
		attempts: 0,
		lastError: null,
		payload: null,
		response: null,
		requestedAt: new Date('2026-03-25T09:10:00.000Z'),
		startedAt: null,
		exportedAt: null,
		createdAt: new Date('2026-03-25T09:10:00.000Z'),
		updatedAt: new Date('2026-03-25T09:10:00.000Z')
	}

	const integration = {
		id: 'integration-1',
		catalogId: 'catalog-1',
		provider: IntegrationProvider.MOYSKLAD,
		metadata: {},
		isActive: true
	}

	const order = {
		id: 'order-1',
		catalogId: 'catalog-1',
		status: OrderStatus.COMPLETED,
		comment: 'Call before delivery',
		address: 'Main street, 1',
		isDelivery: true,
		checkoutMethod: null,
		checkoutData: null,
		checkoutContacts: null,
		totalAmount: 2499,
		createdAt: new Date('2026-03-25T09:10:00.000Z'),
		updatedAt: new Date('2026-03-25T09:10:00.000Z'),
		products: [
			{
				id: 'cart-item-1',
				productId: 'product-1',
				variantId: 'variant-1',
				quantity: 1,
				unitPrice: 2499,
				lineTotal: 2499,
				product: {
					id: 'product-1',
					name: 'Product 1',
					slug: 'product-1'
				}
			}
		]
	}

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				MoySkladOrderExportService,
				{
					provide: IntegrationRepository,
					useValue: {
						findOrderForExport: jest.fn(),
						findMoySklad: jest.fn(),
						setOrderExportPayload: jest.fn(),
						findVariantLinkByVariantId: jest.fn(),
						findProductLinkByProductId: jest.fn()
					}
				},
				{
					provide: MoySkladMetadataCryptoService,
					useValue: {
						parseStoredMetadata: jest.fn().mockReturnValue({
							token: 'token',
							priceTypeName: 'Retail',
							importImages: true,
							syncStock: true,
							exportOrders: true,
							orderExportOrganizationId: 'organization-1',
							orderExportCounterpartyId: 'counterparty-1',
							orderExportStoreId: 'store-1',
							scheduleEnabled: false,
							schedulePattern: null,
							scheduleTimezone: 'Europe/Moscow'
						})
					}
				},
				{
					provide: CapabilityService,
					useValue: {
						assertCanUseMoySkladIntegration: jest.fn().mockResolvedValue(undefined)
					}
				},
				{
					provide: CAPABILITY_ASSERT_PORT,
					useExisting: CapabilityService
				}
			]
		}).compile()

		service = module.get(MoySkladOrderExportService)
		repo = module.get(IntegrationRepository)
		metadataCrypto = module.get(MoySkladMetadataCryptoService)

		repo.findOrderForExport.mockResolvedValue(order as any)
		repo.findMoySklad.mockResolvedValue(integration as any)
		repo.setOrderExportPayload.mockResolvedValue(exportRecord as any)
		repo.findVariantLinkByVariantId.mockResolvedValue({
			id: 'variant-link-1',
			integrationId: 'integration-1',
			variantId: 'variant-1',
			externalId: 'external-code-not-uuid',
			externalCode: 'MSK-XL',
			externalUpdatedAt: null,
			lastSyncedAt: new Date('2026-03-25T09:00:00.000Z'),
			rawMeta: {
				id: '11111111-1111-1111-1111-111111111111',
				type: 'variant'
			},
			createdAt: new Date('2026-03-25T09:00:00.000Z'),
			updatedAt: new Date('2026-03-25T09:00:00.000Z')
		} as any)
		repo.findProductLinkByProductId.mockResolvedValue(null)
		jest
			.spyOn(MoySkladClient.prototype, 'findCustomerOrderByExternalCode')
			.mockResolvedValue(null)
		jest
			.spyOn(MoySkladClient.prototype, 'createCustomerOrder')
			.mockResolvedValue({
				id: 'ms-order-1',
				externalCode: 'ctlg-order-order-1'
			})
	})

	afterEach(() => {
		jest.restoreAllMocks()
	})

	it('builds customerorder payload from order snapshot and raw MoySklad variant meta', async () => {
		const result = await service.exportOrder(exportRecord as any)
		const payload = repo.setOrderExportPayload.mock.calls[0]?.[1] as any

		expect(metadataCrypto.parseStoredMetadata).toHaveBeenCalledWith(
			integration.metadata
		)
		expect(payload).toEqual(
			expect.objectContaining({
				externalCode: 'ctlg-order-order-1',
				organization: expect.objectContaining({
					meta: expect.objectContaining({ type: 'organization' })
				}),
				agent: expect.objectContaining({
					meta: expect.objectContaining({ type: 'counterparty' })
				}),
				store: expect.objectContaining({
					meta: expect.objectContaining({ type: 'store' })
				})
			})
		)
		expect(payload.positions[0]).toEqual(
			expect.objectContaining({
				quantity: 1,
				price: 249900,
				assortment: {
					meta: expect.objectContaining({
						type: 'variant',
						href:
							'https://api.moysklad.ru/api/remap/1.2/entity/variant/11111111-1111-1111-1111-111111111111'
					})
				}
			})
		)
		expect(MoySkladClient.prototype.createCustomerOrder).toHaveBeenCalledWith(
			payload
		)
		expect(result).toEqual(
			expect.objectContaining({
				externalId: 'ms-order-1',
				created: true
			})
		)
	})

	it('exports sale unit orders in base quantity with recalculated unit price', async () => {
		repo.findOrderForExport.mockResolvedValueOnce({
			...order,
			products: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-1',
					saleUnitId: 'sale-unit-1',
					quantity: 2,
					baseQuantity: 24,
					unitPrice: 1200,
					lineTotal: 2400,
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1'
					}
				}
			]
		} as any)

		await service.exportOrder(exportRecord as any)
		const payload = repo.setOrderExportPayload.mock.calls[0]?.[1] as any

		expect(payload.positions[0]).toEqual(
			expect.objectContaining({
				quantity: 24,
				price: 10000
			})
		)
	})

	it('exports discounted final order snapshot price without MoySklad line discount', async () => {
		repo.findOrderForExport.mockResolvedValueOnce({
			...order,
			totalAmount: 1800,
			products: [
				{
					id: 'cart-item-1',
					productId: 'product-1',
					variantId: 'variant-1',
					quantity: 2,
					baseUnitPrice: 1000,
					unitPrice: 900,
					unitPriceSnapshot: 900,
					discountPercent: 10,
					hasDiscount: true,
					lineTotal: 1800,
					product: {
						id: 'product-1',
						name: 'Product 1',
						slug: 'product-1'
					}
				}
			]
		} as any)

		await service.exportOrder(exportRecord as any)
		const payload = repo.setOrderExportPayload.mock.calls[0]?.[1] as any

		expect(payload.positions[0]).toEqual(
			expect.objectContaining({
				quantity: 2,
				price: 90000,
				discount: 0
			})
		)
	})

	it('prefers assortment refs saved in the order snapshot over current links', async () => {
		repo.findOrderForExport.mockResolvedValueOnce({
			...order,
			products: [
				{
					...order.products[0],
					externalVariants: [
						{
							integrationId: 'integration-1',
							provider: IntegrationProvider.MOYSKLAD,
							externalId: 'snapshot-variant-code',
							externalCode: 'MS-SNAPSHOT',
							lastSyncedAt: '2026-03-25T08:05:00.000Z',
							assortmentRef: {
								id: '22222222-2222-2222-2222-222222222222',
								type: 'variant'
							}
						}
					],
					externalProducts: []
				}
			]
		} as any)

		await service.exportOrder(exportRecord as any)
		const payload = repo.setOrderExportPayload.mock.calls[0]?.[1] as any

		expect(repo.findVariantLinkByVariantId).not.toHaveBeenCalled()
		expect(repo.findProductLinkByProductId).not.toHaveBeenCalled()
		expect(payload.positions[0].assortment).toEqual({
			meta: expect.objectContaining({
				type: 'variant',
				href:
					'https://api.moysklad.ru/api/remap/1.2/entity/variant/22222222-2222-2222-2222-222222222222'
			})
		})
	})

	it('does not create a duplicate when MoySklad already has the externalCode', async () => {
		;(
			MoySkladClient.prototype.findCustomerOrderByExternalCode as jest.Mock
		).mockResolvedValueOnce({
			id: 'existing-ms-order',
			externalCode: 'ctlg-order-order-1'
		})

		const result = await service.exportOrder(exportRecord as any)

		expect(MoySkladClient.prototype.createCustomerOrder).not.toHaveBeenCalled()
		expect(result).toEqual(
			expect.objectContaining({
				externalId: 'existing-ms-order',
				created: false
			})
		)
	})
})

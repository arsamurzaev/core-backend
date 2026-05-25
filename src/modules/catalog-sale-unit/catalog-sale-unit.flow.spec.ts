import { BadRequestException } from '@nestjs/common'
import { ProductVariantKind, ProductVariantStatus } from '@generated/enums'

import { RequestContext } from '@/shared/tenancy/request-context'

import { CartLinePricingService } from '@/modules/cart/cart-line-pricing.service'
import { ProductReadService } from '@/modules/product/product-read.service'
import { ProductRepository } from '@/modules/product/product.repository'

import { CatalogSaleUnitService } from './catalog-sale-unit.service'

const runWithCatalog = <T>(fn: () => Promise<T>) =>
	RequestContext.run(
		{
			requestId: 'test',
			host: 'catalog.test',
			catalogId: 'catalog-1'
		},
		fn
	)

function createCatalogSaleUnit(overrides: Record<string, unknown> = {}) {
	return {
		id: 'catalog-sale-unit-box',
		catalogId: 'catalog-1',
		code: 'box',
		name: 'Box',
		defaultBaseQuantity: 12,
		barcode: null,
		isActive: true,
		displayOrder: 0,
		deleteAt: null,
		createdAt: new Date('2026-05-19T00:00:00.000Z'),
		updatedAt: new Date('2026-05-19T00:00:00.000Z'),
		...overrides
	}
}

function createCommercialProjection() {
	return {
		catalogId: 'catalog-1',
		productId: 'product-1',
		mode: 'SIMPLE' as const,
		variantId: 'default-variant',
		defaultVariantId: 'default-variant',
		requiresVariantSelection: false,
		priceState: 'KNOWN' as const,
		displayPrice: '1000.00',
		minPrice: '1000.00',
		maxPrice: '1000.00',
		availabilityState: 'AVAILABLE' as const,
		stock: 120
	}
}

describe('catalog sale unit product/cart flow', () => {
	it('covers admin unit creation, product binding, public read and cart default selection', async () => {
		const catalogSaleUnit = createCatalogSaleUnit()
		const catalogSaleUnitRepo = {
			findByCode: jest.fn().mockResolvedValue(null),
			create: jest.fn().mockResolvedValue(catalogSaleUnit),
			findAll: jest.fn(),
			findById: jest.fn(),
			existsCode: jest.fn(),
			update: jest.fn(),
			syncVariantSnapshots: jest.fn()
		}
		const cache = { bumpVersion: jest.fn() }
		const featureEntitlements = {
			assertCanUseCatalogSaleUnits: jest.fn().mockResolvedValue(undefined)
		}
		const catalogSaleUnitService = new CatalogSaleUnitService(
			catalogSaleUnitRepo as never,
			cache as never,
			featureEntitlements as never
		)

		const createdUnit = await runWithCatalog(() =>
			catalogSaleUnitService.create({
				name: 'Box',
				code: 'box',
				defaultBaseQuantity: 12
			})
		)

		expect(createdUnit).toEqual(catalogSaleUnit)
		expect(catalogSaleUnitRepo.create).toHaveBeenCalledWith(
			expect.objectContaining({
				catalogId: 'catalog-1',
				code: 'box',
				name: 'Box',
				defaultBaseQuantity: 12
			})
		)

		const productRepository = new ProductRepository({} as never)
		const productTx = {
			catalogSaleUnit: {
				findFirst: jest.fn().mockResolvedValue(catalogSaleUnit)
			}
		}
		const [binding] = await (productRepository as any).normalizeVariantSaleUnits(
			productTx,
			'catalog-1',
			[
				{
					catalogSaleUnitId: createdUnit.id,
					baseQuantity: 12,
					price: 1000,
					isDefault: true,
					displayOrder: 0
				}
			]
		)

		expect(binding).toEqual(
			expect.objectContaining({
				catalogSaleUnitId: 'catalog-sale-unit-box',
				code: 'box',
				name: 'Box',
				baseQuantity: 12,
				price: 1000,
				isDefault: true
			})
		)

		const productSaleUnit = {
			id: 'product-sale-unit-box',
			...binding,
			barcode: null,
			isActive: true,
			createdAt: new Date('2026-05-19T00:00:00.000Z'),
			updatedAt: new Date('2026-05-19T00:00:00.000Z'),
			catalogSaleUnit
		}
		const productReadService = new ProductReadService(
			{
				findPublicById: jest.fn().mockResolvedValue({
					id: 'product-1',
					sku: 'MILK',
					name: 'Milk',
					slug: 'milk',
					price: null,
					brand: null,
					productType: { id: 'product-type-1', code: 'food', name: 'Food' },
					media: [],
					categoryProducts: [],
					integrationLinks: [],
					productAttributes: [],
					isPopular: false,
					status: 'ACTIVE',
					position: 0,
					createdAt: new Date('2026-05-19T00:00:00.000Z'),
					updatedAt: new Date('2026-05-19T00:00:00.000Z'),
					variants: [
						{
							id: 'default-variant',
							sku: 'MILK',
							variantKey: 'default',
							kind: ProductVariantKind.DEFAULT,
							stock: 120,
							price: null,
							status: ProductVariantStatus.ACTIVE,
							isAvailable: true,
							createdAt: new Date('2026-05-19T00:00:00.000Z'),
							updatedAt: new Date('2026-05-19T00:00:00.000Z'),
							attributes: [],
							saleUnits: [productSaleUnit]
						}
					]
				})
			} as never,
			{} as never,
			{
				mapProduct: jest.fn(product => ({
					...product,
					categories: [],
					integration: null
				}))
			} as never,
			{ findByEntity: jest.fn().mockResolvedValue(null) } as never,
			{ mapMedia: jest.fn(media => media) } as never,
			{
				getCurrentFeatures: jest.fn().mockResolvedValue({
					canUseProductTypes: true,
					canUseProductVariants: false,
					canUseCatalogSaleUnits: true,
					canUseMoySkladIntegration: true
				})
			} as never,
			{
				resolveProductSellable: jest
					.fn()
					.mockResolvedValue(createCommercialProjection())
			} as never
		)

		const product = await runWithCatalog(() =>
			productReadService.getById('product-1')
		)

		expect(product).toEqual(
			expect.objectContaining({
				displayPrice: '1000.00',
				variants: [],
				saleUnits: [
					expect.objectContaining({
						id: 'product-sale-unit-box',
						catalogSaleUnitId: 'catalog-sale-unit-box',
						name: 'Box',
						baseQuantity: 12,
						price: 1000,
						isDefault: true
					})
				]
			})
		)

		const cartPricing = new CartLinePricingService()
		const cartTx = {
			productVariantSaleUnit: {
				findFirst: jest.fn().mockResolvedValue({
					id: 'product-sale-unit-box',
					variantId: 'default-variant',
					baseQuantity: 12,
					price: 1000
				})
			}
		}
		const saleUnit = await cartPricing.resolveSaleUnit(
			cartTx as never,
			'default-variant',
			null,
			{ useDefaultWhenMissing: true }
		)
		const snapshot = cartPricing.resolveLineSnapshot({
			variantId: 'default-variant',
			saleUnit,
			quantity: 2,
			productSnapshot: { catalogId: 'catalog-1', price: null },
			variantSnapshot: { catalogId: 'catalog-1', price: null },
			commercialProjection: createCommercialProjection()
		})

		expect(snapshot).toEqual({
			baseQuantity: 24,
			unitPriceSnapshot: 1000
		})
	})

	it('rejects sale unit that does not belong to resolved variant', async () => {
		const cartPricing = new CartLinePricingService()
		const tx = {
			productVariantSaleUnit: {
				findFirst: jest.fn().mockResolvedValue(null)
			}
		}

		await expect(
			cartPricing.resolveSaleUnit(
				tx as never,
				'default-variant',
				'foreign-sale-unit'
			)
		).rejects.toBeInstanceOf(BadRequestException)
	})
})

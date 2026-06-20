import {
	CatalogPresentationMode,
	CatalogStatus,
	Role,
	SeoEntityType
} from '@generated/enums'
import { ForbiddenException, NotFoundException } from '@nestjs/common'

import {
	CATALOG_CACHE_VERSION,
	CATEGORY_LIST_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'

import { AdminService } from './admin.service'

function createBatchPayload(count: number) {
	return { count }
}

function createTransactionMock() {
	return {
		productMedia: {
			deleteMany: jest.fn().mockResolvedValue(createBatchPayload(2))
		},
		categoryProduct: {
			deleteMany: jest.fn().mockResolvedValue(createBatchPayload(3))
		},
		integrationProductLink: {
			deleteMany: jest.fn().mockResolvedValue(createBatchPayload(4))
		},
		integrationCategoryLink: {
			deleteMany: jest.fn().mockResolvedValue(createBatchPayload(5))
		},
		variantAttribute: {
			updateMany: jest.fn().mockResolvedValue(createBatchPayload(6))
		},
		productVariant: {
			updateMany: jest.fn().mockResolvedValue(createBatchPayload(7))
		},
		productAttribute: {
			updateMany: jest.fn().mockResolvedValue(createBatchPayload(8))
		},
		product: {
			updateMany: jest.fn().mockResolvedValue(createBatchPayload(9))
		},
		category: {
			updateMany: jest.fn().mockResolvedValue(createBatchPayload(10))
		},
		brand: {
			updateMany: jest.fn().mockResolvedValue(createBatchPayload(11))
		},
		seoSetting: {
			updateMany: jest.fn().mockResolvedValue(createBatchPayload(12))
		},
		catalog: {
			update: jest.fn(),
			findUniqueOrThrow: jest.fn()
		},
		catalogConfig: {
			updateMany: jest.fn()
		},
		catalogSettings: {
			updateMany: jest.fn()
		},
		cart: {
			updateMany: jest.fn()
		},
		order: {
			updateMany: jest.fn()
		},
		payment: {
			updateMany: jest.fn()
		},
		user: {
			update: jest.fn()
		}
	}
}

function createService(tx = createTransactionMock()) {
	const prisma = {
		catalog: {
			findMany: jest.fn().mockResolvedValue([]),
			findUnique: jest.fn().mockResolvedValue({ id: 'catalog-1' }),
			findFirst: jest.fn().mockResolvedValue(null)
		},
		user: {
			create: jest.fn(),
			findMany: jest.fn().mockResolvedValue([]),
			findUnique: jest.fn().mockResolvedValue(null),
			findFirst: jest.fn().mockResolvedValue(null)
		},
		integration: {
			findUnique: jest.fn()
		},
		integrationSyncRun: {
			findFirst: jest.fn()
		},
		integrationProductLink: {
			count: jest.fn(),
			groupBy: jest.fn().mockResolvedValue([])
		},
		integrationVariantLink: {
			count: jest.fn(),
			groupBy: jest.fn().mockResolvedValue([])
		},
		country: {
			create: jest.fn(),
			findFirst: jest.fn().mockResolvedValue(null),
			findMany: jest.fn().mockResolvedValue([]),
			findUnique: jest.fn().mockResolvedValue(null),
			update: jest.fn()
		},
		regionality: {
			create: jest.fn(),
			findFirst: jest.fn().mockResolvedValue(null),
			findMany: jest.fn().mockResolvedValue([]),
			findUnique: jest.fn().mockResolvedValue(null),
			update: jest.fn()
		},
		$transaction: jest.fn(async callback => callback(tx))
	}
	const cache = {
		bumpVersion: jest.fn().mockResolvedValue(undefined)
	}
	const capabilities = {
		getCatalogCapabilities: jest.fn().mockResolvedValue({
			raw: {},
			effective: {},
			flags: {},
			definitions: [],
			items: []
		})
	}
	const productMaintenance = {
		diagnoseDefaultVariantsForCatalog: jest.fn(),
		expireScheduledDiscounts: jest.fn(),
		repairDefaultVariantPriceMismatchesForCatalog: jest.fn(),
		repairMissingDefaultVariantsForCatalog: jest.fn()
	}
	const s3 = {
		copyObjectToCatalog: jest.fn(),
		deleteObjectsByKeys: jest.fn().mockResolvedValue(undefined),
		uploadProofFile: jest.fn()
	}
	const service = new AdminService(
		prisma as any,
		{} as any,
		s3 as any,
		cache as any,
		capabilities as any,
		productMaintenance as any
	)

	return { cache, capabilities, prisma, productMaintenance, s3, service, tx }
}

function createDuplicateTransactionMock() {
	return {
		user: {
			create: jest.fn().mockResolvedValue({
				id: 'user-copy',
				name: 'Catalog Copy',
				login: 'catalog-copy'
			}),
			update: jest.fn()
		},
		catalog: {
			create: jest.fn(async ({ data }) => ({ id: data.id })),
			findUniqueOrThrow: jest.fn().mockResolvedValue({
				id: 'catalog-copy',
				slug: 'catalog-copy',
				domain: null,
				name: 'Catalog Copy',
				typeId: 'type-1',
				parentId: null,
				userId: 'user-copy',
				promoCodeId: null,
				subscriptionEndsAt: null,
				metrics: [],
				activity: [],
				region: [],
				payments: [],
				deleteAt: null,
				createdAt: new Date('2026-05-10T00:00:00.000Z'),
				updatedAt: new Date('2026-05-10T00:00:00.000Z'),
				config: {
					status: CatalogStatus.OPERATIONAL,
					logoMedia: null
				},
				settings: {
					inventoryMode: 'NONE'
				},
				featureEntitlements: [],
				type: {
					id: 'type-1',
					code: 'shop',
					name: 'Shop',
					deleteAt: null,
					createdAt: new Date('2026-05-10T00:00:00.000Z'),
					updatedAt: new Date('2026-05-10T00:00:00.000Z')
				},
				promoCode: null,
				children: []
			})
		},
		media: {
			create: jest.fn().mockResolvedValue({ id: 'media-copy' })
		},
		mediaVariant: {
			createMany: jest.fn()
		},
		catalogConfig: {
			update: jest.fn().mockResolvedValue({}),
			updateMany: jest.fn()
		},
		catalogSettings: {
			update: jest.fn().mockResolvedValue({}),
			updateMany: jest.fn()
		},
		catalogContact: {
			createMany: jest.fn()
		},
		catalogFeatureEntitlement: {
			createMany: jest.fn()
		},
		catalogModifierOption: {
			create: jest.fn()
		},
		catalogModifierGroup: {
			create: jest.fn()
		},
		catalogModifierGroupOption: {
			createMany: jest.fn()
		},
		productType: {
			create: jest.fn()
		},
		productTypeAttribute: {
			createMany: jest.fn()
		},
		productTypeModifierGroupTemplate: {
			create: jest.fn()
		},
		productTypeModifierOptionTemplate: {
			createMany: jest.fn()
		},
		catalogSaleUnit: {
			create: jest.fn()
		},
		inventoryWarehouseCatalog: {
			createMany: jest.fn()
		},
		brand: {
			create: jest.fn()
		},
		category: {
			create: jest.fn()
		},
		product: {
			create: jest.fn()
		},
		productAttribute: {
			createMany: jest.fn()
		},
		productVariant: {
			create: jest.fn()
		},
		productVariantSaleUnit: {
			createMany: jest.fn()
		},
		inventoryStockBalance: {
			createMany: jest.fn()
		},
		variantAttribute: {
			createMany: jest.fn()
		},
		productModifierGroup: {
			create: jest.fn().mockResolvedValue({ id: 'product-modifier-group-copy' })
		},
		productModifierOption: {
			createMany: jest.fn()
		},
		productMedia: {
			createMany: jest.fn()
		},
		categoryProduct: {
			createMany: jest.fn()
		},
		catalogPriceList: {
			create: jest.fn()
		},
		catalogPriceListPrice: {
			createMany: jest.fn()
		},
		seoSetting: {
			create: jest.fn()
		}
	}
}

function createDuplicateSourceCatalog() {
	return {
		id: 'catalog-source',
		parentId: null,
		activity: [],
		region: [],
		config: {
			about: null,
			description: null,
			currency: 'RUB',
			logoMediaId: null,
			bgMediaId: null,
			note: null,
			deleteAt: null
		},
		settings: {
			isActive: true,
			defaultMode: null,
			allowedModes: [],
			inventoryMode: 'NONE',
			address: null,
			checkout: null,
			googleVerification: null,
			yandexVerification: null,
			activePriceListId: null,
			deleteAt: null
		},
		featureEntitlements: [],
		contacts: [],
		media: [
			{
				id: 'media-source',
				originalName: 'photo.jpg',
				mimeType: 'image/jpeg',
				size: 1200,
				width: 100,
				height: 100,
				path: 'products',
				entityId: 'product-source',
				storage: 's3',
				key: 'catalogs/catalog-source/products/product-source/2026/05/18/raw/photo.jpg',
				checksum: 'checksum-1',
				status: 'READY',
				variants: [
					{
						kind: 'thumb-avif',
						mimeType: 'image/avif',
						size: 500,
						width: 100,
						height: 100,
						storage: 's3',
						key: 'catalogs/catalog-source/products/product-source/2026/05/18/photo-thumb.avif'
					}
				]
			}
		],
		brands: [],
		modifierOptions: [],
		modifierGroups: [],
		productTypes: [],
		saleUnits: [],
		priceLists: [],
		inventoryWarehouses: [],
		category: [],
		products: [
			{
				id: 'product-source',
				brandId: null,
				productTypeId: null,
				sku: 'SKU-1',
				name: 'Product',
				slug: 'product',
				price: null,
				isPopular: false,
				status: 'ACTIVE',
				position: 0,
				deleteAt: null,
				productAttributes: [],
				variants: [],
				modifierGroups: [],
				media: [{ mediaId: 'media-source', position: 0, kind: 'image' }],
				categoryProducts: []
			}
		],
		seoSettings: []
	}
}

function createAdminCatalogRecord(overrides: Record<string, unknown> = {}) {
	return {
		id: 'catalog-1',
		slug: 'catalog-one',
		domain: null,
		name: 'Catalog One',
		typeId: 'type-1',
		parentId: null,
		userId: 'user-1',
		promoCodeId: null,
		subscriptionEndsAt: null,
		metrics: [],
		activity: [],
		region: [],
		payments: [],
		deleteAt: null,
		createdAt: new Date('2026-05-10T00:00:00.000Z'),
		updatedAt: new Date('2026-05-10T00:00:00.000Z'),
		config: {
			status: CatalogStatus.OPERATIONAL,
			logoMedia: null
		},
		settings: {
			presentationMode: CatalogPresentationMode.CATALOG,
			inventoryMode: 'NONE'
		},
		featureEntitlements: [],
		type: {
			id: 'type-1',
			code: 'shop',
			name: 'Shop',
			deleteAt: null,
			createdAt: new Date('2026-05-10T00:00:00.000Z'),
			updatedAt: new Date('2026-05-10T00:00:00.000Z')
		},
		promoCode: null,
		children: [],
		...overrides
	}
}

describe('AdminService', () => {
	it('throws NotFoundException when catalog does not exist', async () => {
		const { prisma, service } = createService()
		prisma.catalog.findUnique.mockResolvedValue(null)

		await expect(service.deleteCatalogContent('missing-catalog')).rejects.toThrow(
			NotFoundException
		)

		expect(prisma.$transaction).not.toHaveBeenCalled()
	})

	it('creates trial license with a calendar end date', async () => {
		const tx = {
			user: {
				create: jest.fn().mockResolvedValue({
					id: 'user-1',
					name: 'Catalog One',
					login: 'catalog-one'
				})
			},
			catalog: {
				create: jest.fn(async ({ data }) =>
					createAdminCatalogRecord({
						name: data.name,
						slug: data.slug,
						subscriptionEndsAt: data.subscriptionEndsAt
					})
				)
			}
		}
		const { service } = createService(tx as any)

		jest.useFakeTimers().setSystemTime(new Date(2026, 5, 10, 15, 30))
		try {
			await service.createCatalog({
				name: 'Catalog One',
				slug: 'catalog-one',
				typeId: 'type-1',
				status: CatalogStatus.PROPOSAL,
				trialLicenseDays: 14
			})
		} finally {
			jest.useRealTimers()
		}

		expect(tx.catalog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					subscriptionEndsAt: new Date(2026, 5, 24)
				})
			})
		)
	})

	it('exposes inventory mode and entitlement in admin catalog config', async () => {
		const { prisma, service } = createService()
		prisma.catalog.findMany.mockResolvedValue([
			{
				id: 'catalog-1',
				slug: 'catalog-one',
				domain: null,
				name: 'Catalog One',
				typeId: 'type-1',
				parentId: null,
				userId: 'user-1',
				promoCodeId: null,
				subscriptionEndsAt: null,
				metrics: [],
				payments: [],
				deleteAt: null,
				createdAt: new Date('2026-05-10T00:00:00.000Z'),
				updatedAt: new Date('2026-05-10T00:00:00.000Z'),
				config: {
					status: CatalogStatus.OPERATIONAL,
					logoMedia: null
				},
				settings: {
					inventoryMode: 'INTERNAL'
				},
				featureEntitlements: [
					{
						feature: 'inventory.internal',
						enabled: true,
						expiresAt: new Date('2099-01-01T00:00:00.000Z')
					}
				],
				type: {
					id: 'type-1',
					code: 'shop',
					name: 'Shop',
					deleteAt: null,
					createdAt: new Date('2026-05-10T00:00:00.000Z'),
					updatedAt: new Date('2026-05-10T00:00:00.000Z')
				},
				promoCode: null,
				children: []
			}
		])

		const [catalog] = await service.getCatalogs()

		expect(catalog.config).toMatchObject({
			status: CatalogStatus.OPERATIONAL,
			inventoryMode: 'INTERNAL',
			canUseInternalInventory: true
		})
	})

	it('exposes catalog country and region bindings for admin dashboard', async () => {
		const { prisma, service } = createService()
		const regionality = {
			id: 'region-1',
			code: 'RU-MOW',
			name: 'Москва',
			countryCode: 'RU',
			countryName: 'Россия',
			deleteAt: null
		}
		prisma.catalog.findMany.mockResolvedValue([
			createAdminCatalogRecord({
				region: [regionality],
				children: [
					{
						id: 'catalog-child',
						slug: 'catalog-child',
						domain: null,
						name: 'Catalog Child',
						deleteAt: null,
						region: [regionality]
					}
				]
			})
		])

		const [catalog] = await service.getCatalogs()

		expect(catalog.regionalities).toEqual([regionality])
		expect(catalog.children[0]).toMatchObject({
			id: 'catalog-child',
			regionalities: [regionality]
		})
	})

	it('returns active regionalities sorted for admin selectors', async () => {
		const { prisma, service } = createService()
		prisma.regionality.findMany.mockResolvedValue([
			{
				id: 'region-1',
				code: 'RU-MOW',
				name: 'Москва',
				countryId: 'country-ru',
				parentId: null,
				countryCode: 'RU',
				countryName: 'Россия',
				country: {
					id: 'country-ru',
					code: 'RU',
					name: 'Россия',
					deleteAt: null
				},
				deleteAt: null
			}
		])

		await expect(service.getRegionalities()).resolves.toEqual([
			expect.objectContaining({
				code: 'RU-MOW',
				countryCode: 'RU'
			})
		])
		expect(prisma.regionality.findMany).toHaveBeenCalledWith({
			where: { deleteAt: null },
			select: expect.objectContaining({
				countryId: true,
				parentId: true,
				countryCode: true,
				countryName: true,
				country: expect.any(Object)
			}),
			orderBy: [{ countryName: 'asc' }, { parentId: 'asc' }, { name: 'asc' }]
		})
	})

	it('returns active countries sorted for admin selectors', async () => {
		const { prisma, service } = createService()
		prisma.country.findMany.mockResolvedValue([
			{
				id: 'country-ru',
				code: 'RU',
				name: 'Россия',
				deleteAt: null
			}
		])

		await expect(service.getCountries()).resolves.toEqual([
			expect.objectContaining({
				code: 'RU',
				name: 'Россия'
			})
		])
		expect(prisma.country.findMany).toHaveBeenCalledWith({
			where: { deleteAt: null },
			select: expect.objectContaining({
				code: true,
				name: true
			}),
			orderBy: { name: 'asc' }
		})
	})

	it('scopes countries and regionalities for geo admins', async () => {
		const { prisma, service } = createService()
		prisma.user.findUnique.mockResolvedValue({
			id: 'geo-admin',
			countries: [{ id: 'country-ru' }],
			regions: [{ id: 'region-chechnya' }]
		})
		prisma.regionality.findMany.mockResolvedValue([
			{ id: 'region-chechnya', countryId: 'country-ru', parentId: null },
			{
				id: 'region-grozny',
				countryId: 'country-ru',
				parentId: 'region-chechnya'
			},
			{ id: 'region-kz', countryId: 'country-kz', parentId: null }
		])
		prisma.country.findMany.mockResolvedValue([
			{
				id: 'country-ru',
				code: 'RU',
				name: 'Россия',
				deleteAt: null
			}
		])

		await service.getCountries({ id: 'geo-admin', role: Role.GEO_ADMIN })
		await service.getRegionalities({ id: 'geo-admin', role: Role.GEO_ADMIN })

		expect(prisma.country.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({ id: { in: ['country-ru'] } })
			})
		)
		expect(prisma.regionality.findMany).toHaveBeenLastCalledWith(
			expect.objectContaining({
				where: expect.objectContaining({
					id: { in: ['region-chechnya', 'region-grozny'] }
				})
			})
		)
	})

	it('filters catalog list for geo admins by assigned geo scope', async () => {
		const { prisma, service } = createService()
		prisma.user.findUnique.mockResolvedValue({
			id: 'geo-admin',
			countries: [{ id: 'country-ru' }],
			regions: []
		})
		prisma.regionality.findMany.mockResolvedValue([
			{ id: 'region-chechnya', countryId: 'country-ru', parentId: null },
			{
				id: 'region-grozny',
				countryId: 'country-ru',
				parentId: 'region-chechnya'
			},
			{ id: 'region-kz', countryId: 'country-kz', parentId: null }
		])

		await service.getCatalogs(undefined, {
			id: 'geo-admin',
			role: Role.GEO_ADMIN
		})

		expect(prisma.catalog.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: {
					region: {
						some: {
							id: { in: ['region-chechnya', 'region-grozny'] }
						}
					}
				}
			})
		)
	})

	it('lists geo admins for global admins only', async () => {
		const { prisma, service } = createService()
		prisma.user.findMany.mockResolvedValue([
			{
				id: 'geo-admin',
				login: 'geo-chechnya',
				name: 'Geo Admin',
				role: Role.GEO_ADMIN,
				countries: [
					{ id: 'country-ru', code: 'RU', name: 'Россия', deleteAt: null }
				],
				regions: [],
				deleteAt: null,
				createdAt: new Date('2026-06-01T00:00:00.000Z'),
				updatedAt: new Date('2026-06-01T00:00:00.000Z')
			}
		])

		await expect(
			service.getGeoAdmins({ id: 'admin', role: Role.ADMIN })
		).resolves.toEqual([
			expect.objectContaining({
				login: 'geo-chechnya',
				regionalities: []
			})
		])
		await expect(
			service.getGeoAdmins({ id: 'geo-admin', role: Role.GEO_ADMIN })
		).rejects.toThrow('Недостаточно прав')
	})

	it('creates geo admins with country and regionality assignments', async () => {
		const { prisma, service } = createService()
		const country = {
			id: 'country-ru',
			code: 'RU',
			name: 'Россия',
			deleteAt: null
		}
		const region = {
			id: 'region-chechnya',
			code: 'RU-CHECHENSKAYA-RESPUBLIKA',
			name: 'Чеченская республика',
			countryId: country.id,
			parentId: null,
			countryCode: country.code,
			countryName: country.name,
			country,
			deleteAt: null
		}
		prisma.country.findMany.mockResolvedValue([country])
		prisma.regionality.findMany.mockResolvedValue([region])
		prisma.user.create.mockResolvedValue({
			id: 'geo-admin',
			login: 'geo-chechnya',
			name: 'Geo Admin',
			role: Role.GEO_ADMIN,
			countries: [country],
			regions: [region],
			deleteAt: null,
			createdAt: new Date('2026-06-01T00:00:00.000Z'),
			updatedAt: new Date('2026-06-01T00:00:00.000Z')
		})

		const result = await service.createGeoAdmin(
			{
				login: 'geo-chechnya',
				password: 'password123',
				name: 'Geo Admin',
				countryIds: ['country-ru'],
				regionalityIds: ['region-chechnya']
			},
			{ id: 'admin', role: Role.ADMIN }
		)

		expect(result).toEqual(
			expect.objectContaining({
				admin: expect.objectContaining({
					login: 'geo-chechnya',
					regionalities: [region]
				}),
				credentials: {
					login: 'geo-chechnya',
					password: 'password123'
				}
			})
		)
		expect(prisma.user.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				login: 'geo-chechnya',
				name: 'Geo Admin',
				role: Role.GEO_ADMIN,
				isEmailConfirmed: true,
				countries: { connect: [{ id: 'country-ru' }] },
				regions: { connect: [{ id: 'region-chechnya' }] }
			}),
			select: expect.any(Object)
		})
	})

	it('generates geo admin login and password when omitted', async () => {
		const { prisma, service } = createService()
		const country = {
			id: 'country-ru',
			code: 'RU',
			name: 'Россия',
			deleteAt: null
		}
		prisma.country.findMany.mockResolvedValue([country])
		prisma.user.create.mockImplementation(async ({ data }: any) => ({
			id: 'geo-admin',
			login: data.login,
			name: data.name,
			role: data.role,
			countries: [country],
			regions: [],
			deleteAt: null,
			createdAt: new Date('2026-06-01T00:00:00.000Z'),
			updatedAt: new Date('2026-06-01T00:00:00.000Z')
		}))

		const result = await service.createGeoAdmin(
			{
				name: 'Geo Admin',
				countryIds: ['country-ru']
			},
			{ id: 'admin', role: Role.ADMIN }
		)

		expect(result.admin.login).toMatch(/^geo-geo-admin/)
		expect(result.credentials.login).toBe(result.admin.login)
		expect(result.credentials.password).toHaveLength(12)
		expect(prisma.user.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				login: result.credentials.login,
				password: expect.any(String),
				role: Role.GEO_ADMIN,
				countries: { connect: [{ id: 'country-ru' }] }
			}),
			select: expect.any(Object)
		})
	})

	it('requires a country or regionality when creating geo admins', async () => {
		const { service } = createService()

		await expect(
			service.createGeoAdmin(
				{
					login: 'geo-empty',
					password: 'password123',
					name: 'Geo Empty'
				},
				{ id: 'admin', role: Role.ADMIN }
			)
		).rejects.toThrow('Укажите хотя бы одну страну или регион')
	})

	it('creates country and region for admin selectors', async () => {
		const { prisma, service } = createService()
		const country = {
			id: 'country-ru',
			code: 'RU',
			name: 'Россия',
			deleteAt: null
		}
		const created = {
			id: 'region-chechnya',
			code: 'RU-CHECHENSKAYA-RESPUBLIKA',
			name: 'Чеченская республика',
			countryId: country.id,
			parentId: null,
			countryCode: 'RU',
			countryName: 'Россия',
			country,
			deleteAt: null
		}
		prisma.country.create.mockResolvedValue(country)
		prisma.regionality.create.mockResolvedValue(created)

		const result = await service.createRegionality({
			countryName: 'Россия',
			regionName: 'Чеченская республика'
		})

		expect(result).toEqual(created)
		expect(prisma.country.create).toHaveBeenCalledWith({
			data: {
				code: 'RU',
				name: 'Россия'
			},
			select: expect.objectContaining({
				code: true,
				name: true
			})
		})
		expect(prisma.regionality.create).toHaveBeenCalledWith({
			data: {
				code: 'RU-CHECHENSKAYA-RESPUBLIKA',
				name: 'Чеченская республика',
				country: { connect: { id: 'country-ru' } },
				countryCode: 'RU',
				countryName: 'Россия'
			},
			select: expect.objectContaining({
				countryId: true,
				parentId: true,
				countryCode: true,
				countryName: true
			})
		})
	})

	it('creates nested regionalities inside a country', async () => {
		const { prisma, service } = createService()
		const country = {
			id: 'country-ru',
			code: 'RU',
			name: 'Россия',
			deleteAt: null
		}
		const parent = {
			id: 'region-chechnya',
			countryId: country.id,
			countryCode: country.code,
			deleteAt: null
		}
		const created = {
			id: 'region-grozny',
			code: 'RU-GROZNYJ',
			name: 'Грозный',
			countryId: country.id,
			parentId: parent.id,
			countryCode: country.code,
			countryName: country.name,
			country,
			deleteAt: null
		}
		prisma.country.findUnique.mockResolvedValue(country)
		prisma.regionality.findUnique
			.mockResolvedValueOnce(parent)
			.mockResolvedValueOnce(null)
		prisma.regionality.create.mockResolvedValue(created)

		const result = await service.createRegionality({
			countryId: country.id,
			parentId: parent.id,
			regionName: 'Грозный'
		})

		expect(result).toEqual(created)
		expect(prisma.regionality.create).toHaveBeenCalledWith({
			data: {
				code: 'RU-GROZNYJ',
				name: 'Грозный',
				country: { connect: { id: country.id } },
				parent: { connect: { id: parent.id } },
				countryCode: country.code,
				countryName: country.name
			},
			select: expect.any(Object)
		})
	})

	it('blocks duplicate active country and region names', async () => {
		const { prisma, service } = createService()
		prisma.country.findUnique.mockResolvedValue({
			id: 'country-ru',
			code: 'RU',
			name: 'Россия',
			deleteAt: null
		})
		prisma.regionality.findFirst.mockResolvedValue({ id: 'region-1' })

		await expect(
			service.createRegionality({
				countryName: 'Россия',
				regionName: 'Чеченская республика',
				regionCode: 'RU-CE'
			})
		).rejects.toThrow('Регион уже существует')
		expect(prisma.regionality.create).not.toHaveBeenCalled()
	})

	it('counts catalog subscription end dates inclusively', async () => {
		const { prisma, service } = createService()
		prisma.catalog.findMany.mockResolvedValue([
			createAdminCatalogRecord({
				subscriptionEndsAt: new Date(2026, 4, 28)
			})
		])

		jest.useFakeTimers().setSystemTime(new Date(2026, 4, 28, 12))
		try {
			const [catalogOnEndDate] = await service.getCatalogs()
			expect(catalogOnEndDate.subscriptionDaysLeft).toBe(1)

			jest.setSystemTime(new Date(2026, 4, 29))
			const [catalogAfterEndDate] = await service.getCatalogs()
			expect(catalogAfterEndDate.subscriptionDaysLeft).toBe(0)
		} finally {
			jest.useRealTimers()
		}
	})

	it('returns MoySklad stock diagnostics without leaking provider secrets', async () => {
		const { prisma, service } = createService()
		prisma.integration.findUnique.mockResolvedValue({
			id: 'integration-1',
			isActive: true,
			metadata: {
				token: 'moysklad-secret-token',
				syncStock: true,
				fieldOwnership: { stock: 'external' },
				stockWebhookEnabled: true,
				stockWebhook: { externalId: 'webhook-1', secretHash: 'secret-hash' },
				lastStockSyncedAt: '2026-05-17T08:00:00.000Z'
			}
		})
		prisma.integrationSyncRun.findFirst.mockResolvedValue({
			id: 'run-1',
			trigger: 'WEBHOOK',
			status: 'SUCCESS',
			snapshotCompleteness: 'WEBHOOK_DELTA',
			error: 'Authorization: Bearer moysklad-secret-token',
			metadata: {
				stockRows: {
					total: 5,
					applied: 4,
					skipped: 1,
					diagnostics: {
						source: 'WEBHOOK',
						stockRows: 5,
						matchedStockRows: 4,
						unmatchedStockRows: 1,
						productLinks: 2,
						variantLinks: 3,
						ignoredVariantLinks: 0,
						appliedProductLinks: 1,
						appliedVariantLinks: 3,
						skippedReasons: {
							missingStock: 0,
							productHasVariantLinks: 1,
							variantsCapabilityDisabled: 0,
							stockRowWithoutLocalLink: 1
						}
					}
				}
			},
			totalProducts: 5,
			updatedProducts: 4,
			requestedAt: new Date('2026-05-17T08:00:00.000Z'),
			startedAt: new Date('2026-05-17T08:00:01.000Z'),
			finishedAt: new Date('2026-05-17T08:00:02.000Z')
		})
		prisma.integrationProductLink.count
			.mockResolvedValueOnce(2)
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce(0)
			.mockResolvedValueOnce(0)
		prisma.integrationVariantLink.count
			.mockResolvedValueOnce(3)
			.mockResolvedValueOnce(3)
			.mockResolvedValueOnce(0)
			.mockResolvedValueOnce(1)
		prisma.integrationProductLink.groupBy.mockResolvedValue([
			{
				skippedReason: 'stock_owned_by_variant_links',
				_count: { skippedReason: 2 }
			}
		])
		prisma.integrationVariantLink.groupBy.mockResolvedValue([
			{
				skippedReason: 'stock_missing_in_external_report',
				_count: { skippedReason: 1 }
			}
		])

		const result = await service.getCatalogMoySkladStockDiagnostics('catalog-1')

		expect(result).toMatchObject({
			catalogId: 'catalog-1',
			integrationId: 'integration-1',
			hasIntegration: true,
			integrationActive: true,
			syncStockEnabled: true,
			stockFieldOwnedByMoySklad: true,
			stockWebhookEnabled: true,
			stockWebhookRegistered: true,
			lastStockSyncedAt: '2026-05-17T08:00:00.000Z',
			links: {
				productLinks: 2,
				variantLinks: 3,
				productLinksWithStockSync: 1,
				variantLinksWithStockSync: 3,
				productLinksMissing: 0,
				variantLinksMissing: 0,
				productLinksWithErrors: 0,
				variantLinksWithErrors: 1,
				productSkippedReasons: [
					{ reason: 'stock_owned_by_variant_links', count: 2 }
				],
				variantSkippedReasons: [
					{ reason: 'stock_missing_in_external_report', count: 1 }
				]
			},
			latestRun: {
				id: 'run-1',
				totalRows: 5,
				appliedRows: 4,
				skippedRows: 1,
				diagnostics: {
					source: 'WEBHOOK',
					unmatchedStockRows: 1,
					skippedReasons: {
						productHasVariantLinks: 1,
						stockRowWithoutLocalLink: 1
					}
				},
				error: expect.stringContaining('[redacted]')
			}
		})
		expect(JSON.stringify(result)).not.toContain('moysklad-secret-token')
		expect(JSON.stringify(result)).not.toContain('secret-hash')
	})

	it('delegates default variant diagnostics after catalog existence check', async () => {
		const { prisma, productMaintenance, service } = createService()
		const result = {
			catalogId: 'catalog-1',
			sampleLimit: 10,
			checks: [],
			warnCount: 0,
			failCount: 0,
			ok: true
		}
		productMaintenance.diagnoseDefaultVariantsForCatalog.mockResolvedValue(result)

		await expect(
			service.diagnoseCatalogDefaultVariants('catalog-1', 10)
		).resolves.toBe(result)
		expect(prisma.catalog.findUnique).toHaveBeenCalledWith({
			where: { id: 'catalog-1' },
			select: { id: true }
		})
		expect(
			productMaintenance.diagnoseDefaultVariantsForCatalog
		).toHaveBeenCalledWith('catalog-1', 10)
	})

	it('delegates missing default variant repair after catalog existence check', async () => {
		const { productMaintenance, service } = createService()
		const result = {
			checkedProducts: 2,
			repairedProducts: 1,
			affectedCatalogs: 1
		}
		productMaintenance.repairMissingDefaultVariantsForCatalog.mockResolvedValue(
			result
		)

		await expect(
			service.repairCatalogMissingDefaultVariants('catalog-1')
		).resolves.toBe(result)
		expect(
			productMaintenance.repairMissingDefaultVariantsForCatalog
		).toHaveBeenCalledWith('catalog-1')
	})

	it('delegates default variant price mismatch repair after catalog existence check', async () => {
		const { productMaintenance, service } = createService()
		const options = { apply: false, batchSize: 25, sampleLimit: 5 }
		const result = {
			catalogId: 'catalog-1',
			dryRun: true,
			checkedProducts: 3,
			repairableProducts: 3,
			updatedProducts: 0,
			affectedCatalogs: 0,
			batchSize: 25,
			sampleLimit: 5,
			samples: []
		}
		productMaintenance.repairDefaultVariantPriceMismatchesForCatalog.mockResolvedValue(
			result
		)

		await expect(
			service.repairCatalogDefaultVariantPriceMismatches('catalog-1', options)
		).resolves.toBe(result)
		expect(
			productMaintenance.repairDefaultVariantPriceMismatchesForCatalog
		).toHaveBeenCalledWith('catalog-1', options)
	})

	it('updates catalog owner login when catalog slug changes', async () => {
		const tx = createTransactionMock()
		const { cache, prisma, service } = createService(tx)
		prisma.catalog.findUnique.mockResolvedValueOnce({
			id: 'catalog-1',
			slug: 'old-slug',
			typeId: 'type-1',
			userId: 'user-1',
			metrics: []
		})
		prisma.catalog.findFirst.mockResolvedValueOnce(null)
		prisma.user.findFirst.mockResolvedValueOnce(null)
		tx.catalog.update.mockResolvedValueOnce(
			createAdminCatalogRecord({ slug: 'new-slug' })
		)

		const result = await service.updateCatalog('catalog-1', {
			slug: 'new-slug'
		})

		expect(prisma.user.findFirst).toHaveBeenCalledWith({
			where: {
				login: 'new-slug',
				role: Role.CATALOG,
				id: { not: 'user-1' }
			},
			select: { id: true }
		})
		expect(tx.catalog.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'catalog-1' },
				data: expect.objectContaining({ slug: 'new-slug' })
			})
		)
		expect(tx.user.update).toHaveBeenCalledWith({
			where: { id: 'user-1' },
			data: { login: 'new-slug' }
		})
		expect(result.slug).toBe('new-slug')
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			CATALOG_CACHE_VERSION,
			'catalog-1'
		)
	})

	it('updates trial license with a calendar end date', async () => {
		const tx = createTransactionMock()
		const { prisma, service } = createService(tx)
		prisma.catalog.findUnique.mockResolvedValueOnce({
			id: 'catalog-1',
			slug: 'catalog-one',
			typeId: 'type-1',
			userId: 'user-1',
			metrics: []
		})
		tx.catalog.update.mockResolvedValueOnce(
			createAdminCatalogRecord({
				subscriptionEndsAt: new Date(2026, 5, 24)
			})
		)

		jest.useFakeTimers().setSystemTime(new Date(2026, 5, 10, 15, 30))
		try {
			await service.updateCatalog('catalog-1', { trialLicenseDays: 14 })
		} finally {
			jest.useRealTimers()
		}

		expect(tx.catalog.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'catalog-1' },
				data: expect.objectContaining({
					subscriptionEndsAt: new Date(2026, 5, 24)
				})
			})
		)
	})

	it('updates catalog presentation mode for global admins', async () => {
		const tx = createTransactionMock()
		const { prisma, service, tx: transaction } = createService(tx)
		prisma.catalog.findUnique.mockResolvedValueOnce({
			id: 'catalog-1',
			slug: 'catalog-one',
			typeId: 'type-1',
			userId: 'user-1',
			metrics: []
		})
		tx.catalog.update.mockResolvedValueOnce(
			createAdminCatalogRecord({
				settings: {
					presentationMode: CatalogPresentationMode.BUSINESS_CARD,
					inventoryMode: 'NONE'
				}
			})
		)

		const result = await service.updateCatalog(
			'catalog-1',
			{ presentationMode: CatalogPresentationMode.BUSINESS_CARD },
			{ id: 'admin-1', role: Role.ADMIN }
		)

		expect(transaction.catalog.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'catalog-1' },
				data: expect.objectContaining({
					settings: {
						upsert: {
							create: {
								presentationMode: CatalogPresentationMode.BUSINESS_CARD
							},
							update: {
								presentationMode: CatalogPresentationMode.BUSINESS_CARD
							}
						}
					}
				})
			})
		)
		expect(result.config?.presentationMode).toBe(
			CatalogPresentationMode.BUSINESS_CARD
		)
	})

	it('rejects catalog presentation mode updates from geo admins', async () => {
		const { service, tx } = createService()

		await expect(
			service.updateCatalog(
				'catalog-1',
				{ presentationMode: CatalogPresentationMode.BUSINESS_CARD },
				{ id: 'geo-admin-1', role: Role.GEO_ADMIN }
			)
		).rejects.toThrow(ForbiddenException)

		expect(tx.catalog.update).not.toHaveBeenCalled()
	})

	it('disconnects the main metric when admin clears it', async () => {
		const tx = createTransactionMock()
		const { prisma, service } = createService(tx)
		prisma.catalog.findUnique.mockResolvedValueOnce({
			id: 'catalog-1',
			slug: 'catalog-one',
			typeId: 'type-1',
			userId: 'user-1',
			metrics: [{ id: 'metric-1', counterId: '104674685' }]
		})
		tx.catalog.update.mockResolvedValueOnce(createAdminCatalogRecord())

		await service.updateCatalog('catalog-1', { metricId: null })

		expect(tx.catalog.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'catalog-1' },
				data: expect.objectContaining({
					metrics: expect.objectContaining({
						disconnect: [{ id: 'metric-1' }]
					})
				})
			})
		)
	})

	it('replaces catalog activities during admin edit', async () => {
		const tx = createTransactionMock()
		const { prisma, service } = createService(tx)
		const activity = {
			id: 'activity-2',
			name: 'Cafe',
			deleteAt: null,
			createdAt: new Date('2026-05-10T00:00:00.000Z'),
			updatedAt: new Date('2026-05-10T00:00:00.000Z')
		}
		prisma.catalog.findUnique.mockResolvedValueOnce({
			id: 'catalog-1',
			slug: 'catalog-one',
			typeId: 'type-1',
			userId: 'user-1',
			metrics: []
		})
		tx.catalog.update.mockResolvedValueOnce(
			createAdminCatalogRecord({ activity: [activity] })
		)

		const result = await service.updateCatalog('catalog-1', {
			activityIds: ['activity-2']
		})

		expect(tx.catalog.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'catalog-1' },
				data: expect.objectContaining({
					activity: { set: [{ id: 'activity-2' }] }
				})
			})
		)
		expect(result.activities).toEqual([activity])
	})

	it('replaces catalog regionalities during admin edit', async () => {
		const tx = createTransactionMock()
		const { prisma, service } = createService(tx)
		prisma.catalog.findUnique.mockResolvedValueOnce({
			id: 'catalog-1',
			slug: 'catalog-one',
			typeId: 'type-1',
			userId: 'user-1',
			metrics: []
		})
		tx.catalog.update.mockResolvedValueOnce(
			createAdminCatalogRecord({
				region: [
					{
						id: 'region-1',
						code: 'RU-MOW',
						name: 'Москва',
						countryCode: 'RU',
						countryName: 'Россия',
						deleteAt: null
					}
				]
			})
		)

		const result = await service.updateCatalog('catalog-1', {
			regionalityIds: ['region-1']
		})

		expect(tx.catalog.update).toHaveBeenCalledWith(
			expect.objectContaining({
				where: { id: 'catalog-1' },
				data: expect.objectContaining({
					region: { set: [{ id: 'region-1' }] }
				})
			})
		)
		expect(result.regionalities).toEqual([
			expect.objectContaining({ id: 'region-1', countryCode: 'RU' })
		])
	})

	it('duplicates catalog product media with independent S3 keys', async () => {
		const tx = createDuplicateTransactionMock()
		const { prisma, s3, service } = createService(tx as any)
		prisma.catalog.findUnique.mockResolvedValueOnce(
			createDuplicateSourceCatalog() as any
		)
		s3.copyObjectToCatalog
			.mockResolvedValueOnce({
				ok: true,
				key: 'catalogs/catalog-copy/products/product-source/2026/05/18/raw/photo-copy.jpg',
				url: 'https://cdn.example.test/photo-copy.jpg'
			})
			.mockResolvedValueOnce({
				ok: true,
				key: 'catalogs/catalog-copy/products/product-source/2026/05/18/photo-copy-thumb.avif',
				url: 'https://cdn.example.test/photo-copy-thumb.avif'
			})

		await service.duplicateCatalog('catalog-source', {
			name: 'Catalog Copy',
			slug: 'catalog-copy',
			typeId: 'type-1',
			status: CatalogStatus.OPERATIONAL
		})

		const targetCatalogId =
			s3.copyObjectToCatalog.mock.calls[0][0].targetCatalogId
		const duplicatedProductId = tx.product.create.mock.calls[0][0].data.id
		expect(s3.copyObjectToCatalog).toHaveBeenNthCalledWith(1, {
			sourceKey:
				'catalogs/catalog-source/products/product-source/2026/05/18/raw/photo.jpg',
			targetCatalogId,
			path: 'products',
			entityId: duplicatedProductId
		})
		expect(s3.copyObjectToCatalog).toHaveBeenNthCalledWith(2, {
			sourceKey:
				'catalogs/catalog-source/products/product-source/2026/05/18/photo-thumb.avif',
			targetCatalogId,
			path: 'products',
			entityId: duplicatedProductId
		})
		expect(s3.copyObjectToCatalog.mock.invocationCallOrder[1]).toBeLessThan(
			prisma.$transaction.mock.invocationCallOrder[0]
		)
		expect(tx.catalog.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ id: targetCatalogId })
			})
		)
		expect(tx.media.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				catalogId: targetCatalogId,
				key: 'catalogs/catalog-copy/products/product-source/2026/05/18/raw/photo-copy.jpg'
			})
		})
		const createdMediaId = tx.media.create.mock.calls[0][0].data.id
		expect(tx.mediaVariant.createMany).toHaveBeenCalledWith({
			data: [
				expect.objectContaining({
					mediaId: createdMediaId,
					key: 'catalogs/catalog-copy/products/product-source/2026/05/18/photo-copy-thumb.avif'
				})
			]
		})
		expect(tx.media.create.mock.invocationCallOrder[0]).toBeLessThan(
			tx.mediaVariant.createMany.mock.invocationCallOrder[0]
		)
		expect(tx.productMedia.createMany).toHaveBeenCalledWith({
			data: [
				expect.objectContaining({
					productId: expect.any(String),
					mediaId: expect.not.stringMatching(/^media-source$/)
				})
			]
		})
	})

	it('returns the default owner password when duplicating catalog', async () => {
		const tx = createDuplicateTransactionMock()
		const { prisma, service } = createService(tx as any)
		prisma.catalog.findUnique.mockResolvedValueOnce({
			...createDuplicateSourceCatalog(),
			media: []
		} as any)

		const result = await service.duplicateCatalog('catalog-source', {
			name: 'Catalog Copy',
			slug: 'catalog-copy',
			typeId: 'type-1',
			status: CatalogStatus.OPERATIONAL
		})

		expect(result.owner.password).toBe('00000000')
		expect(tx.user.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				password: expect.any(String)
			}),
			select: {
				id: true,
				name: true,
				login: true
			}
		})
	})

	it('duplicates catalog scoped product model extensions', async () => {
		const tx = createDuplicateTransactionMock()
		const { prisma, service } = createService(tx as any)
		const source = {
			...createDuplicateSourceCatalog(),
			media: [],
			featureEntitlements: [
				{
					feature: 'catalog.sale_units',
					enabled: true,
					expiresAt: null,
					metadata: { copied: true }
				}
			],
			settings: {
				...createDuplicateSourceCatalog().settings,
				inventoryMode: 'INTERNAL',
				address: 'Main street, 1',
				checkout: { enabledMethods: ['PICKUP'] },
				activePriceListId: 'price-list-source'
			},
			modifierOptions: [
				{
					id: 'modifier-option-source',
					code: 'ketchup',
					name: 'Ketchup',
					description: null,
					defaultPrice: 10,
					isActive: true,
					displayOrder: 1,
					rawMeta: { external: true },
					deleteAt: null
				}
			],
			modifierGroups: [
				{
					id: 'modifier-group-source',
					code: 'sauces',
					name: 'Sauces',
					description: null,
					isRequired: false,
					minSelected: 0,
					maxSelected: 2,
					isActive: true,
					displayOrder: 1,
					rawMeta: null,
					deleteAt: null,
					options: [
						{
							optionId: 'modifier-option-source',
							defaultPrice: 10,
							isDefault: true,
							isActive: true,
							displayOrder: 1,
							deleteAt: null
						}
					]
				}
			],
			productTypes: [
				{
					id: 'product-type-source',
					scope: 'CATALOG',
					code: 'burger',
					name: 'Burger',
					description: null,
					isActive: true,
					isArchived: false,
					archivedAt: null,
					attributes: [
						{
							attributeId: 'attribute-source',
							isVariant: true,
							isRequired: true,
							displayOrder: 1
						}
					],
					modifierTemplates: [
						{
							id: 'template-source',
							catalogModifierGroupId: 'modifier-group-source',
							code: 'sauces',
							name: 'Sauces',
							description: null,
							isRequired: false,
							minSelected: 0,
							maxSelected: 2,
							isActive: true,
							displayOrder: 1,
							deleteAt: null,
							options: [
								{
									catalogModifierOptionId: 'modifier-option-source',
									code: 'ketchup',
									name: 'Ketchup',
									price: 10,
									maxQuantity: 2,
									isDefault: true,
									isAvailable: true,
									displayOrder: 1,
									deleteAt: null
								}
							]
						}
					]
				}
			],
			saleUnits: [
				{
					id: 'sale-unit-source',
					code: 'piece',
					name: 'Piece',
					defaultBaseQuantity: 1,
					barcode: null,
					isActive: true,
					displayOrder: 1,
					deleteAt: null
				}
			],
			priceLists: [
				{
					id: 'price-list-source',
					code: 'hall',
					name: 'Hall',
					description: null,
					isActive: true,
					displayOrder: 1,
					deleteAt: null,
					prices: [
						{
							target: 'PRODUCT',
							targetId: 'product-source',
							productId: 'product-source',
							variantId: null,
							saleUnitId: null,
							price: 100,
							deleteAt: null
						},
						{
							target: 'VARIANT',
							targetId: 'variant-source',
							productId: 'product-source',
							variantId: 'variant-source',
							saleUnitId: null,
							price: 110,
							deleteAt: null
						},
						{
							target: 'SALE_UNIT',
							targetId: 'variant-sale-unit-source',
							productId: 'product-source',
							variantId: 'variant-source',
							saleUnitId: 'variant-sale-unit-source',
							price: 120,
							deleteAt: null
						}
					]
				}
			],
			inventoryWarehouses: [{ warehouseId: 'warehouse-1', isDefault: true }],
			products: [
				{
					...createDuplicateSourceCatalog().products[0],
					productTypeId: 'product-type-source',
					variants: [
						{
							id: 'variant-source',
							sku: 'VARIANT-1',
							variantKey: 'default',
							kind: 'DEFAULT',
							stock: 5,
							price: 100,
							status: 'ACTIVE',
							isAvailable: true,
							deleteAt: null,
							attributes: [],
							saleUnits: [
								{
									id: 'variant-sale-unit-source',
									catalogSaleUnitId: 'sale-unit-source',
									code: 'piece',
									name: 'Piece',
									baseQuantity: 1,
									price: 100,
									barcode: null,
									isDefault: true,
									isActive: true,
									displayOrder: 1,
									deleteAt: null
								}
							],
							stockBalances: [
								{
									warehouseId: 'warehouse-1',
									quantityOnHand: 5,
									lastSyncedAt: null
								}
							]
						}
					],
					modifierGroups: [
						{
							id: 'product-modifier-group-source',
							variantId: 'variant-source',
							catalogModifierGroupId: 'modifier-group-source',
							scope: 'VARIANT',
							scopeKey: 'variant-source',
							code: 'sauces',
							name: 'Sauces',
							description: null,
							isRequired: false,
							minSelected: 0,
							maxSelected: 2,
							isActive: true,
							displayOrder: 1,
							rawMeta: null,
							deleteAt: null,
							options: [
								{
									catalogModifierOptionId: 'modifier-option-source',
									code: 'ketchup',
									name: 'Ketchup',
									price: 10,
									maxQuantity: 2,
									isDefault: true,
									isAvailable: true,
									displayOrder: 1,
									rawMeta: null,
									deleteAt: null
								}
							]
						}
					]
				}
			]
		} as any
		prisma.catalog.findUnique.mockResolvedValueOnce(source)

		await service.duplicateCatalog('catalog-source', {
			name: 'Catalog Copy',
			slug: 'catalog-copy',
			typeId: 'type-1',
			status: CatalogStatus.OPERATIONAL
		})

		const copiedProductTypeId = tx.productType.create.mock.calls[0][0].data.id
		const copiedProductId = tx.product.create.mock.calls[0][0].data.id
		const copiedVariantId = tx.productVariant.create.mock.calls[0][0].data.id
		const copiedCatalogSaleUnitId =
			tx.catalogSaleUnit.create.mock.calls[0][0].data.id
		const copiedVariantSaleUnitId =
			tx.productVariantSaleUnit.createMany.mock.calls[0][0].data[0].id

		expect(tx.catalogSettings.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					inventoryMode: 'INTERNAL',
					address: 'Main street, 1',
					checkout: { enabledMethods: ['PICKUP'] }
				})
			})
		)
		expect(tx.catalogFeatureEntitlement.createMany).toHaveBeenCalledWith({
			data: [
				expect.objectContaining({
					catalogId: expect.any(String),
					feature: 'catalog.sale_units',
					enabled: true
				})
			]
		})
		expect(tx.product.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				id: copiedProductId,
				productTypeId: copiedProductTypeId
			})
		})
		expect(tx.productVariant.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				id: copiedVariantId,
				kind: 'DEFAULT'
			})
		})
		expect(tx.productVariantSaleUnit.createMany).toHaveBeenCalledWith({
			data: [
				expect.objectContaining({
					id: copiedVariantSaleUnitId,
					variantId: copiedVariantId,
					catalogSaleUnitId: copiedCatalogSaleUnitId
				})
			]
		})
		expect(tx.catalogPriceListPrice.createMany).toHaveBeenCalledWith({
			data: expect.arrayContaining([
				expect.objectContaining({
					target: 'PRODUCT',
					targetId: copiedProductId,
					productId: copiedProductId
				}),
				expect.objectContaining({
					target: 'VARIANT',
					targetId: copiedVariantId,
					variantId: copiedVariantId
				}),
				expect.objectContaining({
					target: 'SALE_UNIT',
					targetId: copiedVariantSaleUnitId,
					saleUnitId: copiedVariantSaleUnitId
				})
			])
		})
		expect(tx.productModifierGroup.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				productId: copiedProductId,
				variantId: copiedVariantId,
				scopeKey: copiedVariantId
			}),
			select: { id: true }
		})
		expect(tx.inventoryWarehouseCatalog.createMany).toHaveBeenCalledWith({
			data: [
				{
					warehouseId: 'warehouse-1',
					catalogId: expect.any(String),
					isDefault: true
				}
			]
		})
		expect(tx.inventoryStockBalance.createMany).toHaveBeenCalledWith({
			data: [
				expect.objectContaining({
					warehouseId: 'warehouse-1',
					variantId: copiedVariantId,
					quantityOnHand: 5,
					quantityReserved: 0,
					quantityAvailable: 5
				})
			]
		})
	})

	it('resets catalog owner password to the default value', async () => {
		const { prisma, service, tx } = createService()
		prisma.catalog.findUnique.mockResolvedValueOnce({
			id: 'catalog-1',
			userId: 'user-1'
		})
		tx.user.update.mockResolvedValueOnce({
			id: 'user-1',
			name: 'Catalog Owner',
			login: 'catalog-one'
		})
		tx.catalog.findUniqueOrThrow.mockResolvedValueOnce(createAdminCatalogRecord())

		const result = await service.resetCatalogOwnerPassword('catalog-1')

		expect(result.owner).toEqual({
			id: 'user-1',
			name: 'Catalog Owner',
			login: 'catalog-one',
			password: '00000000'
		})
		expect(tx.user.update).toHaveBeenCalledWith({
			where: { id: 'user-1' },
			data: { password: expect.any(String) },
			select: {
				id: true,
				name: true,
				login: true
			}
		})
		expect(tx.catalog.findUniqueOrThrow).toHaveBeenCalledWith({
			where: { id: 'catalog-1' },
			select: expect.any(Object)
		})
	})

	it('duplicates media variants when the raw S3 object is missing', async () => {
		const tx = createDuplicateTransactionMock()
		const { prisma, s3, service } = createService(tx as any)
		prisma.catalog.findUnique.mockResolvedValueOnce(
			createDuplicateSourceCatalog() as any
		)
		s3.copyObjectToCatalog
			.mockRejectedValueOnce(
				Object.assign(new Error('source object is missing'), {
					name: 'NoSuchKey',
					$metadata: { httpStatusCode: 404 }
				})
			)
			.mockResolvedValueOnce({
				ok: true,
				key: 'catalogs/catalog-copy/products/product-source/2026/05/18/photo-copy-thumb.avif',
				url: 'https://cdn.example.test/photo-copy-thumb.avif'
			})

		await service.duplicateCatalog('catalog-source', {
			name: 'Catalog Copy',
			slug: 'catalog-copy',
			typeId: 'type-1',
			status: CatalogStatus.OPERATIONAL
		})

		expect(s3.copyObjectToCatalog).toHaveBeenCalledTimes(2)
		const targetCatalogId =
			s3.copyObjectToCatalog.mock.calls[0][0].targetCatalogId
		expect(s3.copyObjectToCatalog.mock.invocationCallOrder[1]).toBeLessThan(
			prisma.$transaction.mock.invocationCallOrder[0]
		)
		expect(tx.media.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				catalogId: targetCatalogId,
				key: 'catalogs/catalog-copy/products/product-source/2026/05/18/photo-copy-thumb.avif'
			})
		})
		const createdMediaId = tx.media.create.mock.calls[0][0].data.id
		expect(tx.mediaVariant.createMany).toHaveBeenCalledWith({
			data: [
				expect.objectContaining({
					mediaId: createdMediaId,
					key: 'catalogs/catalog-copy/products/product-source/2026/05/18/photo-copy-thumb.avif'
				})
			]
		})
		expect(tx.productMedia.createMany).toHaveBeenCalledWith({
			data: [
				expect.objectContaining({
					productId: expect.any(String),
					mediaId: expect.not.stringMatching(/^media-source$/)
				})
			]
		})
	})

	it('skips missing S3 media while duplicating catalog', async () => {
		const tx = createDuplicateTransactionMock()
		const { prisma, s3, service } = createService(tx as any)
		const source = createDuplicateSourceCatalog()
		source.media[0].variants = []
		prisma.catalog.findUnique.mockResolvedValueOnce(source as any)
		s3.copyObjectToCatalog.mockRejectedValueOnce(
			Object.assign(new Error('source object is missing'), {
				name: 'NoSuchKey',
				$metadata: { httpStatusCode: 404 }
			})
		)

		await expect(
			service.duplicateCatalog('catalog-source', {
				name: 'Catalog Copy',
				slug: 'catalog-copy',
				typeId: 'type-1',
				status: CatalogStatus.OPERATIONAL
			})
		).resolves.toMatchObject({
			catalog: expect.objectContaining({ id: 'catalog-copy' })
		})

		expect(s3.copyObjectToCatalog).toHaveBeenCalledTimes(1)
		expect(tx.media.create).not.toHaveBeenCalled()
		expect(tx.productMedia.createMany).not.toHaveBeenCalled()
		expect(s3.deleteObjectsByKeys).not.toHaveBeenCalled()
	})

	it('cleans copied S3 media when catalog duplicate transaction fails', async () => {
		const tx = createDuplicateTransactionMock()
		const { prisma, s3, service } = createService(tx as any)
		prisma.catalog.findUnique.mockResolvedValueOnce(
			createDuplicateSourceCatalog() as any
		)
		prisma.$transaction.mockRejectedValueOnce(new Error('database failed'))
		s3.copyObjectToCatalog
			.mockResolvedValueOnce({
				ok: true,
				key: 'catalogs/catalog-copy/products/product-source/2026/05/18/raw/photo-copy.jpg',
				url: 'https://cdn.example.test/photo-copy.jpg'
			})
			.mockResolvedValueOnce({
				ok: true,
				key: 'catalogs/catalog-copy/products/product-source/2026/05/18/photo-copy-thumb.avif',
				url: 'https://cdn.example.test/photo-copy-thumb.avif'
			})

		await expect(
			service.duplicateCatalog('catalog-source', {
				name: 'Catalog Copy',
				slug: 'catalog-copy',
				typeId: 'type-1',
				status: CatalogStatus.OPERATIONAL
			})
		).rejects.toThrow('database failed')

		expect(s3.deleteObjectsByKeys).toHaveBeenCalledWith([
			'catalogs/catalog-copy/products/product-source/2026/05/18/raw/photo-copy.jpg',
			'catalogs/catalog-copy/products/product-source/2026/05/18/photo-copy-thumb.avif'
		])
	})

	it('soft-deletes catalog content and keeps catalog-level data intact', async () => {
		const { cache, service, tx } = createService()

		const result = await service.deleteCatalogContent('catalog-1')

		expect(result).toEqual({
			ok: true,
			catalogId: 'catalog-1',
			deletedAt: expect.any(Date),
			counts: {
				products: 9,
				productVariants: 7,
				productAttributes: 8,
				variantAttributes: 6,
				categories: 10,
				brands: 11,
				seoSettings: 12,
				productMediaLinks: 2,
				categoryProductLinks: 3,
				integrationProductLinks: 4,
				integrationCategoryLinks: 5
			}
		})
		expect(tx.product.updateMany).toHaveBeenCalledWith({
			where: { catalogId: 'catalog-1', deleteAt: null },
			data: { deleteAt: result.deletedAt, brandId: null }
		})
		expect(tx.category.updateMany).toHaveBeenCalledWith({
			where: { catalogId: 'catalog-1', deleteAt: null },
			data: { deleteAt: result.deletedAt }
		})
		expect(tx.brand.updateMany).toHaveBeenCalledWith({
			where: { catalogId: 'catalog-1', deleteAt: null },
			data: { deleteAt: result.deletedAt }
		})
		expect(tx.seoSetting.updateMany).toHaveBeenCalledWith({
			where: {
				catalogId: 'catalog-1',
				deleteAt: null,
				entityType: { not: SeoEntityType.CATALOG }
			},
			data: { deleteAt: result.deletedAt }
		})
		expect(tx.catalog.update).not.toHaveBeenCalled()
		expect(tx.catalogConfig.updateMany).not.toHaveBeenCalled()
		expect(tx.catalogSettings.updateMany).not.toHaveBeenCalled()
		expect(tx.cart.updateMany).not.toHaveBeenCalled()
		expect(tx.order.updateMany).not.toHaveBeenCalled()
		expect(tx.payment.updateMany).not.toHaveBeenCalled()
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			CATALOG_CACHE_VERSION,
			'catalog-1'
		)
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			PRODUCTS_CACHE_VERSION,
			'catalog-1'
		)
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			CATEGORY_PRODUCTS_CACHE_VERSION,
			'catalog-1'
		)
		expect(cache.bumpVersion).toHaveBeenCalledWith(
			CATEGORY_LIST_CACHE_VERSION,
			'catalog-1'
		)
	})

	it('removes only content link tables that cannot be soft-deleted', async () => {
		const { service, tx } = createService()

		await service.deleteCatalogContent('catalog-1')

		expect(tx.productMedia.deleteMany).toHaveBeenCalledWith({
			where: { product: { catalogId: 'catalog-1' } }
		})
		expect(tx.categoryProduct.deleteMany).toHaveBeenCalledWith({
			where: {
				OR: [
					{ category: { catalogId: 'catalog-1' } },
					{ product: { catalogId: 'catalog-1' } }
				]
			}
		})
		expect(tx.integrationProductLink.deleteMany).toHaveBeenCalledWith({
			where: {
				OR: [
					{ integration: { catalogId: 'catalog-1' } },
					{ product: { catalogId: 'catalog-1' } }
				]
			}
		})
		expect(tx.integrationCategoryLink.deleteMany).toHaveBeenCalledWith({
			where: {
				OR: [
					{ integration: { catalogId: 'catalog-1' } },
					{ category: { catalogId: 'catalog-1' } }
				]
			}
		})
	})

	it('is idempotent for an already cleaned catalog', async () => {
		const tx = createTransactionMock()
		for (const model of [
			tx.productMedia,
			tx.categoryProduct,
			tx.integrationProductLink,
			tx.integrationCategoryLink,
			tx.variantAttribute,
			tx.productVariant,
			tx.productAttribute,
			tx.product,
			tx.category,
			tx.brand,
			tx.seoSetting
		]) {
			const method = 'deleteMany' in model ? model.deleteMany : model.updateMany
			method.mockResolvedValue(createBatchPayload(0))
		}
		const { service } = createService(tx)

		await expect(
			service.deleteCatalogContent('catalog-1')
		).resolves.toMatchObject({
			ok: true,
			catalogId: 'catalog-1',
			counts: {
				products: 0,
				productVariants: 0,
				productAttributes: 0,
				variantAttributes: 0,
				categories: 0,
				brands: 0,
				seoSettings: 0,
				productMediaLinks: 0,
				categoryProductLinks: 0,
				integrationProductLinks: 0,
				integrationCategoryLinks: 0
			}
		})
	})
})

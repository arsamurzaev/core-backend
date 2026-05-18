import { DataType } from '@generated/enums'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { CapabilityService } from '@/modules/capability/capability.service'
import { CAPABILITY_ASSERT_PORT } from '@/modules/capability/contracts'
import { CacheService } from '@/shared/cache/cache.service'
import {
	CATALOG_TYPE_CACHE_VERSION,
	CATEGORY_PRODUCTS_CACHE_VERSION,
	PRODUCTS_CACHE_VERSION
} from '@/shared/cache/catalog-cache.constants'
import { RequestContext } from '@/shared/tenancy/request-context'

import { ProductTypeScope } from './product-type.constants'
import { ProductTypeRepository } from './product-type.repository'
import { ProductTypeService } from './product-type.service'

describe('ProductTypeService', () => {
	let service: ProductTypeService
	let repo: jest.Mocked<ProductTypeRepository>
	let cache: jest.Mocked<CacheService>

	const catalogId = 'catalog-id'
	const catalogTypeId = 'catalog-type-id'
	const enumAttribute = {
		id: 'size-attribute-id',
		key: 'size',
		displayName: 'Size',
		dataType: DataType.ENUM
	}
	const stringAttribute = {
		id: 'material-attribute-id',
		key: 'material',
		displayName: 'Material',
		dataType: DataType.STRING
	}

	beforeEach(async () => {
		const repoMock = {
			findCatalogTypes: jest.fn(),
			findCatalogTypeById: jest.fn(),
			findCatalogTypeMatrixEditorSchemaById: jest.fn(),
			findSystemTemplates: jest.fn(),
			findSystemTemplateById: jest.fn(),
			create: jest.fn(),
			updateCatalogType: jest.fn(),
			updateSystemTemplate: jest.fn(),
			getCatalogTypeSchemaUpdateImpact: jest.fn(),
			archiveCatalogType: jest.fn(),
			archiveSystemTemplate: jest.fn(),
			existsCode: jest.fn(),
			findCatalog: jest.fn(),
			findAttributesByIds: jest.fn()
		}
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ProductTypeService,
				{
					provide: ProductTypeRepository,
					useValue: repoMock
				},
				{
					provide: CacheService,
					useValue: {
						bumpVersion: jest.fn()
					}
				},
				{
					provide: CapabilityService,
					useValue: {
						assertCanUseProductTypes: jest.fn().mockResolvedValue(undefined)
					}
				},
				{
					provide: CAPABILITY_ASSERT_PORT,
					useExisting: CapabilityService
				}
			]
		}).compile()

		service = module.get<ProductTypeService>(ProductTypeService)
		repo = module.get(ProductTypeRepository)
		cache = module.get(CacheService)
		cache.bumpVersion.mockResolvedValue(1)
		repo.existsCode.mockResolvedValue(false)
		repo.findCatalog.mockResolvedValue({
			id: catalogId,
			typeId: catalogTypeId
		} as any)
		repo.findAttributesByIds.mockResolvedValue([enumAttribute] as any)
		repo.getCatalogTypeSchemaUpdateImpact.mockResolvedValue({
			boundProductCount: 0,
			conflictingProductCount: 0,
			obsoleteProductAttributeProductCount: 0,
			obsoleteVariantAttributeProductCount: 0,
			missingRequiredProductAttributeProductCount: 0,
			missingRequiredVariantAttributeProductCount: 0
		})
		const createMock = repo.create as jest.Mock
		createMock.mockImplementation(async data => ({
			id: 'product-type-id',
			...data
		}))
	})

	it('creates catalog scoped product type with attribute flags', async () => {
		await runWithCatalog(() =>
			service.create({
				code: 'mens-shoes',
				name: 'Mens shoes',
				attributes: [
					{
						attributeId: enumAttribute.id,
						isVariant: true,
						isRequired: true,
						displayOrder: 2
					}
				]
			})
		)

		expect(repo.create).toHaveBeenCalledWith(
			expect.objectContaining({
				catalogId,
				scope: ProductTypeScope.CATALOG,
				code: 'mens-shoes',
				attributes: [
					{
						attributeId: enumAttribute.id,
						isVariant: true,
						isRequired: true,
						displayOrder: 2
					}
				]
			})
		)
		expectCatalogProductTypeInvalidation()
	})

	it('rejects variant attributes that are not enum attributes', async () => {
		repo.findAttributesByIds.mockResolvedValue([stringAttribute] as any)

		await expect(
			runWithCatalog(() =>
				service.create({
					name: 'Materials',
					attributes: [
						{
							attributeId: stringAttribute.id,
							isVariant: true
						}
					]
				})
			)
		).rejects.toBeInstanceOf(BadRequestException)
		expect(repo.create).not.toHaveBeenCalled()
		expect(cache.bumpVersion).not.toHaveBeenCalled()
	})

	it('copies a system template into the current catalog as an editable type', async () => {
		repo.findSystemTemplateById.mockResolvedValue({
			id: 'template-id',
			catalogId: null,
			scope: ProductTypeScope.SYSTEM_TEMPLATE,
			code: 'mens-shoes',
			name: 'Mens shoes',
			description: 'Template',
			isActive: true,
			isArchived: false,
			archivedAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			attributes: [
				{
					productTypeId: 'template-id',
					attributeId: enumAttribute.id,
					isVariant: true,
					isRequired: true,
					displayOrder: 0,
					attribute: enumAttribute,
					createdAt: new Date(),
					updatedAt: new Date()
				}
			]
		} as any)
		repo.existsCode.mockImplementation(
			async (_scope, code) => code === 'mens-shoes'
		)
		repo.create.mockResolvedValue({ id: 'copy-id' } as any)

		await runWithCatalog(() => service.createFromTemplate('template-id', {}))

		expect(repo.create).toHaveBeenCalledWith(
			expect.objectContaining({
				catalogId,
				scope: ProductTypeScope.CATALOG,
				code: 'mens-shoes-1',
				name: 'Mens shoes',
				attributes: [
					{
						attributeId: enumAttribute.id,
						isVariant: true,
						isRequired: true,
						displayOrder: 0
					}
				]
			})
		)
		expectCatalogProductTypeInvalidation()
	})

	it('allows replacing attributes without scalar updates', async () => {
		repo.findCatalogTypeById.mockResolvedValue({
			id: 'product-type-id',
			code: 'mens-shoes',
			name: 'Mens shoes',
			attributes: []
		} as any)
		repo.updateCatalogType.mockResolvedValue({ id: 'product-type-id' } as any)

		await runWithCatalog(() =>
			service.update('product-type-id', {
				attributes: [{ attributeId: enumAttribute.id, isVariant: true }]
			})
		)

		expect(repo.updateCatalogType).toHaveBeenCalledWith(
			'product-type-id',
			catalogId,
			{},
			[
				{
					attributeId: enumAttribute.id,
					isVariant: true,
					isRequired: false,
					displayOrder: 0
				}
			]
		)
		expectCatalogProductTypeInvalidation()
	})

	it('rejects destructive schema update when existing products would conflict', async () => {
		repo.findCatalogTypeById.mockResolvedValue({
			id: 'product-type-id',
			code: 'mens-shoes',
			name: 'Mens shoes',
			attributes: [
				{
					attributeId: enumAttribute.id,
					isVariant: true,
					isRequired: true
				}
			]
		} as any)
		repo.getCatalogTypeSchemaUpdateImpact.mockResolvedValue({
			boundProductCount: 3,
			conflictingProductCount: 2,
			obsoleteProductAttributeProductCount: 0,
			obsoleteVariantAttributeProductCount: 2,
			missingRequiredProductAttributeProductCount: 0,
			missingRequiredVariantAttributeProductCount: 0
		})

		await expect(
			runWithCatalog(() =>
				service.update('product-type-id', {
					attributes: []
				})
			)
		).rejects.toBeInstanceOf(ConflictException)
		expect(repo.updateCatalogType).not.toHaveBeenCalled()
		expect(cache.bumpVersion).not.toHaveBeenCalled()
	})

	it('allows attribute reorder without destructive schema impact check', async () => {
		repo.findCatalogTypeById.mockResolvedValue({
			id: 'product-type-id',
			code: 'mens-shoes',
			name: 'Mens shoes',
			attributes: [
				{
					attributeId: enumAttribute.id,
					isVariant: true,
					isRequired: false,
					displayOrder: 0
				}
			]
		} as any)
		repo.updateCatalogType.mockResolvedValue({ id: 'product-type-id' } as any)

		await runWithCatalog(() =>
			service.update('product-type-id', {
				attributes: [
					{
						attributeId: enumAttribute.id,
						isVariant: true,
						displayOrder: 10
					}
				]
			})
		)

		expect(repo.getCatalogTypeSchemaUpdateImpact).not.toHaveBeenCalled()
		expect(repo.updateCatalogType).toHaveBeenCalled()
		expectCatalogProductTypeInvalidation()
	})

	it('invalidates product type dependent caches after scalar update', async () => {
		repo.findCatalogTypeById.mockResolvedValue({
			id: 'product-type-id',
			code: 'mens-shoes',
			name: 'Mens shoes',
			attributes: []
		} as any)
		repo.updateCatalogType.mockResolvedValue({
			id: 'product-type-id',
			name: 'Updated shoes'
		} as any)

		await runWithCatalog(() =>
			service.update('product-type-id', {
				name: 'Updated shoes'
			})
		)

		expect(repo.updateCatalogType).toHaveBeenCalledWith(
			'product-type-id',
			catalogId,
			{ name: 'Updated shoes' },
			undefined
		)
		expectCatalogProductTypeInvalidation()
	})

	it('returns matrix editor schema for catalog product type attributes', async () => {
		const now = new Date('2026-05-11T09:00:00.000Z')
		repo.findCatalogTypeMatrixEditorSchemaById.mockResolvedValue({
			id: 'product-type-id',
			catalogId,
			scope: ProductTypeScope.CATALOG,
			code: 'mens-shoes',
			name: 'Mens shoes',
			description: null,
			isActive: true,
			isArchived: false,
			archivedAt: null,
			createdAt: now,
			updatedAt: now,
			attributes: [
				{
					productTypeId: 'product-type-id',
					attributeId: enumAttribute.id,
					isVariant: true,
					isRequired: true,
					displayOrder: 1,
					attribute: {
						...enumAttribute,
						isFilterable: true,
						isHidden: false,
						enumValues: [
							{
								id: 'size-s',
								attributeId: enumAttribute.id,
								catalogId: null,
								value: 's',
								displayName: 'S',
								displayOrder: 2,
								businessId: 'size-s-business',
								source: 'MANUAL',
								mergedIntoId: null,
								aliases: [
									{
										id: 'alias-size-small',
										attributeId: enumAttribute.id,
										catalogId: null,
										enumValueId: 'size-s',
										value: 'small',
										displayName: 'Small'
									}
								]
							},
							{
								id: 'size-m',
								attributeId: enumAttribute.id,
								catalogId: null,
								value: 'm',
								displayName: 'M',
								displayOrder: 3,
								businessId: null,
								source: 'IMPORTED',
								mergedIntoId: null,
								aliases: []
							}
						]
					}
				},
				{
					productTypeId: 'product-type-id',
					attributeId: stringAttribute.id,
					isVariant: false,
					isRequired: false,
					displayOrder: 2,
					attribute: {
						...stringAttribute,
						isFilterable: false,
						isHidden: false,
						enumValues: [
							{
								id: 'ignored',
								attributeId: stringAttribute.id,
								catalogId: null,
								value: 'ignored',
								displayName: 'Ignored',
								displayOrder: 1,
								businessId: null,
								source: 'MANUAL',
								mergedIntoId: null,
								aliases: []
							}
						]
					}
				}
			]
		} as any)

		await expect(
			runWithCatalog(() => service.getMatrixEditorSchema('product-type-id'))
		).resolves.toEqual({
			type: {
				id: 'product-type-id',
				catalogId,
				scope: ProductTypeScope.CATALOG,
				code: 'mens-shoes',
				name: 'Mens shoes',
				description: null,
				isActive: true,
				isArchived: false,
				archivedAt: null,
				createdAt: now,
				updatedAt: now
			},
			attributes: [
				{
					productTypeId: 'product-type-id',
					attributeId: enumAttribute.id,
					key: 'size',
					displayName: 'Size',
					dataType: DataType.ENUM,
					isVariant: true,
					isRequired: true,
					isFilterable: true,
					isHidden: false,
					displayOrder: 1
				},
				{
					productTypeId: 'product-type-id',
					attributeId: stringAttribute.id,
					key: 'material',
					displayName: 'Material',
					dataType: DataType.STRING,
					isVariant: false,
					isRequired: false,
					isFilterable: false,
					isHidden: false,
					displayOrder: 2
				}
			],
			variantAttributes: [
				{
					productTypeId: 'product-type-id',
					attributeId: enumAttribute.id,
					key: 'size',
					displayName: 'Size',
					dataType: DataType.ENUM,
					isVariant: true,
					isRequired: true,
					isFilterable: true,
					isHidden: false,
					displayOrder: 1
				}
			],
			requiredAttributes: [
				{
					productTypeId: 'product-type-id',
					attributeId: enumAttribute.id,
					key: 'size',
					displayName: 'Size',
					dataType: DataType.ENUM,
					isVariant: true,
					isRequired: true,
					isFilterable: true,
					isHidden: false,
					displayOrder: 1
				}
			],
			enumValues: [
				{
					id: 'size-s',
					attributeId: enumAttribute.id,
					catalogId: null,
					value: 's',
					displayName: 'S',
					displayOrder: 2,
					businessId: 'size-s-business',
					source: 'MANUAL',
					mergedIntoId: null,
					isArchived: false,
					aliases: [
						{
							id: 'alias-size-small',
							attributeId: enumAttribute.id,
							catalogId: null,
							enumValueId: 'size-s',
							value: 'small',
							displayName: 'Small'
						}
					]
				},
				{
					id: 'size-m',
					attributeId: enumAttribute.id,
					catalogId: null,
					value: 'm',
					displayName: 'M',
					displayOrder: 3,
					businessId: null,
					source: 'IMPORTED',
					mergedIntoId: null,
					isArchived: false,
					aliases: []
				}
			]
		})
		expect(repo.findCatalogTypeMatrixEditorSchemaById).toHaveBeenCalledWith(
			'product-type-id',
			catalogId
		)
	})

	it('soft archives catalog product types', async () => {
		repo.archiveCatalogType.mockResolvedValue(true)

		await expect(
			runWithCatalog(() => service.archive('product-type-id'))
		).resolves.toEqual({
			ok: true
		})
		expect(repo.archiveCatalogType).toHaveBeenCalledWith(
			'product-type-id',
			catalogId
		)
		expectCatalogProductTypeInvalidation()
	})

	it('does not invalidate catalog caches when catalog product type archive fails', async () => {
		repo.archiveCatalogType.mockResolvedValue(false)

		await expect(
			runWithCatalog(() => service.archive('product-type-id'))
		).rejects.toThrow('Product type not found')

		expect(cache.bumpVersion).not.toHaveBeenCalled()
	})

	it('does not invalidate catalog caches for system template mutations', async () => {
		repo.findSystemTemplateById.mockResolvedValue({
			id: 'template-id',
			catalogId: null,
			scope: ProductTypeScope.SYSTEM_TEMPLATE,
			code: 'mens-shoes',
			name: 'Mens shoes',
			description: null,
			isActive: true,
			isArchived: false,
			archivedAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			attributes: []
		} as any)
		repo.updateSystemTemplate.mockResolvedValue({ id: 'template-id' } as any)
		repo.archiveSystemTemplate.mockResolvedValue(true)

		await service.createSystemTemplate({
			name: 'System shoes'
		})
		await service.updateSystemTemplate('template-id', {
			name: 'Updated template'
		})
		await service.archiveSystemTemplate('template-id')

		expect(cache.bumpVersion).not.toHaveBeenCalled()
	})

	function expectCatalogProductTypeInvalidation() {
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			PRODUCTS_CACHE_VERSION,
			catalogId
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATEGORY_PRODUCTS_CACHE_VERSION,
			catalogId
		])
		expect(cache.bumpVersion.mock.calls).toContainEqual([
			CATALOG_TYPE_CACHE_VERSION,
			catalogTypeId
		])
	}

	function runWithCatalog<T>(fn: () => T): T {
		return RequestContext.run(
			{
				requestId: 'test',
				host: 'test.local',
				catalogId,
				typeId: catalogTypeId
			},
			fn
		)
	}
})

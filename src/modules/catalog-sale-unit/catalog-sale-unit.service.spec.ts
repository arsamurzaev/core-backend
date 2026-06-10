import { BadRequestException } from '@nestjs/common'

import { RequestContext } from '@/shared/tenancy/request-context'

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

const runWithChildCatalog = <T>(fn: () => Promise<T>) =>
	RequestContext.run(
		{
			requestId: 'test',
			host: 'child.catalog.test',
			catalogId: 'child-catalog-1',
			parentId: 'catalog-1'
		},
		fn
	)

function createRecord(overrides: Record<string, unknown> = {}) {
	return {
		id: 'sale-unit-1',
		catalogId: 'catalog-1',
		code: 'box',
		name: 'Box',
		defaultBaseQuantity: 1,
		barcode: null,
		isActive: true,
		displayOrder: 0,
		deleteAt: null,
		createdAt: new Date('2026-05-19T00:00:00.000Z'),
		updatedAt: new Date('2026-05-19T00:00:00.000Z'),
		...overrides
	}
}

describe('CatalogSaleUnitService', () => {
	let service: CatalogSaleUnitService
	let repo: {
		findAll: jest.Mock
		findById: jest.Mock
		findByCode: jest.Mock
		existsCode: jest.Mock
		create: jest.Mock
		update: jest.Mock
		syncVariantSnapshots: jest.Mock
	}
	let cache: { bumpVersion: jest.Mock }
	let featureEntitlements: { assertCanUseCatalogSaleUnits: jest.Mock }

	beforeEach(() => {
		repo = {
			findAll: jest.fn().mockResolvedValue([]),
			findById: jest.fn(),
			findByCode: jest.fn().mockResolvedValue(null),
			existsCode: jest.fn().mockResolvedValue(false),
			create: jest.fn(async data => createRecord(data)),
			update: jest.fn(async (_id, _catalogId, data) => [
				createRecord({
					...data,
					deleteAt: data.deleteAt ?? null
				})
			]),
			syncVariantSnapshots: jest.fn().mockResolvedValue(undefined)
		}
		cache = {
			bumpVersion: jest.fn().mockResolvedValue(undefined)
		}
		featureEntitlements = {
			assertCanUseCatalogSaleUnits: jest.fn().mockResolvedValue(undefined)
		}
		service = new CatalogSaleUnitService(
			repo as never,
			cache as never,
			featureEntitlements as never
		)
	})

	it('lists sale units with inactive and archived flags', async () => {
		await runWithCatalog(() =>
			service.getAll({ includeInactive: true, includeArchived: false })
		)

		expect(featureEntitlements.assertCanUseCatalogSaleUnits).toHaveBeenCalledWith(
			'catalog-1'
		)
		expect(repo.findAll).toHaveBeenCalledWith('catalog-1', {
			includeInactive: true,
			includeArchived: false
		})
	})

	it('rejects creating a duplicate active unit', async () => {
		repo.findByCode.mockResolvedValueOnce(createRecord())

		await expect(
			runWithCatalog(() => service.create({ name: 'Box' }))
		).rejects.toBeInstanceOf(BadRequestException)
		expect(repo.update).not.toHaveBeenCalled()
		expect(repo.create).not.toHaveBeenCalled()
	})

	it('rejects sale unit creation from child catalog', async () => {
		await expect(
			runWithChildCatalog(() => service.create({ name: 'Box' }))
		).rejects.toThrow(
			'Дочерний каталог не может управлять товарами, категориями, брендами и справочниками каталога'
		)

		expect(repo.create).not.toHaveBeenCalled()
	})

	it('restores archived unit when creating the same code', async () => {
		repo.findByCode.mockResolvedValueOnce(
			createRecord({
				isActive: false,
				deleteAt: new Date('2026-05-18T00:00:00.000Z')
			})
		)

		await runWithCatalog(() =>
			service.create({
				name: 'Box',
				code: 'box',
				defaultBaseQuantity: 12,
				displayOrder: 3
			})
		)

		expect(repo.update).toHaveBeenCalledWith(
			'sale-unit-1',
			'catalog-1',
			expect.objectContaining({
				name: 'Box',
				defaultBaseQuantity: 12,
				isActive: true,
				deleteAt: null,
				displayOrder: 3
			})
		)
	})

	it('can disable a unit without archiving it', async () => {
		repo.findById.mockResolvedValueOnce(createRecord())

		await runWithCatalog(() => service.update('sale-unit-1', { isActive: false }))

		expect(repo.update).toHaveBeenCalledWith('sale-unit-1', 'catalog-1', {
			isActive: false
		})
		expect(repo.syncVariantSnapshots).toHaveBeenCalledWith('sale-unit-1', {})
		expect(cache.bumpVersion).toHaveBeenCalledTimes(2)
	})

	it('restores an archived unit when isActive is enabled', async () => {
		repo.findById.mockResolvedValueOnce(
			createRecord({
				isActive: false,
				deleteAt: new Date('2026-05-18T00:00:00.000Z')
			})
		)

		await runWithCatalog(() => service.update('sale-unit-1', { isActive: true }))

		expect(repo.update).toHaveBeenCalledWith('sale-unit-1', 'catalog-1', {
			isActive: true,
			deleteAt: null
		})
	})

	it('syncs product binding snapshots when code or name changes', async () => {
		repo.findById.mockResolvedValueOnce(createRecord())
		repo.update.mockResolvedValueOnce([
			createRecord({ code: 'pack', name: 'Pack' })
		])

		await runWithCatalog(() =>
			service.update('sale-unit-1', { code: 'pack', name: 'Pack' })
		)

		expect(repo.syncVariantSnapshots).toHaveBeenCalledWith('sale-unit-1', {
			code: 'pack',
			name: 'Pack'
		})
		expect(cache.bumpVersion).toHaveBeenCalledTimes(2)
	})
})

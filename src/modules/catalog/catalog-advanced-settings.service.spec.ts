import { CatalogAdvancedSettingsService } from './catalog-advanced-settings.service'

describe('CatalogAdvancedSettingsService', () => {
	let service: CatalogAdvancedSettingsService
	let saleUnits: {
		getAll: jest.Mock
		getById: jest.Mock
		create: jest.Mock
		update: jest.Mock
		archive: jest.Mock
	}

	beforeEach(() => {
		saleUnits = {
			getAll: jest.fn().mockResolvedValue([]),
			getById: jest.fn(),
			create: jest.fn(),
			update: jest.fn(),
			archive: jest.fn()
		}

		service = new CatalogAdvancedSettingsService(
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			saleUnits as never,
			{} as never
		)
	})

	it('delegates sale unit settings to catalog sale unit service', async () => {
		const createDto = {
			name: 'Box',
			code: 'box',
			defaultBaseQuantity: 12
		}
		const updateDto = {
			displayOrder: 10,
			isActive: false
		}

		await service.listSaleUnits({
			includeInactive: true,
			includeArchived: false
		})
		await service.getSaleUnit('sale-unit-1')
		await service.createSaleUnit(createDto)
		await service.updateSaleUnit('sale-unit-1', updateDto)
		await service.archiveSaleUnit('sale-unit-1')

		expect(saleUnits.getAll).toHaveBeenCalledWith({
			includeInactive: true,
			includeArchived: false
		})
		expect(saleUnits.getById).toHaveBeenCalledWith('sale-unit-1')
		expect(saleUnits.create).toHaveBeenCalledWith(createDto)
		expect(saleUnits.update).toHaveBeenCalledWith('sale-unit-1', updateDto)
		expect(saleUnits.archive).toHaveBeenCalledWith('sale-unit-1')
	})
})

import { BadRequestException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { overrideControllerAuthGuards } from '@/shared/testing/controller-guards.testing'

import { CatalogAdvancedSettingsController } from './catalog-advanced-settings.controller'
import { CatalogAdvancedSettingsService } from './catalog-advanced-settings.service'

describe('CatalogAdvancedSettingsController', () => {
	let controller: CatalogAdvancedSettingsController
	let service: {
		listSaleUnits: jest.Mock
		getSaleUnit: jest.Mock
		createSaleUnit: jest.Mock
		updateSaleUnit: jest.Mock
		archiveSaleUnit: jest.Mock
	}

	beforeEach(async () => {
		service = {
			listSaleUnits: jest.fn().mockResolvedValue([]),
			getSaleUnit: jest.fn(),
			createSaleUnit: jest.fn(),
			updateSaleUnit: jest.fn(),
			archiveSaleUnit: jest.fn()
		}

		const module: TestingModule = await overrideControllerAuthGuards(
			Test.createTestingModule({
				controllers: [CatalogAdvancedSettingsController],
				providers: [
					{
						provide: CatalogAdvancedSettingsService,
						useValue: service
					}
				]
			})
		).compile()

		controller = module.get(CatalogAdvancedSettingsController)
	})

	it('delegates sale unit listing with detailed filters', async () => {
		await controller.listSaleUnits('true', '0')

		expect(service.listSaleUnits).toHaveBeenCalledWith({
			includeInactive: true,
			includeArchived: false
		})
	})

	it('rejects invalid sale unit boolean filters', async () => {
		expect(() => controller.listSaleUnits('sometimes', undefined)).toThrow(
			BadRequestException
		)
	})

	it('delegates sale unit creation, update and archive', async () => {
		const createDto = {
			name: 'Box',
			code: 'box',
			defaultBaseQuantity: 12
		}
		const updateDto = {
			name: 'Pack',
			isActive: false
		}

		await controller.createSaleUnit(createDto)
		await controller.updateSaleUnit('sale-unit-1', updateDto)
		await controller.archiveSaleUnit('sale-unit-1')

		expect(service.createSaleUnit).toHaveBeenCalledWith(createDto)
		expect(service.updateSaleUnit).toHaveBeenCalledWith('sale-unit-1', updateDto)
		expect(service.archiveSaleUnit).toHaveBeenCalledWith('sale-unit-1')
	})
})

import {
	IntegrationSyncRunMode,
	IntegrationSyncRunTrigger
} from '@generated/enums'
import { Test, TestingModule } from '@nestjs/testing'

import { overrideControllerAuthGuards } from '@/shared/testing/controller-guards.testing'

import { IntegrationController } from './integration.controller'
import { IntegrationService } from './integration.service'

describe('IntegrationController', () => {
	let controller: IntegrationController
	let service: jest.Mocked<IntegrationService>

	beforeEach(async () => {
		const module: TestingModule = await overrideControllerAuthGuards(
			Test.createTestingModule({
				controllers: [IntegrationController],
				providers: [
					{
						provide: IntegrationService,
						useValue: {
							getMoySklad: jest.fn(),
							getMoySkladStatus: jest.fn(),
							getMoySkladRuns: jest.fn(),
							upsertMoySklad: jest.fn(),
							updateMoySklad: jest.fn(),
							removeMoySklad: jest.fn(),
							testMoySkladConnection: jest.fn(),
							syncMoySkladCatalog: jest.fn(),
							syncMoySkladProduct: jest.fn()
						}
					}
				]
			})
		).compile()

		controller = module.get(IntegrationController)
		service = module.get(IntegrationService)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})

	it('delegates product sync to service', async () => {
		service.syncMoySkladProduct.mockResolvedValue({
			ok: true,
			queued: true,
			runId: 'run-1',
			jobId: 'job-1',
			mode: IntegrationSyncRunMode.PRODUCT,
			trigger: IntegrationSyncRunTrigger.MANUAL
		})

		const result = await controller.syncMoySkladProduct('product-1')

		expect(service.syncMoySkladProduct).toHaveBeenCalledWith('product-1')
		expect(result.runId).toBe('run-1')
	})
})

import { Test, TestingModule } from '@nestjs/testing'

import { RegionalityService } from './regionality.service'

describe('RegionalityService', () => {
	let service: RegionalityService

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [RegionalityService]
		}).compile()

		service = module.get<RegionalityService>(RegionalityService)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})
})

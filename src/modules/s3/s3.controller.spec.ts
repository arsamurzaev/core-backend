import { Test, TestingModule } from '@nestjs/testing'

import { S3Controller } from './s3.controller'
import { S3Service } from './s3.service'

describe('S3Controller', () => {
	let controller: S3Controller

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [S3Controller],
			providers: [
				{
					provide: S3Service,
					useValue: {
						createPresignedUpload: jest.fn(),
						createPresignedPost: jest.fn(),
						startMultipartUpload: jest.fn(),
						createMultipartPartUrl: jest.fn(),
						completeMultipartUpload: jest.fn(),
						abortMultipartUpload: jest.fn(),
						enqueueFromS3: jest.fn(),
						getUploadStatus: jest.fn()
					}
				}
			]
		}).compile()

		controller = module.get<S3Controller>(S3Controller)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})
})

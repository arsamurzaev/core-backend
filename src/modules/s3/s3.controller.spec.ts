import { Test, TestingModule } from '@nestjs/testing'

import { overrideControllerAuthGuards } from '@/shared/testing/controller-guards.testing'

import { S3Controller } from './s3.controller'
import { S3Service } from './s3.service'

describe('S3Controller', () => {
	let controller: S3Controller
	let s3Service: jest.Mocked<S3Service>

	beforeEach(async () => {
		const module: TestingModule = await overrideControllerAuthGuards(
			Test.createTestingModule({
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
			})
		).compile()

		controller = module.get<S3Controller>(S3Controller)
		s3Service = module.get(S3Service)
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})

	it('enqueues single key from body.key', async () => {
		s3Service.enqueueFromS3.mockResolvedValue({
			ok: true,
			jobId: '1',
			count: 1
		} as any)

		await controller.enqueueFromS3({
			key: ' catalogs/catalog-1/products/2026/02/09/raw/file.jpg '
		} as any)

		expect(s3Service.enqueueFromS3.mock.calls).toContainEqual([
			[{ key: 'catalogs/catalog-1/products/2026/02/09/raw/file.jpg' }]
		])
	})

	it('enqueues merged list from key and items', async () => {
		s3Service.enqueueFromS3.mockResolvedValue({
			ok: true,
			jobId: '1',
			count: 2
		} as any)

		await controller.enqueueFromS3({
			key: 'catalogs/catalog-1/products/2026/02/09/raw/first.jpg',
			items: [{ key: 'catalogs/catalog-1/products/2026/02/09/raw/second.jpg' }]
		} as any)

		expect(s3Service.enqueueFromS3.mock.calls).toContainEqual([
			[
				{ key: 'catalogs/catalog-1/products/2026/02/09/raw/first.jpg' },
				{ key: 'catalogs/catalog-1/products/2026/02/09/raw/second.jpg' }
			]
		])
	})

	it('throws when neither key nor items passed', async () => {
		await expect(controller.enqueueFromS3({} as any)).rejects.toThrow(
			'Список ключей пуст'
		)
	})
})

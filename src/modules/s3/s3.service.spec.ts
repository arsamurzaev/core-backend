import {
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	PutObjectCommand,
	UploadPartCommand
} from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { ConfigService } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'

import { AllInterfaces } from '@/core/config'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { RequestContext } from '@/shared/tenancy/request-context'

import { S3Service } from './s3.service'

type PresignedPostCallOptions = {
	Bucket: string
	Key: string
	Fields: Record<string, string>
	Conditions: unknown[]
	Expires: number
}

type UploadQueueMock = {
	add: jest.Mock
	getJob: jest.Mock
	close: jest.Mock
}

type PrivateS3Methods = {
	saveTempFile: (file: unknown) => Promise<string>
	headObject: (
		key: string
	) => Promise<{ ContentType?: string; ContentLength?: number }>
}

jest.mock('@aws-sdk/s3-request-presigner', () => ({
	getSignedUrl: jest.fn()
}))

jest.mock('@aws-sdk/s3-presigned-post', () => ({
	createPresignedPost: jest.fn()
}))

jest.mock('bullmq', () => ({
	Queue: jest.fn().mockImplementation(() => ({
		add: jest.fn(),
		getJob: jest.fn(),
		close: jest.fn()
	})),
	Worker: jest.fn().mockImplementation(() => ({
		on: jest.fn(),
		close: jest.fn()
	})),
	Job: class {}
}))

describe('S3Service', () => {
	let service: S3Service
	let prisma: {
		media: {
			create: jest.Mock
			updateMany: jest.Mock
		}
	}
	let sendMock: jest.Mock

	const mockedGetSignedUrl = jest.mocked(getSignedUrl)
	const mockedCreatePresignedPost = jest.mocked(createPresignedPost)

	const runWithCatalog = <T>(fn: () => Promise<T>) =>
		RequestContext.run(
			{
				requestId: 'req-1',
				host: 'example.test',
				catalogId: 'catalog-1'
			},
			fn
		)

	const getUploadQueue = (): UploadQueueMock =>
		(
			service as unknown as {
				uploadQueue: UploadQueueMock
			}
		).uploadQueue

	beforeEach(async () => {
		prisma = {
			media: {
				create: jest.fn(),
				updateMany: jest.fn()
			}
		}

		const s3Config = {
			enabled: true,
			bucket: 'catalog-bucket',
			region: 'us-east-1',
			endpoint: null,
			publicUrl: 'https://cdn.example.test',
			forcePathStyle: false,
			publicRead: false,
			imageQuality: 82,
			imageVariants: [1600, 900, 400],
			imageFormats: ['webp', 'avif'],
			maxFileSizeMb: 10,
			storeOriginal: false,
			presignExpiresSec: 600,
			accessKeyId: 'test-access-key',
			secretAccessKey: 'test-secret-key'
		} satisfies AllInterfaces['s3']

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				S3Service,
				{
					provide: ConfigService,
					useValue: {
						get: jest.fn((key: string) => {
							if (key === 's3') return s3Config
							if (key === 'redis') {
								return {
									host: '127.0.0.1',
									port: 6379
								}
							}
							return undefined
						})
					}
				},
				{
					provide: PrismaService,
					useValue: prisma
				}
			]
		}).compile()

		service = module.get<S3Service>(S3Service)
		sendMock = jest.fn()
		;(service as unknown as { client: { send: jest.Mock } }).client = {
			send: sendMock
		}

		mockedGetSignedUrl.mockReset()
		mockedCreatePresignedPost.mockReset()
		jest.restoreAllMocks()
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	it('creates presigned upload with normalized content type and raw key', async () => {
		prisma.media.create.mockResolvedValue({ id: 'media-1' })
		mockedGetSignedUrl.mockResolvedValue('https://signed.example/upload')

		const result = await runWithCatalog(() =>
			service.createPresignedUpload(' IMAGE/WEBP ', {
				folder: 'Catalog Images',
				entityId: 'Entity 1'
			})
		)

		expect(result.ok).toBe(true)
		expect(result.mediaId).toBe('media-1')
		expect(result.uploadUrl).toBe('https://signed.example/upload')
		expect(result.expiresIn).toBe(600)
		expect(result.url).toMatch(/^https:\/\/cdn\.example\.test\//)

		const signedUrlCall = mockedGetSignedUrl.mock.calls.at(0) as
			| [unknown, PutObjectCommand]
			| undefined
		expect(signedUrlCall).toBeDefined()
		const command = signedUrlCall?.[1]
		expect(command).toBeInstanceOf(PutObjectCommand)
		expect(command?.input.Bucket).toBe('catalog-bucket')
		expect(command?.input.ContentType).toBe('image/webp')
		expect(command?.input.CacheControl).toBe('private, max-age=0')
		expect(command?.input.Key).toMatch(
			/^catalogs\/catalog-1\/catalog-images\/entity-1\/\d{4}\/\d{2}\/\d{2}\/raw\/.+\.webp$/
		)

		const mediaCreateCall = prisma.media.create.mock.calls.at(0) as
			| [{ data: Record<string, unknown> }]
			| undefined
		expect(mediaCreateCall).toBeDefined()
		expect(mediaCreateCall?.[0].data.catalogId).toBe('catalog-1')
		expect(mediaCreateCall?.[0].data.mimeType).toBe('image/webp')
		expect(mediaCreateCall?.[0].data.path).toBe('catalog-images')
		expect(mediaCreateCall?.[0].data.entityId).toBe('Entity 1')
		expect(mediaCreateCall?.[0].data.status).toBe('UPLOADED')
	})

	it('creates presigned post with normalized fields and max file size', async () => {
		prisma.media.create.mockResolvedValue({ id: 'media-2' })
		mockedCreatePresignedPost.mockResolvedValue({
			url: 'https://signed.example/post',
			fields: {
				key: 'raw-key',
				policy: 'policy-value'
			}
		})

		const result = await runWithCatalog(() =>
			service.createPresignedPost(
				' image/png ',
				{
					path: 'Products/Gallery'
				},
				1024
			)
		)

		expect(result.ok).toBe(true)
		expect(result.mediaId).toBe('media-2')
		expect(result.uploadUrl).toBe('https://signed.example/post')
		expect(result.maxFileBytes).toBe(10 * 1024 * 1024)

		const presignedPostCall = mockedCreatePresignedPost.mock.calls.at(0) as
			| [unknown, PresignedPostCallOptions]
			| undefined
		expect(presignedPostCall).toBeDefined()
		const options = presignedPostCall?.[1]
		expect(options?.Bucket).toBe('catalog-bucket')
		expect(options?.Key).toMatch(
			/^catalogs\/catalog-1\/products\/gallery\/\d{4}\/\d{2}\/\d{2}\/raw\/.+\.png$/
		)
		expect(options?.Fields['Content-Type']).toBe('image/png')
		expect(options?.Conditions).toEqual(
			expect.arrayContaining([
				['content-length-range', 1, 10 * 1024 * 1024],
				['eq', '$Content-Type', 'image/png']
			])
		)
		expect(options?.Expires).toBe(600)
	})

	it('starts multipart upload with normalized key and persists presign record', async () => {
		prisma.media.create.mockResolvedValue({ id: 'media-3' })
		sendMock.mockResolvedValue({ UploadId: 'upload-1' })

		const result = await runWithCatalog(() =>
			service.startMultipartUpload({
				contentType: ' image/png ',
				fileSize: 6 * 1024 * 1024,
				partSizeMb: 6,
				path: 'products/gallery',
				entityId: 'entity-1'
			})
		)

		expect(result.ok).toBe(true)
		expect(result.mediaId).toBe('media-3')
		expect(result.uploadId).toBe('upload-1')
		expect(result.partCount).toBe(1)
		expect(result.partSize).toBe(6 * 1024 * 1024)

		const sendCall = sendMock.mock.calls.at(0) as
			| [CreateMultipartUploadCommand]
			| undefined
		expect(sendCall).toBeDefined()
		const command = sendCall?.[0]
		expect(command).toBeInstanceOf(CreateMultipartUploadCommand)
		expect(command?.input.Bucket).toBe('catalog-bucket')
		expect(command?.input.ContentType).toBe('image/png')
		expect(command?.input.Key).toMatch(
			/^catalogs\/catalog-1\/products\/gallery\/entity-1\/\d{4}\/\d{2}\/\d{2}\/raw\/.+\.png$/
		)
	})

	it('creates multipart part url with trimmed key and upload id', async () => {
		mockedGetSignedUrl.mockResolvedValue('https://signed.example/part')

		const result = await runWithCatalog(() =>
			service.createMultipartPartUrl(
				'  catalogs/catalog-1/images/2026/03/12/raw/file.webp  ',
				'  upload-1  ',
				2
			)
		)

		expect(result).toEqual({
			ok: true,
			partNumber: 2,
			uploadUrl: 'https://signed.example/part'
		})

		const signedUrlCall = mockedGetSignedUrl.mock.calls.at(0) as
			| [unknown, UploadPartCommand]
			| undefined
		expect(signedUrlCall).toBeDefined()
		const command = signedUrlCall?.[1]
		expect(command).toBeInstanceOf(UploadPartCommand)
		expect(command?.input.Bucket).toBe('catalog-bucket')
		expect(command?.input.Key).toBe(
			'catalogs/catalog-1/images/2026/03/12/raw/file.webp'
		)
		expect(command?.input.UploadId).toBe('upload-1')
		expect(command?.input.PartNumber).toBe(2)
	})

	it('completes multipart upload with normalized sorted parts and enqueues processing', async () => {
		sendMock.mockResolvedValue({})
		const enqueueFromS3Spy = jest
			.spyOn(service, 'enqueueFromS3')
			.mockResolvedValue({ ok: true, jobId: 'job-1', count: 1 })

		const result = await runWithCatalog(() =>
			service.completeMultipartUpload({
				key: '  catalogs/catalog-1/images/2026/03/12/raw/file.webp  ',
				uploadId: '  upload-1  ',
				parts: [
					{ partNumber: 2, etag: 'etag-2' },
					{ partNumber: 1, etag: '"etag-1"' },
					{ partNumber: 3, etag: '   ' }
				]
			})
		)

		expect(result).toEqual({
			ok: true,
			key: 'catalogs/catalog-1/images/2026/03/12/raw/file.webp',
			jobId: 'job-1',
			count: 1
		})

		const sendCall = sendMock.mock.calls.at(0) as
			| [CompleteMultipartUploadCommand]
			| undefined
		expect(sendCall).toBeDefined()
		const command = sendCall?.[0]
		expect(command).toBeInstanceOf(CompleteMultipartUploadCommand)
		expect(command?.input.MultipartUpload?.Parts).toEqual([
			{ PartNumber: 1, ETag: '"etag-1"' },
			{ PartNumber: 2, ETag: '"etag-2"' }
		])

		expect(enqueueFromS3Spy).toHaveBeenCalledWith([
			{ key: 'catalogs/catalog-1/images/2026/03/12/raw/file.webp' }
		])
	})

	it('enqueues uploaded files as queue items with catalog context', async () => {
		const uploadQueue = getUploadQueue()
		uploadQueue.add.mockResolvedValue({ id: 'job-queue-1' })

		const privateMethods = service as unknown as PrivateS3Methods
		const saveTempFileSpy = jest
			.spyOn(privateMethods, 'saveTempFile')
			.mockResolvedValueOnce('C:\\temp\\upload-1.webp')
			.mockResolvedValueOnce('C:\\temp\\upload-2.png')

		const result = await runWithCatalog(() =>
			service.enqueueImages(
				[
					{
						buffer: Buffer.from('image-1'),
						size: 7,
						mimetype: 'image/webp',
						originalname: 'first.webp'
					},
					{
						buffer: Buffer.from('image-2'),
						size: 7,
						mimetype: 'image/png',
						originalname: 'second.png'
					}
				],
				[{ folder: 'Gallery', entityId: 'entity-1' }, { path: 'products/gallery' }]
			)
		)

		expect(result).toEqual({
			ok: true,
			jobId: 'job-queue-1',
			count: 2
		})
		expect(saveTempFileSpy).toHaveBeenCalledTimes(2)
		expect(uploadQueue.add).toHaveBeenCalledWith('upload', {
			items: [
				{
					source: 'file',
					filePath: 'C:\\temp\\upload-1.webp',
					mimetype: 'image/webp',
					size: 7,
					originalName: 'first.webp',
					options: {
						catalogId: 'catalog-1',
						folder: 'Gallery',
						entityId: 'entity-1'
					}
				},
				{
					source: 'file',
					filePath: 'C:\\temp\\upload-2.png',
					mimetype: 'image/png',
					size: 7,
					originalName: 'second.png',
					options: {
						catalogId: 'catalog-1',
						path: 'products/gallery'
					}
				}
			]
		})
	})

	it('prepares s3 queue items, marks media as processing and enqueues job', async () => {
		const uploadQueue = getUploadQueue()
		uploadQueue.add.mockResolvedValue({ id: 'job-queue-2' })

		const privateMethods = service as unknown as PrivateS3Methods
		const headObjectSpy = jest
			.spyOn(privateMethods, 'headObject')
			.mockResolvedValueOnce({
				ContentType: 'image/webp',
				ContentLength: 123
			})
			.mockResolvedValueOnce({
				ContentType: 'image/png',
				ContentLength: 456
			})

		const result = await runWithCatalog(() =>
			service.enqueueFromS3([
				{ key: ' catalogs/catalog-1/images/2026/03/12/raw/first.webp ' },
				{ key: 'catalogs/catalog-1/images/2026/03/12/raw/second.png' }
			])
		)

		expect(result).toEqual({
			ok: true,
			jobId: 'job-queue-2',
			count: 2
		})
		expect(headObjectSpy).toHaveBeenCalledTimes(2)
		expect(prisma.media.updateMany).toHaveBeenCalledWith({
			where: {
				catalogId: 'catalog-1',
				key: {
					in: [
						'catalogs/catalog-1/images/2026/03/12/raw/first.webp',
						'catalogs/catalog-1/images/2026/03/12/raw/second.png'
					]
				}
			},
			data: { status: 'PROCESSING' }
		})
		expect(uploadQueue.add).toHaveBeenCalledWith('upload', {
			items: [
				{
					source: 's3',
					key: 'catalogs/catalog-1/images/2026/03/12/raw/first.webp',
					mimetype: 'image/webp',
					size: 123,
					options: { catalogId: 'catalog-1' }
				},
				{
					source: 's3',
					key: 'catalogs/catalog-1/images/2026/03/12/raw/second.png',
					mimetype: 'image/png',
					size: 456,
					options: { catalogId: 'catalog-1' }
				}
			]
		})
	})

	it('returns completed upload status with single result payload', async () => {
		const uploadQueue = getUploadQueue()
		uploadQueue.getJob.mockResolvedValue({
			getState: jest.fn().mockResolvedValue('completed'),
			progress: 47,
			returnvalue: [
				{
					ok: true,
					mediaId: 'media-1',
					key: 'key-1',
					url: 'https://cdn.example.test/key-1',
					variants: []
				}
			],
			failedReason: null
		})

		const result = await runWithCatalog(() => service.getUploadStatus('job-1'))

		expect(result).toEqual({
			ok: true,
			status: 'completed',
			progress: 100,
			result: {
				ok: true,
				mediaId: 'media-1',
				key: 'key-1',
				url: 'https://cdn.example.test/key-1',
				variants: []
			}
		})
	})

	it('returns failed upload status with existing error payload', async () => {
		const uploadQueue = getUploadQueue()
		uploadQueue.getJob.mockResolvedValue({
			getState: jest.fn().mockResolvedValue('failed'),
			progress: 42.2,
			returnvalue: [],
			failedReason: ''
		})

		const result = await runWithCatalog(() => service.getUploadStatus('job-2'))

		expect(result).toEqual({
			ok: true,
			status: 'failed',
			progress: 42,
			error: ''
		})
	})
})

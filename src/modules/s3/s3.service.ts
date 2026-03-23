import {
	AbortMultipartUploadCommand,
	CompleteMultipartUploadCommand,
	CreateMultipartUploadCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
	UploadPartCommand
} from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { MediaStatus } from '@generated/enums'
import {
	BadRequestException,
	Injectable,
	InternalServerErrorException,
	Logger,
	NotFoundException,
	type OnModuleDestroy
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Job, Queue, Worker } from 'bullmq'
import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import sharp from 'sharp'
import slugify from 'slugify'

import { AllInterfaces } from '@/core/config'
import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { mustCatalogId } from '@/shared/tenancy/ctx'

const DEFAULT_VARIANT_WIDTHS = [1200, 800, 400]
const DEFAULT_IMAGE_FORMATS = ['avif']
const DEFAULT_VARIANT_NAMES = new Map<number, string>([
	[1600, 'detail'],
	[1400, 'detail'],
	[1200, 'detail'],
	[900, 'card'],
	[800, 'card'],
	[600, 'card'],
	[400, 'thumb'],
	[320, 'thumb'],
	[200, 'thumb']
])
const RAW_SEGMENT = 'raw'
const MULTIPART_MIN_PART_BYTES = 5 * 1024 * 1024
const MULTIPART_MAX_PART_BYTES = 5 * 1024 * 1024 * 1024
const MULTIPART_MAX_PARTS = 10000
const MULTIPART_DEFAULT_PART_BYTES = 64 * 1024 * 1024

const ALLOWED_IMAGE_MIME = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/avif'
])

const CONTENT_TYPE_EXTENSION: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/avif': 'avif'
}

const UPLOAD_QUEUE_NAME = 's3-image-uploads'
const UPLOAD_QUEUE_CONCURRENCY = 2
const TEMP_PREFIX = 'catalog-upload'

type ImageVariant = {
	name: string
	width: number
	key: string
	url: string
	height: number
	size: number
	contentType: string
}

type PreparedVariant = {
	name: string
	width: number
	buffer: Buffer
	key: string
	height: number
	size: number
	contentType: string
}

type CatalogUploadTargetOptions = {
	catalogId?: string
	path?: string
	folder?: string
	entityId?: string
}

type RawObjectTarget = {
	catalogId: string
	mimeType: string
	key: string
	path?: string
	entityId?: string
}

type CompletedMultipartPart = {
	PartNumber: number
	ETag: string
}

type UploadQueueResult = {
	ok: true
	jobId: string
	count: number
}

export type UploadImageOptions = {
	path?: string
	folder?: string
	entityId?: string
	catalogId?: string
}

export type UploadedImageFile = {
	buffer: Buffer
	size: number
	mimetype: string
	originalname?: string
}

export type UploadImageResult = {
	ok: true
	mediaId: string
	key: string
	url: string
	variants: ImageVariant[]
}

export type PresignUploadResult = {
	ok: true
	mediaId: string
	uploadUrl: string
	key: string
	url: string
	expiresIn: number
}

export type PresignPostResult = {
	ok: true
	mediaId: string
	uploadUrl: string
	fields: Record<string, string>
	key: string
	url: string
	expiresIn: number
	maxFileBytes: number
}

export type MultipartStartResult = {
	ok: true
	mediaId: string
	uploadId: string
	key: string
	url: string
	partSize: number
	partCount: number
}

export type MultipartPartResult = {
	ok: true
	partNumber: number
	uploadUrl: string
}

export type MultipartCompleteResult = {
	ok: true
	key: string
	jobId: string
	count: number
}

type UploadQueueItem = {
	source: 'file' | 's3'
	filePath?: string
	key?: string
	mimetype?: string
	size?: number
	originalName?: string
	options: UploadImageOptions
}

type UploadQueueJob = {
	items: UploadQueueItem[]
}

@Injectable()
export class S3Service implements OnModuleDestroy {
	private readonly client: S3Client | null
	private readonly enabled: boolean
	private readonly bucket: string
	private readonly region: string
	private readonly endpoint: string | null
	private readonly publicUrl: string | null
	private readonly forcePathStyle: boolean
	private readonly publicRead: boolean
	private readonly imageQuality: number
	private readonly variantWidths: number[]
	private readonly imageFormats: string[]
	private readonly maxFileBytes: number
	private readonly storeOriginal: boolean
	private readonly presignExpiresSec: number
	private readonly logger = new Logger(S3Service.name)
	private readonly uploadQueue: Queue<UploadQueueJob, UploadImageResult[]> | null
	private readonly uploadWorker: Worker<
		UploadQueueJob,
		UploadImageResult[]
	> | null

	constructor(
		private readonly configService: ConfigService<AllInterfaces>,
		private readonly prisma: PrismaService
	) {
		const config = this.configService.get('s3', { infer: true })

		this.enabled = config?.enabled ?? false
		this.bucket = config?.bucket ?? ''
		this.region = config?.region ?? 'ru-1'
		this.endpoint = config?.endpoint ?? null
		this.publicUrl = config?.publicUrl ?? null
		this.forcePathStyle = config?.forcePathStyle ?? false
		this.publicRead = config?.publicRead ?? false
		this.imageQuality = config?.imageQuality ?? 82
		this.variantWidths = config?.imageVariants?.length
			? config.imageVariants
			: [...DEFAULT_VARIANT_WIDTHS]
		this.imageFormats = config?.imageFormats?.length
			? config.imageFormats
			: [...DEFAULT_IMAGE_FORMATS]
		this.maxFileBytes = (config?.maxFileSizeMb ?? 10) * 1024 * 1024
		this.storeOriginal = config?.storeOriginal ?? false
		this.presignExpiresSec = config?.presignExpiresSec ?? 600

		if (!this.enabled) {
			this.client = null
			this.uploadQueue = null
			this.uploadWorker = null
			return
		}

		this.client = new S3Client({
			region: this.region,
			endpoint: this.endpoint ?? undefined,
			forcePathStyle: this.forcePathStyle,
			credentials: {
				accessKeyId: config.accessKeyId ?? '',
				secretAccessKey: config.secretAccessKey ?? ''
			}
		})

		const redis = this.configService.get('redis', { infer: true })
		const connection: Record<string, any> = {
			host: redis?.host ?? '127.0.0.1',
			port: redis?.port ?? 6379
		}
		if (redis?.user) connection.username = redis.user
		if (redis?.password) connection.password = redis.password

		this.uploadQueue = new Queue<UploadQueueJob, UploadImageResult[]>(
			UPLOAD_QUEUE_NAME,
			{
				connection,
				defaultJobOptions: {
					attempts: 3,
					backoff: { type: 'exponential', delay: 5000 },
					removeOnComplete: { age: 86400 },
					removeOnFail: { age: 86400 }
				}
			}
		)

		this.uploadWorker = new Worker<UploadQueueJob, UploadImageResult[]>(
			UPLOAD_QUEUE_NAME,
			job => this.processUploadJob(job),
			{
				connection,
				concurrency: UPLOAD_QUEUE_CONCURRENCY
			}
		)

		this.uploadWorker.on('failed', (job, error) => {
			this.logger.error('Ошибка очереди загрузки', {
				jobId: job?.id,
				error: error?.message ?? error
			})
		})
	}

	async onModuleDestroy() {
		await this.uploadWorker?.close()
		await this.uploadQueue?.close()
	}

	async uploadImage(
		file: UploadedImageFile,
		options: UploadImageOptions = {}
	): Promise<UploadImageResult> {
		this.assertUploadEnabled()
		this.assertFileValid(file)

		const catalogId = options.catalogId ?? mustCatalogId()
		const prefix = this.buildPrefix(catalogId, options)
		const baseKey = `${prefix}/${randomUUID()}`

		const metadata = await this.readMetadata(file.buffer)
		const variants = await this.buildVariants(file.buffer, baseKey, metadata)

		await Promise.all(
			variants.map(variant =>
				this.putObject(variant.key, variant.buffer, variant.contentType)
			)
		)

		const mediaId = await this.createMediaRecord({
			catalogId,
			originalName: file.originalname,
			mimeType: file.mimetype,
			size: file.size,
			width: metadata.width,
			height: metadata.height,
			rawKey: variants[0]?.key ?? baseKey,
			variants,
			path: options.path ?? options.folder,
			entityId: options.entityId
		})

		return this.buildResponse(variants, mediaId)
	}

	async createPresignedUpload(
		contentType: string,
		options: UploadImageOptions = {}
	): Promise<PresignUploadResult> {
		this.assertUploadEnabled()
		const target = this.prepareRawObjectTarget(contentType, options)

		const command = new PutObjectCommand({
			Bucket: this.bucket,
			Key: target.key,
			ContentType: target.mimeType,
			CacheControl: 'private, max-age=0',
			...(this.publicRead ? { ACL: 'public-read' } : {})
		})

		const uploadUrl = await getSignedUrl(this.client, command, {
			expiresIn: this.presignExpiresSec
		})

		const mediaId = await this.createPresignRecord({
			catalogId: target.catalogId,
			key: target.key,
			mimeType: target.mimeType,
			path: target.path,
			entityId: target.entityId
		})

		return {
			ok: true,
			mediaId,
			uploadUrl,
			key: target.key,
			url: this.buildPublicUrl(target.key),
			expiresIn: this.presignExpiresSec
		}
	}

	async createPresignedPost(
		contentType: string,
		options: UploadImageOptions = {},
		contentLength?: number
	): Promise<PresignPostResult> {
		this.assertUploadEnabled()
		const target = this.prepareRawObjectTarget(contentType, options)
		if (contentLength && contentLength > this.maxFileBytes) {
			this.assertFileSizeWithinLimit(contentLength)
		}

		const baseFields: Record<string, string> = {
			key: target.key,
			'Content-Type': target.mimeType
		}
		if (this.publicRead) {
			baseFields.acl = 'public-read'
		}

		const { url: uploadUrl, fields } = await createPresignedPost(this.client, {
			Bucket: this.bucket,
			Key: target.key,
			Fields: baseFields,
			Conditions: [
				['content-length-range', 1, this.maxFileBytes],
				['eq', '$Content-Type', target.mimeType]
			],
			Expires: this.presignExpiresSec
		})

		const mediaId = await this.createPresignRecord({
			catalogId: target.catalogId,
			key: target.key,
			mimeType: target.mimeType,
			path: target.path,
			entityId: target.entityId
		})

		return {
			ok: true,
			mediaId,
			uploadUrl,
			fields,
			key: target.key,
			url: this.buildPublicUrl(target.key),
			expiresIn: this.presignExpiresSec,
			maxFileBytes: this.maxFileBytes
		}
	}

	async enqueueImages(files: UploadedImageFile[], items: UploadImageOptions[]) {
		this.assertQueueEnabled()

		if (!files.length) {
			throw new BadRequestException('Файлы не переданы')
		}

		const catalogId = mustCatalogId()
		const preparedItems = await this.prepareFileQueueItems(
			files,
			items,
			catalogId
		)
		return this.enqueuePreparedItems(preparedItems)
	}

	async startMultipartUpload(params: {
		contentType: string
		fileSize: number
		partSizeMb?: number
		path?: string
		folder?: string
		entityId?: string
	}): Promise<MultipartStartResult> {
		this.assertUploadEnabled()
		const target = this.prepareRawObjectTarget(params.contentType, params)

		const fileSize = Number(params.fileSize)
		if (!Number.isFinite(fileSize) || fileSize <= 0) {
			throw new BadRequestException('Некорректный размер файла')
		}
		this.assertFileSizeWithinLimit(fileSize)

		const partSize = this.resolveMultipartPartSize(fileSize, params.partSizeMb)
		const partCount = Math.ceil(fileSize / partSize)
		if (partCount > MULTIPART_MAX_PARTS) {
			throw new BadRequestException('Слишком много частей. Увеличьте размер части')
		}

		const command = new CreateMultipartUploadCommand({
			Bucket: this.bucket,
			Key: target.key,
			ContentType: target.mimeType,
			CacheControl: 'private, max-age=0',
			...(this.publicRead ? { ACL: 'public-read' } : {})
		})

		const response = await this.client.send(command)
		if (!response.UploadId) {
			throw new BadRequestException('Не удалось создать multipart загрузку')
		}

		const mediaId = await this.createPresignRecord({
			catalogId: target.catalogId,
			key: target.key,
			mimeType: target.mimeType,
			path: target.path,
			entityId: target.entityId
		})

		return {
			ok: true,
			mediaId,
			uploadId: response.UploadId,
			key: target.key,
			url: this.buildPublicUrl(target.key),
			partSize,
			partCount
		}
	}

	async createMultipartPartUrl(
		key: string,
		uploadId: string,
		partNumber: number
	): Promise<MultipartPartResult> {
		this.assertUploadEnabled()
		const cleanedKey = this.normalizeRequiredKey(key)
		const cleanedUploadId = this.normalizeRequiredUploadId(uploadId)
		this.assertMultipartPartNumber(partNumber)

		const catalogId = mustCatalogId()
		this.assertKeyBelongsToCatalog(cleanedKey, catalogId)

		const command = new UploadPartCommand({
			Bucket: this.bucket,
			Key: cleanedKey,
			UploadId: cleanedUploadId,
			PartNumber: partNumber
		})

		const uploadUrl = await getSignedUrl(this.client, command, {
			expiresIn: this.presignExpiresSec
		})

		return { ok: true, partNumber, uploadUrl }
	}

	async completeMultipartUpload(params: {
		key: string
		uploadId: string
		parts: { partNumber: number; etag: string }[]
	}): Promise<MultipartCompleteResult> {
		this.assertUploadEnabled()
		const cleanedKey = this.normalizeRequiredKey(params.key)
		this.assertRawKey(cleanedKey)
		const cleanedUploadId = this.normalizeRequiredUploadId(params.uploadId)

		const catalogId = mustCatalogId()
		this.assertKeyBelongsToCatalog(cleanedKey, catalogId)

		const normalizedParts = this.normalizeMultipartParts(params.parts)

		const command = new CompleteMultipartUploadCommand({
			Bucket: this.bucket,
			Key: cleanedKey,
			UploadId: cleanedUploadId,
			MultipartUpload: { Parts: normalizedParts }
		})
		await this.client.send(command)

		const queue = await this.enqueueFromS3([{ key: cleanedKey }])

		return {
			ok: true,
			key: cleanedKey,
			jobId: queue.jobId,
			count: queue.count
		}
	}

	async abortMultipartUpload(
		key: string,
		uploadId: string
	): Promise<{ ok: true }> {
		this.assertUploadEnabled()
		const cleanedKey = this.normalizeRequiredKey(key)
		const cleanedUploadId = this.normalizeRequiredUploadId(uploadId)

		const catalogId = mustCatalogId()
		this.assertKeyBelongsToCatalog(cleanedKey, catalogId)

		const command = new AbortMultipartUploadCommand({
			Bucket: this.bucket,
			Key: cleanedKey,
			UploadId: cleanedUploadId
		})
		await this.client.send(command)

		await this.prisma.media.updateMany({
			where: { catalogId, key: cleanedKey },
			data: { status: MediaStatus.FAILED }
		})

		return { ok: true }
	}

	async enqueueFromS3(items: { key: string }[]) {
		this.assertQueueEnabled()

		if (!items.length) {
			throw new BadRequestException('Список ключей пуст')
		}

		const catalogId = mustCatalogId()
		const preparedItems = await this.prepareS3QueueItems(items, catalogId)
		await this.markMediaAsProcessing(catalogId, preparedItems)
		return this.enqueuePreparedItems(preparedItems)
	}

	async getUploadStatus(jobId: string) {
		this.assertQueueEnabled()

		const job = await this.getUploadJobOrThrow(jobId)
		const status = await job.getState()
		return {
			ok: true,
			status,
			progress: this.resolveUploadJobProgress(status, job.progress),
			...this.buildUploadStatusPayload(status, job)
		}
	}

	async deleteObjectsByKeys(keys: string[]): Promise<void> {
		const normalizedKeys = [...new Set(keys.map(key => key.trim()).filter(Boolean))]
		if (!normalizedKeys.length || !this.client || !this.enabled) {
			return
		}

		const failedKeys: string[] = []

		await Promise.all(
			normalizedKeys.map(async key => {
				try {
					await this.client.send(
						new DeleteObjectCommand({
							Bucket: this.bucket,
							Key: key
						})
					)
				} catch (error) {
					failedKeys.push(key)
					this.logger.error('Ошибка удаления объекта из S3', {
						key,
						error: error instanceof Error ? error.message : String(error)
					})
				}
			})
		)

		if (failedKeys.length) {
			throw new InternalServerErrorException(
				`Не удалось удалить файлы из S3: ${failedKeys.join(', ')}`
			)
		}
	}

	private assertUploadEnabled() {
		if (!this.enabled || !this.client) {
			throw new BadRequestException('Загрузка файлов отключена')
		}
	}

	private assertQueueEnabled() {
		this.assertUploadEnabled()
		if (!this.uploadQueue || !this.uploadWorker) {
			throw new BadRequestException('Очередь загрузки не готова')
		}
	}

	private assertFileValid(file: UploadedImageFile) {
		if (!file?.buffer?.length) {
			throw new BadRequestException('Файл не передан')
		}
		this.assertFileSizeWithinLimit(file.size)
		if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
			throw new BadRequestException(
				'Неподдерживаемый формат. Разрешены JPEG, PNG, WebP, AVIF'
			)
		}
	}

	private assertContentType(contentType: string) {
		if (!ALLOWED_IMAGE_MIME.has(contentType)) {
			throw new BadRequestException(
				'Неподдерживаемый формат. Разрешены JPEG, PNG, WebP, AVIF'
			)
		}
	}

	private assertKeyBelongsToCatalog(key: string, catalogId: string) {
		const expectedPrefix = `catalogs/${catalogId}/`
		if (!key.startsWith(expectedPrefix)) {
			throw new BadRequestException('Ключ файла не принадлежит каталогу')
		}
	}

	private async processUploadJob(
		job: Job<UploadQueueJob, UploadImageResult[]>
	): Promise<UploadImageResult[]> {
		const totalSteps = Math.max(
			1,
			this.getExpectedVariantCount() * job.data.items.length
		)
		let completed = 0

		const bump = async () => {
			completed += 1
			const progress = Math.min(100, Math.round((completed / totalSteps) * 100))
			await job.updateProgress(progress)
		}

		const results: UploadImageResult[] = []

		for (const item of job.data.items) {
			if (item.source === 'file' && item.filePath) {
				const fileBuffer = await fs.readFile(item.filePath)
				const file: UploadedImageFile = {
					buffer: fileBuffer,
					size: item.size ?? fileBuffer.length,
					mimetype: item.mimetype ?? 'application/octet-stream',
					originalname: item.originalName
				}

				try {
					const result = await this.uploadImageWithProgress(file, item.options, bump)
					results.push(result)
				} finally {
					await fs.unlink(item.filePath).catch(() => null)
				}
			} else if (item.source === 's3' && item.key) {
				const result = await this.uploadFromS3KeyWithProgress(
					item.key,
					item.options,
					bump
				)
				results.push(result)
			}
		}

		await job.updateProgress(100)
		return results
	}

	private async prepareFileQueueItems(
		files: UploadedImageFile[],
		items: UploadImageOptions[],
		catalogId: string
	): Promise<UploadQueueItem[]> {
		const preparedItems: UploadQueueItem[] = []
		const tempFiles: string[] = []

		try {
			for (let index = 0; index < files.length; index += 1) {
				const file = files[index]
				this.assertFileValid(file)

				const tempPath = await this.saveTempFile(file)
				tempFiles.push(tempPath)

				preparedItems.push({
					source: 'file',
					filePath: tempPath,
					mimetype: file.mimetype,
					size: file.size,
					originalName: file.originalname,
					options: {
						...items[index],
						catalogId
					}
				})
			}
		} catch (error) {
			await this.cleanupTempFiles(tempFiles)
			throw error
		}

		return preparedItems
	}

	private async cleanupTempFiles(filePaths: string[]): Promise<void> {
		await Promise.all(
			filePaths.map(filePath => fs.unlink(filePath).catch(() => null))
		)
	}

	private async prepareS3QueueItems(
		items: { key: string }[],
		catalogId: string
	): Promise<UploadQueueItem[]> {
		const preparedItems: UploadQueueItem[] = []

		for (const item of items) {
			preparedItems.push(await this.prepareS3QueueItem(item.key, catalogId))
		}

		return preparedItems
	}

	private async prepareS3QueueItem(
		key: string,
		catalogId: string
	): Promise<UploadQueueItem> {
		const cleanedKey = this.normalizeRequiredKey(key)
		this.assertKeyBelongsToCatalog(cleanedKey, catalogId)
		this.assertRawKey(cleanedKey)

		const { contentType, size } = await this.loadS3QueueItemHead(cleanedKey)
		return {
			source: 's3',
			key: cleanedKey,
			mimetype: contentType,
			size,
			options: { catalogId }
		}
	}

	private async loadS3QueueItemHead(
		key: string
	): Promise<{ contentType: string; size: number }> {
		const head = await this.headObject(key)
		const contentType = head.ContentType ?? ''
		if (!contentType) {
			throw new BadRequestException(`Не удалось определить тип файла для ${key}`)
		}
		this.assertContentType(contentType)

		const size = head.ContentLength ?? 0
		if (size) {
			this.assertFileSizeWithinLimit(size, `Файл ${key}`)
		}

		return { contentType, size }
	}

	private async markMediaAsProcessing(
		catalogId: string,
		items: UploadQueueItem[]
	): Promise<void> {
		const keysToUpdate = items
			.map(item => item.key)
			.filter((value): value is string => Boolean(value))

		if (!keysToUpdate.length) return

		await this.prisma.media.updateMany({
			where: { catalogId, key: { in: keysToUpdate } },
			data: { status: MediaStatus.PROCESSING }
		})
	}

	private async enqueuePreparedItems(
		items: UploadQueueItem[]
	): Promise<UploadQueueResult> {
		const job = await this.uploadQueue.add('upload', { items })
		return {
			ok: true,
			jobId: String(job.id),
			count: items.length
		}
	}

	private async getUploadJobOrThrow(
		jobId: string
	): Promise<Job<UploadQueueJob, UploadImageResult[]>> {
		const job = await this.uploadQueue.getJob(jobId)
		if (!job) {
			throw new NotFoundException('Задание не найдено')
		}
		return job
	}

	private resolveUploadJobProgress(status: string, progress: unknown): number {
		const rawProgress = typeof progress === 'number' ? progress : 0
		return status === 'completed' ? 100 : Math.round(rawProgress)
	}

	private buildUploadStatusPayload(
		status: string,
		job: Job<UploadQueueJob, UploadImageResult[]>
	): Record<string, unknown> {
		const payload: Record<string, unknown> = {}

		if (status === 'completed' && job.returnvalue?.length) {
			if (job.returnvalue.length === 1) {
				payload.result = job.returnvalue[0]
			} else {
				payload.results = job.returnvalue
			}
		}

		if (status === 'failed') {
			payload.error = job.failedReason ?? 'Ошибка загрузки'
		}

		return payload
	}

	private async uploadImageWithProgress(
		file: UploadedImageFile,
		options: UploadImageOptions,
		onStep: () => Promise<void>
	): Promise<UploadImageResult> {
		this.assertUploadEnabled()
		this.assertFileValid(file)

		const catalogId = options.catalogId ?? mustCatalogId()
		const prefix = this.buildPrefix(catalogId, options)
		const baseKey = `${prefix}/${randomUUID()}`

		const metadata = await this.readMetadata(file.buffer)
		const variants = await this.buildVariants(file.buffer, baseKey, metadata)

		for (const variant of variants) {
			await this.putObject(variant.key, variant.buffer, variant.contentType)
			await onStep()
		}

		const mediaId = await this.createMediaRecord({
			catalogId,
			originalName: file.originalname,
			mimeType: file.mimetype,
			size: file.size,
			width: metadata.width,
			height: metadata.height,
			rawKey: variants[0]?.key ?? baseKey,
			variants
		})

		return this.buildResponse(variants, mediaId)
	}

	private async uploadFromS3KeyWithProgress(
		key: string,
		options: UploadImageOptions,
		onStep: () => Promise<void>
	): Promise<UploadImageResult> {
		this.assertUploadEnabled()

		const cleanedKey = this.normalizeRequiredKey(key)

		const catalogId = options.catalogId ?? mustCatalogId()
		this.assertKeyBelongsToCatalog(cleanedKey, catalogId)

		const bufferData = await this.downloadObjectBuffer(cleanedKey)
		const contentType = bufferData.contentType ?? ''
		if (!contentType) {
			throw new BadRequestException(
				`Не удалось определить тип файла для ${cleanedKey}`
			)
		}
		this.assertContentType(contentType)
		if (bufferData.size) {
			this.assertFileSizeWithinLimit(bufferData.size, `Файл ${cleanedKey}`)
		}

		const baseKey = this.buildBaseKeyFromRawKey(cleanedKey)
		const metadata = await this.readMetadata(bufferData.buffer)
		const variants = await this.buildVariants(
			bufferData.buffer,
			baseKey,
			metadata
		)

		for (const variant of variants) {
			await this.putObject(variant.key, variant.buffer, variant.contentType)
			await onStep()
		}

		const pathInfo = this.extractPathInfoFromKey(cleanedKey)
		const mediaId = await this.createMediaRecord({
			catalogId,
			originalName: path.basename(cleanedKey),
			mimeType: contentType,
			size: bufferData.size,
			width: metadata.width,
			height: metadata.height,
			rawKey: cleanedKey,
			variants,
			path: pathInfo.path,
			entityId: pathInfo.entityId
		})

		return this.buildResponse(variants, mediaId)
	}

	private buildResponse(
		variants: PreparedVariant[],
		mediaId: string
	): UploadImageResult {
		const responseVariants = variants.map(variant => ({
			name: variant.name,
			width: variant.width,
			height: variant.height,
			size: variant.size,
			contentType: variant.contentType,
			key: variant.key,
			url: this.buildPublicUrl(variant.key)
		}))

		const primary =
			responseVariants.find(
				variant => variant.name === 'detail' && variant.contentType === 'image/webp'
			) ??
			responseVariants.find(variant => variant.name === 'detail') ??
			responseVariants.find(
				variant => variant.name === 'card' && variant.contentType === 'image/webp'
			) ??
			responseVariants.find(variant => variant.name === 'card') ??
			responseVariants.find(variant => variant.contentType === 'image/webp') ??
			responseVariants.find(variant => variant.name.startsWith('w')) ??
			responseVariants[0]

		return {
			ok: true,
			mediaId,
			key: primary.key,
			url: primary.url,
			variants: responseVariants
		}
	}

	private async readMetadata(buffer: Buffer) {
		try {
			return await sharp(buffer, { failOnError: true }).metadata()
		} catch {
			throw new BadRequestException('Файл не является валидным изображением')
		}
	}

	private getImageFormats(): string[] {
		const formats = this.imageFormats.length
			? this.imageFormats
			: [...DEFAULT_IMAGE_FORMATS]
		const normalized = formats
			.map(value => value.trim().toLowerCase())
			.filter(value => value === 'webp' || value === 'avif')
		return normalized.length ? normalized : ['webp']
	}

	private getExpectedVariantCount(): number {
		const widths = this.variantWidths.length
			? this.variantWidths
			: [...DEFAULT_VARIANT_WIDTHS]
		const uniqueWidths = [...new Set(widths)].filter(width => width > 0)
		const formats = this.getImageFormats()
		const formatCount = Math.max(1, formats.length)
		return (
			uniqueWidths.length * formatCount + (this.storeOriginal ? formatCount : 0)
		)
	}

	private prepareRawObjectTarget(
		contentType: string,
		options: CatalogUploadTargetOptions
	): RawObjectTarget {
		const mimeType = this.normalizeRequiredContentType(contentType)
		const catalogId = options.catalogId ?? mustCatalogId()
		return {
			catalogId,
			mimeType,
			key: this.buildRawObjectKey(catalogId, options, mimeType),
			path: options.path ?? options.folder,
			entityId: options.entityId
		}
	}

	private resolveMultipartPartSize(
		fileSize: number,
		partSizeMb?: number
	): number {
		const requestedBytes =
			partSizeMb && Number.isFinite(partSizeMb)
				? Math.floor(partSizeMb) * 1024 * 1024
				: MULTIPART_DEFAULT_PART_BYTES
		let partSize = Math.max(requestedBytes, MULTIPART_MIN_PART_BYTES)
		partSize = Math.min(partSize, MULTIPART_MAX_PART_BYTES)

		const minByParts = Math.ceil(fileSize / MULTIPART_MAX_PARTS)
		if (minByParts > partSize) {
			partSize = minByParts
		}

		if (partSize > MULTIPART_MAX_PART_BYTES) {
			throw new BadRequestException('Размер файла слишком большой для multipart')
		}

		return partSize
	}

	private async buildVariants(
		buffer: Buffer,
		baseKey: string,
		metadata: sharp.Metadata
	): Promise<PreparedVariant[]> {
		const variants: PreparedVariant[] = []

		const widths = this.variantWidths.length
			? this.variantWidths
			: [...DEFAULT_VARIANT_WIDTHS]
		const formats = this.getImageFormats()

		const uniqueWidths = [...new Set(widths)].filter(width => width > 0)
		const sorted = uniqueWidths.sort((a, b) => b - a)

		if (this.storeOriginal) {
			for (const format of formats) {
				const original = await this.renderVariant(buffer, metadata.width, {
					name: 'orig',
					format,
					key: `${baseKey}-orig.${format}`,
					quality: Math.min(95, Math.max(1, this.imageQuality + 8))
				})
				variants.push(original)
			}
		}

		for (const [index, width] of sorted.entries()) {
			const name =
				DEFAULT_VARIANT_NAMES.get(width) ??
				this.resolveVariantNameByOrder(width, index, sorted.length)
			for (const format of formats) {
				const variant = await this.renderVariant(buffer, width, {
					name,
					format,
					key: `${baseKey}-${name}.${format}`,
					quality: this.imageQuality
				})
				variants.push(variant)
			}
		}

		if (!variants.length) {
			throw new BadRequestException('Не удалось сформировать варианты изображения')
		}

		return variants
	}

	private resolveVariantNameByOrder(
		width: number,
		index: number,
		total: number
	): string {
		if (index === 0) return 'detail'
		if (index === 1 && total >= 2) return 'card'
		if (index === 2 && total >= 3) return 'thumb'
		return `w${width}`
	}

	private async createPresignRecord(params: {
		catalogId: string
		key: string
		mimeType: string
		path?: string
		entityId?: string
	}): Promise<string> {
		const originalName = path.basename(params.key)
		const normalizedPath = this.normalizePathForStore(params.path)
		const normalizedEntityId = params.entityId?.trim() || null

		const media = await this.prisma.media.create({
			data: {
				catalogId: params.catalogId,
				originalName,
				mimeType: params.mimeType,
				size: null,
				width: null,
				height: null,
				path: normalizedPath,
				entityId: normalizedEntityId,
				storage: 's3',
				key: params.key,
				status: MediaStatus.UPLOADED
			},
			select: { id: true }
		})

		return media.id
	}

	private async createMediaRecord(params: {
		catalogId: string
		originalName?: string
		mimeType: string
		size?: number
		width?: number
		height?: number
		rawKey: string
		variants: PreparedVariant[]
		path?: string
		entityId?: string
	}): Promise<string> {
		const originalName =
			params.originalName?.trim() || path.basename(params.rawKey)
		const normalizedPath = this.normalizePathForStore(params.path)
		const normalizedEntityId = params.entityId?.trim() || null

		const mediaId = await this.prisma.$transaction(async tx => {
			const media = await tx.media.upsert({
				where: {
					catalogId_key: {
						catalogId: params.catalogId,
						key: params.rawKey
					}
				},
				create: {
					catalogId: params.catalogId,
					originalName,
					mimeType: params.mimeType,
					size: params.size ?? null,
					width: params.width ?? null,
					height: params.height ?? null,
					path: normalizedPath,
					entityId: normalizedEntityId,
					storage: 's3',
					key: params.rawKey,
					status: MediaStatus.READY
				},
				update: {
					originalName,
					mimeType: params.mimeType,
					size: params.size ?? null,
					width: params.width ?? null,
					height: params.height ?? null,
					path: normalizedPath,
					entityId: normalizedEntityId,
					storage: 's3',
					status: MediaStatus.READY
				},
				select: { id: true }
			})

			await tx.mediaVariant.deleteMany({
				where: { mediaId: media.id }
			})

			if (params.variants.length) {
				await tx.mediaVariant.createMany({
					data: params.variants.map(variant => ({
						mediaId: media.id,
						kind: this.buildVariantKind(variant),
						mimeType: variant.contentType,
						size: variant.size,
						width: variant.width,
						height: variant.height,
						storage: 's3',
						key: variant.key
					}))
				})
			}

			return media.id
		})

		return mediaId
	}

	private async renderVariant(
		buffer: Buffer,
		width: number | undefined,
		options: { name: string; key: string; quality: number; format: string }
	): Promise<PreparedVariant> {
		const image = sharp(buffer)
			.rotate()
			.resize({
				width: width && width > 0 ? width : undefined,
				withoutEnlargement: true,
				fit: 'inside'
			})

		if (options.format === 'avif') {
			image.avif({ quality: options.quality })
		} else {
			image.webp({ quality: options.quality })
		}

		const result = await image.toBuffer({ resolveWithObject: true })
		const contentType = options.format === 'avif' ? 'image/avif' : 'image/webp'

		return {
			name: options.name,
			width: result.info.width,
			height: result.info.height,
			size: result.info.size,
			contentType,
			key: options.key,
			buffer: result.data
		}
	}

	private async putObject(
		key: string,
		body: Buffer,
		contentType: string
	): Promise<void> {
		if (!this.client) return

		const command = new PutObjectCommand({
			Bucket: this.bucket,
			Key: key,
			Body: body,
			ContentType: contentType,
			CacheControl: 'public, max-age=31536000, immutable',
			...(this.publicRead ? { ACL: 'public-read' } : {})
		})

		await this.client.send(command)
	}

	private async headObject(key: string) {
		try {
			const command = new HeadObjectCommand({
				Bucket: this.bucket,
				Key: key
			})
			return await this.client.send(command)
		} catch {
			throw new BadRequestException(`Файл ${key} не найден в хранилище`)
		}
	}

	private async downloadObjectBuffer(key: string): Promise<{
		buffer: Buffer
		contentType?: string
		size?: number
	}> {
		try {
			const command = new GetObjectCommand({
				Bucket: this.bucket,
				Key: key
			})
			const response = await this.client.send(command)
			const body = response.Body
			if (!body) {
				throw new BadRequestException(`Файл ${key} пустой`)
			}

			const chunks: Buffer[] = []
			for await (const chunk of body as AsyncIterable<Uint8Array>) {
				chunks.push(Buffer.from(chunk))
			}

			const buffer = Buffer.concat(chunks)
			return {
				buffer,
				contentType: response.ContentType ?? undefined,
				size: response.ContentLength ?? buffer.length
			}
		} catch (error) {
			if (error instanceof BadRequestException) throw error
			throw new BadRequestException(`Не удалось скачать файл ${key}`)
		}
	}

	private buildBaseKeyFromRawKey(key: string): string {
		const normalized = key.replace(/\\/g, '/')
		const marker = `/${RAW_SEGMENT}/`
		const index = normalized.lastIndexOf(marker)
		const withoutRaw =
			index >= 0
				? `${normalized.slice(0, index)}/${normalized.slice(index + marker.length)}`
				: normalized
		return withoutRaw.replace(/\.[^/.]+$/, '')
	}

	private buildRawObjectKey(
		catalogId: string,
		options: Pick<CatalogUploadTargetOptions, 'path' | 'folder' | 'entityId'>,
		contentType: string
	): string {
		const prefix = this.buildPrefix(catalogId, options, [RAW_SEGMENT])
		const extension = CONTENT_TYPE_EXTENSION[contentType] ?? 'bin'
		return `${prefix}/${randomUUID()}.${extension}`
	}

	private buildPrefix(
		catalogId: string,
		options: UploadImageOptions,
		extraSegments: string[] = []
	): string {
		const pathSegments = this.normalizePath(options.path)
		const folderSegment = this.normalizeSegment(options.folder ?? 'images')
		const entityId = options.entityId
			? this.normalizeSegment(options.entityId)
			: null
		const now = new Date()
		const year = now.getFullYear()
		const month = String(now.getMonth() + 1).padStart(2, '0')
		const day = String(now.getDate()).padStart(2, '0')

		const segments = [
			'catalogs',
			catalogId,
			...(pathSegments.length ? pathSegments : [folderSegment])
		]
		if (entityId) segments.push(entityId)
		segments.push(String(year), month, day)
		if (extraSegments.length) {
			segments.push(
				...extraSegments.map(segment => this.normalizeSegment(segment, ''))
			)
		}

		return segments.join('/')
	}

	private normalizePath(value?: string): string[] {
		if (!value) return []
		const rawSegments = value
			.split('/')
			.map(segment => segment.trim())
			.filter(Boolean)
		return rawSegments
			.map(segment => this.normalizeSegment(segment, ''))
			.filter(Boolean)
	}

	private normalizeRequiredContentType(contentType: string): string {
		const normalizedType = contentType?.trim().toLowerCase()
		if (!normalizedType) {
			throw new BadRequestException('contentType обязателен')
		}
		this.assertContentType(normalizedType)
		return normalizedType
	}

	private normalizeRequiredKey(key?: string): string {
		const cleanedKey = key?.trim()
		if (!cleanedKey) {
			throw new BadRequestException('Ключ файла обязателен')
		}
		return cleanedKey
	}

	private normalizeRequiredUploadId(uploadId?: string): string {
		const cleanedUploadId = uploadId?.trim()
		if (!cleanedUploadId) {
			throw new BadRequestException('uploadId обязателен')
		}
		return cleanedUploadId
	}

	private assertRawKey(key: string): void {
		if (!key.includes(`/${RAW_SEGMENT}/`)) {
			throw new BadRequestException(
				`Ключ ${key} должен содержать сегмент /${RAW_SEGMENT}/`
			)
		}
	}

	private assertMultipartPartNumber(partNumber: number): void {
		if (!Number.isFinite(partNumber) || partNumber < 1) {
			throw new BadRequestException('Номер части некорректен')
		}
		if (partNumber > MULTIPART_MAX_PARTS) {
			throw new BadRequestException('Номер части превышает лимит')
		}
	}

	private normalizeMultipartParts(
		parts: { partNumber: number; etag: string }[]
	): CompletedMultipartPart[] {
		if (!parts?.length) {
			throw new BadRequestException('Список частей пуст')
		}

		const normalizedParts = parts
			.map(part => ({
				PartNumber: part.partNumber,
				ETag: (() => {
					const cleaned = part.etag?.trim()
					if (!cleaned) return undefined
					return cleaned.startsWith('"') ? cleaned : `"${cleaned}"`
				})()
			}))
			.filter(
				(
					part
				): part is CompletedMultipartPart & { PartNumber: number; ETag: string } =>
					Boolean(part.PartNumber) && Boolean(part.ETag)
			)

		if (!normalizedParts.length) {
			throw new BadRequestException('Список частей пуст')
		}

		const seen = new Set<number>()
		for (const part of normalizedParts) {
			this.assertMultipartPartNumber(part.PartNumber)
			if (seen.has(part.PartNumber)) {
				throw new BadRequestException('Номера частей не должны повторяться')
			}
			seen.add(part.PartNumber)
		}

		normalizedParts.sort((a, b) => a.PartNumber - b.PartNumber)
		return normalizedParts
	}

	private assertFileSizeWithinLimit(
		size: number,
		subject = 'Размер файла'
	): void {
		if (size > this.maxFileBytes) {
			const maxMb = Math.ceil(this.maxFileBytes / 1024 / 1024)
			throw new BadRequestException(`${subject} превышает ${maxMb} МБ`)
		}
	}

	private normalizeSegment(value: string, fallback = 'images'): string {
		const trimmed = value.trim()
		if (!trimmed) return fallback
		const slug = slugify(trimmed, { lower: true, strict: true, trim: true })
		const cleaned = slug.replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
		return cleaned || fallback
	}

	private normalizePathForStore(value?: string): string | null {
		if (!value) return null
		const segments = this.normalizePath(value)
		if (!segments.length) return null
		const joined = segments.join('/')
		if (!joined) return null
		return joined.length > 255 ? joined.slice(0, 255) : joined
	}

	private buildVariantKind(variant: PreparedVariant): string {
		const format = variant.contentType === 'image/avif' ? 'avif' : 'webp'
		return `${variant.name}-${format}`
	}

	private extractPathInfoFromKey(key: string): {
		path?: string | null
		entityId?: string | null
	} {
		const normalized = key.replace(/\\/g, '/')
		const segments = normalized.split('/').filter(Boolean)
		const catalogsIndex = segments.indexOf('catalogs')
		if (catalogsIndex === -1 || segments.length <= catalogsIndex + 1) {
			return { path: null, entityId: null }
		}

		const afterCatalog = segments.slice(catalogsIndex + 2)
		let dateIndex = -1
		for (let i = 0; i < afterCatalog.length - 2; i += 1) {
			const year = afterCatalog[i]
			const month = afterCatalog[i + 1]
			const day = afterCatalog[i + 2]
			if (
				/^\\d{4}$/.test(year) &&
				/^\\d{2}$/.test(month) &&
				/^\\d{2}$/.test(day)
			) {
				dateIndex = i
				break
			}
		}

		const pathSegments =
			dateIndex >= 0 ? afterCatalog.slice(0, dateIndex) : afterCatalog.slice(0, -2)
		const pathValue = pathSegments.length ? pathSegments.join('/') : null

		const lastSegment = pathSegments[pathSegments.length - 1]
		const entityId =
			lastSegment &&
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
				lastSegment
			)
				? lastSegment
				: null

		return { path: pathValue, entityId }
	}

	private buildPublicUrl(key: string): string {
		const base = this.publicUrl ?? this.buildFallbackBaseUrl()
		return `${base.replace(/\/+$/g, '')}/${key}`
	}

	private buildFallbackBaseUrl(): string {
		if (this.endpoint) {
			const url = new URL(this.endpoint)
			if (this.forcePathStyle) {
				return `${url.origin}/${this.bucket}`
			}
			return `${url.protocol}//${this.bucket}.${url.host}`
		}

		return `https://${this.bucket}.s3.${this.region}.amazonaws.com`
	}

	private async saveTempFile(file: UploadedImageFile): Promise<string> {
		const ext = file.originalname ? path.extname(file.originalname) : '.bin'
		const safeExt = ext && ext.length <= 10 ? ext : '.bin'
		const filename = `${TEMP_PREFIX}-${randomUUID()}${safeExt}`
		const filePath = path.join(os.tmpdir(), filename)
		await fs.writeFile(filePath, file.buffer)
		return filePath
	}
}

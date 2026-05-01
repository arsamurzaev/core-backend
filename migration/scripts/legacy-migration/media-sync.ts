import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createHash } from 'node:crypto'
import path from 'node:path'
import pLimit from 'p-limit'
import sharp from 'sharp'

import {
	MediaStatus,
	MigrationEntityKind,
	MigrationIssueSeverity,
	Prisma,
	PrismaClient
} from '../../../prisma/generated/client.js'

import { logLegacyEvent } from './logging.js'
import {
	loadAlreadyMigratedIds,
	runMigrationTransaction,
	withRetry
} from './migration-utils.js'
import {
	buildLegacyCategoryId,
	buildLegacyProductId,
	type LegacyProductsData
} from './products-source.js'
import type { LegacyBusinessRow } from './source.js'

type ApplyLegacyMediaOptions = {
	runId: string
	source: string
}

type LegacyMediaIssue = {
	entity: MigrationEntityKind
	legacyId: string
	severity: MigrationIssueSeverity
	code: string
	message: string
	details?: Prisma.InputJsonValue
}

type ApplyLegacyMediaSummary = {
	processedBusinesses: number
	totalAssets: number
	catalogLogos: number
	catalogBackgrounds: number
	categoryImages: number
	productImages: number
	createdMedia: number
	reusedMedia: number
	failedAssets: number
	linkedCatalogLogos: number
	linkedCatalogBackgrounds: number
	linkedCategoryImages: number
	linkedProductImages: number
}

type ApplyLegacyMediaResult = {
	summary: ApplyLegacyMediaSummary
	issues: LegacyMediaIssue[]
}

type LegacyMediaSummary = {
	selectedBusinesses: number
	totalAssets: number
	pendingAssets: number
	alreadyMigrated: number
	catalogLogos: number
	catalogBackgrounds: number
	categoryImages: number
	productImages: number
	preview: Array<{
		legacyId: string
		kind: LegacyMediaAssetKind
		legacyBusinessId: string
		url: string
	}>
}

type ExistingEntityMap = {
	id: string
	legacyId: string
	targetId: string
	payload: Prisma.JsonValue | null
}

type LegacyMediaAssetKind =
	| 'catalog-logo'
	| 'catalog-background'
	| 'category-image'
	| 'product-image'

type LegacyMediaAsset = {
	legacyId: string
	kind: LegacyMediaAssetKind
	url: string
	legacyBusinessId: string
	legacyEntityId: string
	path: string
	position: number
	originalName: string
}

type ProductMediaPlan = {
	mediaIds: Array<{ mediaId: string; position: number }>
	failures: number
}

type ResolvedLegacyMediaAsset = LegacyMediaAsset & {
	catalogId: string
	targetEntityId: string
}

type MediaTargetMaps = {
	businessByLegacyId: Map<string, ExistingEntityMap>
	categoryByLegacyId: Map<string, ExistingEntityMap>
	productByLegacyId: Map<string, ExistingEntityMap>
}

type MediaBusinessProgress = {
	order: number
	host: string
	totalAssets: number
	processedAssets: number
	createdMedia: number
	reusedMedia: number
	failedAssets: number
}

type UploadedVariant = {
	name: string
	key: string
	contentType: string
	width: number
	height: number
	size: number
}

type DownloadedImage = {
	buffer: Buffer
	mimeType: string
	extension: string
	width: number | null
	height: number | null
	size: number
}

type S3Config = {
	enabled: boolean
	client: S3Client
	bucket: string
	publicRead: boolean
	imageQuality: number
	imageVariants: number[]
	imageFormats: string[]
	storeOriginal: boolean
	maxFileBytes: number
	optimizeRaw: boolean
	rawQuality: number
	maxRawWidth: number
}

const CONTENT_TYPE_EXTENSION: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/avif': 'avif'
}

const SHARP_FORMAT_TO_MIME: Record<string, string> = {
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	avif: 'image/avif'
}

const DEFAULT_IMAGE_VARIANTS = [1200, 800, 400]
const DEFAULT_IMAGE_FORMATS = ['avif']
const DEFAULT_IMAGE_QUALITY = 82
const DEFAULT_LEGACY_MIGRATION_MAX_FILE_MB = 100
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

export async function analyzeLegacyMediaData(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	products: LegacyProductsData,
	source: string
): Promise<LegacyMediaSummary> {
	const assets = buildLegacyMediaAssets(businesses, products)
	const migratedIds = await loadAlreadyMigratedIds(
		prisma,
		source,
		MigrationEntityKind.MEDIA
	)
	const pendingAssets = assets.filter(a => !migratedIds.has(a.legacyId)).length

	return {
		selectedBusinesses: businesses.length,
		totalAssets: assets.length,
		pendingAssets,
		alreadyMigrated: migratedIds.size,
		catalogLogos: assets.filter(asset => asset.kind === 'catalog-logo').length,
		catalogBackgrounds: assets.filter(
			asset => asset.kind === 'catalog-background'
		).length,
		categoryImages: assets.filter(asset => asset.kind === 'category-image')
			.length,
		productImages: assets.filter(asset => asset.kind === 'product-image').length,
		preview: assets.slice(0, 10).map(asset => ({
			legacyId: asset.legacyId,
			kind: asset.kind,
			legacyBusinessId: asset.legacyBusinessId,
			url: asset.url
		}))
	}
}

export async function collectLegacyMediaIssues(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	products: LegacyProductsData,
	source: string
): Promise<LegacyMediaIssue[]> {
	const issues: LegacyMediaIssue[] = []
	const allowSourceDrift = isSourceDriftAllowed()
	const missingTargetSeverity = resolveMissingTargetSeverity(allowSourceDrift)
	const assets = buildLegacyMediaAssets(businesses, products)
	const mappings = await loadMediaTargetMaps(
		prisma,
		businesses,
		products,
		source
	)

	for (const business of businesses) {
		if (mappings.businessByLegacyId.has(business.id)) continue

		if (!business.logoUrl && !business.bgUrl) continue

		issues.push({
			entity: MigrationEntityKind.MEDIA,
			legacyId: business.id,
			severity: missingTargetSeverity,
			code: 'CATALOG_MAPPING_MISSING',
			message:
				'Для переноса catalog media не найден target Catalog. Сначала выполните фазу catalog-bootstrap.',
			details: {
				legacyBusinessId: business.id,
				sourceDriftAllowed: allowSourceDrift
			} satisfies Prisma.InputJsonValue
		})
	}

	for (const category of products.categories) {
		if (!category.imageUrl) continue
		const legacyId = buildLegacyCategoryId(category)
		if (mappings.categoryByLegacyId.has(legacyId)) continue

		issues.push({
			entity: MigrationEntityKind.MEDIA,
			legacyId,
			severity: missingTargetSeverity,
			code: 'CATEGORY_MAPPING_MISSING',
			message:
				'Для переноса изображения категории не найден target Category. Сначала выполните фазу products.',
			details: {
				legacyBusinessId: category.businessId,
				url: category.imageUrl,
				sourceDriftAllowed: allowSourceDrift
			} satisfies Prisma.InputJsonValue
		})
	}

	for (const product of products.products) {
		if (!product.imagesUrl.length) continue
		const legacyId = buildLegacyProductId(product)
		if (mappings.productByLegacyId.has(legacyId)) continue

		issues.push({
			entity: MigrationEntityKind.MEDIA,
			legacyId,
			severity: missingTargetSeverity,
			code: 'PRODUCT_MAPPING_MISSING',
			message:
				'Для переноса изображений товара не найден target Product. Сначала выполните фазу products.',
			details: {
				legacyBusinessId: product.businessId,
				imagesCount: product.imagesUrl.length,
				sourceDriftAllowed: allowSourceDrift
			} satisfies Prisma.InputJsonValue
		})
	}

	for (const asset of assets) {
		if (normalizeHttpUrl(asset.url)) continue

		issues.push({
			entity: MigrationEntityKind.MEDIA,
			legacyId: asset.legacyId,
			severity: MigrationIssueSeverity.WARNING,
			code: 'MEDIA_URL_INVALID',
			message:
				'Legacy media URL не выглядит как корректный http(s)-адрес и будет пропущен.',
			details: {
				url: asset.url,
				kind: asset.kind
			} satisfies Prisma.InputJsonValue
		})
	}
	return dedupeIssues(issues)
}

export async function applyLegacyMedia(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	products: LegacyProductsData,
	options: ApplyLegacyMediaOptions
): Promise<ApplyLegacyMediaResult> {
	const s3 = createS3ConfigFromEnv()
	const issues: LegacyMediaIssue[] = []
	const allowSourceDrift = isSourceDriftAllowed()
	const missingTargetSeverity = resolveMissingTargetSeverity(allowSourceDrift)
	const assets = buildLegacyMediaAssets(businesses, products)
	const mappings = await loadMediaTargetMaps(
		prisma,
		businesses,
		products,
		options.source
	)
	// Pre-initialize product plans so concurrent tasks never overwrite each other's entry
	const productPlans = new Map<string, ProductMediaPlan>()
	for (const asset of assets) {
		const resolved = resolveLegacyMediaAsset(asset, mappings)
		if (
			resolved?.kind === 'product-image' &&
			!productPlans.has(resolved.targetEntityId)
		) {
			productPlans.set(resolved.targetEntityId, { mediaIds: [], failures: 0 })
		}
	}

	const businessProgress = buildMediaBusinessProgress(businesses, assets)

	let createdMedia = 0
	let reusedMedia = 0
	let failedAssets = 0
	let linkedCatalogLogos = 0
	let linkedCatalogBackgrounds = 0
	let linkedCategoryImages = 0
	logMediaStep('phase', 'media apply started', {
		businesses: businesses.length,
		assets: assets.length,
		maxFileMb: Math.round(s3.maxFileBytes / 1024 / 1024),
		sourceDriftAllowed: allowSourceDrift
	})

	const limit = pLimit(6)
	await Promise.all(
		assets.map((asset, assetIndex) =>
			limit(async () => {
				const businessState = getMediaBusinessProgress(
					businessProgress,
					asset.legacyBusinessId
				)
				const assetLabel = formatMediaAssetLabel(
					asset,
					assetIndex + 1,
					assets.length,
					businessState,
					businesses.length
				)
				logMediaStep(assetLabel, 'start', {
					url: asset.url
				})
				const resolvedAsset = resolveLegacyMediaAsset(asset, mappings)
				if (!resolvedAsset) {
					failedAssets += 1
					businessState.failedAssets += 1
					issues.push({
						entity: MigrationEntityKind.MEDIA,
						legacyId: asset.legacyId,
						severity: missingTargetSeverity,
						code: 'MEDIA_TARGET_UNRESOLVED',
						message:
							'Legacy media asset skipped because target entity mapping was not found.',
						details: {
							kind: asset.kind,
							legacyBusinessId: asset.legacyBusinessId,
							legacyEntityId: asset.legacyEntityId,
							url: asset.url,
							sourceDriftAllowed: allowSourceDrift
						} satisfies Prisma.InputJsonValue
					})
					finalizeMediaAssetProgress(
						assetLabel,
						businessState,
						assetIndex + 1,
						assets.length,
						businesses.length
					)
					logMediaStep(assetLabel, 'failed: target mapping missing')
					return
				}

				const url = normalizeHttpUrl(resolvedAsset.url)
				if (!url) {
					failedAssets += 1
					businessState.failedAssets += 1
					if (resolvedAsset.kind === 'product-image') {
						productPlans.get(resolvedAsset.targetEntityId).failures += 1
					}
					finalizeMediaAssetProgress(
						assetLabel,
						businessState,
						assetIndex + 1,
						assets.length,
						businesses.length
					)
					logMediaStep(assetLabel, 'failed: invalid url')
					return
				}

				try {
					const normalizedAsset = {
						...resolvedAsset,
						url
					}
					logMediaStep(assetLabel, 'checking existing media map')
					const existing = await resolveExistingMediaTarget(
						prisma,
						options.source,
						normalizedAsset.legacyId
					)
					const mediaId = existing?.mediaId
						? existing.mediaId
						: await withRetry(() =>
								importLegacyMediaAsset(prisma, s3, normalizedAsset, options, assetLabel)
							)

					if (existing?.mediaId) {
						reusedMedia += 1
						businessState.reusedMedia += 1
						logMediaStep(assetLabel, 'reused existing media', {
							mediaId
						})
					} else {
						createdMedia += 1
						businessState.createdMedia += 1
						logMediaStep(assetLabel, 'created media', {
							mediaId
						})
					}

					if (resolvedAsset.kind === 'catalog-logo') {
						logMediaStep(assetLabel, 'linking catalog logo')
						await prisma.catalogConfig.upsert({
							where: { catalogId: resolvedAsset.targetEntityId },
							create: {
								catalogId: resolvedAsset.targetEntityId,
								logoMediaId: mediaId
							},
							update: {
								logoMediaId: mediaId
							}
						})
						linkedCatalogLogos += 1
						logMediaStep(assetLabel, 'catalog logo linked')
						finalizeMediaAssetProgress(
							assetLabel,
							businessState,
							assetIndex + 1,
							assets.length,
							businesses.length
						)
						return
					}

					if (resolvedAsset.kind === 'catalog-background') {
						logMediaStep(assetLabel, 'linking catalog background')
						await prisma.catalogConfig.upsert({
							where: { catalogId: resolvedAsset.targetEntityId },
							create: {
								catalogId: resolvedAsset.targetEntityId,
								bgMediaId: mediaId
							},
							update: {
								bgMediaId: mediaId
							}
						})
						linkedCatalogBackgrounds += 1
						logMediaStep(assetLabel, 'catalog background linked')
						finalizeMediaAssetProgress(
							assetLabel,
							businessState,
							assetIndex + 1,
							assets.length,
							businesses.length
						)
						return
					}

					if (resolvedAsset.kind === 'category-image') {
						logMediaStep(assetLabel, 'linking category image')
						await prisma.category.update({
							where: { id: resolvedAsset.targetEntityId },
							data: { imageMediaId: mediaId }
						})
						linkedCategoryImages += 1
						logMediaStep(assetLabel, 'category image linked')
						finalizeMediaAssetProgress(
							assetLabel,
							businessState,
							assetIndex + 1,
							assets.length,
							businesses.length
						)
						return
					}

					productPlans.get(resolvedAsset.targetEntityId).mediaIds.push({
						mediaId,
						position: resolvedAsset.position
					})
					logMediaStep(assetLabel, 'queued for product linking', {
						productId: resolvedAsset.targetEntityId,
						position: resolvedAsset.position
					})
					finalizeMediaAssetProgress(
						assetLabel,
						businessState,
						assetIndex + 1,
						assets.length,
						businesses.length
					)
				} catch (error) {
					failedAssets += 1
					businessState.failedAssets += 1
					if (resolvedAsset.kind === 'product-image') {
						productPlans.get(resolvedAsset.targetEntityId).failures += 1
					}
					issues.push({
						entity: MigrationEntityKind.MEDIA,
						legacyId: resolvedAsset.legacyId,
						severity: MigrationIssueSeverity.WARNING,
						code: 'MEDIA_IMPORT_FAILED',
						message:
							error instanceof Error
								? error.message
								: 'Импорт legacy media завершился ошибкой.',
						details: {
							url,
							kind: resolvedAsset.kind
						} satisfies Prisma.InputJsonValue
					})
					logMediaStep(assetLabel, 'failed', {
						error: summarizeError(error)
					})
					finalizeMediaAssetProgress(
						assetLabel,
						businessState,
						assetIndex + 1,
						assets.length,
						businesses.length
					)
				}
			})
		)
	)

	let linkedProductImages = 0
	for (const [planIndex, [productId, plan]] of Array.from(
		productPlans.entries()
	).entries()) {
		logMediaStep('product-link', 'processing product media plan', {
			productIndex: planIndex + 1,
			productTotal: productPlans.size,
			productId,
			mediaCount: plan.mediaIds.length,
			failures: plan.failures
		})
		if (plan.mediaIds.length === 0 && plan.failures > 0) {
			logMediaStep(
				'product-link',
				'skipping product media link because all assets failed',
				{
					productId
				}
			)
			continue
		}

		await runMigrationTransaction(prisma, async tx => {
			await tx.productMedia.deleteMany({
				where: { productId }
			})

			if (plan.mediaIds.length > 0) {
				await tx.productMedia.createMany({
					data: plan.mediaIds
						.sort((left, right) => left.position - right.position)
						.map(item => ({
							productId,
							mediaId: item.mediaId,
							position: item.position
						}))
				})
			}
		})

		linkedProductImages += plan.mediaIds.length
		logMediaStep('product-link', 'product media linked', {
			productId,
			linkedCount: plan.mediaIds.length
		})
	}

	logMediaStep('phase', 'media apply completed', {
		createdMedia,
		reusedMedia,
		failedAssets,
		linkedCatalogLogos,
		linkedCatalogBackgrounds,
		linkedCategoryImages,
		linkedProductImages
	})

	return {
		summary: {
			processedBusinesses: businesses.length,
			totalAssets: assets.length,
			catalogLogos: assets.filter(asset => asset.kind === 'catalog-logo').length,
			catalogBackgrounds: assets.filter(
				asset => asset.kind === 'catalog-background'
			).length,
			categoryImages: assets.filter(asset => asset.kind === 'category-image')
				.length,
			productImages: assets.filter(asset => asset.kind === 'product-image').length,
			createdMedia,
			reusedMedia,
			failedAssets,
			linkedCatalogLogos,
			linkedCatalogBackgrounds,
			linkedCategoryImages,
			linkedProductImages
		},
		issues: dedupeIssues(issues)
	}
}

async function resolveExistingMediaTarget(
	prisma: PrismaClient,
	source: string,
	legacyId: string
): Promise<{ mediaId: string } | null> {
	const existingMap = await prisma.migrationEntityMap.findFirst({
		where: {
			source,
			entity: MigrationEntityKind.MEDIA,
			legacyId
		},
		select: {
			targetId: true
		}
	})
	if (!existingMap) return null

	const existingMedia = await prisma.media.findFirst({
		where: { id: existingMap.targetId },
		select: { id: true }
	})

	return existingMedia ? { mediaId: existingMedia.id } : null
}

async function importLegacyMediaAsset(
	prisma: PrismaClient,
	s3: S3Config,
	asset: ResolvedLegacyMediaAsset,
	options: ApplyLegacyMediaOptions,
	assetLabel: string
): Promise<string> {
	logMediaStep(assetLabel, 'download started')
	const downloaded = await downloadLegacyImage(asset.url, s3.maxFileBytes)
	logMediaStep(assetLabel, 'download completed', {
		size: formatMegabytes(downloaded.size),
		mimeType: downloaded.mimeType,
		width: downloaded.width,
		height: downloaded.height
	})
	const image = s3.optimizeRaw
		? await optimizeRawImage(downloaded, s3).then(opt => {
				logMediaStep(assetLabel, 'raw optimized', {
					originalSize: formatMegabytes(downloaded.size),
					optimizedSize: formatMegabytes(opt.size),
					width: opt.width,
					height: opt.height
				})
				return opt
			})
		: downloaded
	const rawKey = buildRawKey(asset, image.extension)
	const baseKey = buildBaseKeyFromRawKey(rawKey)
	const variants = shouldBuildMediaVariants(asset)
		? await buildVariants(image.buffer, baseKey, image, s3)
		: []
	logMediaStep(assetLabel, 'variants built', {
		rawKey,
		variants: variants.length
	})

	logMediaStep(assetLabel, 'uploading raw object', {
		rawKey
	})
	await putObject(
		s3,
		rawKey,
		image.buffer,
		image.mimeType,
		'public, max-age=31536000, immutable'
	)

	for (const [variantIndex, variant] of variants.entries()) {
		logMediaStep(assetLabel, 'uploading variant', {
			variantIndex: variantIndex + 1,
			variantTotal: variants.length,
			key: variant.key
		})
		await putObject(
			s3,
			variant.key,
			variant.buffer,
			variant.contentType,
			'public, max-age=31536000, immutable'
		)
	}

	return runMigrationTransaction(prisma, async tx => {
		logMediaStep(assetLabel, 'upserting media row')
		const media = await tx.media.upsert({
			where: {
				catalogId_key: {
					catalogId: asset.catalogId,
					key: rawKey
				}
			},
			create: {
				catalogId: asset.catalogId,
				originalName: asset.originalName,
				mimeType: image.mimeType,
				size: image.size,
				width: image.width,
				height: image.height,
				path: asset.path,
				entityId: asset.targetEntityId,
				storage: 's3',
				key: rawKey,
				status: MediaStatus.READY
			},
			update: {
				originalName: asset.originalName,
				mimeType: image.mimeType,
				size: image.size,
				width: image.width,
				height: image.height,
				path: asset.path,
				entityId: asset.targetEntityId,
				storage: 's3',
				status: MediaStatus.READY
			},
			select: { id: true }
		})

		logMediaStep(assetLabel, 'refreshing media variants', {
			mediaId: media.id,
			variantCount: variants.length
		})
		await tx.mediaVariant.deleteMany({
			where: { mediaId: media.id }
		})

		if (variants.length > 0) {
			await tx.mediaVariant.createMany({
				data: variants.map(variant => ({
					mediaId: media.id,
					kind: buildVariantKind(variant),
					mimeType: variant.contentType,
					size: variant.size,
					width: variant.width,
					height: variant.height,
					storage: 's3',
					key: variant.key
				}))
			})
		}

		await upsertEntityMap(tx, {
			runId: options.runId,
			source: options.source,
			entity: MigrationEntityKind.MEDIA,
			legacyId: asset.legacyId,
			targetId: media.id,
			payload: {
				kind: asset.kind,
				url: asset.url,
				rawKey,
				targetEntityId: asset.targetEntityId
			}
		})

		logMediaStep(assetLabel, 'media persisted', {
			mediaId: media.id
		})
		return media.id
	})
}

async function optimizeRawImage(
	image: DownloadedImage,
	s3: S3Config
): Promise<DownloadedImage> {
	const optimized = await sharp(image.buffer)
		.rotate()
		.resize({ width: s3.maxRawWidth, withoutEnlargement: true })
		.webp({ quality: s3.rawQuality })
		.toBuffer({ resolveWithObject: true })

	return {
		buffer: optimized.data,
		mimeType: 'image/webp',
		extension: 'webp',
		width: optimized.info.width,
		height: optimized.info.height,
		size: optimized.info.size
	}
}

async function downloadLegacyImage(
	url: string,
	maxFileBytes: number
): Promise<DownloadedImage> {
	const response = await fetch(url)
	if (!response.ok) {
		throw new Error(
			`Не удалось скачать media: ${response.status} ${response.statusText}`
		)
	}

	const arrayBuffer = await response.arrayBuffer()
	const buffer = Buffer.from(arrayBuffer)
	if (!buffer.length) {
		throw new Error('Legacy media оказался пустым файлом.')
	}
	if (buffer.length > maxFileBytes) {
		throw new Error(
			`Legacy media превышает лимит S3 (${Math.round(maxFileBytes / 1024 / 1024)} MB).`
		)
	}

	const metadata = await sharp(buffer, { failOnError: true }).metadata()
	const mimeType = resolveMimeType(
		response.headers.get('content-type'),
		metadata.format,
		url
	)
	if (!mimeType) {
		throw new Error('Не удалось определить MIME type legacy media.')
	}

	const extension = CONTENT_TYPE_EXTENSION[mimeType]
	if (!extension) {
		throw new Error(`Неподдерживаемый MIME type для media: ${mimeType}`)
	}

	return {
		buffer,
		mimeType,
		extension,
		width: metadata.width ?? null,
		height: metadata.height ?? null,
		size: buffer.length
	}
}

async function buildVariants(
	buffer: Buffer,
	baseKey: string,
	image: DownloadedImage,
	s3: S3Config
): Promise<
	Array<
		UploadedVariant & {
			buffer: Buffer
		}
	>
> {
	const variants: Array<
		UploadedVariant & {
			buffer: Buffer
		}
	> = []
	const widths = [...new Set(s3.imageVariants)]
		.filter(width => width > 0)
		.sort((a, b) => b - a)

	if (s3.storeOriginal) {
		for (const format of s3.imageFormats) {
			variants.push(
				await renderVariant(buffer, image.width ?? undefined, {
					name: 'orig',
					format,
					key: `${baseKey}-orig.${format}`,
					quality: Math.min(95, Math.max(1, s3.imageQuality + 8))
				})
			)
		}
	}

	for (const [index, width] of widths.entries()) {
		const name =
			DEFAULT_VARIANT_NAMES.get(width) ??
			resolveVariantNameByOrder(width, index, widths.length)
		for (const format of s3.imageFormats) {
			variants.push(
				await renderVariant(buffer, width, {
					name,
					format,
					key: `${baseKey}-${name}.${format}`,
					quality: s3.imageQuality
				})
			)
		}
	}

	return variants
}

async function renderVariant(
	buffer: Buffer,
	width: number | undefined,
	options: {
		name: string
		format: string
		key: string
		quality: number
	}
): Promise<
	UploadedVariant & {
		buffer: Buffer
	}
> {
	const pipeline = sharp(buffer).rotate().resize({
		width,
		withoutEnlargement: true,
		fit: 'inside'
	})

	if (options.format === 'avif') {
		pipeline.avif({ quality: options.quality })
	} else {
		pipeline.webp({ quality: options.quality })
	}

	const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
	return {
		name: options.name,
		key: options.key,
		contentType: options.format === 'avif' ? 'image/avif' : 'image/webp',
		width: info.width,
		height: info.height,
		size: info.size,
		buffer: data
	}
}

async function putObject(
	s3: S3Config,
	key: string,
	body: Buffer,
	contentType: string,
	cacheControl: string
) {
	await s3.client.send(
		new PutObjectCommand({
			Bucket: s3.bucket,
			Key: key,
			Body: body,
			ContentType: contentType,
			CacheControl: cacheControl,
			...(s3.publicRead ? { ACL: 'public-read' } : {})
		})
	)
}

function buildLegacyMediaAssets(
	businesses: LegacyBusinessRow[],
	products: LegacyProductsData
): LegacyMediaAsset[] {
	const assets: LegacyMediaAsset[] = []
	for (const business of businesses) {
		if (business.logoUrl) {
			assets.push({
				legacyId: `business:${business.id}:logo`,
				kind: 'catalog-logo',
				url: business.logoUrl,
				legacyBusinessId: business.id,
				legacyEntityId: business.id,
				path: 'branding/logo',
				position: 0,
				originalName: buildOriginalName('logo', business.logoUrl)
			})
		}

		if (business.bgUrl) {
			assets.push({
				legacyId: `business:${business.id}:bg`,
				kind: 'catalog-background',
				url: business.bgUrl,
				legacyBusinessId: business.id,
				legacyEntityId: business.id,
				path: 'branding/bg',
				position: 0,
				originalName: buildOriginalName('background', business.bgUrl)
			})
		}
	}

	for (const category of products.categories) {
		if (!category.imageUrl) continue
		const legacyCategoryId = buildLegacyCategoryId(category)
		assets.push({
			legacyId: `category:${legacyCategoryId}:image`,
			kind: 'category-image',
			url: category.imageUrl,
			legacyBusinessId: category.businessId,
			legacyEntityId: legacyCategoryId,
			path: 'categories',
			position: 0,
			originalName: buildOriginalName('category', category.imageUrl)
		})
	}

	for (const product of products.products) {
		if (!product.imagesUrl.length) continue
		const legacyProductId = buildLegacyProductId(product)
		product.imagesUrl.forEach((url, index) => {
			assets.push({
				legacyId: `product:${legacyProductId}:image:${index + 1}`,
				kind: 'product-image',
				url,
				legacyBusinessId: product.businessId,
				legacyEntityId: legacyProductId,
				path: 'products',
				position: index,
				originalName: buildOriginalName(`product-${index + 1}`, url)
			})
		})
	}

	return assets
}

async function loadMediaTargetMaps(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	products: LegacyProductsData,
	source: string
): Promise<MediaTargetMaps> {
	const [businessByLegacyId, categoryByLegacyId, productByLegacyId] =
		await Promise.all([
			loadEntityMapByLegacyId(
				prisma,
				source,
				MigrationEntityKind.BUSINESS,
				businesses.map(business => business.id)
			),
			loadEntityMapByLegacyId(
				prisma,
				source,
				MigrationEntityKind.CATEGORY,
				products.categories.map(category => buildLegacyCategoryId(category))
			),
			loadEntityMapByLegacyId(
				prisma,
				source,
				MigrationEntityKind.PRODUCT,
				products.products.map(product => buildLegacyProductId(product))
			)
		])

	return {
		businessByLegacyId,
		categoryByLegacyId,
		productByLegacyId
	}
}

function resolveLegacyMediaAsset(
	asset: LegacyMediaAsset,
	mappings: MediaTargetMaps
): ResolvedLegacyMediaAsset | null {
	const business = mappings.businessByLegacyId.get(asset.legacyBusinessId)
	if (!business) return null

	if (asset.kind === 'catalog-logo' || asset.kind === 'catalog-background') {
		return {
			...asset,
			catalogId: business.targetId,
			targetEntityId: business.targetId
		}
	}

	if (asset.kind === 'category-image') {
		const category = mappings.categoryByLegacyId.get(asset.legacyEntityId)
		if (!category) return null

		return {
			...asset,
			catalogId: business.targetId,
			targetEntityId: category.targetId
		}
	}

	const product = mappings.productByLegacyId.get(asset.legacyEntityId)
	if (!product) return null

	return {
		...asset,
		catalogId: business.targetId,
		targetEntityId: product.targetId
	}
}

async function loadEntityMapByLegacyId(
	prisma: PrismaClient,
	source: string,
	entity: MigrationEntityKind,
	legacyIds: string[]
): Promise<Map<string, ExistingEntityMap>> {
	if (legacyIds.length === 0) return new Map()

	const mappings = await prisma.migrationEntityMap.findMany({
		where: {
			source,
			entity,
			legacyId: { in: legacyIds }
		},
		select: {
			id: true,
			legacyId: true,
			targetId: true,
			payload: true
		}
	})

	return new Map(mappings.map(mapping => [mapping.legacyId, mapping]))
}

async function upsertEntityMap(
	tx: Prisma.TransactionClient,
	input: {
		runId: string
		source: string
		entity: MigrationEntityKind
		legacyId: string
		targetId: string
		payload?: Prisma.InputJsonValue
	}
) {
	const existing = await tx.migrationEntityMap.findFirst({
		where: {
			source: input.source,
			entity: input.entity,
			legacyId: input.legacyId
		},
		select: { id: true }
	})

	if (existing) {
		await tx.migrationEntityMap.update({
			where: { id: existing.id },
			data: {
				runId: input.runId,
				targetId: input.targetId,
				...(input.payload ? { payload: input.payload } : {})
			}
		})
		return
	}

	await tx.migrationEntityMap.create({
		data: {
			runId: input.runId,
			source: input.source,
			entity: input.entity,
			legacyId: input.legacyId,
			targetId: input.targetId,
			...(input.payload ? { payload: input.payload } : {})
		}
	})
}

function buildRawKey(
	asset: ResolvedLegacyMediaAsset,
	extension: string
): string {
	const stableHash = createHash('sha1')
		.update(asset.url)
		.digest('hex')
		.slice(0, 12)
	const segments = [
		'catalogs',
		asset.catalogId,
		...normalizePath(asset.path),
		asset.targetEntityId,
		'raw'
	]
	const fileName =
		asset.kind === 'product-image'
			? `${String(asset.position + 1).padStart(2, '0')}-${stableHash}.${extension}`
			: `${stableHash}.${extension}`
	return [...segments, fileName].join('/')
}

function buildBaseKeyFromRawKey(key: string): string {
	const normalized = key.replace(/\\/g, '/')
	const marker = '/raw/'
	const index = normalized.lastIndexOf(marker)
	const withoutRaw =
		index >= 0
			? `${normalized.slice(0, index)}/${normalized.slice(index + marker.length)}`
			: normalized
	return withoutRaw.replace(/\.[^/.]+$/, '')
}

function buildVariantKind(variant: UploadedVariant): string {
	const format = variant.contentType === 'image/avif' ? 'avif' : 'webp'
	return `${variant.name}-${format}`
}

function shouldBuildMediaVariants(asset: LegacyMediaAsset): boolean {
	return asset.kind !== 'catalog-logo' && asset.kind !== 'catalog-background'
}

function resolveVariantNameByOrder(
	width: number,
	index: number,
	total: number
): string {
	if (index === 0) return 'detail'
	if (index === 1 && total >= 2) return 'card'
	if (index === 2 && total >= 3) return 'thumb'
	return `w${width}`
}

function resolveMimeType(
	headerContentType: string | null,
	sharpFormat: string | undefined,
	url: string
): string | null {
	const headerMime =
		headerContentType?.split(';')[0]?.trim().toLowerCase() ?? null
	if (headerMime && CONTENT_TYPE_EXTENSION[headerMime]) {
		return headerMime
	}

	const formatMime = sharpFormat ? SHARP_FORMAT_TO_MIME[sharpFormat] : null
	if (formatMime) return formatMime

	const extension = path
		.extname(new URL(url).pathname)
		.replace(/^\./, '')
		.toLowerCase()
	for (const [mimeType, ext] of Object.entries(CONTENT_TYPE_EXTENSION)) {
		if (ext === extension) return mimeType
	}

	return null
}

function buildMediaBusinessProgress(
	businesses: LegacyBusinessRow[],
	assets: LegacyMediaAsset[]
): Map<string, MediaBusinessProgress> {
	const assetCounts = new Map<string, number>()
	for (const asset of assets) {
		assetCounts.set(
			asset.legacyBusinessId,
			(assetCounts.get(asset.legacyBusinessId) ?? 0) + 1
		)
	}

	return new Map(
		businesses.map((business, index) => [
			business.id,
			{
				order: index + 1,
				host: business.host || business.id,
				totalAssets: assetCounts.get(business.id) ?? 0,
				processedAssets: 0,
				createdMedia: 0,
				reusedMedia: 0,
				failedAssets: 0
			} satisfies MediaBusinessProgress
		])
	)
}

function getMediaBusinessProgress(
	progress: Map<string, MediaBusinessProgress>,
	legacyBusinessId: string
): MediaBusinessProgress {
	const businessState = progress.get(legacyBusinessId)
	if (!businessState) {
		throw new Error(
			`Media progress state missing for legacy business ${legacyBusinessId}`
		)
	}
	return businessState
}

function formatMediaAssetLabel(
	asset: LegacyMediaAsset,
	globalIndex: number,
	globalTotal: number,
	businessState: MediaBusinessProgress,
	businessTotal: number
): string {
	return `asset ${globalIndex}/${globalTotal} | business ${businessState.order}/${businessTotal} ${businessState.host} | item ${businessState.processedAssets + 1}/${businessState.totalAssets} | ${asset.kind}`
}

function formatMediaBusinessLabel(
	businessState: MediaBusinessProgress,
	businessTotal: number
): string {
	return `business ${businessState.order}/${businessTotal} ${businessState.host}`
}

function finalizeMediaAssetProgress(
	assetLabel: string,
	businessState: MediaBusinessProgress,
	globalProcessed: number,
	globalTotal: number,
	businessTotal: number
) {
	businessState.processedAssets += 1
	logMediaStep(assetLabel, 'progress', {
		businessProcessed: businessState.processedAssets,
		businessTotal: businessState.totalAssets,
		globalProcessed,
		globalTotal
	})
	if (businessState.processedAssets === businessState.totalAssets) {
		logMediaStep(
			formatMediaBusinessLabel(businessState, businessTotal),
			'business completed',
			{
				createdMedia: businessState.createdMedia,
				reusedMedia: businessState.reusedMedia,
				failedAssets: businessState.failedAssets
			}
		)
	}
}

function logMediaStep(
	label: string,
	message: string,
	details?: Record<string, unknown>
) {
	logLegacyEvent({
		channel: 'media',
		phase: 'media',
		scope: 'progress',
		label,
		message,
		details
	})
}

function summarizeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function formatMegabytes(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function createS3ConfigFromEnv(): S3Config {
	const enabled = parseBoolean(process.env.S3_ENABLED)
	const region = process.env.S3_REGION?.trim()
	const bucket = process.env.S3_BUCKET?.trim()
	const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim()
	const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim()
	const endpoint = process.env.S3_ENDPOINT?.trim() || undefined
	const forcePathStyle = parseBoolean(process.env.S3_FORCE_PATH_STYLE)
	const publicRead = parseBoolean(process.env.S3_PUBLIC_READ)
	const storeOriginal = parseBoolean(process.env.S3_STORE_ORIGINAL)
	const imageQuality =
		process.env.S3_IMAGE_QUALITY !== undefined
			? Math.min(100, Math.max(1, parseInt(process.env.S3_IMAGE_QUALITY, 10)))
			: DEFAULT_IMAGE_QUALITY
	const imageVariants = parseNumberList(
		process.env.S3_IMAGE_VARIANTS,
		DEFAULT_IMAGE_VARIANTS
	)
	const imageFormats = parseStringList(
		process.env.S3_IMAGE_FORMATS,
		DEFAULT_IMAGE_FORMATS
	)
	const configuredMaxFileMb =
		process.env.LEGACY_MIGRATION_MEDIA_MAX_FILE_MB !== undefined
			? Math.max(1, parseInt(process.env.LEGACY_MIGRATION_MEDIA_MAX_FILE_MB, 10))
			: process.env.S3_MAX_FILE_MB !== undefined
				? Math.max(1, parseInt(process.env.S3_MAX_FILE_MB, 10))
				: DEFAULT_LEGACY_MIGRATION_MAX_FILE_MB
	const maxFileBytes = configuredMaxFileMb * 1024 * 1024
	const optimizeRaw = parseBoolean(
		process.env.LEGACY_MIGRATION_OPTIMIZE_RAW,
		true
	)
	const rawQuality =
		process.env.LEGACY_MIGRATION_RAW_QUALITY !== undefined
			? Math.min(
					100,
					Math.max(1, parseInt(process.env.LEGACY_MIGRATION_RAW_QUALITY, 10))
				)
			: 92
	const maxRawWidth =
		process.env.LEGACY_MIGRATION_MAX_RAW_WIDTH !== undefined
			? Math.max(1, parseInt(process.env.LEGACY_MIGRATION_MAX_RAW_WIDTH, 10))
			: 2400

	if (!enabled) {
		throw new Error('S3 выключен: media phase нельзя применить без S3.')
	}
	if (!region || !bucket || !accessKeyId || !secretAccessKey) {
		throw new Error(
			'S3 настроен не полностью. Ожидаются S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID и S3_SECRET_ACCESS_KEY.'
		)
	}

	return {
		enabled,
		client: new S3Client({
			region,
			endpoint,
			forcePathStyle,
			credentials: {
				accessKeyId,
				secretAccessKey
			}
		}),
		bucket,
		publicRead,
		imageQuality,
		imageVariants,
		imageFormats,
		storeOriginal,
		maxFileBytes,
		optimizeRaw,
		rawQuality,
		maxRawWidth
	}
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
	if (value === undefined) return fallback
	const normalized = value.trim().toLowerCase()
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false
	return fallback
}

function parseNumberList(
	value: string | undefined,
	fallback: number[]
): number[] {
	if (!value) return [...fallback]
	const parsed = value
		.split(',')
		.map(item => parseInt(item.trim(), 10))
		.filter(item => Number.isFinite(item) && item > 0)
	return parsed.length ? parsed : [...fallback]
}

function parseStringList(
	value: string | undefined,
	fallback: string[]
): string[] {
	if (!value) return [...fallback]
	const parsed = value
		.split(',')
		.map(item => item.trim().toLowerCase())
		.filter(item => item === 'webp' || item === 'avif')
	return parsed.length ? parsed : [...fallback]
}

function isSourceDriftAllowed(): boolean {
	return parseBoolean(process.env.LEGACY_MIGRATION_ALLOW_SOURCE_DRIFT)
}

function resolveMissingTargetSeverity(
	allowSourceDrift: boolean
): MigrationIssueSeverity {
	return allowSourceDrift
		? MigrationIssueSeverity.WARNING
		: MigrationIssueSeverity.ERROR
}

function normalizeHttpUrl(value: string | null | undefined): string | null {
	if (typeof value !== 'string') return null
	let normalized = value.trim()
	if (!normalized) return null

	normalized = normalized.replace(/^https:\/(?!\/)/i, 'https://')
	normalized = normalized.replace(/^http:\/(?!\/)/i, 'http://')

	return /^https?:\/\//i.test(normalized) ? normalized : null
}

function normalizePath(value: string): string[] {
	return value
		.split('/')
		.map(segment => segment.trim())
		.filter(Boolean)
}

function buildOriginalName(prefix: string, url: string): string {
	try {
		const parsed = new URL(url)
		const base = path.basename(parsed.pathname)
		return base || `${prefix}.bin`
	} catch {
		return `${prefix}.bin`
	}
}

function dedupeIssues(issues: LegacyMediaIssue[]): LegacyMediaIssue[] {
	const seen = new Set<string>()
	const result: LegacyMediaIssue[] = []

	for (const issue of issues) {
		const key = JSON.stringify([
			issue.entity,
			issue.legacyId,
			issue.severity,
			issue.code,
			issue.message
		])
		if (seen.has(key)) continue
		seen.add(key)
		result.push(issue)
	}

	return result
}

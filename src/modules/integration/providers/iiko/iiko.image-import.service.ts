import { Injectable, Logger, NotFoundException } from '@nestjs/common'

import { S3Service } from '@/modules/s3/public'
import { MediaRepository } from '@/shared/media/media.repository'

import { IntegrationRepository } from '../../integration.repository'
import { renderSafeProviderErrorMessage } from '../../provider-error-redaction'

import { IikoClient } from './iiko.client'
import type { IikoSyncProduct } from './iiko.types'

const IMAGE_IMPORT_PATH = 'integrations/iiko/products'

type RepositoryTransaction = Parameters<
	IntegrationRepository['findProductMediaIds']
>[2]

@Injectable()
export class IikoImageImportService {
	private readonly logger = new Logger(IikoImageImportService.name)

	constructor(
		private readonly repo: IntegrationRepository,
		private readonly s3Service: S3Service,
		private readonly mediaRepo: MediaRepository
	) {}

	async refreshProductImages(params: {
		catalogId: string
		productId: string
		client: IikoClient
		product: IikoSyncProduct
		forceImages: boolean
		tx?: RepositoryTransaction
	}): Promise<number> {
		const imageUrls = normalizeImageLinks(params.product.imageLinks)
		if (!imageUrls.length) return 0

		const previousMediaIds = await this.repo.findProductMediaIds(
			params.productId,
			params.catalogId,
			params.tx
		)
		if (!params.forceImages && previousMediaIds.length > 0) return 0

		const mediaIds: string[] = []
		const uploadedKeys: string[] = []

		for (const imageUrl of imageUrls) {
			try {
				const downloaded = await params.client.downloadImage(imageUrl)
				if (!downloaded) continue
				const uploaded = await this.s3Service.uploadImage(
					{
						buffer: downloaded.buffer,
						size: downloaded.buffer.length,
						mimetype: normalizeImageContentType(downloaded.contentType),
						originalname: `${params.product.id}.jpg`
					},
					{
						catalogId: params.catalogId,
						path: IMAGE_IMPORT_PATH,
						entityId: params.productId
					}
				)
				mediaIds.push(uploaded.mediaId)
				uploadedKeys.push(uploaded.key)
			} catch (error) {
				this.logger.warn(
					`Failed to import iiko image for product ${params.product.id}: ${renderSafeProviderErrorMessage(error)}`
				)
			}
		}

		if (!mediaIds.length) return 0

		const changed =
			params.forceImages ||
			mediaIds.length !== previousMediaIds.length ||
			mediaIds.some((mediaId, index) => mediaId !== previousMediaIds[index])
		if (!changed) return 0

		const replaced = await this.repo.replaceProductMedia(
			params.productId,
			params.catalogId,
			mediaIds,
			params.tx
		)
		if (!replaced) {
			await this.cleanupUploaded(uploadedKeys)
			throw new NotFoundException('Product was not found')
		}

		await this.cleanupOrphanedMedia(previousMediaIds, params.catalogId)
		return mediaIds.length
	}

	private async cleanupUploaded(keys: string[]): Promise<void> {
		if (!keys.length) return
		try {
			await this.s3Service.deleteObjectsByKeys(keys)
		} catch (error) {
			this.logger.warn(
				`Failed to cleanup iiko images after import error: ${renderSafeProviderErrorMessage(error)}`
			)
		}
	}

	private async cleanupOrphanedMedia(
		previousMediaIds: string[],
		catalogId: string
	): Promise<void> {
		if (!previousMediaIds.length) return

		const orphans = await this.mediaRepo.findOrphanedByIds(
			previousMediaIds,
			catalogId
		)
		if (!orphans.length) return

		const keys = orphans.flatMap(orphan => [
			orphan.key,
			...orphan.variants
				.filter(variant => variant.storage === 's3' && variant.key)
				.map(variant => variant.key)
		])

		try {
			await this.s3Service.deleteObjectsByKeys(keys)
			await this.mediaRepo.deleteOrphanedByIds(
				orphans.map(orphan => orphan.id),
				catalogId
			)
		} catch (error) {
			this.logger.warn(
				`Failed to cleanup orphaned media after iiko sync: ${renderSafeProviderErrorMessage(error)}`
			)
		}
	}
}

function normalizeImageLinks(value?: string[] | null): string[] {
	if (!Array.isArray(value)) return []
	return [...new Set(value.map(item => item.trim()).filter(Boolean))]
}

function normalizeImageContentType(value: string | null): string {
	const normalized = value?.split(';')[0]?.trim().toLowerCase()
	if (
		normalized === 'image/jpeg' ||
		normalized === 'image/png' ||
		normalized === 'image/webp' ||
		normalized === 'image/avif'
	) {
		return normalized
	}
	return 'image/jpeg'
}

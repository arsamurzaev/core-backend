import { Injectable, Logger, NotFoundException } from '@nestjs/common'

import { S3Service } from '@/modules/s3/s3.service'
import { MediaRepository } from '@/shared/media/media.repository'

import { IntegrationRepository } from '../../integration.repository'
import { renderSafeProviderErrorMessage } from '../../provider-error-redaction'

import { MoySkladClient } from './moysklad.client'
import type { MoySkladEntityType, MoySkladProduct } from './moysklad.types'

const IMAGE_IMPORT_PATH = 'integrations/moysklad/products'
const ALLOWED_IMAGE_MIME_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/avif'
])

type RepositoryTransaction = Parameters<
	IntegrationRepository['findProductMediaIds']
>[2]

type ImportedProductImages = {
	mediaIds: string[]
	sourceCount: number
}

@Injectable()
export class MoySkladImageImportService {
	private readonly logger = new Logger(MoySkladImageImportService.name)

	constructor(
		private readonly repo: IntegrationRepository,
		private readonly s3Service: S3Service,
		private readonly mediaRepo: MediaRepository
	) {}

	async refreshProductImages(params: {
		catalogId: string
		productId: string
		client: MoySkladClient
		product: MoySkladProduct
		forceImages: boolean
		tx?: RepositoryTransaction
	}): Promise<number> {
		const previousMediaIds = await this.repo.findProductMediaIds(
			params.productId,
			params.catalogId,
			params.tx
		)
		const imported = await this.importProductImages({
			catalogId: params.catalogId,
			productId: params.productId,
			client: params.client,
			product: params.product
		})
		if (!imported) {
			return 0
		}
		if (imported.sourceCount > 0 && imported.mediaIds.length === 0) {
			return 0
		}

		const mediaIds = imported.mediaIds
		const changed =
			params.forceImages ||
			mediaIds.length !== previousMediaIds.length ||
			mediaIds.length > 0 ||
			(previousMediaIds.length > 0 && imported.sourceCount === 0)

		if (!changed) {
			return 0
		}

		const replaced = await this.repo.replaceProductMedia(
			params.productId,
			params.catalogId,
			mediaIds,
			params.tx
		)
		if (!replaced) {
			throw new NotFoundException('Товар не найден')
		}

		await this.cleanupOrphanedMedia(previousMediaIds, params.catalogId)
		return mediaIds.length
	}

	private async importProductImages(params: {
		catalogId: string
		productId: string
		client: MoySkladClient
		product: MoySkladProduct
	}): Promise<ImportedProductImages | null> {
		const imageUrls = await this.resolveProductImageUrls(
			params.client,
			params.product
		)

		if (!imageUrls) {
			return null
		}
		if (!imageUrls.length) {
			return { mediaIds: [], sourceCount: 0 }
		}

		const mediaIds: string[] = []
		const uploadedKeys: string[] = []

		try {
			const uploadPromises = imageUrls.map(async imageUrl => {
				try {
					const uploaded = await this.uploadProductImage({
						catalogId: params.catalogId,
						productId: params.productId,
						client: params.client,
						product: params.product,
						imageUrl
					})

					return uploaded
				} catch (error) {
					this.logger.warn(
						`Не удалось импортировать изображение MoySklad для товара ${params.product.id}: ${this.renderErrorMessage(error)}`
					)
					return null
				}
			})

			const results = await Promise.allSettled(uploadPromises)

			for (const result of results) {
				if (result.status === 'fulfilled' && result.value) {
					mediaIds.push(result.value.mediaId)
					uploadedKeys.push(result.value.key)
				}
			}
		} catch (error) {
			if (uploadedKeys.length > 0) {
				try {
					await this.s3Service.deleteObjectsByKeys(uploadedKeys)
				} catch (cleanupError) {
					this.logger.error(
						`Не удалось очистить загруженные изображения после ошибки: ${this.renderErrorMessage(cleanupError)}`
					)
				}
			}
			throw error
		}

		return {
			mediaIds,
			sourceCount: imageUrls.length
		}
	}

	private async resolveProductImageUrls(
		client: MoySkladClient,
		product: MoySkladProduct
	): Promise<string[] | null> {
		const entityType = resolveExternalEntityType(product)

		if (product.images?.rows && product.images.rows.length > 0) {
			return product.images.rows
				.filter(image => image.meta.downloadHref)
				.map(image => image.meta.downloadHref)
		}

		try {
			return entityType === 'product'
				? await client.getEntityImages('product', product.id)
				: []
		} catch (error) {
			this.logger.warn(
				`Не удалось загрузить список изображений MoySklad для товара ${product.id}: ${this.renderErrorMessage(error)}`
			)
			return null
		}
	}

	private async uploadProductImage(params: {
		catalogId: string
		productId: string
		client: MoySkladClient
		product: MoySkladProduct
		imageUrl: string
	}): Promise<{ mediaId: string; key: string } | null> {
		const downloaded = await params.client.downloadImage(params.imageUrl)
		if (!downloaded) {
			return null
		}

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

		return { mediaId: uploaded.mediaId, key: uploaded.key }
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
				`Не удалось очистить orphaned media после sync MoySklad: ${this.renderErrorMessage(error)}`
			)
		}
	}

	private renderErrorMessage(error: unknown): string {
		return renderSafeProviderErrorMessage(error)
	}
}

function resolveExternalEntityType(
	product: MoySkladProduct
): MoySkladEntityType {
	switch (product.meta?.type) {
		case 'service':
		case 'bundle':
		case 'variant':
			return product.meta.type
		default:
			return 'product'
	}
}

function normalizeImageContentType(contentType?: string | null): string {
	const normalized = contentType?.split(';')[0]?.trim().toLowerCase()
	if (normalized === 'image/jpg') {
		return 'image/jpeg'
	}
	if (normalized && ALLOWED_IMAGE_MIME_TYPES.has(normalized)) {
		return normalized
	}
	return 'image/jpeg'
}

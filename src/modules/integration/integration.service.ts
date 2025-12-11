import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'
import Bottleneck from 'bottleneck'

import { PrismaService } from '@/src/core/prisma/prisma.service'
import { loadImage } from '@/src/shared/lib/load-image'

@Injectable()
export class IntegrationService {
	private readonly logger = new Logger(IntegrationService.name)
	private readonly msUrl = 'https://api.moysklad.ru/api/remap/1.2/entity/product'
	private readonly token = process.env.MS_TOKEN!
	private readonly s3 = new S3Client({ region: process.env.AWS_REGION })
	private readonly bucket = process.env.S3_BUCKET!
	private readonly limiter = new Bottleneck({ maxConcurrent: 4, minTime: 80 })

	constructor(private prisma: PrismaService) {}

	async sync() {
		const limit = 1000
		let offset = 0

		while (true) {
			const res = await this.limiter.schedule(() =>
				axios.get(this.msUrl, {
					headers: { Authorization: `Bearer ${this.token}` },
					params: { limit, offset }
				})
			)
			const rows = res.data.rows || []
			if (!rows.length) break

			for (const p of rows) {
				let imageUrl: string | null = null
				const imagesMetaHref = p?.images?.meta?.href

				if (imagesMetaHref) {
					try {
						const filesList = await this.limiter.schedule(() =>
							axios.get(imagesMetaHref, {
								headers: { Authorization: `Bearer ${this.token}` }
							})
						)
						const files = filesList.data.rows || []
						if (files.length) {
							const downloadHref = files[0]?.meta?.downloadHref
							if (downloadHref) {
								const buf = await this.limiter.schedule(() =>
									loadImage(downloadHref, this.token)
								)
								const key = `products/${p.id}.png`
								await this.s3.send(
									new PutObjectCommand({
										Bucket: this.bucket,
										Key: key,
										Body: buf,
										ContentType: 'image/png',
										ACL: 'public-read'
									})
								)
								imageUrl = `https://${this.bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
							}
						}
					} catch (e) {
						this.logger.warn(
							`Ошибка обработки изображения ${p.id}: ${e?.message ?? e}`
						)
					}
				}

				await this.prisma.product.upsert({
					where: { sku: p.id },
					create: {
						sku: p.id,
						name: p.name ?? '',
						updatedAt: new Date(p.updated),
						imagesUrls: imageUrl
					},
					update: {
						name: p.name ?? '',
						code: p.code ?? null,
						updatedAt: new Date(p.updated),
						image: imageUrl
					}
				})
			}

			if (rows.length < limit) break
			offset += limit
		}
	}
}

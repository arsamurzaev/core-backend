import { SeoChangeFreq, SeoEntityType } from '@generated/enums'
import {
	SeoSettingCreateInput,
	SeoSettingUpdateInput
} from '@generated/models'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import sharp from 'sharp'

import {
	S3Service,
	type UploadGeneratedAssetResult
} from '@/modules/s3/s3.service'
import { SeoRepository } from '@/modules/seo/seo.repository'
import { normalizeNullableTrimmedString } from '@/shared/utils'

type CatalogSeoSyncRecord = {
	id: string
	slug: string
	domain?: string | null
	name: string
	config?: {
		about?: string | null
		description?: string | null
	} | null
}

type GeneratedSeoAsset = {
	mediaId: string
	key: string
	url: string
	contentType: string
	width?: number
	height?: number
}

type GeneratedCatalogSeoAssets = {
	favicon: GeneratedSeoAsset | null
	telegram: GeneratedSeoAsset | null
	whatsapp: GeneratedSeoAsset | null
}

@Injectable()
export class CatalogSeoSyncService {
	private readonly logger = new Logger(CatalogSeoSyncService.name)

	constructor(
		private readonly seoRepo: SeoRepository,
		private readonly s3Service: S3Service
	) {}

	async syncCatalog(catalog: CatalogSeoSyncRecord): Promise<void> {
		const existing = await this.seoRepo.findByEntity(
			catalog.id,
			SeoEntityType.CATALOG,
			catalog.id
		)
		const generatedAssets = await this.generateAssets(catalog)
		const mergedExtras = this.mergeSeoExtras(existing?.extras, generatedAssets)
		const description = this.buildDescription(catalog)
		const canonicalUrl = this.buildCanonicalUrl(catalog)

		if (!existing) {
			const createData: SeoSettingCreateInput = {
				catalog: { connect: { id: catalog.id } },
				entityType: SeoEntityType.CATALOG,
				entityId: catalog.id,
				urlPath: '/',
				canonicalUrl,
				title: catalog.name,
				description,
				keywords: `${catalog.name}, каталог, магазин`,
				h1: catalog.name,
				robots: 'index,follow',
				isIndexable: true,
				isFollowable: true,
				ogTitle: catalog.name,
				ogDescription: description,
				...(generatedAssets.whatsapp
					? { ogMedia: { connect: { id: generatedAssets.whatsapp.mediaId } } }
					: {}),
				ogType: 'website',
				ogUrl: canonicalUrl,
				ogSiteName: catalog.name,
				ogLocale: 'ru_RU',
				twitterCard: 'summary_large_image',
				twitterTitle: catalog.name,
				twitterDescription: description,
				...(generatedAssets.telegram
					? { twitterMedia: { connect: { id: generatedAssets.telegram.mediaId } } }
					: {}),
				extras: JSON.stringify(mergedExtras),
				sitemapPriority: 1,
				sitemapChangeFreq: SeoChangeFreq.WEEKLY
			}

			await this.seoRepo.create(createData)
			return
		}

		const updateData: SeoSettingUpdateInput = {
			urlPath: '/',
			canonicalUrl,
			title: catalog.name,
			description,
			keywords: `${catalog.name}, каталог, магазин`,
			h1: catalog.name,
			robots: 'index,follow',
			isIndexable: true,
			isFollowable: true,
			ogTitle: catalog.name,
			ogDescription: description,
			ogType: 'website',
			ogUrl: canonicalUrl,
			ogSiteName: catalog.name,
			ogLocale: 'ru_RU',
			twitterCard: 'summary_large_image',
			twitterTitle: catalog.name,
			twitterDescription: description,
			extras: JSON.stringify(mergedExtras),
			sitemapPriority: 1,
			sitemapChangeFreq: SeoChangeFreq.WEEKLY
		}

		if (generatedAssets.whatsapp) {
			updateData.ogMedia = {
				connect: { id: generatedAssets.whatsapp.mediaId }
			}
		}
		if (generatedAssets.telegram) {
			updateData.twitterMedia = {
				connect: { id: generatedAssets.telegram.mediaId }
			}
		}

		await this.seoRepo.update(existing.id, catalog.id, updateData)
	}

	private async generateAssets(
		catalog: CatalogSeoSyncRecord
	): Promise<GeneratedCatalogSeoAssets> {
		try {
			const [faviconPng, telegramPng, whatsappPng] = await Promise.all([
				this.renderFaviconPng(catalog),
				this.renderSocialPng(catalog, 'Telegram'),
				this.renderSocialPng(catalog, 'WhatsApp')
			])

			const faviconIco = this.wrapPngAsIco(faviconPng.buffer, 64, 64)

			const [favicon, telegram, whatsapp] = await Promise.all([
				this.uploadAsset(catalog.id, 'favicon.ico', 'image/x-icon', faviconIco, {
					width: 64,
					height: 64
				}),
				this.uploadAsset(
					catalog.id,
					'telegram.png',
					'image/png',
					telegramPng.buffer,
					{
						width: telegramPng.width,
						height: telegramPng.height
					}
				),
				this.uploadAsset(
					catalog.id,
					'whatsapp.png',
					'image/png',
					whatsappPng.buffer,
					{
						width: whatsappPng.width,
						height: whatsappPng.height
					}
				)
			])

			return { favicon, telegram, whatsapp }
		} catch (error) {
			if (
				error instanceof BadRequestException &&
				error.message === 'Загрузка файлов отключена'
			) {
				this.logger.warn(
					`SEO assets for catalog ${catalog.id} were skipped because S3 uploads are disabled`
				)
				return {
					favicon: null,
					telegram: null,
					whatsapp: null
				}
			}

			throw error
		}
	}

	private async uploadAsset(
		catalogId: string,
		filename: string,
		contentType: string,
		buffer: Buffer,
		size: { width?: number; height?: number }
	): Promise<GeneratedSeoAsset> {
		const result = await this.s3Service.uploadGeneratedAsset(
			{
				buffer,
				contentType,
				originalName: filename,
				size: buffer.length,
				width: size.width,
				height: size.height
			},
			{
				catalogId,
				path: 'seo/catalog',
				entityId: catalogId,
				filename
			}
		)

		return this.mapAsset(result, contentType, size)
	}

	private mapAsset(
		asset: UploadGeneratedAssetResult,
		contentType: string,
		size: { width?: number; height?: number }
	): GeneratedSeoAsset {
		return {
			mediaId: asset.mediaId,
			key: asset.key,
			url: asset.url,
			contentType,
			width: size.width,
			height: size.height
		}
	}

	private mergeSeoExtras(
		current: unknown,
		generatedAssets: GeneratedCatalogSeoAssets
	): Record<string, unknown> {
		const parsed =
			this.parseExtras(current) ?? ({} as Record<string, unknown>)

		return {
			...parsed,
			generatedAssets: {
				favicon: generatedAssets.favicon,
				telegram: generatedAssets.telegram,
				whatsapp: generatedAssets.whatsapp
			}
		}
	}

	private parseExtras(value: unknown): Record<string, unknown> | null {
		if (!value) return null
		if (typeof value === 'object' && !Array.isArray(value)) {
			return value as Record<string, unknown>
		}
		if (typeof value !== 'string') return null

		try {
			const parsed = JSON.parse(value) as unknown
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>
			}
		} catch {
			return null
		}

		return null
	}

	private buildCanonicalUrl(catalog: CatalogSeoSyncRecord): string | null {
		return catalog.domain ? `https://${catalog.domain}` : null
	}

	private buildDescription(catalog: CatalogSeoSyncRecord): string {
		const description =
			normalizeNullableTrimmedString(catalog.config?.description) ??
			normalizeNullableTrimmedString(catalog.config?.about) ??
			`Каталог ${catalog.name}`

		return description
	}

	private async renderFaviconPng(catalog: CatalogSeoSyncRecord): Promise<{
		buffer: Buffer
	}> {
		const palette = this.resolvePalette(catalog.slug || catalog.name)
		const initials = this.buildInitials(catalog.name)
		const svg = `
			<svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
				<defs>
					<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
						<stop offset="0%" stop-color="${palette.primary}" />
						<stop offset="100%" stop-color="${palette.secondary}" />
					</linearGradient>
				</defs>
				<rect width="64" height="64" rx="18" fill="url(#bg)" />
				<text x="32" y="39" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#ffffff">${this.escapeSvgText(initials)}</text>
			</svg>
		`

		const rendered = await sharp(Buffer.from(svg)).png().toBuffer({
			resolveWithObject: true
		})

		return { buffer: rendered.data }
	}

	private async renderSocialPng(
		catalog: CatalogSeoSyncRecord,
		label: 'Telegram' | 'WhatsApp'
	): Promise<{ buffer: Buffer; width: number; height: number }> {
		const width = 1200
		const height = 630
		const palette = this.resolvePalette(catalog.slug || catalog.name)
		const initials = this.buildInitials(catalog.name)
		const [line1, line2] = this.splitTitle(catalog.name)

		const svg = `
			<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
				<defs>
					<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
						<stop offset="0%" stop-color="${palette.primary}" />
						<stop offset="100%" stop-color="${palette.secondary}" />
					</linearGradient>
				</defs>
				<rect width="${width}" height="${height}" fill="url(#bg)" />
				<circle cx="1040" cy="110" r="180" fill="${palette.accent}" fill-opacity="0.12" />
				<circle cx="1120" cy="500" r="220" fill="#ffffff" fill-opacity="0.08" />
				<rect x="72" y="72" width="168" height="168" rx="42" fill="#ffffff" fill-opacity="0.16" />
				<text x="156" y="176" text-anchor="middle" font-family="Arial, sans-serif" font-size="68" font-weight="700" fill="#ffffff">${this.escapeSvgText(initials)}</text>
				<text x="72" y="330" font-family="Arial, sans-serif" font-size="92" font-weight="700" fill="#ffffff">${this.escapeSvgText(line1)}</text>
				<text x="72" y="432" font-family="Arial, sans-serif" font-size="92" font-weight="700" fill="#ffffff">${this.escapeSvgText(line2)}</text>
				<text x="72" y="542" font-family="Arial, sans-serif" font-size="34" fill="#ffffff" fill-opacity="0.82">${this.escapeSvgText(label)} preview</text>
			</svg>
		`

		const rendered = await sharp(Buffer.from(svg)).png().toBuffer({
			resolveWithObject: true
		})

		return {
			buffer: rendered.data,
			width: rendered.info.width,
			height: rendered.info.height
		}
	}

	private wrapPngAsIco(buffer: Buffer, width: number, height: number): Buffer {
		const header = Buffer.alloc(22)
		header.writeUInt16LE(0, 0)
		header.writeUInt16LE(1, 2)
		header.writeUInt16LE(1, 4)
		header.writeUInt8(width >= 256 ? 0 : width, 6)
		header.writeUInt8(height >= 256 ? 0 : height, 7)
		header.writeUInt8(0, 8)
		header.writeUInt8(0, 9)
		header.writeUInt16LE(1, 10)
		header.writeUInt16LE(32, 12)
		header.writeUInt32LE(buffer.length, 14)
		header.writeUInt32LE(22, 18)

		return Buffer.concat([header, buffer])
	}

	private buildInitials(name: string): string {
		const words = name
			.split(/\s+/)
			.map(word => word.trim())
			.filter(Boolean)

		if (!words.length) return 'CT'

		return words
			.slice(0, 2)
			.map(word => Array.from(word)[0] ?? '')
			.join('')
			.toUpperCase()
	}

	private splitTitle(name: string): [string, string] {
		const words = name
			.split(/\s+/)
			.map(word => word.trim())
			.filter(Boolean)
		if (!words.length) return ['Catalog', '']
		if (words.length === 1) return [words[0], '']

		const midpoint = Math.ceil(words.length / 2)
		return [
			words.slice(0, midpoint).join(' ').slice(0, 18),
			words.slice(midpoint).join(' ').slice(0, 18)
		]
	}

	private resolvePalette(seed: string): {
		primary: string
		secondary: string
		accent: string
	} {
		let hash = 0
		for (const char of seed) {
			hash = (hash * 31 + char.charCodeAt(0)) >>> 0
		}

		const hue = hash % 360
		return {
			primary: `hsl(${hue} 68% 46%)`,
			secondary: `hsl(${(hue + 42) % 360} 55% 32%)`,
			accent: `hsl(${(hue + 180) % 360} 78% 78%)`
		}
	}

	private escapeSvgText(value: string): string {
		return value
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;')
	}
}

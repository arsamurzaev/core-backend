import { SeoChangeFreq, SeoEntityType } from '@generated/enums'
import { SeoSettingCreateInput, SeoSettingUpdateInput } from '@generated/models'
import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import sharp from 'sharp'

import {
	S3Service,
	type UploadGeneratedAssetResult
} from '@/modules/s3/s3.service'
import { SeoRepository } from '@/modules/seo/seo.repository'
import {
	MEDIA_VARIANT_NAMES,
	MediaUrlService,
	normalizeMediaVariantName
} from '@/shared/media/media-url.service'
import { normalizeNullableTrimmedString } from '@/shared/utils'

type CatalogSeoMediaVariant = {
	kind: string
	mimeType?: string | null
	storage: string
	key: string
}

type CatalogSeoMediaRecord = {
	mimeType?: string | null
	storage: string
	key: string
	variants?: CatalogSeoMediaVariant[] | null
}

type CatalogSeoSyncRecord = {
	id: string
	slug: string
	domain?: string | null
	name: string
	config?: {
		about?: string | null
		description?: string | null
		logoMedia?: CatalogSeoMediaRecord | null
		bgMedia?: CatalogSeoMediaRecord | null
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

type PreparedCatalogSeoVisuals = {
	background: Buffer | null
	logo: Buffer | null
}

type ResolvedCatalogSeoMediaSource = {
	key: string
	storage: string
	mimeType?: string | null
}

const SOCIAL_IMAGE_WIDTH = 1200
const SOCIAL_IMAGE_HEIGHT = 630
const SOCIAL_LOGO_SIZE = 448
const SOCIAL_OG_LOGO_SIZE = 420
const SOCIAL_OG_VERTICAL_GAP = 18
const SOCIAL_FALLBACK_LOGO_FONT_RATIO = 0.37
const FAVICON_SIZE = 64
const UPLOADS_DISABLED_MESSAGE = 'Загрузка файлов отключена'

@Injectable()
export class CatalogSeoSyncService {
	private readonly logger = new Logger(CatalogSeoSyncService.name)

	constructor(
		private readonly seoRepo: SeoRepository,
		private readonly s3Service: S3Service,
		private readonly mediaUrl: MediaUrlService
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
				...(generatedAssets.favicon
					? { faviconMedia: { connect: { id: generatedAssets.favicon.mediaId } } }
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
		if (generatedAssets.favicon) {
			updateData.faviconMedia = {
				connect: { id: generatedAssets.favicon.mediaId }
			}
		}

		await this.seoRepo.update(existing.id, catalog.id, updateData)
	}

	private async generateAssets(
		catalog: CatalogSeoSyncRecord
	): Promise<GeneratedCatalogSeoAssets> {
		try {
			const visuals = await this.prepareSocialVisuals(catalog)
			const [faviconPng, socialPng] = await Promise.all([
				this.renderFaviconPng(catalog, visuals.logo),
				this.renderSocialPng(catalog, visuals)
			])

			const faviconIco = this.wrapPngAsIco(
				faviconPng.buffer,
				FAVICON_SIZE,
				FAVICON_SIZE
			)

			const [favicon, telegram, whatsapp] = await Promise.all([
				this.uploadAsset(catalog.id, 'favicon.ico', 'image/x-icon', faviconIco, {
					width: FAVICON_SIZE,
					height: FAVICON_SIZE
				}),
				this.uploadAsset(
					catalog.id,
					'telegram.png',
					'image/png',
					socialPng.buffer,
					{
						width: socialPng.width,
						height: socialPng.height
					}
				),
				this.uploadAsset(
					catalog.id,
					'whatsapp.png',
					'image/png',
					socialPng.buffer,
					{
						width: socialPng.width,
						height: socialPng.height
					}
				)
			])

			return { favicon, telegram, whatsapp }
		} catch (error) {
			if (this.isUploadsDisabledError(error)) {
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

	private async prepareSocialVisuals(
		catalog: CatalogSeoSyncRecord
	): Promise<PreparedCatalogSeoVisuals> {
		const [background, logo] = await Promise.all([
			this.prepareBackgroundVisual(catalog.config?.bgMedia ?? null),
			this.prepareLogoVisual(catalog.config?.logoMedia ?? null)
		])

		return { background, logo }
	}

	private async prepareBackgroundVisual(
		media: CatalogSeoMediaRecord | null
	): Promise<Buffer | null> {
		const buffer = await this.loadCatalogMediaBuffer(media, [
			MEDIA_VARIANT_NAMES.detail,
			MEDIA_VARIANT_NAMES.card
		])
		if (!buffer) return null

		try {
			return await sharp(buffer)
				.rotate()
				.resize({
					width: SOCIAL_IMAGE_WIDTH,
					height: SOCIAL_IMAGE_HEIGHT,
					fit: 'cover'
				})
				.modulate({
					brightness: 0.9,
					saturation: 1.05
				})
				.png()
				.toBuffer()
		} catch (error) {
			this.logger.warn(
				`Failed to prepare catalog background image for SEO preview: ${this.describeError(error)}`
			)
			return null
		}
	}

	private async prepareLogoVisual(
		media: CatalogSeoMediaRecord | null
	): Promise<Buffer | null> {
		const buffer = await this.loadCatalogMediaBuffer(media, [
			MEDIA_VARIANT_NAMES.thumb,
			MEDIA_VARIANT_NAMES.card,
			MEDIA_VARIANT_NAMES.detail
		])
		if (!buffer) return null

		try {
			const resized = await sharp(buffer)
				.rotate()
				.resize({
					width: SOCIAL_LOGO_SIZE,
					height: SOCIAL_LOGO_SIZE,
					fit: 'cover'
				})
				.png()
				.toBuffer()
			const mask = Buffer.from(`
				<svg width="${SOCIAL_LOGO_SIZE}" height="${SOCIAL_LOGO_SIZE}" viewBox="0 0 ${SOCIAL_LOGO_SIZE} ${SOCIAL_LOGO_SIZE}" xmlns="http://www.w3.org/2000/svg">
					<rect width="${SOCIAL_LOGO_SIZE}" height="${SOCIAL_LOGO_SIZE}" rx="${SOCIAL_LOGO_SIZE / 2}" fill="#ffffff" />
				</svg>
			`)

			return await sharp(resized)
				.composite([{ input: mask, blend: 'dest-in' }])
				.png()
				.toBuffer()
		} catch (error) {
			this.logger.warn(
				`Failed to prepare catalog logo image for SEO preview: ${this.describeError(error)}`
			)
			return null
		}
	}

	private async loadCatalogMediaBuffer(
		media: CatalogSeoMediaRecord | null,
		preferredVariantNames: readonly string[]
	): Promise<Buffer | null> {
		const source = this.resolveMediaSource(media, preferredVariantNames)
		if (!source) return null

		try {
			if (source.storage === 's3') {
				const downloaded = await this.s3Service.downloadObject(source.key)
				return downloaded.buffer
			}

			const url = this.mediaUrl.resolveUrl(source.storage, source.key)
			const response = await fetch(url)
			if (!response.ok) {
				throw new BadRequestException(
					`Failed to download media ${url}: ${response.status}`
				)
			}

			const arrayBuffer = await response.arrayBuffer()
			return Buffer.from(arrayBuffer)
		} catch (error) {
			this.logger.warn(
				`Failed to load catalog media ${source.key} for SEO preview: ${this.describeError(error)}`
			)
			return null
		}
	}

	private resolveMediaSource(
		media: CatalogSeoMediaRecord | null,
		preferredVariantNames: readonly string[]
	): ResolvedCatalogSeoMediaSource | null {
		if (!media?.key) return null

		const normalizedPreferredNames = preferredVariantNames.map(variantName =>
			normalizeMediaVariantName(variantName)
		)

		for (const preferredName of normalizedPreferredNames) {
			const variant = (media.variants ?? []).find(
				item => this.extractVariantName(item.kind) === preferredName
			)
			if (variant?.key) {
				return {
					key: variant.key,
					storage: variant.storage,
					mimeType: variant.mimeType
				}
			}
		}

		return {
			key: media.key,
			storage: media.storage,
			mimeType: media.mimeType
		}
	}

	private extractVariantName(kind: string): string {
		return normalizeMediaVariantName(kind.replace(/-(avif|webp)$/i, ''))
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
		const parsed = this.parseExtras(current) ?? ({} as Record<string, unknown>)

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
		return (
			normalizeNullableTrimmedString(catalog.config?.description) ??
			normalizeNullableTrimmedString(catalog.config?.about) ??
			`Каталог ${catalog.name}`
		)
	}

	private buildSocialSubtitle(catalog: CatalogSeoSyncRecord): string {
		return (
			normalizeNullableTrimmedString(catalog.config?.about) ??
			catalog.domain ??
			catalog.slug ??
			'Online catalog'
		)
	}

	private async renderFaviconPng(
		catalog: CatalogSeoSyncRecord,
		logo: Buffer | null
	): Promise<{ buffer: Buffer }> {
		const palette = this.resolvePalette(catalog.slug || catalog.name)
		const initials = this.buildInitials(catalog.name)
		const svg = `
			<svg width="${FAVICON_SIZE}" height="${FAVICON_SIZE}" viewBox="0 0 ${FAVICON_SIZE} ${FAVICON_SIZE}" xmlns="http://www.w3.org/2000/svg">
				<defs>
					<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
						<stop offset="0%" stop-color="${palette.primary}" />
						<stop offset="100%" stop-color="${palette.secondary}" />
					</linearGradient>
				</defs>
				<rect width="${FAVICON_SIZE}" height="${FAVICON_SIZE}" fill="url(#bg)" />
				${
					logo
						? ''
						: `<text x="32" y="39" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="#ffffff">${this.escapeSvgText(initials)}</text>`
				}
			</svg>
		`

		const circleMask = Buffer.from(
			`<svg width="${FAVICON_SIZE}" height="${FAVICON_SIZE}" viewBox="0 0 ${FAVICON_SIZE} ${FAVICON_SIZE}" xmlns="http://www.w3.org/2000/svg"><circle cx="${FAVICON_SIZE / 2}" cy="${FAVICON_SIZE / 2}" r="${FAVICON_SIZE / 2}" fill="#ffffff"/></svg>`
		)

		if (logo) {
			const resized = await sharp(logo)
				.resize({ width: FAVICON_SIZE, height: FAVICON_SIZE, fit: 'cover' })
				.png()
				.toBuffer()

			const rendered = await sharp(resized)
				.composite([{ input: circleMask, blend: 'dest-in' }])
				.png()
				.toBuffer({ resolveWithObject: true })

			return { buffer: rendered.data }
		}

		const flat = await sharp(Buffer.from(svg)).png().toBuffer()

		const rendered = await sharp(flat)
			.composite([{ input: circleMask, blend: 'dest-in' }])
			.png()
			.toBuffer({ resolveWithObject: true })

		return { buffer: rendered.data }
	}

	private async renderSocialPng(
		catalog: CatalogSeoSyncRecord,
		visuals: PreparedCatalogSeoVisuals
	): Promise<{ buffer: Buffer; width: number; height: number }> {
		const palette = this.resolvePalette(catalog.slug || catalog.name)
		const titleLines = this.wrapText(catalog.name, 20, 2)
		const initials = this.buildInitials(catalog.name)
		const background = await this.renderSocialBackground(
			visuals.background,
			palette
		)

		const logoTop = SOCIAL_OG_VERTICAL_GAP
		const logoLeft = Math.round((SOCIAL_IMAGE_WIDTH - SOCIAL_OG_LOGO_SIZE) / 2)
		const titleTop = logoTop + SOCIAL_OG_LOGO_SIZE + SOCIAL_OG_VERTICAL_GAP
		const titleBottom = SOCIAL_IMAGE_HEIGHT - SOCIAL_OG_VERTICAL_GAP
		const titleBlockHeight = Math.max(0, titleBottom - titleTop)
		const titleLineCount = Math.max(titleLines.length, 1)
		const titleLineHeight = Math.floor(titleBlockHeight / titleLineCount)
		const titleFontSize = titleLineHeight
		const titleShadeTop = Math.max(0, titleTop - SOCIAL_OG_VERTICAL_GAP * 2)

		const overlaySvg = `
			<svg width="${SOCIAL_IMAGE_WIDTH}" height="${SOCIAL_IMAGE_HEIGHT}" viewBox="0 0 ${SOCIAL_IMAGE_WIDTH} ${SOCIAL_IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
				<defs>
					<linearGradient id="screenShade" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stop-color="#030712" stop-opacity="0.06" />
						<stop offset="50%" stop-color="#030712" stop-opacity="0.16" />
						<stop offset="100%" stop-color="#030712" stop-opacity="0.55" />
					</linearGradient>
					<linearGradient id="titleShade" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stop-color="#040816" stop-opacity="0" />
						<stop offset="55%" stop-color="#040816" stop-opacity="0.72" />
						<stop offset="100%" stop-color="#040816" stop-opacity="0.88" />
					</linearGradient>
				</defs>
				<rect width="${SOCIAL_IMAGE_WIDTH}" height="${SOCIAL_IMAGE_HEIGHT}" fill="url(#screenShade)" />
				<rect x="0" y="${titleShadeTop}" width="${SOCIAL_IMAGE_WIDTH}" height="${SOCIAL_IMAGE_HEIGHT - titleShadeTop}" fill="url(#titleShade)" />
				<rect x="${logoLeft}" y="${logoTop}" width="${SOCIAL_OG_LOGO_SIZE}" height="${SOCIAL_OG_LOGO_SIZE}" rx="${SOCIAL_OG_LOGO_SIZE / 2}" fill="#06101d" fill-opacity="0.64" />
				<rect x="${logoLeft}" y="${logoTop}" width="${SOCIAL_OG_LOGO_SIZE}" height="${SOCIAL_OG_LOGO_SIZE}" rx="${SOCIAL_OG_LOGO_SIZE / 2}" stroke="#ffffff" stroke-opacity="0.14" stroke-width="1" />
				${
					visuals.logo
						? ''
						: `<text x="${SOCIAL_IMAGE_WIDTH / 2}" y="${SOCIAL_IMAGE_HEIGHT / 2 + SOCIAL_OG_LOGO_SIZE * 0.14}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.round(SOCIAL_OG_LOGO_SIZE * SOCIAL_FALLBACK_LOGO_FONT_RATIO)}" font-weight="700" fill="#ffffff">${this.escapeSvgText(initials)}</text>`
				}
				${this.renderSvgTextLines(titleLines, {
					x: SOCIAL_IMAGE_WIDTH / 2,
					y: titleTop,
					lineHeight: titleLineHeight,
					fontSize: titleFontSize,
					fontWeight: 700,
					fill: '#ffffff',
					textAnchor: 'middle',
					dominantBaseline: 'hanging'
				})}
			</svg>
		`

		const composite: sharp.OverlayOptions[] = [
			{ input: Buffer.from(overlaySvg), left: 0, top: 0 }
		]

		if (visuals.logo) {
			const logoResized = await sharp(visuals.logo)
				.resize({
					width: SOCIAL_OG_LOGO_SIZE,
					height: SOCIAL_OG_LOGO_SIZE,
					fit: 'cover'
				})
				.png()
				.toBuffer()
			composite.push({
				input: logoResized,
				left: logoLeft,
				top: logoTop
			})
		}

		const rendered = await sharp(background).composite(composite).png().toBuffer({
			resolveWithObject: true
		})

		return {
			buffer: rendered.data,
			width: rendered.info.width,
			height: rendered.info.height
		}
	}

	private async renderSocialBackground(
		background: Buffer | null,
		palette: { primary: string; secondary: string; accent: string }
	): Promise<Buffer> {
		if (background) {
			return background
		}

		const svg = `
			<svg width="${SOCIAL_IMAGE_WIDTH}" height="${SOCIAL_IMAGE_HEIGHT}" viewBox="0 0 ${SOCIAL_IMAGE_WIDTH} ${SOCIAL_IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
				<defs>
					<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
						<stop offset="0%" stop-color="${palette.primary}" />
						<stop offset="58%" stop-color="${palette.secondary}" />
						<stop offset="100%" stop-color="#08111d" />
					</linearGradient>
				</defs>
				<rect width="${SOCIAL_IMAGE_WIDTH}" height="${SOCIAL_IMAGE_HEIGHT}" fill="url(#bg)" />
				<circle cx="920" cy="110" r="220" fill="${palette.accent}" fill-opacity="0.16" />
				<circle cx="1040" cy="540" r="260" fill="#ffffff" fill-opacity="0.05" />
			</svg>
		`

		return sharp(Buffer.from(svg)).png().toBuffer()
	}

	private renderSvgTextLines(
		lines: string[],
		options: {
			x: number
			y: number
			lineHeight: number
			fontSize: number
			fontWeight: number
			fill: string
			fillOpacity?: number
			textAnchor?: string
			dominantBaseline?: string
		}
	): string {
		const anchor = options.textAnchor
			? ` text-anchor="${options.textAnchor}"`
			: ''
		const dominantBaseline = options.dominantBaseline
			? ` dominant-baseline="${options.dominantBaseline}"`
			: ''
		return lines
			.map((line, index) => {
				const fillOpacity =
					options.fillOpacity !== undefined
						? ` fill-opacity="${options.fillOpacity}"`
						: ''

				return `<text x="${options.x}" y="${options.y + index * options.lineHeight}" font-family="Arial, sans-serif" font-size="${options.fontSize}" font-weight="${options.fontWeight}" fill="${options.fill}"${fillOpacity}${anchor}${dominantBaseline}>${this.escapeSvgText(line)}</text>`
			})
			.join('')
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

	private wrapText(
		value: string | null | undefined,
		maxChars: number,
		maxLines: number
	): string[] {
		const normalized = normalizeNullableTrimmedString(value)?.replace(/\s+/g, ' ')
		if (!normalized) return []

		const words = normalized.split(' ')
		const lines: string[] = []
		let current = ''

		for (const word of words) {
			const candidate = current ? `${current} ${word}` : word
			if (candidate.length <= maxChars) {
				current = candidate
				continue
			}

			if (!current) {
				lines.push(this.truncateText(word, maxChars))
			} else {
				lines.push(current)
				current = word
			}

			if (lines.length === maxLines - 1) {
				const remainder = [current, ...words.slice(words.indexOf(word) + 1)]
					.filter(Boolean)
					.join(' ')
				if (remainder) {
					lines.push(this.truncateText(remainder, maxChars))
				}
				return lines.slice(0, maxLines)
			}
		}

		if (current) {
			lines.push(this.truncateText(current, maxChars))
		}

		return lines.slice(0, maxLines)
	}

	private truncateText(value: string, maxChars: number): string {
		if (value.length <= maxChars) return value
		if (maxChars <= 1) return value.slice(0, maxChars)
		return `${value.slice(0, maxChars - 1).trimEnd()}…`
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

	private isUploadsDisabledError(error: unknown): boolean {
		return (
			error instanceof BadRequestException &&
			error.message === UPLOADS_DISABLED_MESSAGE
		)
	}

	private describeError(error: unknown): string {
		if (error instanceof Error) {
			return error.message
		}

		return String(error)
	}
}

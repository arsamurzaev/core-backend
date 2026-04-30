import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { AllInterfaces } from '@/core/config'

import { MediaDto, MediaVariantDto } from './dto/media.dto.res'

export const MEDIA_VARIANT_NAMES = {
	thumb: 'thumb',
	card: 'card',
	detail: 'detail'
} as const

export type MediaVariantName =
	(typeof MEDIA_VARIANT_NAMES)[keyof typeof MEDIA_VARIANT_NAMES]

export const MEDIA_LIST_VARIANT_NAMES = [MEDIA_VARIANT_NAMES.card] as const
export const MEDIA_DETAIL_VARIANT_NAMES = [
	MEDIA_VARIANT_NAMES.thumb,
	MEDIA_VARIANT_NAMES.detail
] as const

const LEGACY_MEDIA_VARIANT_NAMES: Record<string, MediaVariantName> = {
	sm: MEDIA_VARIANT_NAMES.thumb,
	md: MEDIA_VARIANT_NAMES.card,
	xl: MEDIA_VARIANT_NAMES.detail
}

export type MediaRecord = {
	id: string
	originalName: string
	mimeType: string
	size?: number | null
	width?: number | null
	height?: number | null
	status: string
	storage: string
	key: string
	variants?: MediaVariantRecord[] | null
}

export type MediaVariantRecord = {
	id: string
	kind: string
	mimeType?: string | null
	size?: number | null
	width?: number | null
	height?: number | null
	storage: string
	key: string
}

export type MediaMapOptions = {
	variantNames?: readonly string[]
}

function splitVariantKind(kind: string): {
	name: string
	format: string | null
} {
	const normalized = kind.trim().toLowerCase()
	if (!normalized) {
		return { name: '', format: null }
	}

	const match = normalized.match(/^(.*?)-(avif|webp)$/)
	if (!match) {
		return { name: normalized, format: null }
	}

	return { name: match[1], format: match[2] }
}

export function normalizeMediaVariantName(name: string): string {
	const normalized = name.trim().toLowerCase()
	return LEGACY_MEDIA_VARIANT_NAMES[normalized] ?? normalized
}

function extractNormalizedVariantName(kind: string): string {
	return normalizeMediaVariantName(splitVariantKind(kind).name)
}

function normalizeMediaVariantKind(kind: string): string {
	const { name, format } = splitVariantKind(kind)
	const normalizedName = normalizeMediaVariantName(name)
	return format ? `${normalizedName}-${format}` : normalizedName
}

function pickPrimaryMediaVariant(
	variants: MediaVariantDto[]
): MediaVariantDto | null {
	return (
		variants.find(
			variant => variant.kind === `${MEDIA_VARIANT_NAMES.detail}-webp`
		) ??
		variants.find(
			variant => variant.kind === `${MEDIA_VARIANT_NAMES.detail}-avif`
		) ??
		variants.find(variant => variant.kind === MEDIA_VARIANT_NAMES.detail) ??
		variants.find(
			variant => variant.kind === `${MEDIA_VARIANT_NAMES.card}-webp`
		) ??
		variants.find(
			variant => variant.kind === `${MEDIA_VARIANT_NAMES.card}-avif`
		) ??
		variants.find(variant => variant.kind === MEDIA_VARIANT_NAMES.card) ??
		variants[0] ??
		null
	)
}

@Injectable()
export class MediaUrlService {
	private readonly publicUrl: string | null
	private readonly endpoint: string | null
	private readonly bucket: string
	private readonly region: string
	private readonly forcePathStyle: boolean

	constructor(private readonly configService: ConfigService<AllInterfaces>) {
		const config = this.configService.get('s3', { infer: true })
		this.publicUrl = config?.publicUrl ?? null
		this.endpoint = config?.endpoint ?? null
		this.bucket = config?.bucket ?? ''
		this.region = config?.region ?? 'us-east-1'
		this.forcePathStyle = config?.forcePathStyle ?? false
	}

	resolveUrl(storage: string, key: string): string {
		if (storage === 'url') return key
		return this.buildPublicUrl(key)
	}

	mapVariant(variant: MediaVariantRecord): MediaVariantDto {
		return {
			id: variant.id,
			kind: normalizeMediaVariantKind(variant.kind),
			mimeType: variant.mimeType ?? null,
			size: variant.size ?? null,
			width: variant.width ?? null,
			height: variant.height ?? null,
			key: variant.key,
			url: this.resolveUrl(variant.storage, variant.key)
		}
	}

	mapMedia(media: MediaRecord, options?: MediaMapOptions): MediaDto {
		const variantNames = options?.variantNames?.length
			? new Set(
					options.variantNames.map(variantName =>
						normalizeMediaVariantName(variantName)
					)
				)
			: null
		const variants = (media.variants ?? [])
			.filter(variant => {
				if (!variantNames?.size) return true
				return variantNames.has(extractNormalizedVariantName(variant.kind))
			})
			.map(variant => this.mapVariant(variant))
		const primaryVariant = pickPrimaryMediaVariant(variants)

		return {
			id: media.id,
			originalName: media.originalName,
			mimeType: media.mimeType,
			size: media.size ?? null,
			width: media.width ?? null,
			height: media.height ?? null,
			status: media.status as MediaDto['status'],
			key: media.key,
			url: primaryVariant?.url ?? this.resolveUrl(media.storage, media.key),
			variants
		}
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
}

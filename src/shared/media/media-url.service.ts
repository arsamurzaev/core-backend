import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { AllInterfaces } from '@/core/config'

import { MediaDto, MediaVariantDto } from './dto/media.dto.res'

type MediaRecord = {
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

type MediaVariantRecord = {
	id: string
	kind: string
	mimeType?: string | null
	size?: number | null
	width?: number | null
	height?: number | null
	storage: string
	key: string
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
			kind: variant.kind,
			mimeType: variant.mimeType ?? null,
			size: variant.size ?? null,
			width: variant.width ?? null,
			height: variant.height ?? null,
			key: variant.key,
			url: this.resolveUrl(variant.storage, variant.key)
		}
	}

	mapMedia(media: MediaRecord): MediaDto {
		const variants = (media.variants ?? []).map(variant =>
			this.mapVariant(variant)
		)
		return {
			id: media.id,
			originalName: media.originalName,
			mimeType: media.mimeType,
			size: media.size ?? null,
			width: media.width ?? null,
			height: media.height ?? null,
			status: media.status as MediaDto['status'],
			key: media.key,
			url: this.resolveUrl(media.storage, media.key),
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

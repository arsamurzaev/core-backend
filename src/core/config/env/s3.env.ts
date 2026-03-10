import { registerAs } from '@nestjs/config'

import { validateEnv } from '@/shared/utils'

import { S3Interface } from '../interfaces/s3.interface'
import { S3Validator } from '../validators'

const DEFAULT_IMAGE_VARIANTS = [1200, 800, 400]
const DEFAULT_IMAGE_QUALITY = 82
const DEFAULT_MAX_FILE_MB = 25
const DEFAULT_IMAGE_FORMATS = ['webp']
const DEFAULT_PRESIGN_EXPIRES_SEC = 600
const ALLOWED_IMAGE_FORMATS = new Set(['webp', 'avif'])

function parseBoolean(value: string | undefined, fallback = false): boolean {
	if (value === undefined) return fallback
	const normalized = value.trim().toLowerCase()
	if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
	if (['0', 'false', 'no', 'off'].includes(normalized)) return false
	return fallback
}

function parseVariants(value?: string): number[] {
	if (!value) return [...DEFAULT_IMAGE_VARIANTS]
	const parsed = value
		.split(',')
		.map(item => parseInt(item.trim(), 10))
		.filter(item => Number.isFinite(item) && item > 0)
	return parsed.length ? parsed : [...DEFAULT_IMAGE_VARIANTS]
}

function parseFormats(value?: string): string[] {
	if (!value) return [...DEFAULT_IMAGE_FORMATS]
	const parsed = value
		.split(',')
		.map(item => item.trim().toLowerCase())
		.filter(item => ALLOWED_IMAGE_FORMATS.has(item))
	return parsed.length ? parsed : [...DEFAULT_IMAGE_FORMATS]
}

export const s3Env = registerAs<S3Interface>('s3', () => {
	validateEnv(process.env, S3Validator)

	const enabled = parseBoolean(process.env.S3_ENABLED)
	const region = process.env.S3_REGION?.trim()
	const bucket = process.env.S3_BUCKET?.trim()
	const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim()
	const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim()
	const endpoint = process.env.S3_ENDPOINT?.trim() || null
	const publicUrl = process.env.S3_PUBLIC_URL?.trim() || null
	const forcePathStyle = parseBoolean(process.env.S3_FORCE_PATH_STYLE)
	const publicRead = parseBoolean(process.env.S3_PUBLIC_READ)
	const storeOriginal = parseBoolean(process.env.S3_STORE_ORIGINAL)
	const imageQuality =
		process.env.S3_IMAGE_QUALITY !== undefined
			? Math.min(100, Math.max(1, parseInt(process.env.S3_IMAGE_QUALITY, 10)))
			: DEFAULT_IMAGE_QUALITY
	const imageVariants = parseVariants(process.env.S3_IMAGE_VARIANTS)
	const imageFormats = parseFormats(process.env.S3_IMAGE_FORMATS)
	const maxFileSizeMb =
		process.env.S3_MAX_FILE_MB !== undefined
			? Math.max(1, parseInt(process.env.S3_MAX_FILE_MB, 10))
			: DEFAULT_MAX_FILE_MB
	const presignExpiresSec =
		process.env.S3_PRESIGN_EXPIRES_SEC !== undefined
			? Math.max(60, parseInt(process.env.S3_PRESIGN_EXPIRES_SEC, 10))
			: DEFAULT_PRESIGN_EXPIRES_SEC

	if (enabled) {
		const missing: string[] = []
		if (!region) missing.push('S3_REGION')
		if (!bucket) missing.push('S3_BUCKET')
		if (!accessKeyId) missing.push('S3_ACCESS_KEY_ID')
		if (!secretAccessKey) missing.push('S3_SECRET_ACCESS_KEY')
		if (missing.length) {
			throw new Error(
				`S3 включен, но не заданы обязательные переменные: ${missing.join(', ')}`
			)
		}
	}

	return {
		enabled,
		region,
		bucket,
		accessKeyId,
		secretAccessKey,
		endpoint,
		publicUrl,
		forcePathStyle,
		publicRead,
		imageQuality,
		imageVariants,
		imageFormats,
		maxFileSizeMb,
		storeOriginal,
		presignExpiresSec
	}
})

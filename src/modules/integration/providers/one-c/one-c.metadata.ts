import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { z } from 'zod'

import { AllInterfaces } from '@/core/config'
import { normalizeRequiredString } from '@/shared/utils'

import {
	ONE_C_API_KINDS,
	ONE_C_AUTH_KINDS,
	type OneCAuthKind,
	type OneCEncryptedSecret,
	type OneCMetadata,
	type StoredOneCMetadata
} from './one-c.types'

const ONE_C_SECRET_ENCRYPTION_FORMAT = 'enc-v1'
const ONE_C_SECRET_ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const AES_GCM_KEY_BYTES = 32
const AES_GCM_IV_BYTES = 12
const DEFAULT_TIMEOUT_MS = 30000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 120000
const DEFAULT_PRODUCT_SYNC_LIMIT = 100
const MIN_PRODUCT_SYNC_LIMIT = 1
const MAX_PRODUCT_SYNC_LIMIT = 100
const DEFAULT_VARIANT_SYNC_LIMIT = 100
const MIN_VARIANT_SYNC_LIMIT = 1
const MAX_VARIANT_SYNC_LIMIT = 100
const DEFAULT_VALUE_SYNC_LIMIT = 100
const MIN_VALUE_SYNC_LIMIT = 1
const MAX_VALUE_SYNC_LIMIT = 100
export const ONE_C_DEFAULT_SCHEDULE_TIMEZONE = 'Europe/Moscow'

const encryptedSecretSchema = z.object({
	format: z.literal(ONE_C_SECRET_ENCRYPTION_FORMAT),
	alg: z.literal(ONE_C_SECRET_ENCRYPTION_ALGORITHM),
	keyVersion: z.string(),
	iv: z.string(),
	tag: z.string(),
	ciphertext: z.string()
})

const storedOneCMetadataSchema = z.object({
	apiKind: z.enum(ONE_C_API_KINDS),
	authKind: z.enum(ONE_C_AUTH_KINDS),
	baseUrl: z.string(),
	username: z.string().nullable().optional(),
	passwordEncrypted: encryptedSecretSchema.optional(),
	tokenEncrypted: encryptedSecretSchema.optional(),
	timeoutMs: z.number().int().optional(),
	importProducts: z.boolean().optional(),
	syncStock: z.boolean().optional(),
	exportOrders: z.boolean().optional(),
	productSyncEntityMappingId: z.string().nullable().optional(),
	productSyncLimit: z.number().int().optional(),
	productSyncFilter: z.string().nullable().optional(),
	variantSyncEntityMappingId: z.string().nullable().optional(),
	variantSyncLimit: z.number().int().optional(),
	variantSyncFilter: z.string().nullable().optional(),
	stockSyncEntityMappingId: z.string().nullable().optional(),
	stockSyncLimit: z.number().int().optional(),
	stockSyncFilter: z.string().nullable().optional(),
	priceSyncEntityMappingId: z.string().nullable().optional(),
	priceSyncLimit: z.number().int().optional(),
	priceSyncFilter: z.string().nullable().optional(),
	scheduleEnabled: z.boolean().optional(),
	schedulePattern: z.string().nullable().optional(),
	scheduleTimezone: z.string().optional(),
	stockScheduleEnabled: z.boolean().optional(),
	stockSchedulePattern: z.string().nullable().optional(),
	stockScheduleTimezone: z.string().optional(),
	priceScheduleEnabled: z.boolean().optional(),
	priceSchedulePattern: z.string().nullable().optional(),
	priceScheduleTimezone: z.string().optional(),
	lastDiscoveredAt: z.string().nullable().optional()
})

export type PartialOneCMetadata = {
	apiKind?: OneCMetadata['apiKind']
	authKind?: OneCAuthKind
	baseUrl?: string
	username?: string | null
	password?: string | null
	token?: string | null
	timeoutMs?: number | null
	importProducts?: boolean
	syncStock?: boolean
	exportOrders?: boolean
	productSyncEntityMappingId?: string | null
	productSyncLimit?: number | null
	productSyncFilter?: string | null
	variantSyncEntityMappingId?: string | null
	variantSyncLimit?: number | null
	variantSyncFilter?: string | null
	stockSyncEntityMappingId?: string | null
	stockSyncLimit?: number | null
	stockSyncFilter?: string | null
	priceSyncEntityMappingId?: string | null
	priceSyncLimit?: number | null
	priceSyncFilter?: string | null
	scheduleEnabled?: boolean
	schedulePattern?: string | null
	scheduleTimezone?: string | null
	stockScheduleEnabled?: boolean
	stockSchedulePattern?: string | null
	stockScheduleTimezone?: string | null
	priceScheduleEnabled?: boolean
	priceSchedulePattern?: string | null
	priceScheduleTimezone?: string | null
	lastDiscoveredAt?: string | null
}

export function buildOneCMetadata(input: PartialOneCMetadata): OneCMetadata {
	const apiKind = ONE_C_API_KINDS.includes(input.apiKind ?? 'ODATA')
		? (input.apiKind ?? 'ODATA')
		: 'ODATA'
	const authKind = ONE_C_AUTH_KINDS.includes(input.authKind ?? 'BASIC')
		? (input.authKind ?? 'BASIC')
		: 'BASIC'
	const baseUrl = normalizeOneCBaseUrl(
		normalizeRequiredString(input.baseUrl ?? '', 'baseUrl')
	)
	const username = normalizeOptionalString(input.username)
	const password = normalizeOptionalString(input.password)
	const token = normalizeOptionalString(input.token)
	const productSyncEntityMappingId = normalizeOptionalString(
		input.productSyncEntityMappingId
	)
	const productSyncFilter = normalizeOptionalString(input.productSyncFilter)
	const variantSyncEntityMappingId = normalizeOptionalString(
		input.variantSyncEntityMappingId
	)
	const variantSyncFilter = normalizeOptionalString(input.variantSyncFilter)
	const stockSyncEntityMappingId = normalizeOptionalString(
		input.stockSyncEntityMappingId
	)
	const stockSyncFilter = normalizeOptionalString(input.stockSyncFilter)
	const priceSyncEntityMappingId = normalizeOptionalString(
		input.priceSyncEntityMappingId
	)
	const priceSyncFilter = normalizeOptionalString(input.priceSyncFilter)
	const schedulePattern = normalizeOptionalString(input.schedulePattern)
	const scheduleTimezone =
		normalizeOptionalString(input.scheduleTimezone) ??
		ONE_C_DEFAULT_SCHEDULE_TIMEZONE
	const scheduleEnabled = input.scheduleEnabled ?? false
	const stockSchedulePattern = normalizeOptionalString(
		input.stockSchedulePattern
	)
	const stockScheduleTimezone =
		normalizeOptionalString(input.stockScheduleTimezone) ?? scheduleTimezone
	const stockScheduleEnabled = input.stockScheduleEnabled ?? false
	const priceSchedulePattern = normalizeOptionalString(
		input.priceSchedulePattern
	)
	const priceScheduleTimezone =
		normalizeOptionalString(input.priceScheduleTimezone) ?? scheduleTimezone
	const priceScheduleEnabled = input.priceScheduleEnabled ?? false

	if (authKind === 'BASIC' && (!username || !password)) {
		throw new BadRequestException(
			'For ONE_C BASIC auth, username and password are required'
		)
	}
	if (authKind === 'BEARER' && !token) {
		throw new BadRequestException('For ONE_C BEARER auth, token is required')
	}
	if (scheduleEnabled && !schedulePattern) {
		throw new BadRequestException(
			'For scheduled ONE_C sync, schedulePattern is required'
		)
	}
	if (scheduleEnabled && !productSyncEntityMappingId) {
		throw new BadRequestException(
			'For scheduled ONE_C product sync, productSyncEntityMappingId is required'
		)
	}
	if (stockScheduleEnabled && !stockSchedulePattern) {
		throw new BadRequestException(
			'For scheduled ONE_C stock sync, stockSchedulePattern is required'
		)
	}
	if (stockScheduleEnabled && !stockSyncEntityMappingId) {
		throw new BadRequestException(
			'For scheduled ONE_C stock sync, stockSyncEntityMappingId is required'
		)
	}
	if (priceScheduleEnabled && !priceSchedulePattern) {
		throw new BadRequestException(
			'For scheduled ONE_C price sync, priceSchedulePattern is required'
		)
	}
	if (priceScheduleEnabled && !priceSyncEntityMappingId) {
		throw new BadRequestException(
			'For scheduled ONE_C price sync, priceSyncEntityMappingId is required'
		)
	}

	return {
		apiKind,
		authKind,
		baseUrl,
		username: authKind === 'BASIC' ? username : null,
		password: authKind === 'BASIC' ? password : null,
		token: authKind === 'BEARER' ? token : null,
		timeoutMs: normalizeTimeoutMs(input.timeoutMs),
		importProducts: input.importProducts ?? true,
		syncStock: input.syncStock ?? false,
		exportOrders: input.exportOrders ?? false,
		productSyncEntityMappingId,
		productSyncLimit: normalizeProductSyncLimit(input.productSyncLimit),
		productSyncFilter,
		variantSyncEntityMappingId,
		variantSyncLimit: normalizeVariantSyncLimit(input.variantSyncLimit),
		variantSyncFilter,
		stockSyncEntityMappingId,
		stockSyncLimit: normalizeValueSyncLimit(input.stockSyncLimit),
		stockSyncFilter,
		priceSyncEntityMappingId,
		priceSyncLimit: normalizeValueSyncLimit(input.priceSyncLimit),
		priceSyncFilter,
		scheduleEnabled,
		schedulePattern,
		scheduleTimezone,
		stockScheduleEnabled,
		stockSchedulePattern,
		stockScheduleTimezone,
		priceScheduleEnabled,
		priceSchedulePattern,
		priceScheduleTimezone,
		lastDiscoveredAt: normalizeOptionalString(input.lastDiscoveredAt)
	}
}

export function maskOneCSecret(secret: string | null): string | null {
	const normalized = secret?.trim() ?? ''
	if (!normalized) return null
	if (normalized.length <= 8) {
		return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`
	}
	return `${normalized.slice(0, 4)}***${normalized.slice(-4)}`
}

@Injectable()
export class OneCMetadataCryptoService {
	private readonly encryptionKey: Buffer
	private readonly keyVersion: string

	constructor(private readonly configService: ConfigService<AllInterfaces>) {
		const config = this.configService.get('integrationCrypto', { infer: true })
		const rawKey = config?.encryptionKey?.trim() ?? ''
		const keyVersion = config?.keyVersion?.trim() ?? 'v1'

		if (!rawKey) {
			throw new Error('INTEGRATION_ENCRYPTION_KEY is not configured')
		}

		const decodedKey = this.decodeKey(rawKey)
		if (decodedKey.length !== AES_GCM_KEY_BYTES) {
			throw new Error(
				`INTEGRATION_ENCRYPTION_KEY must decode to ${AES_GCM_KEY_BYTES} bytes`
			)
		}

		this.encryptionKey = decodedKey
		this.keyVersion = keyVersion
	}

	buildStoredMetadata(input: PartialOneCMetadata): StoredOneCMetadata {
		const metadata = buildOneCMetadata(input)

		return {
			apiKind: metadata.apiKind,
			authKind: metadata.authKind,
			baseUrl: metadata.baseUrl,
			username: metadata.username,
			...(metadata.password
				? { passwordEncrypted: this.encryptSecret(metadata.password) }
				: {}),
			...(metadata.token
				? { tokenEncrypted: this.encryptSecret(metadata.token) }
				: {}),
			timeoutMs: metadata.timeoutMs,
			importProducts: metadata.importProducts,
			syncStock: metadata.syncStock,
			exportOrders: metadata.exportOrders,
			productSyncEntityMappingId: metadata.productSyncEntityMappingId,
			productSyncLimit: metadata.productSyncLimit,
			productSyncFilter: metadata.productSyncFilter,
			variantSyncEntityMappingId: metadata.variantSyncEntityMappingId,
			variantSyncLimit: metadata.variantSyncLimit,
			variantSyncFilter: metadata.variantSyncFilter,
			stockSyncEntityMappingId: metadata.stockSyncEntityMappingId,
			stockSyncLimit: metadata.stockSyncLimit,
			stockSyncFilter: metadata.stockSyncFilter,
			priceSyncEntityMappingId: metadata.priceSyncEntityMappingId,
			priceSyncLimit: metadata.priceSyncLimit,
			priceSyncFilter: metadata.priceSyncFilter,
			scheduleEnabled: metadata.scheduleEnabled,
			schedulePattern: metadata.schedulePattern,
			scheduleTimezone: metadata.scheduleTimezone,
			stockScheduleEnabled: metadata.stockScheduleEnabled,
			stockSchedulePattern: metadata.stockSchedulePattern,
			stockScheduleTimezone: metadata.stockScheduleTimezone,
			priceScheduleEnabled: metadata.priceScheduleEnabled,
			priceSchedulePattern: metadata.priceSchedulePattern,
			priceScheduleTimezone: metadata.priceScheduleTimezone,
			lastDiscoveredAt: metadata.lastDiscoveredAt
		}
	}

	parseStoredMetadata(metadata: unknown): OneCMetadata {
		const parsed = storedOneCMetadataSchema.parse(metadata)

		return buildOneCMetadata({
			apiKind: parsed.apiKind,
			authKind: parsed.authKind,
			baseUrl: parsed.baseUrl,
			username: parsed.username,
			password: parsed.passwordEncrypted
				? this.decryptSecret(parsed.passwordEncrypted)
				: null,
			token: parsed.tokenEncrypted
				? this.decryptSecret(parsed.tokenEncrypted)
				: null,
			timeoutMs: parsed.timeoutMs,
			importProducts: parsed.importProducts,
			syncStock: parsed.syncStock,
			exportOrders: parsed.exportOrders,
			productSyncEntityMappingId: parsed.productSyncEntityMappingId,
			productSyncLimit: parsed.productSyncLimit,
			productSyncFilter: parsed.productSyncFilter,
			variantSyncEntityMappingId: parsed.variantSyncEntityMappingId,
			variantSyncLimit: parsed.variantSyncLimit,
			variantSyncFilter: parsed.variantSyncFilter,
			stockSyncEntityMappingId: parsed.stockSyncEntityMappingId,
			stockSyncLimit: parsed.stockSyncLimit,
			stockSyncFilter: parsed.stockSyncFilter,
			priceSyncEntityMappingId: parsed.priceSyncEntityMappingId,
			priceSyncLimit: parsed.priceSyncLimit,
			priceSyncFilter: parsed.priceSyncFilter,
			scheduleEnabled: parsed.scheduleEnabled,
			schedulePattern: parsed.schedulePattern,
			scheduleTimezone: parsed.scheduleTimezone,
			stockScheduleEnabled: parsed.stockScheduleEnabled,
			stockSchedulePattern: parsed.stockSchedulePattern,
			stockScheduleTimezone: parsed.stockScheduleTimezone,
			priceScheduleEnabled: parsed.priceScheduleEnabled,
			priceSchedulePattern: parsed.priceSchedulePattern,
			priceScheduleTimezone: parsed.priceScheduleTimezone,
			lastDiscoveredAt: parsed.lastDiscoveredAt
		})
	}

	private encryptSecret(secret: string): OneCEncryptedSecret {
		const iv = randomBytes(AES_GCM_IV_BYTES)
		const cipher = createCipheriv(
			ONE_C_SECRET_ENCRYPTION_ALGORITHM,
			this.encryptionKey,
			iv
		)
		const ciphertext = Buffer.concat([
			cipher.update(secret, 'utf8'),
			cipher.final()
		])
		const tag = cipher.getAuthTag()

		return {
			format: ONE_C_SECRET_ENCRYPTION_FORMAT,
			alg: ONE_C_SECRET_ENCRYPTION_ALGORITHM,
			keyVersion: this.keyVersion,
			iv: iv.toString('base64'),
			tag: tag.toString('base64'),
			ciphertext: ciphertext.toString('base64')
		}
	}

	private decryptSecret(secret: OneCEncryptedSecret): string {
		try {
			const decipher = createDecipheriv(
				ONE_C_SECRET_ENCRYPTION_ALGORITHM,
				this.encryptionKey,
				Buffer.from(secret.iv, 'base64')
			)
			decipher.setAuthTag(Buffer.from(secret.tag, 'base64'))

			const plaintext = Buffer.concat([
				decipher.update(Buffer.from(secret.ciphertext, 'base64')),
				decipher.final()
			]).toString('utf8')

			return normalizeRequiredString(plaintext, 'secret')
		} catch {
			throw new BadRequestException(
				'Could not decrypt ONE_C secret. Check integration encryption key.'
			)
		}
	}

	private decodeKey(value: string): Buffer {
		try {
			return Buffer.from(value, 'base64')
		} catch {
			throw new Error('INTEGRATION_ENCRYPTION_KEY must be valid base64')
		}
	}
}

function normalizeOneCBaseUrl(value: string): string {
	let parsed: URL
	try {
		parsed = new URL(value)
	} catch {
		throw new BadRequestException('baseUrl must be a valid URL')
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new BadRequestException('baseUrl must use http or https')
	}
	return parsed.toString().replace(/\/+$/, '')
}

function normalizeOptionalString(value?: string | null): string | null {
	const normalized = typeof value === 'string' ? value.trim() : ''
	return normalized || null
}

function normalizeTimeoutMs(value?: number | null): number {
	const normalized = Number.isFinite(value)
		? Math.trunc(value as number)
		: DEFAULT_TIMEOUT_MS
	return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, normalized))
}

function normalizeProductSyncLimit(value?: number | null): number {
	const normalized = Number.isFinite(value)
		? Math.trunc(value as number)
		: DEFAULT_PRODUCT_SYNC_LIMIT
	return Math.min(
		MAX_PRODUCT_SYNC_LIMIT,
		Math.max(MIN_PRODUCT_SYNC_LIMIT, normalized)
	)
}

function normalizeVariantSyncLimit(value?: number | null): number {
	const normalized = Number.isFinite(value)
		? Math.trunc(value as number)
		: DEFAULT_VARIANT_SYNC_LIMIT
	return Math.min(
		MAX_VARIANT_SYNC_LIMIT,
		Math.max(MIN_VARIANT_SYNC_LIMIT, normalized)
	)
}

function normalizeValueSyncLimit(value?: number | null): number {
	const normalized = Number.isFinite(value)
		? Math.trunc(value as number)
		: DEFAULT_VALUE_SYNC_LIMIT
	return Math.min(
		MAX_VALUE_SYNC_LIMIT,
		Math.max(MIN_VALUE_SYNC_LIMIT, normalized)
	)
}

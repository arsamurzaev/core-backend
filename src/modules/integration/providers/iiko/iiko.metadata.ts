import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { z } from 'zod'

import { AllInterfaces } from '@/core/config'
import { normalizeRequiredString } from '@/shared/utils'

import {
	type IikoEncryptedApiLogin,
	type IikoEncryptedClientSecret,
	type IikoEncryptedSecret,
	type IikoMetadata,
	type IikoWebhookMetadata,
	type StoredIikoMetadata
} from './iiko.types'

const IIKO_SECRET_ENCRYPTION_FORMAT = 'enc-v1'
const IIKO_SECRET_ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const AES_GCM_KEY_BYTES = 32
const AES_GCM_IV_BYTES = 12

const encryptedSecretSchema = z.object({
	format: z.literal(IIKO_SECRET_ENCRYPTION_FORMAT),
	alg: z.literal(IIKO_SECRET_ENCRYPTION_ALGORITHM),
	keyVersion: z.string(),
	iv: z.string(),
	tag: z.string(),
	ciphertext: z.string()
})

const storedIikoMetadataSchema = z
	.object({
		apiLogin: z.string().optional(),
		apiLoginEncrypted: encryptedSecretSchema.optional(),
		appId: z.string().nullable().optional(),
		clientSecret: z.string().nullable().optional(),
		clientSecretEncrypted: encryptedSecretSchema.optional(),
		organizationId: z.string(),
		organizationName: z.string().nullable().optional(),
		externalMenuId: z.string().nullable().optional(),
		externalMenuName: z.string().nullable().optional(),
		priceCategoryId: z.string().nullable().optional(),
		priceCategoryName: z.string().nullable().optional(),
		terminalGroupId: z.string().nullable().optional(),
		terminalGroupName: z.string().nullable().optional(),
		menuVersion: z.number().int().nullable().optional(),
		syncSource: z
			.enum(['external_menu', 'nomenclature'])
			.or(z.string())
			.nullable()
			.optional(),
		importImages: z.boolean().optional(),
		exportOrders: z.boolean().optional(),
		orderExportServiceType: z
			.enum(['DeliveryByCourier', 'DeliveryByClient'])
			.nullable()
			.optional(),
		orderExportSourceKey: z.string().nullable().optional(),
		lastRevision: z.number().int().nullable().optional(),
		lastMenuSyncedAt: z.string().nullable().optional(),
		lastStopListSyncedAt: z.string().nullable().optional(),
		webhook: z
			.object({
				enabled: z.boolean().optional(),
				urlPreview: z.string().nullable().optional(),
				secretHash: z.string().nullable().optional(),
				filterHash: z.string().nullable().optional(),
				lastConfiguredAt: z.string().nullable().optional(),
				lastReceivedAt: z.string().nullable().optional(),
				lastEventType: z.string().nullable().optional(),
				lastError: z.string().nullable().optional()
			})
			.nullable()
			.optional()
	})
	.refine(data => data.apiLogin || data.apiLoginEncrypted, {
		message: 'iiko apiLogin is required'
	})

type PartialIikoMetadata = {
	apiLogin: string
	appId?: string | null
	clientSecret?: string | null
	organizationId: string
	organizationName?: string | null
	externalMenuId?: string | null
	externalMenuName?: string | null
	priceCategoryId?: string | null
	priceCategoryName?: string | null
	terminalGroupId?: string | null
	terminalGroupName?: string | null
	menuVersion?: number | null
	syncSource?: string | null
	importImages?: boolean
	exportOrders?: boolean | null
	orderExportServiceType?: 'DeliveryByCourier' | 'DeliveryByClient' | null
	orderExportSourceKey?: string | null
	lastRevision?: number | null
	lastMenuSyncedAt?: string | null
	lastStopListSyncedAt?: string | null
	webhook?: Partial<IikoWebhookMetadata> | null
}

export function buildIikoMetadata(input: PartialIikoMetadata): IikoMetadata {
	return {
		apiLogin: normalizeRequiredString(input.apiLogin, 'apiLogin'),
		appId: normalizeOptionalString(input.appId),
		clientSecret: normalizeOptionalString(input.clientSecret),
		organizationId: normalizeRequiredString(
			input.organizationId,
			'organizationId'
		),
		organizationName: normalizeOptionalString(input.organizationName),
		externalMenuId: normalizeOptionalString(input.externalMenuId),
		externalMenuName: normalizeOptionalString(input.externalMenuName),
		priceCategoryId: normalizeOptionalString(input.priceCategoryId),
		priceCategoryName: normalizeOptionalString(input.priceCategoryName),
		terminalGroupId: normalizeOptionalString(input.terminalGroupId),
		terminalGroupName: normalizeOptionalString(input.terminalGroupName),
		menuVersion: normalizeMenuVersion(input.menuVersion),
		syncSource: normalizeSyncSource(input.syncSource),
		importImages: input.importImages ?? true,
		exportOrders: input.exportOrders === true,
		orderExportServiceType: normalizeOrderExportServiceType(
			input.orderExportServiceType
		),
		orderExportSourceKey: normalizeOptionalString(input.orderExportSourceKey),
		lastRevision: normalizeNullableInteger(input.lastRevision),
		lastMenuSyncedAt: normalizeOptionalString(input.lastMenuSyncedAt),
		lastStopListSyncedAt: normalizeOptionalString(input.lastStopListSyncedAt),
		webhook: normalizeWebhookMetadata(input.webhook)
	}
}

export function maskApiLogin(apiLogin: string): string | null {
	const normalized = apiLogin.trim()
	if (!normalized) return null
	if (normalized.length <= 8) {
		return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`
	}
	return `${normalized.slice(0, 4)}***${normalized.slice(-4)}`
}

@Injectable()
export class IikoMetadataCryptoService {
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

	buildStoredMetadata(input: PartialIikoMetadata): StoredIikoMetadata {
		const metadata = buildIikoMetadata(input)

		return {
			apiLoginEncrypted: this.encryptApiLogin(metadata.apiLogin),
			appId: metadata.appId,
			...(metadata.clientSecret
				? {
						clientSecretEncrypted: this.encryptClientSecret(metadata.clientSecret)
					}
				: {}),
			organizationId: metadata.organizationId,
			organizationName: metadata.organizationName,
			externalMenuId: metadata.externalMenuId,
			externalMenuName: metadata.externalMenuName,
			priceCategoryId: metadata.priceCategoryId,
			priceCategoryName: metadata.priceCategoryName,
			terminalGroupId: metadata.terminalGroupId,
			terminalGroupName: metadata.terminalGroupName,
			menuVersion: metadata.menuVersion,
			syncSource: metadata.syncSource,
			importImages: metadata.importImages,
			exportOrders: metadata.exportOrders,
			orderExportServiceType: metadata.orderExportServiceType,
			orderExportSourceKey: metadata.orderExportSourceKey,
			lastRevision: metadata.lastRevision,
			lastMenuSyncedAt: metadata.lastMenuSyncedAt,
			lastStopListSyncedAt: metadata.lastStopListSyncedAt,
			webhook: metadata.webhook
		}
	}

	parseStoredMetadata(metadata: unknown): IikoMetadata {
		const parsed = storedIikoMetadataSchema.parse(metadata)
		const apiLogin = this.resolveApiLogin(parsed)
		const clientSecret = this.resolveClientSecret(parsed)

		return buildIikoMetadata({
			apiLogin,
			appId: parsed.appId,
			clientSecret,
			organizationId: parsed.organizationId,
			organizationName: parsed.organizationName,
			externalMenuId: parsed.externalMenuId,
			externalMenuName: parsed.externalMenuName,
			priceCategoryId: parsed.priceCategoryId,
			priceCategoryName: parsed.priceCategoryName,
			terminalGroupId: parsed.terminalGroupId,
			terminalGroupName: parsed.terminalGroupName,
			menuVersion: parsed.menuVersion,
			syncSource: parsed.syncSource,
			importImages: parsed.importImages,
			exportOrders: parsed.exportOrders,
			orderExportServiceType: parsed.orderExportServiceType,
			orderExportSourceKey: parsed.orderExportSourceKey,
			lastRevision: parsed.lastRevision,
			lastMenuSyncedAt: parsed.lastMenuSyncedAt,
			lastStopListSyncedAt: parsed.lastStopListSyncedAt,
			webhook: parsed.webhook
		})
	}

	private resolveApiLogin(metadata: Record<string, unknown>): string {
		if (typeof metadata.apiLogin === 'string') {
			return metadata.apiLogin
		}

		if (isEncryptedApiLogin(metadata.apiLoginEncrypted)) {
			return this.decryptApiLogin(metadata.apiLoginEncrypted)
		}

		throw new BadRequestException('iiko apiLogin is not configured')
	}

	private encryptApiLogin(apiLogin: string): IikoEncryptedApiLogin {
		return this.encryptSecret(apiLogin)
	}

	private encryptClientSecret(clientSecret: string): IikoEncryptedClientSecret {
		return this.encryptSecret(clientSecret)
	}

	private encryptSecret(secret: string): IikoEncryptedSecret {
		const iv = randomBytes(AES_GCM_IV_BYTES)
		const cipher = createCipheriv(
			IIKO_SECRET_ENCRYPTION_ALGORITHM,
			this.encryptionKey,
			iv
		)
		const ciphertext = Buffer.concat([
			cipher.update(secret, 'utf8'),
			cipher.final()
		])
		const tag = cipher.getAuthTag()

		return {
			format: IIKO_SECRET_ENCRYPTION_FORMAT,
			alg: IIKO_SECRET_ENCRYPTION_ALGORITHM,
			keyVersion: this.keyVersion,
			iv: iv.toString('base64'),
			tag: tag.toString('base64'),
			ciphertext: ciphertext.toString('base64')
		}
	}

	private decryptApiLogin(secret: IikoEncryptedApiLogin): string {
		return this.decryptSecret(secret, 'apiLogin')
	}

	private resolveClientSecret(metadata: Record<string, unknown>): string | null {
		if (typeof metadata.clientSecret === 'string') {
			return normalizeOptionalString(metadata.clientSecret)
		}

		if (isEncryptedSecret(metadata.clientSecretEncrypted)) {
			return this.decryptClientSecret(metadata.clientSecretEncrypted)
		}

		return null
	}

	private decryptClientSecret(secret: IikoEncryptedClientSecret): string {
		return this.decryptSecret(secret, 'clientSecret')
	}

	private decryptSecret(secret: IikoEncryptedSecret, fieldName: string): string {
		try {
			const decipher = createDecipheriv(
				IIKO_SECRET_ENCRYPTION_ALGORITHM,
				this.encryptionKey,
				Buffer.from(secret.iv, 'base64')
			)
			decipher.setAuthTag(Buffer.from(secret.tag, 'base64'))

			const plaintext = Buffer.concat([
				decipher.update(Buffer.from(secret.ciphertext, 'base64')),
				decipher.final()
			]).toString('utf8')

			return normalizeRequiredString(plaintext, fieldName)
		} catch {
			throw new BadRequestException(
				`Could not decrypt iiko ${fieldName}. Check integration encryption key.`
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

function isEncryptedApiLogin(value: unknown): value is IikoEncryptedApiLogin {
	return isEncryptedSecret(value)
}

function isEncryptedSecret(value: unknown): value is IikoEncryptedSecret {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		(value as Record<string, unknown>).format === IIKO_SECRET_ENCRYPTION_FORMAT &&
		(value as Record<string, unknown>).alg === IIKO_SECRET_ENCRYPTION_ALGORITHM &&
		typeof (value as Record<string, unknown>).keyVersion === 'string' &&
		typeof (value as Record<string, unknown>).iv === 'string' &&
		typeof (value as Record<string, unknown>).tag === 'string' &&
		typeof (value as Record<string, unknown>).ciphertext === 'string'
	)
}

function normalizeOptionalString(value?: string | null): string | null {
	const normalized = typeof value === 'string' ? value.trim() : ''
	return normalized || null
}

function normalizeNullableInteger(value?: number | null): number | null {
	if (value === null || value === undefined) return null
	const normalized = Math.trunc(value)
	return Number.isFinite(normalized) ? normalized : null
}

function normalizeMenuVersion(value?: number | null): number {
	if (value === null || value === undefined) return 4
	const normalized = Math.trunc(value)
	return Number.isFinite(normalized) && normalized > 0 ? normalized : 4
}

function normalizeSyncSource(
	value?: string | null
): 'external_menu' | 'nomenclature' {
	return value === 'nomenclature' ? 'nomenclature' : 'external_menu'
}

function normalizeOrderExportServiceType(
	value?: 'DeliveryByCourier' | 'DeliveryByClient' | null
): 'DeliveryByCourier' | 'DeliveryByClient' | null {
	return value === 'DeliveryByCourier' || value === 'DeliveryByClient'
		? value
		: null
}

function normalizeWebhookMetadata(
	value?: Partial<IikoWebhookMetadata> | null
): IikoWebhookMetadata {
	return {
		enabled: value?.enabled === true,
		urlPreview: normalizeOptionalString(value?.urlPreview),
		secretHash: normalizeOptionalString(value?.secretHash),
		filterHash: normalizeOptionalString(value?.filterHash),
		lastConfiguredAt: normalizeOptionalString(value?.lastConfiguredAt),
		lastReceivedAt: normalizeOptionalString(value?.lastReceivedAt),
		lastEventType: normalizeOptionalString(value?.lastEventType),
		lastError: normalizeOptionalString(value?.lastError)
	}
}

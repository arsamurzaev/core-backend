import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { z } from 'zod'

import { AllInterfaces } from '@/core/config'
import { normalizeRequiredString } from '@/shared/utils'

import {
	type EncryptedMoySkladToken,
	type MoySkladMetadata,
	type StoredMoySkladMetadata
} from './moysklad.types'

export const MOYSKLAD_DEFAULT_PRICE_TYPE_NAME = 'Цена продажи'
export const MOYSKLAD_DEFAULT_SCHEDULE_TIMEZONE = 'Europe/Moscow'

const MOYSKLAD_TOKEN_ENCRYPTION_FORMAT = 'enc-v1'
const MOYSKLAD_TOKEN_ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const AES_GCM_KEY_BYTES = 32
const AES_GCM_IV_BYTES = 12

const storedMoySkladMetadataSchema = z
	.object({
		token: z.string().optional(),
		tokenEncrypted: z
			.object({
				format: z.literal(MOYSKLAD_TOKEN_ENCRYPTION_FORMAT),
				alg: z.literal(MOYSKLAD_TOKEN_ENCRYPTION_ALGORITHM),
				keyVersion: z.string(),
				iv: z.string(),
				tag: z.string(),
				ciphertext: z.string()
			})
			.optional(),
		priceTypeName: z.string().optional(),
		importImages: z.boolean().optional(),
		syncStock: z.boolean().optional(),
		scheduleEnabled: z.boolean().optional(),
		schedulePattern: z.string().nullable().optional(),
		scheduleTimezone: z.string().optional()
	})
	.refine(data => data.token || data.tokenEncrypted, {
		message: 'Токен MoySklad обязателен'
	})

type PartialMoySkladMetadata = {
	token?: string
	priceTypeName?: string | null
	importImages?: boolean
	syncStock?: boolean
	scheduleEnabled?: boolean
	schedulePattern?: string | null
	scheduleTimezone?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEncryptedToken(value: unknown): value is EncryptedMoySkladToken {
	if (!isRecord(value)) return false

	return (
		value.format === MOYSKLAD_TOKEN_ENCRYPTION_FORMAT &&
		value.alg === MOYSKLAD_TOKEN_ENCRYPTION_ALGORITHM &&
		typeof value.keyVersion === 'string' &&
		typeof value.iv === 'string' &&
		typeof value.tag === 'string' &&
		typeof value.ciphertext === 'string'
	)
}

export function buildMoySkladMetadata(
	input: PartialMoySkladMetadata
): MoySkladMetadata {
	const token = normalizeRequiredString(input.token ?? '', 'token')
	const rawPriceTypeName =
		typeof input.priceTypeName === 'string' ? input.priceTypeName : ''
	const priceTypeName =
		rawPriceTypeName.trim() || MOYSKLAD_DEFAULT_PRICE_TYPE_NAME
	const rawSchedulePattern =
		typeof input.schedulePattern === 'string' ? input.schedulePattern : ''
	const schedulePattern = rawSchedulePattern.trim() || null
	const rawScheduleTimezone =
		typeof input.scheduleTimezone === 'string' ? input.scheduleTimezone : ''
	const scheduleTimezone =
		rawScheduleTimezone.trim() || MOYSKLAD_DEFAULT_SCHEDULE_TIMEZONE
	const scheduleEnabled = input.scheduleEnabled ?? false

	if (scheduleEnabled && !schedulePattern) {
		throw new BadRequestException(
			'Для планового sync MoySklad укажите schedulePattern'
		)
	}

	return {
		token,
		priceTypeName,
		importImages: input.importImages ?? true,
		syncStock: input.syncStock ?? true,
		scheduleEnabled,
		schedulePattern,
		scheduleTimezone
	}
}

export function maskToken(token: string): string | null {
	const normalized = token.trim()
	if (!normalized) return null
	if (normalized.length <= 8) {
		return `${normalized.slice(0, 2)}***${normalized.slice(-2)}`
	}
	return `${normalized.slice(0, 4)}***${normalized.slice(-4)}`
}

@Injectable()
export class MoySkladMetadataCryptoService {
	private readonly encryptionKey: Buffer
	private readonly keyVersion: string

	constructor(private readonly configService: ConfigService<AllInterfaces>) {
		const config = this.configService.get('integrationCrypto', { infer: true })
		const rawKey = config?.encryptionKey?.trim() ?? ''
		const keyVersion = config?.keyVersion?.trim() ?? 'v1'

		if (!rawKey) {
			throw new Error('INTEGRATION_ENCRYPTION_KEY не настроен')
		}

		const decodedKey = this.decodeKey(rawKey)
		if (decodedKey.length !== AES_GCM_KEY_BYTES) {
			throw new Error(
				`INTEGRATION_ENCRYPTION_KEY должен содержать ${AES_GCM_KEY_BYTES} байта после декодирования`
			)
		}

		this.encryptionKey = decodedKey
		this.keyVersion = keyVersion
	}

	buildStoredMetadata(input: PartialMoySkladMetadata): StoredMoySkladMetadata {
		const metadata = buildMoySkladMetadata(input)

		return {
			priceTypeName: metadata.priceTypeName,
			importImages: metadata.importImages,
			syncStock: metadata.syncStock,
			scheduleEnabled: metadata.scheduleEnabled,
			schedulePattern: metadata.schedulePattern,
			scheduleTimezone: metadata.scheduleTimezone,
			tokenEncrypted: this.encryptToken(metadata.token)
		}
	}

	parseStoredMetadata(metadata: unknown): MoySkladMetadata {
		const parsed = storedMoySkladMetadataSchema.parse(metadata)

		const token = this.resolveToken(parsed)

		return buildMoySkladMetadata({
			token,
			priceTypeName: parsed.priceTypeName,
			importImages: parsed.importImages,
			syncStock: parsed.syncStock,
			scheduleEnabled: parsed.scheduleEnabled,
			schedulePattern: parsed.schedulePattern,
			scheduleTimezone: parsed.scheduleTimezone
		})
	}

	private resolveToken(metadata: Record<string, unknown>): string {
		if (typeof metadata.token === 'string') {
			return metadata.token
		}

		if (isEncryptedToken(metadata.tokenEncrypted)) {
			return this.decryptToken(metadata.tokenEncrypted)
		}

		throw new BadRequestException('Токен MoySklad не настроен')
	}

	private encryptToken(token: string): EncryptedMoySkladToken {
		const iv = randomBytes(AES_GCM_IV_BYTES)
		const cipher = createCipheriv(
			MOYSKLAD_TOKEN_ENCRYPTION_ALGORITHM,
			this.encryptionKey,
			iv
		)
		const ciphertext = Buffer.concat([
			cipher.update(token, 'utf8'),
			cipher.final()
		])
		const tag = cipher.getAuthTag()

		return {
			format: MOYSKLAD_TOKEN_ENCRYPTION_FORMAT,
			alg: MOYSKLAD_TOKEN_ENCRYPTION_ALGORITHM,
			keyVersion: this.keyVersion,
			iv: iv.toString('base64'),
			tag: tag.toString('base64'),
			ciphertext: ciphertext.toString('base64')
		}
	}

	private decryptToken(token: EncryptedMoySkladToken): string {
		try {
			const decipher = createDecipheriv(
				MOYSKLAD_TOKEN_ENCRYPTION_ALGORITHM,
				this.encryptionKey,
				Buffer.from(token.iv, 'base64')
			)
			decipher.setAuthTag(Buffer.from(token.tag, 'base64'))

			const plaintext = Buffer.concat([
				decipher.update(Buffer.from(token.ciphertext, 'base64')),
				decipher.final()
			]).toString('utf8')

			return normalizeRequiredString(plaintext, 'token')
		} catch {
			throw new BadRequestException(
				'Не удалось расшифровать токен MoySklad. Проверьте ключ шифрования приложения.'
			)
		}
	}

	private decodeKey(value: string): Buffer {
		try {
			return Buffer.from(value, 'base64')
		} catch {
			throw new Error(
				'INTEGRATION_ENCRYPTION_KEY должен быть валидной base64-строкой'
			)
		}
	}
}

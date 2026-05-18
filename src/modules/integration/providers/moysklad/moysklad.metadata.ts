import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { z } from 'zod'

import { AllInterfaces } from '@/core/config'
import { normalizeRequiredString } from '@/shared/utils'

import {
	type EncryptedMoySkladToken,
	type MoySkladFieldOwnership,
	type MoySkladMetadata,
	type MoySkladProductChangeWebhookAction,
	type MoySkladProductChangeWebhookEntityType,
	type MoySkladProductChangeWebhookMetadata,
	type MoySkladProductDeleteWebhookEntityType,
	type MoySkladProductDeleteWebhookMetadata,
	type MoySkladProductFolderWebhookAction,
	type MoySkladProductFolderWebhookMetadata,
	type MoySkladStockWebhookMetadata,
	type StoredMoySkladMetadata
} from './moysklad.types'

export const MOYSKLAD_DEFAULT_PRICE_TYPE_NAME = 'Цена продажи'
export const MOYSKLAD_DEFAULT_SCHEDULE_TIMEZONE = 'Europe/Moscow'
export const MOYSKLAD_STOCK_WEBHOOK_REPORT_TYPE = 'all'
export const MOYSKLAD_STOCK_WEBHOOK_STOCK_TYPE = 'stock'
export const MOYSKLAD_PRODUCT_DELETE_WEBHOOK_ENTITY_TYPES = [
	'product',
	'service',
	'bundle',
	'variant'
] as const satisfies readonly MoySkladProductDeleteWebhookEntityType[]
export const MOYSKLAD_PRODUCT_CHANGE_WEBHOOK_ENTITY_TYPES = [
	'product',
	'service',
	'bundle',
	'variant'
] as const satisfies readonly MoySkladProductChangeWebhookEntityType[]
export const MOYSKLAD_PRODUCT_CHANGE_WEBHOOK_ACTIONS = [
	'CREATE',
	'UPDATE'
] as const satisfies readonly MoySkladProductChangeWebhookAction[]
export const MOYSKLAD_PRODUCT_FOLDER_WEBHOOK_ACTIONS = [
	'CREATE',
	'UPDATE',
	'DELETE'
] as const satisfies readonly MoySkladProductFolderWebhookAction[]
export const MOYSKLAD_PRODUCT_FOLDER_WEBHOOK_ENTITY_TYPE = 'productfolder'
export const MOYSKLAD_FIELD_OWNERSHIP_VALUES = ['external', 'local'] as const
export const MOYSKLAD_DEFAULT_FIELD_OWNERSHIP: MoySkladFieldOwnership = {
	price: 'external',
	stock: 'external',
	content: 'external',
	images: 'external'
}

const MOYSKLAD_TOKEN_ENCRYPTION_FORMAT = 'enc-v1'
const MOYSKLAD_TOKEN_ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const AES_GCM_KEY_BYTES = 32
const AES_GCM_IV_BYTES = 12
const moySkladFieldOwnershipValueSchema = z.enum(
	MOYSKLAD_FIELD_OWNERSHIP_VALUES
)
const moySkladFieldOwnershipSchema = z
	.object({
		price: moySkladFieldOwnershipValueSchema.optional(),
		stock: moySkladFieldOwnershipValueSchema.optional(),
		content: moySkladFieldOwnershipValueSchema.optional(),
		images: moySkladFieldOwnershipValueSchema.optional()
	})
	.optional()

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
		exportOrders: z.boolean().optional(),
		orderExportOrganizationId: z.string().nullable().optional(),
		orderExportCounterpartyId: z.string().nullable().optional(),
		orderExportStoreId: z.string().nullable().optional(),
		scheduleEnabled: z.boolean().optional(),
		schedulePattern: z.string().nullable().optional(),
		scheduleTimezone: z.string().optional(),
		lastStockSyncedAt: z.string().nullable().optional(),
		fieldOwnership: moySkladFieldOwnershipSchema,
		stockWebhookEnabled: z.boolean().optional(),
		stockWebhook: z
			.object({
				externalId: z.string().nullable().optional(),
				accountId: z.string().nullable().optional(),
				secretHash: z.string().nullable().optional(),
				reportType: z.literal(MOYSKLAD_STOCK_WEBHOOK_REPORT_TYPE).optional(),
				stockType: z.literal(MOYSKLAD_STOCK_WEBHOOK_STOCK_TYPE).optional(),
				lastReceivedAt: z.string().nullable().optional(),
				lastProcessedAt: z.string().nullable().optional(),
				lastError: z.string().nullable().optional()
			})
			.optional(),
		productDeleteWebhook: z
			.object({
				enabled: z.boolean().optional(),
				externalIds: z
					.object({
						product: z.string().nullable().optional(),
						service: z.string().nullable().optional(),
						bundle: z.string().nullable().optional(),
						variant: z.string().nullable().optional()
					})
					.optional(),
				accountId: z.string().nullable().optional(),
				secretHash: z.string().nullable().optional(),
				lastReceivedAt: z.string().nullable().optional(),
				lastProcessedAt: z.string().nullable().optional(),
				lastError: z.string().nullable().optional()
			})
			.optional(),
		productChangeWebhook: z
			.object({
				enabled: z.boolean().optional(),
				externalIds: z
					.object({
						product: z
							.object({
								CREATE: z.string().nullable().optional(),
								UPDATE: z.string().nullable().optional()
							})
							.optional(),
						service: z
							.object({
								CREATE: z.string().nullable().optional(),
								UPDATE: z.string().nullable().optional()
							})
							.optional(),
						bundle: z
							.object({
								CREATE: z.string().nullable().optional(),
								UPDATE: z.string().nullable().optional()
							})
							.optional(),
						variant: z
							.object({
								CREATE: z.string().nullable().optional(),
								UPDATE: z.string().nullable().optional()
							})
							.optional()
					})
					.optional(),
				accountId: z.string().nullable().optional(),
				secretHash: z.string().nullable().optional(),
				lastReceivedAt: z.string().nullable().optional(),
				lastProcessedAt: z.string().nullable().optional(),
				lastError: z.string().nullable().optional()
			})
			.optional(),
		productFolderWebhook: z
			.object({
				enabled: z.boolean().optional(),
				externalIds: z
					.object({
						CREATE: z.string().nullable().optional(),
						UPDATE: z.string().nullable().optional(),
						DELETE: z.string().nullable().optional()
					})
					.optional(),
				accountId: z.string().nullable().optional(),
				secretHash: z.string().nullable().optional(),
				lastReceivedAt: z.string().nullable().optional(),
				lastProcessedAt: z.string().nullable().optional(),
				lastError: z.string().nullable().optional()
			})
			.optional()
	})
	.refine(data => data.token || data.tokenEncrypted, {
		message: 'Токен MoySklad обязателен'
	})

type PartialMoySkladProductDeleteWebhookMetadata = Omit<
	Partial<MoySkladProductDeleteWebhookMetadata>,
	'externalIds'
> & {
	externalIds?: Partial<
		Record<MoySkladProductDeleteWebhookEntityType, string | null>
	> | null
}

type PartialMoySkladProductChangeWebhookMetadata = Omit<
	Partial<MoySkladProductChangeWebhookMetadata>,
	'externalIds'
> & {
	externalIds?: Partial<
		Record<
			MoySkladProductChangeWebhookEntityType,
			Partial<Record<MoySkladProductChangeWebhookAction, string | null>>
		>
	> | null
}

type PartialMoySkladProductFolderWebhookMetadata = Omit<
	Partial<MoySkladProductFolderWebhookMetadata>,
	'externalIds'
> & {
	externalIds?: Partial<
		Record<MoySkladProductFolderWebhookAction, string | null>
	> | null
}

type PartialMoySkladMetadata = {
	token?: string
	priceTypeName?: string | null
	importImages?: boolean
	syncStock?: boolean
	exportOrders?: boolean
	orderExportOrganizationId?: string | null
	orderExportCounterpartyId?: string | null
	orderExportStoreId?: string | null
	scheduleEnabled?: boolean
	schedulePattern?: string | null
	scheduleTimezone?: string | null
	lastStockSyncedAt?: string | null
	stockWebhookEnabled?: boolean
	stockWebhook?: Partial<MoySkladStockWebhookMetadata> | null
	productDeleteWebhook?: PartialMoySkladProductDeleteWebhookMetadata | null
	productChangeWebhook?: PartialMoySkladProductChangeWebhookMetadata | null
	productFolderWebhook?: PartialMoySkladProductFolderWebhookMetadata | null
	fieldOwnership?: Partial<MoySkladFieldOwnership> | null
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
	const exportOrders = input.exportOrders ?? false
	const orderExportOrganizationId = normalizeOptionalString(
		input.orderExportOrganizationId
	)
	const orderExportCounterpartyId = normalizeOptionalString(
		input.orderExportCounterpartyId
	)
	const orderExportStoreId = normalizeOptionalString(input.orderExportStoreId)
	const lastStockSyncedAt = normalizeOptionalString(input.lastStockSyncedAt)
	const stockWebhookEnabled = input.stockWebhookEnabled ?? false
	const stockWebhook = normalizeStockWebhookMetadata(input.stockWebhook)
	const productDeleteWebhook = normalizeProductDeleteWebhookMetadata(
		input.productDeleteWebhook
	)
	const productChangeWebhook = normalizeProductChangeWebhookMetadata(
		input.productChangeWebhook
	)
	const productFolderWebhook = normalizeProductFolderWebhookMetadata(
		input.productFolderWebhook
	)
	const fieldOwnership = normalizeMoySkladFieldOwnership(input.fieldOwnership)

	if (scheduleEnabled && !schedulePattern) {
		throw new BadRequestException(
			'Для планового sync MoySklad укажите schedulePattern'
		)
	}

	if (
		exportOrders &&
		(!orderExportOrganizationId ||
			!orderExportCounterpartyId ||
			!orderExportStoreId)
	) {
		throw new BadRequestException(
			'For MoySklad order export, organization, counterparty and store ids are required'
		)
	}

	return {
		token,
		priceTypeName,
		importImages: input.importImages ?? true,
		syncStock: input.syncStock ?? true,
		exportOrders,
		orderExportOrganizationId,
		orderExportCounterpartyId,
		orderExportStoreId,
		scheduleEnabled,
		schedulePattern,
		scheduleTimezone,
		lastStockSyncedAt,
		stockWebhookEnabled,
		stockWebhook,
		productDeleteWebhook,
		productChangeWebhook,
		productFolderWebhook,
		fieldOwnership
	}
}

export function normalizeMoySkladFieldOwnership(
	input?: Partial<MoySkladFieldOwnership> | null
): MoySkladFieldOwnership {
	if (!input) return { ...MOYSKLAD_DEFAULT_FIELD_OWNERSHIP }

	return {
		price: normalizeMoySkladFieldOwnershipValue(input.price),
		stock: normalizeMoySkladFieldOwnershipValue(input.stock),
		content: normalizeMoySkladFieldOwnershipValue(input.content),
		images: normalizeMoySkladFieldOwnershipValue(input.images)
	}
}

export function isMoySkladExternalField(
	metadata: { fieldOwnership?: Partial<MoySkladFieldOwnership> | null },
	field: keyof MoySkladFieldOwnership
): boolean {
	return (
		normalizeMoySkladFieldOwnership(metadata.fieldOwnership)[field] === 'external'
	)
}

function normalizeMoySkladFieldOwnershipValue(
	value?: MoySkladFieldOwnership[keyof MoySkladFieldOwnership] | null
): MoySkladFieldOwnership[keyof MoySkladFieldOwnership] {
	return value === 'local' ? 'local' : 'external'
}

export function buildDefaultMoySkladStockWebhookMetadata(): MoySkladStockWebhookMetadata {
	return {
		externalId: null,
		accountId: null,
		secretHash: null,
		reportType: MOYSKLAD_STOCK_WEBHOOK_REPORT_TYPE,
		stockType: MOYSKLAD_STOCK_WEBHOOK_STOCK_TYPE,
		lastReceivedAt: null,
		lastProcessedAt: null,
		lastError: null
	}
}

function normalizeStockWebhookMetadata(
	input?: Partial<MoySkladStockWebhookMetadata> | null
): MoySkladStockWebhookMetadata {
	const defaults = buildDefaultMoySkladStockWebhookMetadata()
	if (!input) return defaults

	return {
		externalId: normalizeOptionalString(input.externalId),
		accountId: normalizeOptionalString(input.accountId),
		secretHash: normalizeOptionalString(input.secretHash),
		reportType: defaults.reportType,
		stockType: defaults.stockType,
		lastReceivedAt: normalizeOptionalString(input.lastReceivedAt),
		lastProcessedAt: normalizeOptionalString(input.lastProcessedAt),
		lastError: normalizeOptionalString(input.lastError)
	}
}

export function buildDefaultMoySkladProductDeleteWebhookMetadata(): MoySkladProductDeleteWebhookMetadata {
	return {
		enabled: false,
		externalIds: {
			product: null,
			service: null,
			bundle: null,
			variant: null
		},
		accountId: null,
		secretHash: null,
		lastReceivedAt: null,
		lastProcessedAt: null,
		lastError: null
	}
}

function normalizeProductDeleteWebhookMetadata(
	input?: PartialMoySkladProductDeleteWebhookMetadata | null
): MoySkladProductDeleteWebhookMetadata {
	const defaults = buildDefaultMoySkladProductDeleteWebhookMetadata()
	if (!input) return defaults

	const externalIds =
		input.externalIds && typeof input.externalIds === 'object'
			? input.externalIds
			: defaults.externalIds

	return {
		enabled: input.enabled ?? defaults.enabled,
		externalIds: {
			product: normalizeOptionalString(externalIds.product),
			service: normalizeOptionalString(externalIds.service),
			bundle: normalizeOptionalString(externalIds.bundle),
			variant: normalizeOptionalString(externalIds.variant)
		},
		accountId: normalizeOptionalString(input.accountId),
		secretHash: normalizeOptionalString(input.secretHash),
		lastReceivedAt: normalizeOptionalString(input.lastReceivedAt),
		lastProcessedAt: normalizeOptionalString(input.lastProcessedAt),
		lastError: normalizeOptionalString(input.lastError)
	}
}

export function buildDefaultMoySkladProductChangeWebhookMetadata(): MoySkladProductChangeWebhookMetadata {
	return {
		enabled: false,
		externalIds: {
			product: { CREATE: null, UPDATE: null },
			service: { CREATE: null, UPDATE: null },
			bundle: { CREATE: null, UPDATE: null },
			variant: { CREATE: null, UPDATE: null }
		},
		accountId: null,
		secretHash: null,
		lastReceivedAt: null,
		lastProcessedAt: null,
		lastError: null
	}
}

function normalizeProductChangeWebhookMetadata(
	input?: PartialMoySkladProductChangeWebhookMetadata | null
): MoySkladProductChangeWebhookMetadata {
	const defaults = buildDefaultMoySkladProductChangeWebhookMetadata()
	if (!input) return defaults

	const externalIds =
		input.externalIds && typeof input.externalIds === 'object'
			? input.externalIds
			: defaults.externalIds

	return {
		enabled: input.enabled ?? defaults.enabled,
		externalIds: {
			product: normalizeProductChangeWebhookActionIds(externalIds.product),
			service: normalizeProductChangeWebhookActionIds(externalIds.service),
			bundle: normalizeProductChangeWebhookActionIds(externalIds.bundle),
			variant: normalizeProductChangeWebhookActionIds(externalIds.variant)
		},
		accountId: normalizeOptionalString(input.accountId),
		secretHash: normalizeOptionalString(input.secretHash),
		lastReceivedAt: normalizeOptionalString(input.lastReceivedAt),
		lastProcessedAt: normalizeOptionalString(input.lastProcessedAt),
		lastError: normalizeOptionalString(input.lastError)
	}
}

function normalizeProductChangeWebhookActionIds(
	input?: Partial<
		Record<MoySkladProductChangeWebhookAction, string | null>
	> | null
): Record<MoySkladProductChangeWebhookAction, string | null> {
	return {
		CREATE: normalizeOptionalString(input?.CREATE),
		UPDATE: normalizeOptionalString(input?.UPDATE)
	}
}

export function buildDefaultMoySkladProductFolderWebhookMetadata(): MoySkladProductFolderWebhookMetadata {
	return {
		enabled: false,
		externalIds: {
			CREATE: null,
			UPDATE: null,
			DELETE: null
		},
		accountId: null,
		secretHash: null,
		lastReceivedAt: null,
		lastProcessedAt: null,
		lastError: null
	}
}

function normalizeProductFolderWebhookMetadata(
	input?: PartialMoySkladProductFolderWebhookMetadata | null
): MoySkladProductFolderWebhookMetadata {
	const defaults = buildDefaultMoySkladProductFolderWebhookMetadata()
	if (!input) return defaults

	const externalIds =
		input.externalIds && typeof input.externalIds === 'object'
			? input.externalIds
			: defaults.externalIds

	return {
		enabled: input.enabled ?? defaults.enabled,
		externalIds: {
			CREATE: normalizeOptionalString(externalIds.CREATE),
			UPDATE: normalizeOptionalString(externalIds.UPDATE),
			DELETE: normalizeOptionalString(externalIds.DELETE)
		},
		accountId: normalizeOptionalString(input.accountId),
		secretHash: normalizeOptionalString(input.secretHash),
		lastReceivedAt: normalizeOptionalString(input.lastReceivedAt),
		lastProcessedAt: normalizeOptionalString(input.lastProcessedAt),
		lastError: normalizeOptionalString(input.lastError)
	}
}

function normalizeOptionalString(value?: string | null): string | null {
	const normalized = typeof value === 'string' ? value.trim() : ''
	return normalized || null
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
			exportOrders: metadata.exportOrders,
			orderExportOrganizationId: metadata.orderExportOrganizationId,
			orderExportCounterpartyId: metadata.orderExportCounterpartyId,
			orderExportStoreId: metadata.orderExportStoreId,
			scheduleEnabled: metadata.scheduleEnabled,
			schedulePattern: metadata.schedulePattern,
			scheduleTimezone: metadata.scheduleTimezone,
			lastStockSyncedAt: metadata.lastStockSyncedAt,
			fieldOwnership: metadata.fieldOwnership,
			stockWebhookEnabled: metadata.stockWebhookEnabled,
			stockWebhook: metadata.stockWebhook,
			productDeleteWebhook: metadata.productDeleteWebhook,
			productChangeWebhook: metadata.productChangeWebhook,
			productFolderWebhook: metadata.productFolderWebhook,
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
			exportOrders: parsed.exportOrders,
			orderExportOrganizationId: parsed.orderExportOrganizationId,
			orderExportCounterpartyId: parsed.orderExportCounterpartyId,
			orderExportStoreId: parsed.orderExportStoreId,
			scheduleEnabled: parsed.scheduleEnabled,
			schedulePattern: parsed.schedulePattern,
			scheduleTimezone: parsed.scheduleTimezone,
			lastStockSyncedAt: parsed.lastStockSyncedAt,
			fieldOwnership: parsed.fieldOwnership,
			stockWebhookEnabled: parsed.stockWebhookEnabled,
			stockWebhook: parsed.stockWebhook,
			productDeleteWebhook: parsed.productDeleteWebhook,
			productChangeWebhook: parsed.productChangeWebhook,
			productFolderWebhook: parsed.productFolderWebhook
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

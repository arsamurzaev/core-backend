import { BadRequestException, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
	createCipheriv,
	createDecipheriv,
	createECDH,
	createPrivateKey,
	createPublicKey,
	hkdfSync,
	randomBytes
} from 'crypto'

import { AllInterfaces } from '@/core/config'

const TOKEN_PREFIX = 'ip2'
const TOKEN_VERSION = 1
const AES_GCM_IV_BYTES = 12
const AES_GCM_KEY_BYTES = 32
const AES_GCM_TAG_BYTES = 16
const EC_CURVE = 'prime256v1'
const EC_PRIVATE_KEY_BYTES = 32
const EC_PUBLIC_KEY_BYTES = 65
const EC_PUBLIC_KEY_PREFIX = 0x04
const HKDF_SALT = Buffer.from('integration-payload-token:ip2:salt', 'utf8')
const HKDF_INFO = Buffer.from('integration-payload-token:ip2:a256gcm', 'utf8')
const MAX_PAYLOAD_JSON_BYTES = 8192

export type IntegrationPayloadTokenEnvelope = {
	v: typeof TOKEN_VERSION
	type: string | null
	iat: number
	exp: number | null
	catalogId: string | null
	payload: unknown
}

export type IntegrationPayloadPublicKey = {
	alg: 'ECDH-ES+A256GCM'
	kid: string
	prefix: typeof TOKEN_PREFIX
	publicKey: string
}

export type SealIntegrationPayloadTokenParams = {
	type?: string | null
	catalogId?: string | null
	expiresInSeconds?: number | null
}

export type OpenIntegrationPayloadTokenParams = {
	expectedType?: string | null
	expectedCatalogId?: string | null
}

@Injectable()
export class IntegrationPayloadTokenService {
	private readonly keyId: string
	private readonly privateKeyRaw: Buffer | null
	private readonly publicKeyRaw: Buffer | null

	constructor(private readonly configService: ConfigService<AllInterfaces>) {
		const config = this.configService.get('integrationCrypto', { infer: true })
		this.keyId = config?.payloadKeyId?.trim() || 'v1'
		this.privateKeyRaw = normalizeEcPrivateKey(config?.payloadPrivateKey)
		this.publicKeyRaw =
			normalizeEcPublicKey(config?.payloadPublicKey) ??
			this.derivePublicKey(this.privateKeyRaw)
	}

	getPublicKey(): IntegrationPayloadPublicKey {
		if (!this.publicKeyRaw) {
			throw new BadRequestException(
				'INTEGRATION_PAYLOAD_PUBLIC_KEY or INTEGRATION_PAYLOAD_PRIVATE_KEY is not configured'
			)
		}

		return {
			alg: 'ECDH-ES+A256GCM',
			kid: this.keyId,
			prefix: TOKEN_PREFIX,
			publicKey: this.publicKeyRaw.toString('base64url')
		}
	}

	seal(payload: unknown, params: SealIntegrationPayloadTokenParams = {}): string {
		if (!this.publicKeyRaw) {
			throw new BadRequestException(
				'INTEGRATION_PAYLOAD_PUBLIC_KEY or INTEGRATION_PAYLOAD_PRIVATE_KEY is not configured'
			)
		}

		const envelope = this.buildEnvelope(payload, params)
		const encoded = Buffer.from(JSON.stringify(envelope), 'utf8')
		if (encoded.length > MAX_PAYLOAD_JSON_BYTES) {
			throw new BadRequestException('Integration payload token is too large')
		}

		const ephemeral = createECDH(EC_CURVE)
		ephemeral.generateKeys()
		const ephemeralPublicKey = ephemeral.getPublicKey(
			undefined,
			'uncompressed'
		) as Buffer
		const contentKey = deriveContentKey(
			ephemeral.computeSecret(this.publicKeyRaw)
		)
		const iv = randomBytes(AES_GCM_IV_BYTES)
		const cipher = createCipheriv('aes-256-gcm', contentKey, iv)
		const ciphertext = Buffer.concat([cipher.update(encoded), cipher.final()])
		const tag = cipher.getAuthTag()

		return [
			TOKEN_PREFIX,
			this.keyId,
			ephemeralPublicKey.toString('base64url'),
			iv.toString('base64url'),
			Buffer.concat([ciphertext, tag]).toString('base64url')
		].join('.')
	}

	open(
		token: string,
		params: OpenIntegrationPayloadTokenParams = {}
	): IntegrationPayloadTokenEnvelope {
		if (!this.privateKeyRaw) {
			throw new BadRequestException(
				'INTEGRATION_PAYLOAD_PRIVATE_KEY is not configured'
			)
		}

		const parts = token.trim().split('.')
		if (parts.length !== 5 || parts[0] !== TOKEN_PREFIX) {
			throw new BadRequestException('Invalid integration payload token')
		}
		const [, kid, ephemeralPublicKeyPart, ivPart, encryptedPayloadPart] = parts
		if (kid !== this.keyId) {
			throw new BadRequestException('Integration payload token key mismatch')
		}

		try {
			const ephemeralPublicKey = Buffer.from(ephemeralPublicKeyPart, 'base64url')
			const iv = Buffer.from(ivPart, 'base64url')
			const encryptedPayload = Buffer.from(encryptedPayloadPart, 'base64url')

			assertEcPublicKey(ephemeralPublicKey)
			if (
				iv.length !== AES_GCM_IV_BYTES ||
				encryptedPayload.length <= AES_GCM_TAG_BYTES
			) {
				throw new Error('Invalid token parts')
			}

			const ecdh = createECDH(EC_CURVE)
			ecdh.setPrivateKey(this.privateKeyRaw)
			const contentKey = deriveContentKey(ecdh.computeSecret(ephemeralPublicKey))
			const tag = encryptedPayload.subarray(
				encryptedPayload.length - AES_GCM_TAG_BYTES
			)
			const ciphertext = encryptedPayload.subarray(
				0,
				encryptedPayload.length - AES_GCM_TAG_BYTES
			)
			const decipher = createDecipheriv('aes-256-gcm', contentKey, iv)
			decipher.setAuthTag(tag)
			const plaintext = Buffer.concat([
				decipher.update(ciphertext),
				decipher.final()
			])
			const envelope = parseEnvelope(JSON.parse(plaintext.toString('utf8')))
			this.assertEnvelope(envelope, params)
			return envelope
		} catch (error) {
			if (error instanceof BadRequestException) throw error
			throw new BadRequestException('Invalid integration payload token')
		}
	}

	private buildEnvelope(
		payload: unknown,
		params: SealIntegrationPayloadTokenParams
	): IntegrationPayloadTokenEnvelope {
		const now = Math.floor(Date.now() / 1000)
		const expiresInSeconds = normalizePositiveInt(params.expiresInSeconds)
		return {
			v: TOKEN_VERSION,
			type: normalizeText(params.type),
			iat: now,
			exp: expiresInSeconds ? now + expiresInSeconds : null,
			catalogId: normalizeText(params.catalogId),
			payload
		}
	}

	private assertEnvelope(
		envelope: IntegrationPayloadTokenEnvelope,
		params: OpenIntegrationPayloadTokenParams
	) {
		const expectedType = normalizeText(params.expectedType)
		if (expectedType && envelope.type !== expectedType) {
			throw new BadRequestException('Integration payload token type mismatch')
		}

		const expectedCatalogId = normalizeText(params.expectedCatalogId)
		if (expectedCatalogId && envelope.catalogId !== expectedCatalogId) {
			throw new BadRequestException('Integration payload token catalog mismatch')
		}

		if (envelope.exp && envelope.exp < Math.floor(Date.now() / 1000)) {
			throw new BadRequestException('Integration payload token expired')
		}
	}

	private derivePublicKey(privateKey: Buffer | null): Buffer | null {
		if (!privateKey) return null
		const ecdh = createECDH(EC_CURVE)
		ecdh.setPrivateKey(privateKey)
		return ecdh.getPublicKey(undefined, 'uncompressed') as Buffer
	}
}

function deriveContentKey(sharedSecret: Buffer): Buffer {
	return Buffer.from(
		hkdfSync(
			'sha256',
			sharedSecret,
			HKDF_SALT,
			HKDF_INFO,
			AES_GCM_KEY_BYTES
		)
	)
}

function parseEnvelope(value: unknown): IntegrationPayloadTokenEnvelope {
	if (!isRecord(value)) {
		throw new BadRequestException('Invalid integration payload token')
	}
	if (value.v !== TOKEN_VERSION) {
		throw new BadRequestException('Unsupported integration payload token version')
	}
	if (typeof value.iat !== 'number' || !Number.isFinite(value.iat)) {
		throw new BadRequestException('Invalid integration payload token')
	}

	return {
		v: TOKEN_VERSION,
		type: normalizeText(value.type ?? value.t),
		iat: Math.floor(value.iat),
		exp:
			typeof value.exp === 'number' && Number.isFinite(value.exp)
				? Math.floor(value.exp)
				: null,
		catalogId: normalizeText(value.catalogId ?? value.c),
		payload: value.payload ?? value.p
	}
}

function normalizeEcPrivateKey(value: string | null | undefined): Buffer | null {
	const normalized = value?.trim()
	if (!normalized) return null
	const pem = decodeMaybePem(normalized)
	if (pem) {
		const jwk = createPrivateKey(pem).export({ format: 'jwk' }) as Record<
			string,
			unknown
		>
		return decodeFixedBase64Url(jwk.d, EC_PRIVATE_KEY_BYTES)
	}

	const hex = normalized.replace(/^0x/i, '')
	if (/^[0-9a-f]{64}$/i.test(hex)) {
		return Buffer.from(hex, 'hex')
	}

	return decodeFixedBase64Url(normalized, EC_PRIVATE_KEY_BYTES)
}

function normalizeEcPublicKey(value: string | null | undefined): Buffer | null {
	const normalized = value?.trim()
	if (!normalized) return null
	const pem = decodeMaybePem(normalized)
	if (pem) {
		const jwk = createPublicKey(pem).export({ format: 'jwk' }) as Record<
			string,
			unknown
		>
		return pointFromJwk(jwk)
	}

	const hex = normalized.replace(/^0x/i, '')
	if (/^[0-9a-f]{130}$/i.test(hex)) {
		const publicKey = Buffer.from(hex, 'hex')
		assertEcPublicKey(publicKey)
		return publicKey
	}

	const publicKey = decodeFixedBase64Url(normalized, EC_PUBLIC_KEY_BYTES)
	assertEcPublicKey(publicKey)
	return publicKey
}

function pointFromJwk(jwk: Record<string, unknown>): Buffer {
	const x = decodeFixedBase64Url(jwk.x, EC_PRIVATE_KEY_BYTES)
	const y = decodeFixedBase64Url(jwk.y, EC_PRIVATE_KEY_BYTES)
	return Buffer.concat([Buffer.from([EC_PUBLIC_KEY_PREFIX]), x, y])
}

function decodeMaybePem(value: string): string | null {
	const withNewlines = value.replace(/\\n/g, '\n')
	if (withNewlines.includes('-----BEGIN')) return withNewlines

	try {
		const decoded = Buffer.from(value, 'base64url').toString('utf8')
		return decoded.includes('-----BEGIN') ? decoded : null
	} catch {
		return null
	}
}

function decodeFixedBase64Url(value: unknown, expectedBytes: number): Buffer {
	if (typeof value !== 'string') {
		throw new BadRequestException('Invalid integration payload key')
	}
	const decoded = Buffer.from(value.trim(), 'base64url')
	if (decoded.length !== expectedBytes) {
		throw new BadRequestException('Invalid integration payload key')
	}
	return decoded
}

function assertEcPublicKey(value: Buffer) {
	if (
		value.length !== EC_PUBLIC_KEY_BYTES ||
		value[0] !== EC_PUBLIC_KEY_PREFIX
	) {
		throw new BadRequestException('Invalid integration payload public key')
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeText(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized || null
}

function normalizePositiveInt(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return null
	const normalized = Math.floor(value)
	return normalized > 0 ? normalized : null
}

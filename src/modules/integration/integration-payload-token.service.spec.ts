import { BadRequestException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createCipheriv, createECDH, hkdfSync, randomBytes } from 'crypto'

import { AllInterfaces } from '@/core/config'

import { IntegrationPayloadTokenService } from './integration-payload-token.service'

const HKDF_SALT = Buffer.from('integration-payload-token:ip2:salt', 'utf8')
const HKDF_INFO = Buffer.from('integration-payload-token:ip2:a256gcm', 'utf8')

function createKeyPair() {
	const ecdh = createECDH('prime256v1')
	ecdh.generateKeys()
	return {
		privateKey: ecdh.getPrivateKey().toString('base64url'),
		publicKey: ecdh.getPublicKey(undefined, 'uncompressed').toString('base64url')
	}
}

function createService(params: {
	keyId?: string
	privateKey: string
	publicKey?: string | null
}) {
	const configService = {
		get: jest.fn().mockReturnValue({
			encryptionKey: 'unused',
			keyVersion: 'v1',
			payloadKeyId: params.keyId ?? 'test-key',
			payloadPrivateKey: params.privateKey,
			payloadPublicKey: params.publicKey ?? null
		})
	} as unknown as ConfigService<AllInterfaces>

	return new IntegrationPayloadTokenService(configService)
}

function sealCompactToken(params: {
	catalogId: string
	keyId: string
	payload: unknown
	publicKey: string
	type: string
}) {
	const recipientPublicKey = Buffer.from(params.publicKey, 'base64url')
	const ephemeral = createECDH('prime256v1')
	ephemeral.generateKeys()
	const contentKey = Buffer.from(
		hkdfSync(
			'sha256',
			ephemeral.computeSecret(recipientPublicKey),
			HKDF_SALT,
			HKDF_INFO,
			32
		)
	)
	const iv = randomBytes(12)
	const now = Math.floor(Date.now() / 1000)
	const envelope = Buffer.from(
		JSON.stringify({
			v: 1,
			t: params.type,
			iat: now,
			c: params.catalogId,
			p: params.payload
		}),
		'utf8'
	)
	const cipher = createCipheriv('aes-256-gcm', contentKey, iv)
	const ciphertext = Buffer.concat([cipher.update(envelope), cipher.final()])
	const encryptedPayload = Buffer.concat([ciphertext, cipher.getAuthTag()])

	return [
		'ip2',
		params.keyId,
		ephemeral.getPublicKey(undefined, 'uncompressed').toString('base64url'),
		iv.toString('base64url'),
		encryptedPayload.toString('base64url')
	].join('.')
}

describe('IntegrationPayloadTokenService', () => {
	it('seals and opens flexible payloads with a derived public key', () => {
		const { privateKey } = createKeyPair()
		const service = createService({ privateKey })

		const publicKey = service.getPublicKey()
		expect(publicKey).toEqual(
			expect.objectContaining({
				alg: 'ECDH-ES+A256GCM',
				kid: 'test-key',
				prefix: 'ip2'
			})
		)
		expect(Buffer.from(publicKey.publicKey, 'base64url')).toHaveLength(65)

		const token = service.seal(
			{
				h: {
					n: '11',
					sn: 'Main hall'
				},
				i: {
					t: 'table-uuid'
				}
			},
			{
				catalogId: 'catalog-1',
				type: 'hall.table'
			}
		)

		expect(token.startsWith('ip2.test-key.')).toBe(true)
		expect(token.length).toBeLessThan(600)

		const envelope = service.open(token, {
			expectedCatalogId: 'catalog-1',
			expectedType: 'hall.table'
		})

		expect(envelope).toEqual(
			expect.objectContaining({
				catalogId: 'catalog-1',
				type: 'hall.table',
				payload: {
					h: {
						n: '11',
						sn: 'Main hall'
					},
					i: {
						t: 'table-uuid'
					}
				}
			})
		)
	})

	it('opens compact web payloads produced by the frontend helper', () => {
		const { privateKey, publicKey } = createKeyPair()
		const service = createService({
			keyId: 'compact-key',
			privateKey,
			publicKey
		})
		const token = sealCompactToken({
			catalogId: 'catalog-1',
			keyId: 'compact-key',
			publicKey,
			type: 'hall.table',
			payload: {
				i: {
					t: 'table-uuid'
				}
			}
		})

		expect(
			service.open(token, {
				expectedCatalogId: 'catalog-1',
				expectedType: 'hall.table'
			}).payload
		).toEqual({
			i: {
				t: 'table-uuid'
			}
		})
	})

	it('rejects tokens for another type or catalog', () => {
		const { privateKey } = createKeyPair()
		const service = createService({ privateKey })
		const token = service.seal(
			{
				i: {
					t: 'table-uuid'
				}
			},
			{
				catalogId: 'catalog-1',
				type: 'hall.table'
			}
		)

		expect(() =>
			service.open(token, {
				expectedCatalogId: 'catalog-2',
				expectedType: 'hall.table'
			})
		).toThrow(BadRequestException)
		expect(() =>
			service.open(token, {
				expectedCatalogId: 'catalog-1',
				expectedType: 'delivery.point'
			})
		).toThrow(BadRequestException)
	})

	it('requires catalog id when a caller expects one', () => {
		const { privateKey } = createKeyPair()
		const service = createService({ privateKey })
		const token = service.seal(
			{
				i: {
					t: 'table-uuid'
				}
			},
			{
				type: 'hall.table'
			}
		)

		expect(() =>
			service.open(token, {
				expectedCatalogId: 'catalog-1',
				expectedType: 'hall.table'
			})
		).toThrow(BadRequestException)
	})
})

import { ConfigService } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'

import {
	buildMoySkladMetadata,
	MoySkladMetadataCryptoService
} from './moysklad.metadata'

describe('MoySkladMetadataCryptoService', () => {
	let service: MoySkladMetadataCryptoService

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				MoySkladMetadataCryptoService,
				{
					provide: ConfigService,
					useValue: {
						get: jest.fn((key: string) => {
							if (key === 'integrationCrypto') {
								return {
									encryptionKey: Buffer.alloc(32, 7).toString('base64'),
									keyVersion: 'v1'
								}
							}
							return undefined
						})
					}
				}
			]
		}).compile()

		service = module.get(MoySkladMetadataCryptoService)
	})

	it('encrypts token in stored metadata', () => {
		const result = service.buildStoredMetadata({
			token: 'secret-token',
			priceTypeName: 'Цена продажи',
			importImages: true,
			syncStock: true,
			scheduleEnabled: false,
			schedulePattern: null,
			scheduleTimezone: 'Europe/Moscow'
		})

		expect(result.token).toBeUndefined()
		expect(result.tokenEncrypted).toEqual(
			expect.objectContaining({
				format: 'enc-v1',
				alg: 'aes-256-gcm',
				keyVersion: 'v1',
				iv: expect.any(String),
				tag: expect.any(String),
				ciphertext: expect.any(String)
			})
		)
	})

	it('decrypts encrypted stored metadata', () => {
		const stored = service.buildStoredMetadata({
			token: 'secret-token',
			priceTypeName: 'Цена продажи',
			importImages: true,
			syncStock: true,
			scheduleEnabled: true,
			schedulePattern: '0 */6 * * *',
			scheduleTimezone: 'Europe/Moscow'
		})

		const result = service.parseStoredMetadata(stored)

		expect(result).toEqual(
			buildMoySkladMetadata({
				token: 'secret-token',
				priceTypeName: 'Цена продажи',
				importImages: true,
				syncStock: true,
				scheduleEnabled: true,
				schedulePattern: '0 */6 * * *',
				scheduleTimezone: 'Europe/Moscow'
			})
		)
	})

	it('supports legacy plain token metadata', () => {
		const result = service.parseStoredMetadata({
			token: 'legacy-token',
			priceTypeName: 'Цена продажи',
			importImages: true,
			syncStock: true,
			scheduleEnabled: false,
			schedulePattern: null,
			scheduleTimezone: 'Europe/Moscow'
		})

		expect(result.token).toBe('legacy-token')
	})
})

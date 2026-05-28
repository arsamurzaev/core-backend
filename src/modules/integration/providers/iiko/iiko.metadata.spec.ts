import { ConfigService } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'

import {
	buildIikoMetadata,
	IikoMetadataCryptoService,
	maskApiLogin
} from './iiko.metadata'

describe('IikoMetadataCryptoService', () => {
	let service: IikoMetadataCryptoService

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			providers: [
				IikoMetadataCryptoService,
				{
					provide: ConfigService,
					useValue: {
						get: jest.fn((key: string) => {
							if (key === 'integrationCrypto') {
								return {
									encryptionKey: Buffer.alloc(32, 9).toString('base64'),
									keyVersion: 'v1'
								}
							}
							return undefined
						})
					}
				}
			]
		}).compile()

		service = module.get(IikoMetadataCryptoService)
	})

	it('encrypts apiLogin in stored metadata', () => {
		const result = service.buildStoredMetadata({
			apiLogin: 'secret-login',
			organizationId: 'organization-1',
			organizationName: 'Demo',
			importImages: true
		})

		expect(result.apiLogin).toBeUndefined()
		expect(result.apiLoginEncrypted).toEqual(
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
			apiLogin: 'secret-login',
			organizationId: 'organization-1',
			organizationName: 'Demo',
			externalMenuId: '81651',
			externalMenuName: 'Main menu',
			priceCategoryId: 'price-1',
			priceCategoryName: 'Base',
			terminalGroupId: 'terminal-1',
			terminalGroupName: 'Main terminal',
			menuVersion: 4,
			exportOrders: true,
			orderExportServiceType: 'DeliveryByClient',
			orderExportSourceKey: 'catalog-api',
			importImages: false,
			lastRevision: 42,
			lastMenuSyncedAt: '2026-05-20T10:00:00.000Z',
			lastStopListSyncedAt: '2026-05-20T10:05:00.000Z',
			webhook: {
				enabled: true,
				urlPreview:
					'https://api.example.test/integration/webhooks/iiko/integration-1/***',
				secretHash: 'secret-hash',
				lastConfiguredAt: '2026-05-20T10:06:00.000Z',
				lastReceivedAt: '2026-05-20T10:07:00.000Z',
				lastEventType: 'StopListUpdate',
				lastError: null
			}
		})

		expect(service.parseStoredMetadata(stored)).toEqual(
			buildIikoMetadata({
				apiLogin: 'secret-login',
				organizationId: 'organization-1',
				organizationName: 'Demo',
				externalMenuId: '81651',
				externalMenuName: 'Main menu',
				priceCategoryId: 'price-1',
				priceCategoryName: 'Base',
				terminalGroupId: 'terminal-1',
				terminalGroupName: 'Main terminal',
				menuVersion: 4,
				syncSource: 'external_menu',
				importImages: false,
				exportOrders: true,
				orderExportServiceType: 'DeliveryByClient',
				orderExportSourceKey: 'catalog-api',
				lastRevision: 42,
				lastMenuSyncedAt: '2026-05-20T10:00:00.000Z',
				lastStopListSyncedAt: '2026-05-20T10:05:00.000Z',
				webhook: {
					enabled: true,
					urlPreview:
						'https://api.example.test/integration/webhooks/iiko/integration-1/***',
					secretHash: 'secret-hash',
					lastConfiguredAt: '2026-05-20T10:06:00.000Z',
					lastReceivedAt: '2026-05-20T10:07:00.000Z',
					lastEventType: 'StopListUpdate',
					lastError: null
				}
			})
		)
	})

	it('supports legacy plain apiLogin metadata', () => {
		const result = service.parseStoredMetadata({
			apiLogin: 'legacy-login',
			organizationId: 'organization-1',
			importImages: true
		})

		expect(result.apiLogin).toBe('legacy-login')
		expect(result.externalMenuId).toBeNull()
		expect(result.terminalGroupId).toBeNull()
		expect(result.exportOrders).toBe(false)
		expect(result.orderExportServiceType).toBeNull()
		expect(result.menuVersion).toBe(4)
		expect(result.syncSource).toBe('external_menu')
		expect(result.webhook).toEqual({
			enabled: false,
			urlPreview: null,
			secretHash: null,
			filterHash: null,
			lastConfiguredAt: null,
			lastReceivedAt: null,
			lastEventType: null,
			lastError: null
		})
	})

	it('masks apiLogin preview', () => {
		expect(maskApiLogin('secret-login')).toBe('secr***ogin')
	})
})

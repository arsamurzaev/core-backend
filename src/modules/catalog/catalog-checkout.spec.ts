import { CartCheckoutMethod, ContactType } from '@generated/enums'
import { BadRequestException } from '@nestjs/common'

import {
	normalizeCartCheckoutData,
	normalizeCatalogCheckoutSettings,
	resolveCatalogCheckoutConfig,
	resolveCheckoutAvailableMethods,
	resolveCheckoutContactsSnapshot
} from './catalog-checkout'

describe('catalog checkout helpers', () => {
	it('resolves checkout method presets by catalog type', () => {
		expect(resolveCheckoutAvailableMethods('restaurant')).toEqual([
			CartCheckoutMethod.DELIVERY,
			CartCheckoutMethod.PICKUP,
			CartCheckoutMethod.PREORDER
		])
		expect(resolveCheckoutAvailableMethods('cafe')).toEqual([
			CartCheckoutMethod.DELIVERY,
			CartCheckoutMethod.PICKUP,
			CartCheckoutMethod.PREORDER
		])
		expect(resolveCheckoutAvailableMethods('clothes')).toEqual([
			CartCheckoutMethod.DELIVERY,
			CartCheckoutMethod.PICKUP
		])
		expect(resolveCheckoutAvailableMethods('wholesale')).toEqual([
			CartCheckoutMethod.DELIVERY,
			CartCheckoutMethod.PICKUP
		])
	})

	it('resolves default enabled methods by catalog type', () => {
		expect(
			resolveCatalogCheckoutConfig({ typeCode: 'restaurant' }).enabledMethods
		).toEqual([CartCheckoutMethod.DELIVERY, CartCheckoutMethod.PICKUP])
		expect(
			resolveCatalogCheckoutConfig({ typeCode: 'cafe' }).enabledMethods
		).toEqual([CartCheckoutMethod.DELIVERY, CartCheckoutMethod.PICKUP])
		expect(
			resolveCatalogCheckoutConfig({ typeCode: 'wholesale' }).enabledMethods
		).toEqual([])
		expect(
			resolveCatalogCheckoutConfig({ typeCode: 'clothes' }).enabledMethods
		).toEqual([])
	})

	it('keeps explicit empty enabled methods', () => {
		expect(
			normalizeCatalogCheckoutSettings({ enabledMethods: [] }, 'restaurant')
		).toEqual({
			enabledMethods: []
		})
		expect(
			resolveCatalogCheckoutConfig({
				typeCode: 'restaurant',
				checkout: { enabledMethods: [] }
			}).enabledMethods
		).toEqual([])
	})

	it('uses catalog contacts unless a method has custom checkout contacts', () => {
		const config = resolveCatalogCheckoutConfig({
			typeCode: 'restaurant',
			checkout: {
				methodContacts: {
					DELIVERY: {
						TELEGRAM: '@delivery'
					}
				}
			}
		})

		expect(config).not.toHaveProperty('defaultMethod')
		expect(config).not.toHaveProperty('pickup')

		expect(
			resolveCheckoutContactsSnapshot({
				catalogContacts: [
					{ type: ContactType.PHONE, value: '+79990000000' },
					{ type: ContactType.WHATSAPP, value: '+79991111111' }
				],
				config,
				method: CartCheckoutMethod.PICKUP
			})
		).toEqual({
			[ContactType.PHONE]: '+79990000000',
			[ContactType.WHATSAPP]: '+79991111111'
		})

		expect(
			resolveCheckoutContactsSnapshot({
				catalogContacts: [{ type: ContactType.PHONE, value: '+79990000000' }],
				config,
				method: CartCheckoutMethod.DELIVERY
			})
		).toEqual({
			[ContactType.TELEGRAM]: '@delivery'
		})
	})

	it('requires client address for delivery checkout', () => {
		const config = resolveCatalogCheckoutConfig({
			typeCode: 'wholesale',
			checkout: { enabledMethods: [CartCheckoutMethod.DELIVERY] }
		})

		expect(() =>
			normalizeCartCheckoutData({
				config,
				method: CartCheckoutMethod.DELIVERY,
				data: {}
			})
		).toThrow(BadRequestException)

		expect(
			normalizeCartCheckoutData({
				catalogAddress: 'Main street, 1',
				config,
				method: CartCheckoutMethod.DELIVERY,
				data: {
					address: 'Client street, 2',
					customerName: 'Ivan',
					phone: '+79990000000'
				}
			})
		).toEqual({
			checkoutMethod: CartCheckoutMethod.DELIVERY,
			checkoutData: {
				address: 'Client street, 2',
				customerName: 'Ivan',
				phone: '+79990000000'
			}
		})
	})

	it('keeps catalog address and map url snapshot for pickup', () => {
		const config = resolveCatalogCheckoutConfig({
			typeCode: 'clothes',
			checkout: { enabledMethods: [CartCheckoutMethod.PICKUP] }
		})

		expect(
			normalizeCartCheckoutData({
				catalogAddress: 'Main street, 1',
				config,
				data: { customerName: 'Ivan', phone: '+79990000000' },
				mapUrl: 'https://yandex.ru/maps/-/test',
				method: CartCheckoutMethod.PICKUP
			})
		).toEqual({
			checkoutMethod: CartCheckoutMethod.PICKUP,
			checkoutData: {
				address: 'Main street, 1',
				customerName: 'Ivan',
				phone: '+79990000000',
				mapUrl: 'https://yandex.ru/maps/-/test'
			}
		})
	})

	it('requires persons count and keeps optional visit time for preorder', () => {
		const config = resolveCatalogCheckoutConfig({
			typeCode: 'restaurant',
			checkout: { enabledMethods: [CartCheckoutMethod.PREORDER] }
		})

		expect(() =>
			normalizeCartCheckoutData({
				config,
				method: CartCheckoutMethod.PREORDER,
				data: {}
			})
		).toThrow(BadRequestException)

		expect(
			normalizeCartCheckoutData({
				config,
				method: CartCheckoutMethod.PREORDER,
				data: {
					customerName: 'Ivan',
					personsCount: '4',
					phone: '+79990000000',
					visitTime: '19:30'
				}
			})
		).toEqual({
			checkoutMethod: CartCheckoutMethod.PREORDER,
			checkoutData: {
				customerName: 'Ivan',
				guestsCount: 4,
				personsCount: 4,
				phone: '+79990000000',
				visitTime: '19:30'
			}
		})
	})

	it('accepts hall checkout with protected integration payload token', () => {
		const config = resolveCatalogCheckoutConfig({ typeCode: 'restaurant' })

		expect(
			normalizeCartCheckoutData({
				config,
				data: {
					customerName: 'Ivan',
					h: 'ip1.test.encrypted',
					integrationPayloadToken: 'ip1.test.encrypted',
					orderMode: 'HALL',
					table: '11',
					tableName: 'Table 11'
				}
			})
		).toEqual({
			checkoutMethod: CartCheckoutMethod.PICKUP,
			checkoutData: {
				customerName: 'Ivan',
				h: 'ip1.test.encrypted',
				integrationPayloadToken: 'ip1.test.encrypted',
				orderMode: 'HALL',
				table: '11',
				tableName: 'Table 11'
			}
		})
	})

	it('accepts hall checkout with backend-stored table code', () => {
		const config = resolveCatalogCheckoutConfig({ typeCode: 'restaurant' })

		expect(
			normalizeCartCheckoutData({
				config,
				data: {
					customerName: 'Ivan',
					orderMode: 'HALL',
					t: 'Ab7Kp92x',
					table: '11'
				}
			})
		).toEqual({
			checkoutMethod: CartCheckoutMethod.PICKUP,
			checkoutData: {
				customerName: 'Ivan',
				orderMode: 'HALL',
				t: 'Ab7Kp92x',
				table: '11'
			}
		})
	})

	it('allows checkout without method when all methods are disabled', () => {
		const config = resolveCatalogCheckoutConfig({ typeCode: 'wholesale' })

		expect(
			normalizeCartCheckoutData({
				config,
				data: { address: 'Client street, 2' }
			})
		).toEqual({
			checkoutMethod: null,
			checkoutData: {}
		})
	})

	it('accepts explicit available method for integration checkout when all methods are disabled', () => {
		const config = resolveCatalogCheckoutConfig({ typeCode: 'wholesale' })

		expect(
			normalizeCartCheckoutData({
				config,
				method: CartCheckoutMethod.DELIVERY,
				data: {
					address: 'Client street, 2',
					customerName: 'Ivan',
					phone: '+79990000000'
				}
			})
		).toEqual({
			checkoutMethod: CartCheckoutMethod.DELIVERY,
			checkoutData: {
				address: 'Client street, 2',
				customerName: 'Ivan',
				phone: '+79990000000'
			}
		})
	})

	it('keeps preorder disabled by default for restaurants', () => {
		const config = resolveCatalogCheckoutConfig({ typeCode: 'restaurant' })

		expect(() =>
			normalizeCartCheckoutData({
				config,
				method: CartCheckoutMethod.PREORDER,
				data: { personsCount: 4 }
			})
		).toThrow('checkoutMethod is not enabled')
	})
})

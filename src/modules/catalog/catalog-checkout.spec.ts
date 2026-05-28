import { CartCheckoutMethod, ContactType } from '@generated/enums'
import { BadRequestException } from '@nestjs/common'

import {
	normalizeCartCheckoutData,
	normalizeCatalogCheckoutSettings,
	resolveCatalogCheckoutConfig,
	resolveCheckoutAvailableMethods,
	resolveCheckoutContactsSnapshot
} from './catalog-checkout'

function futureVisit(daysFromNow = 1): { visitDate: string; visitTime: string } {
	const date = new Date()
	date.setDate(date.getDate() + daysFromNow)
	date.setHours(19, 30, 0, 0)
	return {
		visitDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
		visitTime: '19:30'
	}
}

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
		expect(resolveCatalogCheckoutConfig({ typeCode: 'restaurant' }).preorder).toEqual({
			minLeadTimeMinutes: 30,
			maxAdvanceDays: 14
		})
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

	it('normalizes preorder checkout settings', () => {
		expect(
			normalizeCatalogCheckoutSettings(
				{
					enabledMethods: [CartCheckoutMethod.PREORDER],
					preorder: {
						minLeadTimeMinutes: '45',
						maxAdvanceDays: '21'
					}
				},
				'restaurant'
			)
		).toEqual({
			enabledMethods: [CartCheckoutMethod.PREORDER],
			preorder: {
				minLeadTimeMinutes: 45,
				maxAdvanceDays: 21
			}
		})

		expect(
			resolveCatalogCheckoutConfig({
				typeCode: 'restaurant',
				checkout: {
					preorder: {
						minLeadTimeMinutes: 60,
						maxAdvanceDays: 2
					}
				}
			}).preorder
		).toEqual({
			minLeadTimeMinutes: 60,
			maxAdvanceDays: 2
		})
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

	it('requires persons count and normalizes preorder date and time', () => {
		const config = resolveCatalogCheckoutConfig({
			typeCode: 'restaurant',
			checkout: { enabledMethods: [CartCheckoutMethod.PREORDER] }
		})
		const visit = futureVisit()

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
					...visit
				}
			})
		).toEqual({
			checkoutMethod: CartCheckoutMethod.PREORDER,
			checkoutData: {
				customerName: 'Ivan',
				guestsCount: 4,
				personsCount: 4,
				phone: '+79990000000',
				scheduledAt: `${visit.visitDate}T19:30:00.000`,
				visitDate: visit.visitDate,
				visitTime: '19:30'
			}
		})
	})

	it('keeps explicit preorder method when iiko table id is provided', () => {
		const config = resolveCatalogCheckoutConfig({
			typeCode: 'restaurant',
			checkout: { enabledMethods: [CartCheckoutMethod.PREORDER] }
		})
		const visit = futureVisit()

		expect(
			normalizeCartCheckoutData({
				config,
				method: CartCheckoutMethod.PREORDER,
				data: {
					customerName: 'Ivan',
					iikoTableId: 'table-11',
					hallTableId: 'table-11',
					hallTableName: 'Стол 11',
					hallTableNumber: '11',
					personsCount: 2,
					phone: '+79990000000',
					...visit
				}
			})
		).toEqual({
			checkoutMethod: CartCheckoutMethod.PREORDER,
			checkoutData: {
				customerName: 'Ivan',
				guestsCount: 2,
				hallTableId: 'table-11',
				hallTableName: 'Стол 11',
				hallTableNumber: '11',
				iikoTableId: 'table-11',
				personsCount: 2,
				phone: '+79990000000',
				scheduledAt: `${visit.visitDate}T19:30:00.000`,
				visitDate: visit.visitDate,
				visitTime: '19:30'
			}
		})
	})

	it('rejects preorder without schedule and past schedule', () => {
		const config = resolveCatalogCheckoutConfig({
			typeCode: 'restaurant',
			checkout: { enabledMethods: [CartCheckoutMethod.PREORDER] }
		})

		expect(() =>
			normalizeCartCheckoutData({
				config,
				method: CartCheckoutMethod.PREORDER,
				data: { personsCount: 4 }
			})
		).toThrow('visitDate and visitTime are required for preorder')

		expect(() =>
			normalizeCartCheckoutData({
				config,
				method: CartCheckoutMethod.PREORDER,
				data: {
					personsCount: 4,
					visitDate: '2020-01-01',
					visitTime: '19:30'
				}
			})
		).toThrow('preorder time must be at least 30 minutes in the future')
	})

	it('rejects preorder beyond configured max advance window', () => {
		const config = resolveCatalogCheckoutConfig({
			typeCode: 'restaurant',
			checkout: {
				enabledMethods: [CartCheckoutMethod.PREORDER],
				preorder: {
					minLeadTimeMinutes: 0,
					maxAdvanceDays: 1
				}
			}
		})
		const visit = futureVisit(3)

		expect(() =>
			normalizeCartCheckoutData({
				config,
				method: CartCheckoutMethod.PREORDER,
				data: {
					personsCount: 4,
					...visit
				}
			})
		).toThrow('preorder time must be within 1 days')
	})

	it('rejects hall checkout without table id or backend-stored table code', () => {
		const config = resolveCatalogCheckoutConfig({ typeCode: 'restaurant' })

		expect(
			() => normalizeCartCheckoutData({
				config,
				data: {
					customerName: 'Ivan',
					orderMode: 'HALL',
					table: '11',
					tableName: 'Table 11'
				}
			})
		).toThrow('iiko table id is required for hall order')
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

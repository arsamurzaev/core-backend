import {
	getInclusiveCalendarDaysUntilExpiry,
	isInclusiveExpiryActive
} from './inclusive-expiry'

describe('inclusive expiry utilities', () => {
	it('keeps an expiry date active through that whole calendar day', () => {
		const expiresAt = new Date(2026, 4, 28)

		expect(isInclusiveExpiryActive(expiresAt, new Date(2026, 4, 28, 23))).toBe(
			true
		)
		expect(isInclusiveExpiryActive(expiresAt, new Date(2026, 4, 29))).toBe(
			false
		)
	})

	it('counts calendar days including today and the expiry date', () => {
		expect(
			getInclusiveCalendarDaysUntilExpiry(
				new Date(2026, 4, 28),
				new Date(2026, 4, 25, 10)
			)
		).toBe(4)
		expect(
			getInclusiveCalendarDaysUntilExpiry(
				new Date(2026, 4, 28),
				new Date(2026, 4, 29)
			)
		).toBe(0)
	})
})

import type pg from 'pg'

import type { LegacyBusinessRow } from './source.js'

export type LegacyFinanceScanOptions = {
	businessIds: string[]
}

export type LegacyPromoCodeRow = {
	id: string
	name: string | null
	firstName: string | null
	lastName: string | null
	surName: string | null
	bet: string | null
	createdAt: Date
	updatedAt: Date
}

export type LegacySubscriptionPaymentRow = {
	id: string
	businessId: string
	dateEndLicense: Date
	datePayment: Date
	paymentAmount: number
	paymentProof: string | null
	createdAt: Date
	updatedAt: Date
}

export type LegacyPromoPaymentRow = {
	id: string
	businessId: string
	promoCodeId: string
	datePayment: Date
	paymentAmount: string | null
	paymentProof: string | null
	createdAt: Date
	updatedAt: Date
}

export type LegacyFinanceData = {
	promoCodes: LegacyPromoCodeRow[]
	subscriptionPayments: LegacySubscriptionPaymentRow[]
	promoPayments: LegacyPromoPaymentRow[]
}

export type LegacyFinanceSummary = {
	selectedBusinesses: number
	businessesWithAssignedPromoCode: number
	businessesWithSubscriptionPayments: number
	businessesWithPromoPayments: number
	referencedPromoCodes: number
	subscriptionPayments: number
	promoPayments: number
	subscriptionPaymentsWithoutProof: number
	promoPaymentsWithoutProof: number
	preview: Array<{
		businessId: string
		subscriptionPayments: number
		promoPayments: number
		promoCodeId: string | null
	}>
}

export async function loadLegacyFinanceData(
	pool: pg.Pool,
	options: LegacyFinanceScanOptions
): Promise<LegacyFinanceData> {
	if (options.businessIds.length === 0) {
		return {
			promoCodes: [],
			subscriptionPayments: [],
			promoPayments: []
		}
	}

	const businessIds = options.businessIds
	const [promoCodes, subscriptionPayments, promoPayments] = await Promise.all([
		loadLegacyPromoCodes(pool, businessIds),
		loadLegacySubscriptionPayments(pool, businessIds),
		loadLegacyPromoPayments(pool, businessIds)
	])

	return {
		promoCodes,
		subscriptionPayments,
		promoPayments
	}
}

export function analyzeLegacyFinanceData(
	businesses: LegacyBusinessRow[],
	finance: LegacyFinanceData
): LegacyFinanceSummary {
	const subscriptionPaymentCounts = countByBusinessId(
		finance.subscriptionPayments.map(payment => payment.businessId)
	)
	const promoPaymentCounts = countByBusinessId(
		finance.promoPayments.map(payment => payment.businessId)
	)

	return {
		selectedBusinesses: businesses.length,
		businessesWithAssignedPromoCode: businesses.filter(
			business => !!business.promoCodeId
		).length,
		businessesWithSubscriptionPayments: subscriptionPaymentCounts.size,
		businessesWithPromoPayments: promoPaymentCounts.size,
		referencedPromoCodes: finance.promoCodes.length,
		subscriptionPayments: finance.subscriptionPayments.length,
		promoPayments: finance.promoPayments.length,
		subscriptionPaymentsWithoutProof: finance.subscriptionPayments.filter(
			payment => !normalizeText(payment.paymentProof)
		).length,
		promoPaymentsWithoutProof: finance.promoPayments.filter(
			payment => !normalizeText(payment.paymentProof)
		).length,
		preview: businesses.slice(0, 10).map(business => ({
			businessId: business.id,
			subscriptionPayments: subscriptionPaymentCounts.get(business.id) ?? 0,
			promoPayments: promoPaymentCounts.get(business.id) ?? 0,
			promoCodeId: business.promoCodeId
		}))
	}
}

async function loadLegacyPromoCodes(
	pool: pg.Pool,
	businessIds: string[]
): Promise<LegacyPromoCodeRow[]> {
	const query = `
		SELECT DISTINCT
			p.id,
			NULLIF(BTRIM(p.name), '') AS name,
			NULLIF(BTRIM(p.first_name), '') AS "firstName",
			NULLIF(BTRIM(p.last_name), '') AS "lastName",
			NULLIF(BTRIM(p.sur_name), '') AS "surName",
			NULLIF(BTRIM(p.bet), '') AS bet,
			p.created_at AS "createdAt",
			p.updated_at AS "updatedAt"
		FROM "PromoCode" p
		WHERE p.id IN (
			SELECT DISTINCT b.business_promo_code_id
			FROM "Business" b
			WHERE b.id = ANY($1::text[])
			  AND b.business_promo_code_id IS NOT NULL
			UNION
			SELECT DISTINCT pp."promoCodeId"
			FROM "PromoCodePayment" pp
			WHERE pp.business_id = ANY($1::text[])
		)
		ORDER BY "createdAt" ASC, p.id ASC
	`

	const result = await pool.query<LegacyPromoCodeRow>(query, [businessIds])
	return result.rows
}

async function loadLegacySubscriptionPayments(
	pool: pg.Pool,
	businessIds: string[]
): Promise<LegacySubscriptionPaymentRow[]> {
	const query = `
		SELECT
			p.id,
			p.business_id AS "businessId",
			p.date_end AS "dateEndLicense",
			p.date_payment AS "datePayment",
			p.payment_amount AS "paymentAmount",
			NULLIF(BTRIM(p.payment_proof), '') AS "paymentProof",
			p.created_at AS "createdAt",
			p.updated_at AS "updatedAt"
		FROM "Payment" p
		WHERE p.business_id = ANY($1::text[])
		ORDER BY p.created_at ASC, p.id ASC
	`

	const result = await pool.query<LegacySubscriptionPaymentRow>(query, [
		businessIds
	])
	return result.rows
}

async function loadLegacyPromoPayments(
	pool: pg.Pool,
	businessIds: string[]
): Promise<LegacyPromoPaymentRow[]> {
	const query = `
		SELECT
			pp.id,
			pp.business_id AS "businessId",
			pp."promoCodeId" AS "promoCodeId",
			pp.date_payment AS "datePayment",
			NULLIF(BTRIM(pp.payment_amount), '') AS "paymentAmount",
			NULLIF(BTRIM(pp.payment_proof), '') AS "paymentProof",
			pp.created_at AS "createdAt",
			pp.updated_at AS "updatedAt"
		FROM "PromoCodePayment" pp
		WHERE pp.business_id = ANY($1::text[])
		ORDER BY pp.created_at ASC, pp.id ASC
	`

	const result = await pool.query<LegacyPromoPaymentRow>(query, [businessIds])
	return result.rows
}

function countByBusinessId(values: string[]): Map<string, number> {
	const counts = new Map<string, number>()

	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1)
	}

	return counts
}

function normalizeText(value: string | null | undefined): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

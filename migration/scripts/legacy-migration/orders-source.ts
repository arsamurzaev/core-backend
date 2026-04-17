import type pg from 'pg'

import type { LegacyBusinessRow } from './source.js'

export type LegacyOrderScanOptions = {
	businessIds: string[]
}

export type LegacyOrderRow = {
	sourceTable: string
	legacyOrderRowId: string
	businessId: string
	typeId: string | null
	legacyUserId: string | null
	status: string | null
	token: string | null
	comment: string | null
	commentByAdmin: string | null
	address: string | null
	isDelivery: boolean
	paymentMethod: string | null
	paymentProof: string[]
	products: unknown
	totalAmount: string | null
	createdAt: Date
	updatedAt: Date
}

export type LegacyOrdersData = {
	orders: LegacyOrderRow[]
}

export type LegacyOrdersSummary = {
	selectedBusinesses: number
	businessesWithOrders: number
	totalOrders: number
	ordersWithLegacyUser: number
	ordersWithAddress: number
	deliveryOrders: number
	ordersWithPaymentMethod: number
	ordersWithPaymentProof: number
	bySourceTable: Record<string, number>
	byStatus: Record<string, number>
	preview: Array<{
		legacyOrderId: string
		sourceTable: string
		businessId: string
		status: string | null
		paymentMethod: string | null
		totalAmount: string | null
	}>
}

export async function loadLegacyOrdersData(
	pool: pg.Pool,
	options: LegacyOrderScanOptions
): Promise<LegacyOrdersData> {
	if (options.businessIds.length === 0) {
		return { orders: [] }
	}

	const result = await pool.query<LegacyOrderRow>(ORDERS_QUERY, [
		options.businessIds
	])
	return { orders: result.rows }
}

export function analyzeLegacyOrdersData(
	businesses: LegacyBusinessRow[],
	data: LegacyOrdersData
): LegacyOrdersSummary {
	const ordersByBusiness = new Set(data.orders.map(order => order.businessId))

	return {
		selectedBusinesses: businesses.length,
		businessesWithOrders: ordersByBusiness.size,
		totalOrders: data.orders.length,
		ordersWithLegacyUser: data.orders.filter(order => !!order.legacyUserId)
			.length,
		ordersWithAddress: data.orders.filter(order => !!order.address).length,
		deliveryOrders: data.orders.filter(order => order.isDelivery).length,
		ordersWithPaymentMethod: data.orders.filter(order => !!order.paymentMethod)
			.length,
		ordersWithPaymentProof: data.orders.filter(
			order => order.paymentProof.length > 0
		).length,
		bySourceTable: countByKey(data.orders, order => order.sourceTable),
		byStatus: countByKey(data.orders, order => order.status ?? 'unknown'),
		preview: data.orders.slice(0, 10).map(order => ({
			legacyOrderId: buildLegacyOrderId(order),
			sourceTable: order.sourceTable,
			businessId: order.businessId,
			status: order.status,
			paymentMethod: order.paymentMethod,
			totalAmount: order.totalAmount
		}))
	}
}

export function buildLegacyOrderId(order: {
	sourceTable: string
	legacyOrderRowId: string
}): string {
	return `${order.sourceTable}:${order.legacyOrderRowId}`
}

const ORDERS_QUERY = `
	SELECT
		q."sourceTable",
		q."legacyOrderRowId",
		q."businessId",
		q."typeId",
		q."legacyUserId",
		q.status,
		q.token,
		q.comment,
		q."commentByAdmin",
		q.address,
		q."isDelivery",
		q."paymentMethod",
		q."paymentProof",
		q.products,
		q."totalAmount",
		q."createdAt",
		q."updatedAt"
	FROM (
		SELECT
			'ClothesOrder' AS "sourceTable",
			id::text AS "legacyOrderRowId",
			business_id AS "businessId",
			type_id AS "typeId",
			user_id AS "legacyUserId",
			status::text AS status,
			NULLIF(BTRIM(token), '') AS token,
			NULLIF(BTRIM(comment), '') AS comment,
			NULLIF(BTRIM(comment_by_admin), '') AS "commentByAdmin",
			NULL::text AS address,
			false AS "isDelivery",
			"paymentMethod"::text AS "paymentMethod",
			COALESCE("paymentProof", ARRAY[]::text[]) AS "paymentProof",
			products,
			total_amount::text AS "totalAmount",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "ClothesOrder"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'ConfectioneryOrder' AS "sourceTable",
			id::text AS "legacyOrderRowId",
			business_id AS "businessId",
			type_id AS "typeId",
			user_id AS "legacyUserId",
			status::text AS status,
			NULLIF(BTRIM(token), '') AS token,
			NULLIF(BTRIM(comment), '') AS comment,
			NULLIF(BTRIM(comment_by_admin), '') AS "commentByAdmin",
			NULL::text AS address,
			false AS "isDelivery",
			"paymentMethod"::text AS "paymentMethod",
			COALESCE("paymentProof", ARRAY[]::text[]) AS "paymentProof",
			products,
			total_amount::text AS "totalAmount",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "ConfectioneryOrder"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'DefaultOrder' AS "sourceTable",
			id::text AS "legacyOrderRowId",
			business_id AS "businessId",
			type_id AS "typeId",
			user_id AS "legacyUserId",
			status::text AS status,
			NULLIF(BTRIM(token), '') AS token,
			NULLIF(BTRIM(comment), '') AS comment,
			NULLIF(BTRIM(comment_by_admin), '') AS "commentByAdmin",
			NULL::text AS address,
			false AS "isDelivery",
			"paymentMethod"::text AS "paymentMethod",
			COALESCE("paymentProof", ARRAY[]::text[]) AS "paymentProof",
			products,
			total_amount::text AS "totalAmount",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "DefaultOrder"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'FlowersOrder' AS "sourceTable",
			id::text AS "legacyOrderRowId",
			business_id AS "businessId",
			type_id AS "typeId",
			user_id AS "legacyUserId",
			status::text AS status,
			NULLIF(BTRIM(token), '') AS token,
			NULLIF(BTRIM(comment), '') AS comment,
			NULLIF(BTRIM(comment_by_admin), '') AS "commentByAdmin",
			NULL::text AS address,
			false AS "isDelivery",
			"paymentMethod"::text AS "paymentMethod",
			COALESCE("paymentProof", ARRAY[]::text[]) AS "paymentProof",
			products,
			total_amount::text AS "totalAmount",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "FlowersOrder"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'GiftOrder' AS "sourceTable",
			id::text AS "legacyOrderRowId",
			business_id AS "businessId",
			type_id AS "typeId",
			user_id AS "legacyUserId",
			status::text AS status,
			NULLIF(BTRIM(token), '') AS token,
			NULLIF(BTRIM(comment), '') AS comment,
			NULLIF(BTRIM(comment_by_admin), '') AS "commentByAdmin",
			NULL::text AS address,
			false AS "isDelivery",
			"paymentMethod"::text AS "paymentMethod",
			COALESCE("paymentProof", ARRAY[]::text[]) AS "paymentProof",
			products,
			total_amount::text AS "totalAmount",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "GiftOrder"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'RestaurantOrder' AS "sourceTable",
			id::text AS "legacyOrderRowId",
			business_id AS "businessId",
			type_id AS "typeId",
			user_id AS "legacyUserId",
			status::text AS status,
			NULLIF(BTRIM(token), '') AS token,
			NULLIF(BTRIM(comment), '') AS comment,
			NULLIF(BTRIM(comment_by_admin), '') AS "commentByAdmin",
			NULLIF(BTRIM(address), '') AS address,
			is_delivery AS "isDelivery",
			"paymentMethod"::text AS "paymentMethod",
			COALESCE("paymentProof", ARRAY[]::text[]) AS "paymentProof",
			products,
			total_amount::text AS "totalAmount",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "RestaurantOrder"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'SemiFinishedProductsOrder' AS "sourceTable",
			id::text AS "legacyOrderRowId",
			business_id AS "businessId",
			type_id AS "typeId",
			user_id AS "legacyUserId",
			status::text AS status,
			NULLIF(BTRIM(token), '') AS token,
			NULLIF(BTRIM(comment), '') AS comment,
			NULLIF(BTRIM(comment_by_admin), '') AS "commentByAdmin",
			NULL::text AS address,
			false AS "isDelivery",
			"paymentMethod"::text AS "paymentMethod",
			COALESCE("paymentProof", ARRAY[]::text[]) AS "paymentProof",
			products,
			total_amount::text AS "totalAmount",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "SemiFinishedProductsOrder"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'TechnicOrder' AS "sourceTable",
			id::text AS "legacyOrderRowId",
			business_id AS "businessId",
			type_id AS "typeId",
			user_id AS "legacyUserId",
			status::text AS status,
			NULLIF(BTRIM(token), '') AS token,
			NULLIF(BTRIM(comment), '') AS comment,
			NULLIF(BTRIM(comment_by_admin), '') AS "commentByAdmin",
			NULL::text AS address,
			false AS "isDelivery",
			"paymentMethod"::text AS "paymentMethod",
			COALESCE("paymentProof", ARRAY[]::text[]) AS "paymentProof",
			products,
			total_amount::text AS "totalAmount",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "TechnicOrder"
		WHERE business_id = ANY($1::text[])

		UNION ALL

		SELECT
			'TradingBaseOrder' AS "sourceTable",
			id::text AS "legacyOrderRowId",
			business_id AS "businessId",
			type_id AS "typeId",
			user_id AS "legacyUserId",
			status::text AS status,
			NULLIF(BTRIM(token), '') AS token,
			NULLIF(BTRIM(comment), '') AS comment,
			NULLIF(BTRIM(comment_by_admin), '') AS "commentByAdmin",
			NULL::text AS address,
			false AS "isDelivery",
			"paymentMethod"::text AS "paymentMethod",
			COALESCE("paymentProof", ARRAY[]::text[]) AS "paymentProof",
			products,
			total_amount::text AS "totalAmount",
			created_at AS "createdAt",
			updated_at AS "updatedAt"
		FROM "TradingBaseOrder"
		WHERE business_id = ANY($1::text[])
	) q
	ORDER BY q."createdAt" ASC, q."sourceTable" ASC, q."legacyOrderRowId" ASC
`

function countByKey<T>(
	items: T[],
	getKey: (item: T) => string
): Record<string, number> {
	return items.reduce<Record<string, number>>((acc, item) => {
		const key = getKey(item)
		acc[key] = (acc[key] ?? 0) + 1
		return acc
	}, {})
}

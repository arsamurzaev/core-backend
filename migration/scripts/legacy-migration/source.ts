import type pg from 'pg'

export type LegacyBusinessScanOptions = {
	businessIds: string[]
	businessHosts: string[]
	limit: number | null
}

export type LegacyBusinessRow = {
	id: string
	parentId: string | null
	host: string | null
	domain: string | null
	login: string | null
	name: string | null
	about: string | null
	description: string | null
	phone: string | null
	email: string | null
	message: string | null
	whatsapp: string | null
	max: string | null
	bip: string | null
	telegram: string | null
	map: string | null
	note: string | null
	logoUrl: string | null
	bgUrl: string | null
	typeId: string | null
	typeSlug: string | null
	typeName: string | null
	activityId: string | null
	activityName: string | null
	status: string | null
	isActive: boolean
	currency: string | null
	promoCodeId: string | null
	moySckladToken: string | null
	globalYandexMetrikaId: string | null
	mainYandexMetrikaId: string | null
	yandexMetrikaId: string | null
	regionality: string[]
	regionalityCount: number
	childCount: number
	createdAt: Date
	updatedAt: Date
}

export type LegacyBusinessIssue = {
	entity: 'BUSINESS'
	legacyId: string
	severity: 'ERROR' | 'WARNING'
	code: string
	message: string
	details?: Record<string, unknown>
}

export type LegacyBusinessSummary = {
	total: number
	parents: number
	children: number
	withChildren: number
	withPromoCode: number
	withMoySklad: number
	withAnyYandexCounter: number
	missingHost: number
	missingLogin: number
	missingType: number
	duplicateLogins: number
	duplicateDomains: number
	byType: Record<string, number>
	preview: Array<{
		id: string
		parentId: string | null
		host: string | null
		login: string | null
		typeSlug: string | null
		childCount: number
	}>
}

export async function loadLegacyBusinesses(
	pool: pg.Pool,
	options: LegacyBusinessScanOptions
): Promise<LegacyBusinessRow[]> {
	const values: unknown[] = []
	const filters: string[] = []

	if (options.businessIds.length > 0) {
		values.push(options.businessIds)
		filters.push(`b.id = ANY($${values.length}::text[])`)
	}

	if (options.businessHosts.length > 0) {
		values.push(options.businessHosts)
		filters.push(`BTRIM(b.host) = ANY($${values.length}::text[])`)
	}

	const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''

	let limitClause = ''
	if (options.limit !== null) {
		values.push(options.limit)
		limitClause = `LIMIT $${values.length}`
	}

	const query = `
		SELECT
			b.id,
			b.business_id AS "parentId",
			NULLIF(BTRIM(b.host), '') AS host,
			NULLIF(BTRIM(b.domain), '') AS domain,
			NULLIF(BTRIM(b.login), '') AS login,
			NULLIF(BTRIM(b.name), '') AS name,
			NULLIF(BTRIM(b.about), '') AS about,
			NULLIF(BTRIM(b.description), '') AS description,
			NULLIF(BTRIM(b.phone), '') AS phone,
			NULLIF(BTRIM(b.email), '') AS email,
			NULLIF(BTRIM(b.message), '') AS message,
			NULLIF(BTRIM(b.whatsapp), '') AS whatsapp,
			NULLIF(BTRIM(b.max), '') AS max,
			NULLIF(BTRIM(b.bip), '') AS bip,
			NULLIF(BTRIM(b.telegram), '') AS telegram,
			NULLIF(BTRIM(b.map), '') AS map,
			NULLIF(BTRIM(b.note), '') AS note,
			NULLIF(BTRIM(b.logo_url), '') AS "logoUrl",
			NULLIF(BTRIM(b.bg_url), '') AS "bgUrl",
			b.type_id AS "typeId",
			t.slug::text AS "typeSlug",
			t.name AS "typeName",
			b.activity_id AS "activityId",
			a.name AS "activityName",
			b.status::text AS status,
			b.is_active AS "isActive",
			NULLIF(BTRIM(b.currency), '') AS currency,
			b.business_promo_code_id AS "promoCodeId",
			NULLIF(BTRIM(b."moySckladToken"), '') AS "moySckladToken",
			NULLIF(BTRIM(b."globalYandexMetrikaId"), '') AS "globalYandexMetrikaId",
			NULLIF(BTRIM(b."mainYandexMetrikaId"), '') AS "mainYandexMetrikaId",
			NULLIF(BTRIM(b."yandexMetrikaId"), '') AS "yandexMetrikaId",
			COALESCE(b.regionality, ARRAY[]::text[]) AS regionality,
			COALESCE(array_length(b.regionality, 1), 0)::int AS "regionalityCount",
			COUNT(c.id)::int AS "childCount",
			b.created_at AS "createdAt",
			b.updated_at AS "updatedAt"
		FROM "Business" b
		LEFT JOIN "Type" t ON t.id = b.type_id
		LEFT JOIN "Activity" a ON a.id = b.activity_id
		LEFT JOIN "Business" c ON c.business_id = b.id
		${whereClause}
		GROUP BY
			b.id,
			b.business_id,
			b.host,
			b.domain,
			b.login,
			b.name,
			b.about,
			b.description,
			b.phone,
			b.email,
			b.message,
			b.whatsapp,
			b.max,
			b.bip,
			b.telegram,
			b.map,
			b.note,
			b.logo_url,
			b.bg_url,
			b.type_id,
			t.slug,
			t.name,
			b.activity_id,
			a.name,
			b.status,
			b.is_active,
			b.currency,
			b.business_promo_code_id,
			b."moySckladToken",
			b."globalYandexMetrikaId",
			b."mainYandexMetrikaId",
			b."yandexMetrikaId",
			b.regionality,
			b.created_at,
			b.updated_at
		ORDER BY b.created_at ASC, b.id ASC
		${limitClause}
	`

	const result = await pool.query<LegacyBusinessRow>(query, values)
	return result.rows
}

export function analyzeLegacyBusinesses(
	rows: LegacyBusinessRow[]
): LegacyBusinessSummary {
	const byType = rows.reduce<Record<string, number>>((acc, row) => {
		const key = row.typeSlug ?? 'unknown'
		acc[key] = (acc[key] ?? 0) + 1
		return acc
	}, {})

	const duplicateLogins = countDuplicateValues(rows.map(row => row.login))
	const duplicateDomains = countDuplicateValues(rows.map(row => row.domain))

	return {
		total: rows.length,
		parents: rows.filter(row => !row.parentId).length,
		children: rows.filter(row => !!row.parentId).length,
		withChildren: rows.filter(row => row.childCount > 0).length,
		withPromoCode: rows.filter(row => !!row.promoCodeId).length,
		withMoySklad: rows.filter(row => !!row.moySckladToken).length,
		withAnyYandexCounter: rows.filter(
			row =>
				!!row.globalYandexMetrikaId ||
				!!row.mainYandexMetrikaId ||
				!!row.yandexMetrikaId
		).length,
		missingHost: rows.filter(row => !row.host).length,
		missingLogin: rows.filter(row => !row.login).length,
		missingType: rows.filter(row => !row.typeId || !row.typeSlug).length,
		duplicateLogins,
		duplicateDomains,
		byType,
		preview: rows.slice(0, 10).map(row => ({
			id: row.id,
			parentId: row.parentId,
			host: row.host,
			login: row.login,
			typeSlug: row.typeSlug,
			childCount: row.childCount
		}))
	}
}

export function collectLegacyBusinessIssues(
	rows: LegacyBusinessRow[]
): LegacyBusinessIssue[] {
	const issues: LegacyBusinessIssue[] = []
	const duplicateLogins = collectDuplicateValues(rows, row => row.login)
	const duplicateDomains = collectDuplicateValues(rows, row => row.domain)

	for (const row of rows) {
		if (!row.host) {
			issues.push({
				entity: 'BUSINESS',
				legacyId: row.id,
				severity: 'ERROR',
				code: 'MISSING_HOST',
				message: 'У legacy business отсутствует host',
				details: { login: row.login, parentId: row.parentId }
			})
		}

		if (!row.login) {
			issues.push({
				entity: 'BUSINESS',
				legacyId: row.id,
				severity: 'ERROR',
				code: 'MISSING_LOGIN',
				message: 'У legacy business отсутствует login',
				details: { host: row.host, parentId: row.parentId }
			})
		}

		if (!row.typeId || !row.typeSlug) {
			issues.push({
				entity: 'BUSINESS',
				legacyId: row.id,
				severity: 'ERROR',
				code: 'MISSING_TYPE',
				message: 'У legacy business отсутствует связанный тип',
				details: { host: row.host, login: row.login, typeId: row.typeId }
			})
		}

		if (!row.name) {
			issues.push({
				entity: 'BUSINESS',
				legacyId: row.id,
				severity: 'WARNING',
				code: 'EMPTY_NAME',
				message: 'У legacy business пустое имя',
				details: { host: row.host, login: row.login }
			})
		}

		if (row.login && duplicateLogins.has(normalizeKey(row.login))) {
			issues.push({
				entity: 'BUSINESS',
				legacyId: row.id,
				severity: 'WARNING',
				code: 'DUPLICATE_LOGIN',
				message: 'Login встречается у нескольких legacy business',
				details: { login: row.login }
			})
		}

		if (row.domain && duplicateDomains.has(normalizeKey(row.domain))) {
			issues.push({
				entity: 'BUSINESS',
				legacyId: row.id,
				severity: 'WARNING',
				code: 'DUPLICATE_DOMAIN',
				message: 'Domain встречается у нескольких legacy business',
				details: { domain: row.domain }
			})
		}
	}

	return issues
}

function countDuplicateValues(values: Array<string | null>): number {
	return collectDuplicateValues(
		values.map(value => ({ value })),
		item => item.value
	).size
}

function collectDuplicateValues<T>(
	items: T[],
	getValue: (item: T) => string | null
): Set<string> {
	const counts = new Map<string, number>()

	for (const item of items) {
		const key = normalizeKey(getValue(item))
		if (!key) continue
		counts.set(key, (counts.get(key) ?? 0) + 1)
	}

	return new Set(
		Array.from(counts.entries())
			.filter(([, count]) => count > 1)
			.map(([key]) => key)
	)
}

function normalizeKey(value: string | null): string | null {
	if (!value) return null
	const normalized = value.trim().toLowerCase()
	return normalized.length > 0 ? normalized : null
}

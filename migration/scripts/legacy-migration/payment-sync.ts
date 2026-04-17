import {
	MigrationEntityKind,
	MigrationIssueSeverity,
	PaymentKind,
	Prisma,
	PrismaClient
} from '../../../prisma/generated/client.js'

import { runMigrationTransaction } from './migration-utils.js'
import type {
	LegacyFinanceData,
	LegacyPromoCodeRow,
	LegacyPromoPaymentRow,
	LegacySubscriptionPaymentRow
} from './payments-source.js'
import type { LegacyBusinessRow } from './source.js'

type ApplyLegacyPaymentsOptions = {
	runId: string
	source: string
}

type LegacyPaymentIssue = {
	entity: MigrationEntityKind
	legacyId: string
	severity: MigrationIssueSeverity
	code: string
	message: string
	details?: Prisma.InputJsonValue
}

type ApplyLegacyPaymentsSummary = {
	processedBusinesses: number
	createdPromoCodes: number
	reusedPromoCodes: number
	assignedCatalogPromoCodes: number
	clearedCatalogPromoCodes: number
	createdPayments: number
	reusedPayments: number
	subscriptionPayments: number
	promoPayments: number
	updatedSubscriptionCatalogs: number
	skippedPayments: number
	skippedPromoPayments: number
}

type ApplyLegacyPaymentsResult = {
	summary: ApplyLegacyPaymentsSummary
	issues: LegacyPaymentIssue[]
}

type ExistingEntityMap = {
	id: string
	legacyId: string
	targetId: string
	payload: Prisma.JsonValue | null
}

type UpsertPromoCodeResult = {
	targetPromoCodeId: string
	created: boolean
}

type UpsertPaymentResult = {
	targetPaymentId: string
	created: boolean
}

export async function collectLegacyPaymentIssues(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	finance: LegacyFinanceData,
	source: string
): Promise<LegacyPaymentIssue[]> {
	const issues: LegacyPaymentIssue[] = []
	const relevantBusinessIds = collectRelevantBusinessIds(businesses, finance)
	const mappedBusinessIds = await loadMappedLegacyIds(
		prisma,
		source,
		MigrationEntityKind.BUSINESS,
		relevantBusinessIds
	)

	for (const businessId of relevantBusinessIds) {
		if (mappedBusinessIds.has(businessId)) continue

		issues.push({
			entity: MigrationEntityKind.PAYMENT,
			legacyId: businessId,
			severity: MigrationIssueSeverity.ERROR,
			code: 'CATALOG_MAPPING_MISSING',
			message:
				'Для legacy business не найден mapping в target Catalog. Сначала выполните фазу catalog-bootstrap.',
			details: {
				legacyBusinessId: businessId
			} satisfies Prisma.InputJsonValue
		})
	}

	const availablePromoCodeIds = new Set(finance.promoCodes.map(code => code.id))
	for (const promoCodeId of collectReferencedPromoCodeIds(businesses, finance)) {
		if (availablePromoCodeIds.has(promoCodeId)) continue

		issues.push({
			entity: MigrationEntityKind.PROMO_CODE,
			legacyId: promoCodeId,
			severity: MigrationIssueSeverity.ERROR,
			code: 'PROMO_CODE_MISSING',
			message:
				'Legacy promo code referenced by business or promo payment was not found in source database.',
			details: {
				legacyPromoCodeId: promoCodeId
			} satisfies Prisma.InputJsonValue
		})
	}

	for (const promoCode of finance.promoCodes) {
		if (normalizeText(promoCode.name)) continue

		issues.push({
			entity: MigrationEntityKind.PROMO_CODE,
			legacyId: promoCode.id,
			severity: MigrationIssueSeverity.ERROR,
			code: 'PROMO_CODE_NAME_MISSING',
			message:
				'Legacy promo code has an empty name and cannot be created in target.',
			details: {
				firstName: promoCode.firstName,
				lastName: promoCode.lastName,
				surName: promoCode.surName
			} satisfies Prisma.InputJsonValue
		})
	}

	for (const payment of finance.promoPayments) {
		if (parseDecimal(payment.paymentAmount) !== null) continue

		issues.push({
			entity: MigrationEntityKind.PAYMENT,
			legacyId: buildPaymentLegacyId('promo', payment.id),
			severity: MigrationIssueSeverity.WARNING,
			code: 'PROMO_PAYMENT_AMOUNT_INVALID',
			message:
				'Promo payment amount could not be parsed into Decimal and will be stored only in metadata.',
			details: {
				legacyPaymentId: payment.id,
				rawAmount: payment.paymentAmount
			} satisfies Prisma.InputJsonValue
		})
	}

	return issues
}

export async function applyLegacyPayments(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	finance: LegacyFinanceData,
	options: ApplyLegacyPaymentsOptions
): Promise<ApplyLegacyPaymentsResult> {
	const issues: LegacyPaymentIssue[] = []
	const businessIds = businesses.map(business => business.id)
	const businessMapByLegacyId = await loadEntityMapByLegacyId(
		prisma,
		options.source,
		MigrationEntityKind.BUSINESS,
		businessIds
	)

	const promoCodeRowsById = new Map(
		finance.promoCodes.map(promoCode => [promoCode.id, promoCode])
	)
	const targetPromoCodeIdByLegacyId = new Map<string, string>()

	let createdPromoCodes = 0
	let reusedPromoCodes = 0
	let assignedCatalogPromoCodes = 0
	let clearedCatalogPromoCodes = 0
	let createdPayments = 0
	let reusedPayments = 0
	let skippedPayments = 0
	let skippedPromoPayments = 0

	for (const promoCodeId of collectReferencedPromoCodeIds(businesses, finance)) {
		const promoCode = promoCodeRowsById.get(promoCodeId)
		if (!promoCode) {
			issues.push({
				entity: MigrationEntityKind.PROMO_CODE,
				legacyId: promoCodeId,
				severity: MigrationIssueSeverity.ERROR,
				code: 'PROMO_CODE_MISSING',
				message:
					'Legacy promo code referenced during apply was not found in loaded source rows.',
				details: {
					legacyPromoCodeId: promoCodeId
				} satisfies Prisma.InputJsonValue
			})
			continue
		}

		const result = await runMigrationTransaction(prisma, async tx => {
			return upsertPromoCode(tx, promoCode, options)
		})

		targetPromoCodeIdByLegacyId.set(promoCodeId, result.targetPromoCodeId)
		if (result.created) {
			createdPromoCodes += 1
		} else {
			reusedPromoCodes += 1
		}
	}

	for (const business of businesses) {
		const businessMap = businessMapByLegacyId.get(business.id)
		if (!businessMap) continue

		const targetPromoCodeId = business.promoCodeId
			? (targetPromoCodeIdByLegacyId.get(business.promoCodeId) ?? null)
			: null

		if (business.promoCodeId && !targetPromoCodeId) {
			issues.push({
				entity: MigrationEntityKind.CATALOG,
				legacyId: business.id,
				severity: MigrationIssueSeverity.ERROR,
				code: 'CATALOG_PROMO_CODE_MISSING',
				message:
					'Catalog promo code reference could not be resolved in target database.',
				details: {
					legacyPromoCodeId: business.promoCodeId
				} satisfies Prisma.InputJsonValue
			})
			continue
		}

		await prisma.catalog.update({
			where: { id: businessMap.targetId },
			data: {
				promoCodeId: targetPromoCodeId
			}
		})

		if (targetPromoCodeId) {
			assignedCatalogPromoCodes += 1
		} else {
			clearedCatalogPromoCodes += 1
		}
	}

	const latestSubscriptionEndsAtByCatalog = new Map<string, Date>()

	for (const payment of finance.subscriptionPayments) {
		const businessMap = businessMapByLegacyId.get(payment.businessId)
		if (!businessMap) {
			skippedPayments += 1
			issues.push({
				entity: MigrationEntityKind.PAYMENT,
				legacyId: buildPaymentLegacyId('subscription', payment.id),
				severity: MigrationIssueSeverity.ERROR,
				code: 'PAYMENT_SKIPPED_NO_CATALOG',
				message:
					'Legacy subscription payment was skipped because target catalog mapping is missing.',
				details: {
					legacyBusinessId: payment.businessId
				} satisfies Prisma.InputJsonValue
			})
			continue
		}

		const result = await runMigrationTransaction(prisma, async tx => {
			return upsertSubscriptionPayment(tx, payment, businessMap.targetId, options)
		})

		if (result.created) {
			createdPayments += 1
		} else {
			reusedPayments += 1
		}

		const currentMax = latestSubscriptionEndsAtByCatalog.get(businessMap.targetId)
		if (!currentMax || payment.dateEndLicense > currentMax) {
			latestSubscriptionEndsAtByCatalog.set(
				businessMap.targetId,
				payment.dateEndLicense
			)
		}
	}

	for (const payment of finance.promoPayments) {
		const businessMap = businessMapByLegacyId.get(payment.businessId)
		if (!businessMap) {
			skippedPromoPayments += 1
			issues.push({
				entity: MigrationEntityKind.PAYMENT,
				legacyId: buildPaymentLegacyId('promo', payment.id),
				severity: MigrationIssueSeverity.ERROR,
				code: 'PROMO_PAYMENT_SKIPPED_NO_CATALOG',
				message:
					'Legacy promo payment was skipped because target catalog mapping is missing.',
				details: {
					legacyBusinessId: payment.businessId
				} satisfies Prisma.InputJsonValue
			})
			continue
		}

		const targetPromoCodeId = targetPromoCodeIdByLegacyId.get(payment.promoCodeId)
		if (!targetPromoCodeId) {
			skippedPromoPayments += 1
			issues.push({
				entity: MigrationEntityKind.PAYMENT,
				legacyId: buildPaymentLegacyId('promo', payment.id),
				severity: MigrationIssueSeverity.ERROR,
				code: 'PROMO_PAYMENT_SKIPPED_NO_PROMO_CODE',
				message:
					'Legacy promo payment was skipped because promo code mapping is missing.',
				details: {
					legacyBusinessId: payment.businessId,
					legacyPromoCodeId: payment.promoCodeId
				} satisfies Prisma.InputJsonValue
			})
			continue
		}

		const result = await runMigrationTransaction(prisma, async tx => {
			return upsertPromoPayment(
				tx,
				payment,
				businessMap.targetId,
				targetPromoCodeId,
				options
			)
		})

		if (result.created) {
			createdPayments += 1
		} else {
			reusedPayments += 1
		}
	}

	for (const [
		catalogId,
		subscriptionEndsAt
	] of latestSubscriptionEndsAtByCatalog) {
		await prisma.catalog.update({
			where: { id: catalogId },
			data: { subscriptionEndsAt }
		})
	}

	return {
		summary: {
			processedBusinesses: businesses.length,
			createdPromoCodes,
			reusedPromoCodes,
			assignedCatalogPromoCodes,
			clearedCatalogPromoCodes,
			createdPayments,
			reusedPayments,
			subscriptionPayments: finance.subscriptionPayments.length,
			promoPayments: finance.promoPayments.length,
			updatedSubscriptionCatalogs: latestSubscriptionEndsAtByCatalog.size,
			skippedPayments,
			skippedPromoPayments
		},
		issues
	}
}

async function upsertPromoCode(
	tx: Prisma.TransactionClient,
	promoCode: LegacyPromoCodeRow,
	options: ApplyLegacyPaymentsOptions
): Promise<UpsertPromoCodeResult> {
	const legacyMap = await findEntityMap(
		tx,
		options.source,
		MigrationEntityKind.PROMO_CODE,
		promoCode.id
	)
	const existingByMap = legacyMap
		? await tx.promoCode.findFirst({
				where: { id: legacyMap.targetId },
				select: { id: true }
			})
		: null

	const normalizedName =
		normalizeText(promoCode.name) ?? `legacy-promo-${promoCode.id.slice(0, 8)}`

	const existingByName = existingByMap
		? null
		: await tx.promoCode.findFirst({
				where: { name: normalizedName },
				select: { id: true }
			})

	const existingPromoCode = existingByMap ?? existingByName

	if (existingPromoCode) {
		await tx.promoCode.update({
			where: { id: existingPromoCode.id },
			data: {
				name: normalizedName,
				firstName: promoCode.firstName ?? '',
				lastName: promoCode.lastName ?? '',
				surName: promoCode.surName ?? '',
				bet: promoCode.bet ?? '',
				deleteAt: null
			}
		})

		await upsertEntityMap(tx, {
			runId: options.runId,
			source: options.source,
			entity: MigrationEntityKind.PROMO_CODE,
			legacyId: promoCode.id,
			targetId: existingPromoCode.id,
			payload: {
				name: normalizedName
			}
		})

		return {
			targetPromoCodeId: existingPromoCode.id,
			created: false
		}
	}

	const createdPromoCode = await tx.promoCode.create({
		data: {
			name: normalizedName,
			firstName: promoCode.firstName ?? '',
			lastName: promoCode.lastName ?? '',
			surName: promoCode.surName ?? '',
			bet: promoCode.bet ?? '',
			createdAt: promoCode.createdAt
		},
		select: { id: true }
	})

	await upsertEntityMap(tx, {
		runId: options.runId,
		source: options.source,
		entity: MigrationEntityKind.PROMO_CODE,
		legacyId: promoCode.id,
		targetId: createdPromoCode.id,
		payload: {
			name: normalizedName
		}
	})

	return {
		targetPromoCodeId: createdPromoCode.id,
		created: true
	}
}

async function upsertSubscriptionPayment(
	tx: Prisma.TransactionClient,
	payment: LegacySubscriptionPaymentRow,
	catalogId: string,
	options: ApplyLegacyPaymentsOptions
): Promise<UpsertPaymentResult> {
	const legacyId = buildPaymentLegacyId('subscription', payment.id)
	const existingMap = await findEntityMap(
		tx,
		options.source,
		MigrationEntityKind.PAYMENT,
		legacyId
	)
	const existingPayment = existingMap
		? await tx.payment.findFirst({
				where: { id: existingMap.targetId },
				select: { id: true }
			})
		: null

	const data = {
		kind: PaymentKind.SUBSCRIPTION,
		catalogId,
		promoCodeId: null,
		paidAt: payment.datePayment,
		amount: new Prisma.Decimal(payment.paymentAmount),
		licenseEndsAt: payment.dateEndLicense,
		proofUrl: normalizeText(payment.paymentProof),
		metadata: buildPaymentMetadata('Payment', payment, {
			legacyBusinessId: payment.businessId
		}),
		deleteAt: null
	} satisfies Prisma.PaymentUncheckedCreateInput

	if (existingPayment) {
		await tx.payment.update({
			where: { id: existingPayment.id },
			data
		})

		await upsertEntityMap(tx, {
			runId: options.runId,
			source: options.source,
			entity: MigrationEntityKind.PAYMENT,
			legacyId,
			targetId: existingPayment.id,
			payload: {
				legacyTable: 'Payment',
				rawLegacyId: payment.id,
				legacyBusinessId: payment.businessId
			}
		})

		return {
			targetPaymentId: existingPayment.id,
			created: false
		}
	}

	const createdPayment = await tx.payment.create({
		data: {
			...data,
			createdAt: payment.createdAt
		},
		select: { id: true }
	})

	await upsertEntityMap(tx, {
		runId: options.runId,
		source: options.source,
		entity: MigrationEntityKind.PAYMENT,
		legacyId,
		targetId: createdPayment.id,
		payload: {
			legacyTable: 'Payment',
			rawLegacyId: payment.id,
			legacyBusinessId: payment.businessId
		}
	})

	return {
		targetPaymentId: createdPayment.id,
		created: true
	}
}

async function upsertPromoPayment(
	tx: Prisma.TransactionClient,
	payment: LegacyPromoPaymentRow,
	catalogId: string,
	targetPromoCodeId: string,
	options: ApplyLegacyPaymentsOptions
): Promise<UpsertPaymentResult> {
	const legacyId = buildPaymentLegacyId('promo', payment.id)
	const existingMap = await findEntityMap(
		tx,
		options.source,
		MigrationEntityKind.PAYMENT,
		legacyId
	)
	const existingPayment = existingMap
		? await tx.payment.findFirst({
				where: { id: existingMap.targetId },
				select: { id: true }
			})
		: null

	const amount = parseDecimal(payment.paymentAmount)
	const data = {
		kind: PaymentKind.PROMOCODE,
		catalogId,
		promoCodeId: targetPromoCodeId,
		paidAt: payment.datePayment,
		amount,
		licenseEndsAt: null,
		proofUrl: normalizeText(payment.paymentProof),
		metadata: buildPaymentMetadata('PromoCodePayment', payment, {
			legacyBusinessId: payment.businessId,
			legacyPromoCodeId: payment.promoCodeId,
			legacyPaymentAmountRaw: payment.paymentAmount
		}),
		deleteAt: null
	} satisfies Prisma.PaymentUncheckedCreateInput

	if (existingPayment) {
		await tx.payment.update({
			where: { id: existingPayment.id },
			data
		})

		await upsertEntityMap(tx, {
			runId: options.runId,
			source: options.source,
			entity: MigrationEntityKind.PAYMENT,
			legacyId,
			targetId: existingPayment.id,
			payload: {
				legacyTable: 'PromoCodePayment',
				rawLegacyId: payment.id,
				legacyBusinessId: payment.businessId,
				legacyPromoCodeId: payment.promoCodeId
			}
		})

		return {
			targetPaymentId: existingPayment.id,
			created: false
		}
	}

	const createdPayment = await tx.payment.create({
		data: {
			...data,
			createdAt: payment.createdAt
		},
		select: { id: true }
	})

	await upsertEntityMap(tx, {
		runId: options.runId,
		source: options.source,
		entity: MigrationEntityKind.PAYMENT,
		legacyId,
		targetId: createdPayment.id,
		payload: {
			legacyTable: 'PromoCodePayment',
			rawLegacyId: payment.id,
			legacyBusinessId: payment.businessId,
			legacyPromoCodeId: payment.promoCodeId
		}
	})

	return {
		targetPaymentId: createdPayment.id,
		created: true
	}
}

async function loadMappedLegacyIds(
	prisma: PrismaClient,
	source: string,
	entity: MigrationEntityKind,
	legacyIds: string[]
): Promise<Set<string>> {
	if (legacyIds.length === 0) return new Set()

	const mappings = await prisma.migrationEntityMap.findMany({
		where: {
			source,
			entity,
			legacyId: { in: legacyIds }
		},
		select: { legacyId: true }
	})

	return new Set(mappings.map(mapping => mapping.legacyId))
}

async function loadEntityMapByLegacyId(
	prisma: PrismaClient,
	source: string,
	entity: MigrationEntityKind,
	legacyIds: string[]
): Promise<Map<string, ExistingEntityMap>> {
	if (legacyIds.length === 0) return new Map()

	const mappings = await prisma.migrationEntityMap.findMany({
		where: {
			source,
			entity,
			legacyId: { in: legacyIds }
		},
		select: {
			id: true,
			legacyId: true,
			targetId: true,
			payload: true
		}
	})

	return new Map(mappings.map(mapping => [mapping.legacyId, mapping]))
}

async function findEntityMap(
	tx: Prisma.TransactionClient,
	source: string,
	entity: MigrationEntityKind,
	legacyId: string
): Promise<ExistingEntityMap | null> {
	return tx.migrationEntityMap.findFirst({
		where: {
			source,
			entity,
			legacyId
		},
		select: {
			id: true,
			legacyId: true,
			targetId: true,
			payload: true
		}
	})
}

async function upsertEntityMap(
	tx: Prisma.TransactionClient,
	input: {
		runId: string
		source: string
		entity: MigrationEntityKind
		legacyId: string
		targetId: string
		payload?: Prisma.InputJsonValue
	}
) {
	const existing = await findEntityMap(
		tx,
		input.source,
		input.entity,
		input.legacyId
	)

	if (existing) {
		await tx.migrationEntityMap.update({
			where: { id: existing.id },
			data: {
				runId: input.runId,
				targetId: input.targetId,
				...(input.payload ? { payload: input.payload } : {})
			}
		})
		return
	}

	await tx.migrationEntityMap.create({
		data: {
			runId: input.runId,
			source: input.source,
			entity: input.entity,
			legacyId: input.legacyId,
			targetId: input.targetId,
			...(input.payload ? { payload: input.payload } : {})
		}
	})
}

function collectRelevantBusinessIds(
	businesses: LegacyBusinessRow[],
	finance: LegacyFinanceData
): string[] {
	const values = new Set<string>()

	for (const business of businesses) {
		if (business.promoCodeId) {
			values.add(business.id)
		}
	}

	for (const payment of finance.subscriptionPayments) {
		values.add(payment.businessId)
	}

	for (const payment of finance.promoPayments) {
		values.add(payment.businessId)
	}

	return Array.from(values)
}

function collectReferencedPromoCodeIds(
	businesses: LegacyBusinessRow[],
	finance: LegacyFinanceData
): string[] {
	const values = new Set<string>()

	for (const business of businesses) {
		if (business.promoCodeId) {
			values.add(business.promoCodeId)
		}
	}

	for (const payment of finance.promoPayments) {
		values.add(payment.promoCodeId)
	}

	return Array.from(values)
}

function buildPaymentLegacyId(
	kind: 'subscription' | 'promo',
	legacyId: string
): string {
	return `${kind}:${legacyId}`
}

function buildPaymentMetadata(
	legacyTable: 'Payment' | 'PromoCodePayment',
	row: LegacySubscriptionPaymentRow | LegacyPromoPaymentRow,
	extra: Record<string, string | null>
): Prisma.InputJsonValue {
	return {
		legacySource: 'old-code',
		legacyTable,
		legacyId: row.id,
		legacyCreatedAt: row.createdAt.toISOString(),
		legacyUpdatedAt: row.updatedAt.toISOString(),
		...extra
	} satisfies Prisma.InputJsonValue
}

function parseDecimal(
	value: string | number | null | undefined
): Prisma.Decimal | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? new Prisma.Decimal(value) : null
	}

	const normalized = normalizeText(value)
	if (!normalized) return null

	const sanitized = normalized.replace(/\s+/g, '').replace(',', '.')
	if (!/^[+-]?\d+(?:\.\d+)?$/.test(sanitized)) {
		return null
	}

	return new Prisma.Decimal(sanitized)
}

function normalizeText(value: string | null | undefined): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

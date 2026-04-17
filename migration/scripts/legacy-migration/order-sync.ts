import {
	MigrationEntityKind,
	MigrationIssueSeverity,
	OrderStatus,
	PaymentMethod,
	Prisma,
	PrismaClient
} from '../../../prisma/generated/client.js'

import { runMigrationTransaction } from './migration-utils.js'
import {
	buildLegacyOrderId,
	type LegacyOrderRow,
	type LegacyOrdersData
} from './orders-source.js'
import type { LegacyBusinessRow } from './source.js'

type ApplyLegacyOrdersOptions = {
	runId: string
	source: string
}

type LegacyOrderIssue = {
	entity: MigrationEntityKind
	legacyId: string
	severity: MigrationIssueSeverity
	code: string
	message: string
	details?: Prisma.InputJsonValue
}

type ApplyLegacyOrdersSummary = {
	processedBusinesses: number
	totalOrders: number
	createdOrders: number
	reusedOrders: number
	ordersWithProducts: number
	ordersWithoutProducts: number
	ordersWithLegacyUser: number
	ordersWithAddress: number
	deliveryOrders: number
	skippedOrders: number
	byStatus: Record<string, number>
	byPaymentMethod: Record<string, number>
}

type ApplyLegacyOrdersResult = {
	summary: ApplyLegacyOrdersSummary
	issues: LegacyOrderIssue[]
}

type ExistingEntityMap = {
	id: string
	legacyId: string
	targetId: string
	payload: Prisma.JsonValue | null
}

type UpsertOrderResult = {
	targetOrderId: string
	created: boolean
	productCount: number
	status: OrderStatus
	paymentMethod: PaymentMethod | null
	address: string | null
	isDelivery: boolean
	legacyUserId: string | null
}

type LegacyProductRecord = Record<string, unknown>

export async function collectLegacyOrderIssues(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	data: LegacyOrdersData,
	source: string
): Promise<LegacyOrderIssue[]> {
	const issues: LegacyOrderIssue[] = []
	const relevantBusinessIds = Array.from(
		new Set(data.orders.map(order => order.businessId))
	)
	const mappedBusinessIds = await loadMappedLegacyIds(
		prisma,
		source,
		MigrationEntityKind.BUSINESS,
		relevantBusinessIds
	)

	for (const businessId of relevantBusinessIds) {
		if (mappedBusinessIds.has(businessId)) continue

		issues.push({
			entity: MigrationEntityKind.ORDER,
			legacyId: businessId,
			severity: MigrationIssueSeverity.ERROR,
			code: 'CATALOG_MAPPING_MISSING',
			message:
				'Для legacy business с заказами не найден mapping в target Catalog. Сначала выполните фазу catalog-bootstrap.',
			details: {
				legacyBusinessId: businessId
			} satisfies Prisma.InputJsonValue
		})
	}

	const knownBusinessIds = new Set(businesses.map(business => business.id))
	for (const order of data.orders) {
		const legacyId = buildLegacyOrderId(order)

		if (!knownBusinessIds.has(order.businessId)) {
			issues.push({
				entity: MigrationEntityKind.ORDER,
				legacyId,
				severity: MigrationIssueSeverity.ERROR,
				code: 'ORDER_OUTSIDE_SELECTED_BUSINESSES',
				message:
					'Legacy order references business outside the selected migration business set.',
				details: {
					legacyBusinessId: order.businessId,
					sourceTable: order.sourceTable
				} satisfies Prisma.InputJsonValue
			})
		}

		if (!mapLegacyStatus(order.status)) {
			issues.push({
				entity: MigrationEntityKind.ORDER,
				legacyId,
				severity: MigrationIssueSeverity.WARNING,
				code: 'ORDER_STATUS_UNKNOWN',
				message:
					'Legacy order status is unknown and will be mapped to PENDING by default.',
				details: {
					legacyStatus: order.status
				} satisfies Prisma.InputJsonValue
			})
		}

		if (order.paymentMethod && !mapLegacyPaymentMethod(order.paymentMethod)) {
			issues.push({
				entity: MigrationEntityKind.ORDER,
				legacyId,
				severity: MigrationIssueSeverity.WARNING,
				code: 'ORDER_PAYMENT_METHOD_UNKNOWN',
				message:
					'Legacy order payment method is unknown and will be stored as null.',
				details: {
					legacyPaymentMethod: order.paymentMethod
				} satisfies Prisma.InputJsonValue
			})
		}

		if (parseDecimal(order.totalAmount) === null) {
			issues.push({
				entity: MigrationEntityKind.ORDER,
				legacyId,
				severity: MigrationIssueSeverity.WARNING,
				code: 'ORDER_TOTAL_AMOUNT_INVALID',
				message:
					'Legacy totalAmount could not be parsed into Decimal and will be stored as 0.',
				details: {
					rawTotalAmount: order.totalAmount
				} satisfies Prisma.InputJsonValue
			})
		}

		if (!Array.isArray(order.products)) {
			issues.push({
				entity: MigrationEntityKind.ORDER,
				legacyId,
				severity: MigrationIssueSeverity.WARNING,
				code: 'ORDER_PRODUCTS_NOT_ARRAY',
				message:
					'Legacy order products payload is not an array. The migrated snapshot will be empty.',
				details: {
					sourceTable: order.sourceTable
				} satisfies Prisma.InputJsonValue
			})
		}
	}

	return issues
}

export async function applyLegacyOrders(
	prisma: PrismaClient,
	businesses: LegacyBusinessRow[],
	data: LegacyOrdersData,
	options: ApplyLegacyOrdersOptions
): Promise<ApplyLegacyOrdersResult> {
	const issues: LegacyOrderIssue[] = []
	const businessMapByLegacyId = await loadEntityMapByLegacyId(
		prisma,
		options.source,
		MigrationEntityKind.BUSINESS,
		Array.from(new Set(data.orders.map(order => order.businessId)))
	)

	let createdOrders = 0
	let reusedOrders = 0
	let ordersWithProducts = 0
	let ordersWithoutProducts = 0
	let ordersWithLegacyUser = 0
	let ordersWithAddress = 0
	let deliveryOrders = 0
	let skippedOrders = 0

	const byStatus: Record<string, number> = {}
	const byPaymentMethod: Record<string, number> = {}

	for (const order of data.orders) {
		const businessMap = businessMapByLegacyId.get(order.businessId)
		const legacyId = buildLegacyOrderId(order)

		if (!businessMap) {
			skippedOrders += 1
			issues.push({
				entity: MigrationEntityKind.ORDER,
				legacyId,
				severity: MigrationIssueSeverity.ERROR,
				code: 'ORDER_SKIPPED_NO_CATALOG',
				message:
					'Legacy order was skipped because target catalog mapping is missing.',
				details: {
					legacyBusinessId: order.businessId,
					sourceTable: order.sourceTable
				} satisfies Prisma.InputJsonValue
			})
			continue
		}

		const result = await runMigrationTransaction(prisma, async tx => {
			return upsertLegacyOrder(tx, order, businessMap.targetId, options)
		})

		if (result.created) {
			createdOrders += 1
		} else {
			reusedOrders += 1
		}

		if (result.productCount > 0) {
			ordersWithProducts += 1
		} else {
			ordersWithoutProducts += 1
		}

		if (result.legacyUserId) ordersWithLegacyUser += 1
		if (result.address) ordersWithAddress += 1
		if (result.isDelivery) deliveryOrders += 1

		byStatus[result.status] = (byStatus[result.status] ?? 0) + 1
		byPaymentMethod[result.paymentMethod ?? 'NONE'] =
			(byPaymentMethod[result.paymentMethod ?? 'NONE'] ?? 0) + 1
	}

	return {
		summary: {
			processedBusinesses: businesses.length,
			totalOrders: data.orders.length,
			createdOrders,
			reusedOrders,
			ordersWithProducts,
			ordersWithoutProducts,
			ordersWithLegacyUser,
			ordersWithAddress,
			deliveryOrders,
			skippedOrders,
			byStatus,
			byPaymentMethod
		},
		issues
	}
}

async function upsertLegacyOrder(
	tx: Prisma.TransactionClient,
	order: LegacyOrderRow,
	catalogId: string,
	options: ApplyLegacyOrdersOptions
): Promise<UpsertOrderResult> {
	const legacyId = buildLegacyOrderId(order)
	const existingMap = await findEntityMap(
		tx,
		options.source,
		MigrationEntityKind.ORDER,
		legacyId
	)
	const existingOrder = existingMap
		? await tx.order.findFirst({
				where: { id: existingMap.targetId },
				select: { id: true }
			})
		: null

	const status = mapLegacyStatus(order.status) ?? OrderStatus.PENDING
	const paymentMethod = mapLegacyPaymentMethod(order.paymentMethod)
	const products = buildOrderProductsSnapshot(order)
	const totalAmount = parseDecimal(order.totalAmount) ?? new Prisma.Decimal(0)

	const data = {
		status,
		legacyOrderId: legacyId,
		legacyUserId: normalizeText(order.legacyUserId),
		token: normalizeText(order.token),
		comment: normalizeText(order.comment),
		address: normalizeText(order.address),
		isDelivery: order.isDelivery,
		commentByAdmin: normalizeText(order.commentByAdmin),
		paymentMethod,
		paymentProof: normalizeStringArray(order.paymentProof),
		products,
		totalAmount,
		catalogId,
		deleteAt: null,
		updatedAt: order.updatedAt
	} satisfies Prisma.OrderUncheckedCreateInput

	if (existingOrder) {
		await tx.order.update({
			where: { id: existingOrder.id },
			data
		})

		await upsertEntityMap(tx, {
			runId: options.runId,
			source: options.source,
			entity: MigrationEntityKind.ORDER,
			legacyId,
			targetId: existingOrder.id,
			payload: {
				sourceTable: order.sourceTable,
				rawLegacyOrderRowId: order.legacyOrderRowId,
				legacyBusinessId: order.businessId
			}
		})

		return {
			targetOrderId: existingOrder.id,
			created: false,
			productCount: products.length,
			status,
			paymentMethod,
			address: normalizeText(order.address),
			isDelivery: order.isDelivery,
			legacyUserId: normalizeText(order.legacyUserId)
		}
	}

	const createdOrder = await tx.order.create({
		data: {
			...data,
			createdAt: order.createdAt
		},
		select: { id: true }
	})

	await upsertEntityMap(tx, {
		runId: options.runId,
		source: options.source,
		entity: MigrationEntityKind.ORDER,
		legacyId,
		targetId: createdOrder.id,
		payload: {
			sourceTable: order.sourceTable,
			rawLegacyOrderRowId: order.legacyOrderRowId,
			legacyBusinessId: order.businessId
		}
	})

	return {
		targetOrderId: createdOrder.id,
		created: true,
		productCount: products.length,
		status,
		paymentMethod,
		address: normalizeText(order.address),
		isDelivery: order.isDelivery,
		legacyUserId: normalizeText(order.legacyUserId)
	}
}

function buildOrderProductsSnapshot(
	order: LegacyOrderRow
): Prisma.InputJsonValue[] {
	if (!Array.isArray(order.products)) {
		return []
	}

	return order.products.flatMap((item, index) => {
		if (!isRecord(item)) return []

		const quantity = normalizeQuantity(item.quantity)
		const unitPrice = resolveUnitPrice(item)
		const legacyProductId = readString(item.id)
		const lineTotal = normalizeMoney(unitPrice * quantity)
		const imageUrl = readFirstStringArrayEntry(item.imagesUrl)

		return [
			{
				id: `legacy-${order.sourceTable}-${order.legacyOrderRowId}-${index + 1}`,
				productId: legacyProductId,
				variantId: null,
				quantity,
				unitPrice,
				lineTotal,
				product: {
					id: legacyProductId,
					name: readString(item.name),
					slug: null,
					imageUrl
				},
				legacy: {
					...item,
					sourceTable: order.sourceTable,
					legacyOrderRowId: order.legacyOrderRowId
				}
			} satisfies Prisma.InputJsonValue
		]
	})
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

function mapLegacyStatus(value: string | null): OrderStatus | null {
	switch ((value ?? '').trim().toLowerCase()) {
		case 'pending':
			return OrderStatus.PENDING
		case 'delivered':
			return OrderStatus.COMPLETED
		default:
			return null
	}
}

function mapLegacyPaymentMethod(value: string | null): PaymentMethod | null {
	switch ((value ?? '').trim()) {
		case 'cash':
			return PaymentMethod.CASH
		case 'transferToBankCard':
			return PaymentMethod.TRANSFER
		case 'acquiring':
			return PaymentMethod.ACQUIRING
		default:
			return null
	}
}

function resolveUnitPrice(item: LegacyProductRecord): number {
	const discountedPrice = readNumber(item.discountedPrice)
	if (discountedPrice !== null && discountedPrice > 0) {
		return normalizeMoney(discountedPrice)
	}

	const regularPrice = readNumber(item.price)
	if (regularPrice !== null) {
		return normalizeMoney(regularPrice)
	}

	return 0
}

function normalizeQuantity(value: unknown): number {
	const parsed = readNumber(value)
	if (parsed === null) return 1
	return Math.max(1, Math.trunc(parsed))
}

function normalizeMoney(value: unknown): number {
	const parsed = readNumber(value)
	if (parsed === null) return 0
	return Number(parsed.toFixed(2))
}

function parseDecimal(value: string | null | undefined): Prisma.Decimal | null {
	const normalized = normalizeText(value)
	if (!normalized) return null

	const sanitized = normalized.replace(/\s+/g, '').replace(',', '.')
	if (!/^[+-]?\d+(?:\.\d+)?$/.test(sanitized)) {
		return null
	}

	return new Prisma.Decimal(sanitized)
}

function normalizeStringArray(values: string[] | null | undefined): string[] {
	if (!Array.isArray(values)) return []
	return values
		.map(value => normalizeText(value))
		.filter((value): value is string => Boolean(value))
}

function readFirstStringArrayEntry(value: unknown): string | null {
	if (!Array.isArray(value)) return null
	for (const item of value) {
		const normalized = readString(item)
		if (normalized) return normalized
	}
	return null
}

function readNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string') {
		const normalized = value.trim()
		if (!normalized) return null
		const sanitized = normalized.replace(/\s+/g, '').replace(',', '.')
		const parsed = Number(sanitized)
		return Number.isFinite(parsed) ? parsed : null
	}
	return null
}

function readString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function normalizeText(value: string | null | undefined): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function isRecord(value: unknown): value is LegacyProductRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

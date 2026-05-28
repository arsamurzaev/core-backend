import { CartCheckoutMethod, ContactType } from '@generated/enums'
import { BadRequestException } from '@nestjs/common'

export type CatalogCheckoutContactValues = Partial<Record<ContactType, string>>

export type CatalogCheckoutField = {
	key: string
	label: string
	required: boolean
	type: 'date' | 'number' | 'text' | 'time'
}

export type CatalogCheckoutPreorderSettings = {
	minLeadTimeMinutes: number
	maxAdvanceDays: number
}

export type CatalogCheckoutConfig = {
	availableMethods: CartCheckoutMethod[]
	enabledMethods: CartCheckoutMethod[]
	methodContacts: Partial<
		Record<CartCheckoutMethod, CatalogCheckoutContactValues>
	>
	methodFields: Record<CartCheckoutMethod, CatalogCheckoutField[]>
	preorder: CatalogCheckoutPreorderSettings
}

export type CatalogCheckoutSettingsInput = {
	enabledMethods?: unknown
	methodContacts?: unknown
	preorder?: unknown
}

export type CatalogCheckoutData = {
	address?: string
	customerName?: string
	guestsCount?: number
	hallSectionId?: string
	hallSectionName?: string
	hallTableCode?: string
	hallTableId?: string
	hallTableName?: string
	hallTableNumber?: string
	iikoRestaurantSectionId?: string
	iikoRestaurantSectionName?: string
	iikoTableId?: string
	integrationExternalItemCode?: string
	mapUrl?: string
	orderMode?: string
	phone?: string
	personsCount?: number
	t?: string
	table?: string
	tableCode?: string
	tableId?: string
	tableName?: string
	tableNumber?: string
	scheduledAt?: string
	visitDate?: string
	visitTime?: string
}

export type CatalogContactSnapshot = {
	type: ContactType
	value: string
}

const CHECKOUT_CONTACT_TYPES = new Set<ContactType>([
	ContactType.PHONE,
	ContactType.WHATSAPP,
	ContactType.SMS,
	ContactType.TELEGRAM,
	ContactType.BIP,
	ContactType.MAX
])

const METHOD_FIELDS: Record<CartCheckoutMethod, CatalogCheckoutField[]> = {
	[CartCheckoutMethod.DELIVERY]: [
		{
			key: 'address',
			label: 'Адрес доставки',
			required: true,
			type: 'text'
		}
	],
	[CartCheckoutMethod.PICKUP]: [],
	[CartCheckoutMethod.PREORDER]: [
		{
			key: 'personsCount',
			label: 'Количество человек',
			required: true,
			type: 'number'
		},
		{
			key: 'visitDate',
			label: 'Дата визита',
			required: true,
			type: 'date'
		},
		{
			key: 'visitTime',
			label: 'Время визита',
			required: true,
			type: 'time'
		}
	]
}

const DEFAULT_PREORDER_SETTINGS: CatalogCheckoutPreorderSettings = {
	minLeadTimeMinutes: 30,
	maxAdvanceDays: 14
}

const DEFAULT_AVAILABLE_METHODS = [
	CartCheckoutMethod.DELIVERY,
	CartCheckoutMethod.PICKUP
]
const RESTAURANT_TYPE_CODES = new Set(['restaurant', 'cafe'])

function isRestaurantCheckoutType(typeCode?: string | null): boolean {
	const code = typeCode?.trim().toLowerCase()
	return Boolean(code && RESTAURANT_TYPE_CODES.has(code))
}

export function resolveCheckoutAvailableMethods(
	typeCode?: string | null
): CartCheckoutMethod[] {
	if (isRestaurantCheckoutType(typeCode)) {
		return [
			CartCheckoutMethod.DELIVERY,
			CartCheckoutMethod.PICKUP,
			CartCheckoutMethod.PREORDER
		]
	}

	return DEFAULT_AVAILABLE_METHODS
}

export function resolveCheckoutDefaultEnabledMethods(
	typeCode?: string | null,
	availableMethods = resolveCheckoutAvailableMethods(typeCode)
): CartCheckoutMethod[] {
	if (isRestaurantCheckoutType(typeCode)) {
		return [CartCheckoutMethod.DELIVERY, CartCheckoutMethod.PICKUP].filter(
			method => availableMethods.includes(method)
		)
	}

	return []
}

export function normalizeCatalogCheckoutSettings(
	input: unknown,
	typeCode?: string | null
): CatalogCheckoutSettingsInput | null | undefined {
	if (input === undefined) return undefined
	if (input === null) return null

	if (!isRecord(input)) {
		throw new BadRequestException('checkout must be an object')
	}

	const availableMethods = resolveCheckoutAvailableMethods(typeCode)
	const enabledMethods = normalizeMethodArray(
		input.enabledMethods,
		availableMethods,
		true
	)
	const methodContacts = normalizeMethodContacts(input.methodContacts)
	const preorder = normalizePreorderSettings(input.preorder)
	const normalized: CatalogCheckoutSettingsInput = {}

	if (enabledMethods) {
		normalized.enabledMethods = enabledMethods
	}

	if (methodContacts) {
		normalized.methodContacts = methodContacts
	}

	if (preorder) {
		normalized.preorder = preorder
	}

	return normalized
}

export function resolveCatalogCheckoutConfig(params: {
	checkout?: unknown
	typeCode?: string | null
}): CatalogCheckoutConfig {
	const availableMethods = resolveCheckoutAvailableMethods(params.typeCode)
	const raw = isRecord(params.checkout) ? params.checkout : {}
	const fallbackMethods = resolveCheckoutDefaultEnabledMethods(
		params.typeCode,
		availableMethods
	)
	const normalizedEnabledMethods = normalizeMethodArray(
		raw.enabledMethods,
		availableMethods
	)
	const enabledMethods =
		normalizedEnabledMethods === null ? fallbackMethods : normalizedEnabledMethods

	return {
		availableMethods,
		enabledMethods,
		methodContacts: normalizeMethodContacts(raw.methodContacts) ?? {},
		methodFields: METHOD_FIELDS,
		preorder: normalizePreorderSettings(raw.preorder) ?? DEFAULT_PREORDER_SETTINGS
	}
}

export function normalizeCheckoutMethod(
	value: unknown
): CartCheckoutMethod | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim().toUpperCase()
	if (
		normalized === CartCheckoutMethod.DELIVERY ||
		normalized === CartCheckoutMethod.PICKUP ||
		normalized === CartCheckoutMethod.PREORDER
	) {
		return normalized
	}
	return null
}

export function normalizeCartCheckoutData(params: {
	catalogAddress?: unknown
	config: CatalogCheckoutConfig
	data?: unknown
	mapUrl?: unknown
	method?: unknown
}): {
	checkoutData: CatalogCheckoutData
	checkoutMethod: CartCheckoutMethod | null
} {
	const explicitMethod = normalizeCheckoutMethod(params.method)
	if (params.config.enabledMethods.length === 0 && !explicitMethod) {
		return { checkoutMethod: null, checkoutData: {} }
	}

	const rawData = isRecord(params.data) ? params.data : {}
	if (
		explicitMethod !== CartCheckoutMethod.PREORDER &&
		isHallCheckoutData(rawData)
	) {
		return {
			checkoutMethod: CartCheckoutMethod.PICKUP,
			checkoutData: normalizeHallCheckoutData({
				catalogAddress: params.catalogAddress,
				mapUrl: params.mapUrl,
				rawData
			})
		}
	}

	const method =
		explicitMethod ?? resolveCartCheckoutMethod(params.method, params.config)
	const allowedMethods =
		params.config.enabledMethods.length > 0
			? params.config.enabledMethods
			: params.config.availableMethods
	if (!allowedMethods.includes(method)) {
		throw new BadRequestException('checkoutMethod is not enabled')
	}

	const customerData = normalizeCustomerCheckoutData(rawData)
	const integrationData = normalizeIntegrationCheckoutData(rawData)
	if (method === CartCheckoutMethod.DELIVERY) {
		const address = normalizeString(rawData.address)
		if (!address) {
			throw new BadRequestException('address is required for delivery')
		}
		return {
			checkoutMethod: method,
			checkoutData: { ...customerData, ...integrationData, address }
		}
	}

	if (method === CartCheckoutMethod.PICKUP) {
		const address = normalizeString(params.catalogAddress)
		const mapUrl = normalizeString(params.mapUrl)
		return {
			checkoutMethod: method,
			checkoutData: {
				...customerData,
				...integrationData,
				...(address ? { address } : {}),
				...(mapUrl ? { mapUrl } : {})
			}
		}
	}

	if (method === CartCheckoutMethod.PREORDER) {
		const personsCount = normalizePositiveInt(rawData.personsCount)
		if (!personsCount) {
			throw new BadRequestException('personsCount is required for preorder')
		}
		const preorderSchedule = normalizePreorderSchedule(rawData)
		if (!preorderSchedule) {
			throw new BadRequestException(
				'visitDate and visitTime are required for preorder'
			)
		}
		if (
			preorderSchedule.date.getTime() <
			Date.now() + params.config.preorder.minLeadTimeMinutes * 60 * 1000
		) {
			throw new BadRequestException(
				`preorder time must be at least ${params.config.preorder.minLeadTimeMinutes} minutes in the future`
			)
		}
		if (
			preorderSchedule.date.getTime() >
			Date.now() + params.config.preorder.maxAdvanceDays * 24 * 60 * 60 * 1000
		) {
			throw new BadRequestException(
				`preorder time must be within ${params.config.preorder.maxAdvanceDays} days`
			)
		}
		return {
			checkoutMethod: method,
			checkoutData: {
				...customerData,
				...integrationData,
				personsCount,
				scheduledAt: preorderSchedule.scheduledAt,
				visitDate: preorderSchedule.visitDate,
				visitTime: preorderSchedule.visitTime
			}
		}
	}

	return { checkoutMethod: method, checkoutData: {} }
}

function normalizeCustomerCheckoutData(
	rawData: Record<string, unknown>
): Pick<CatalogCheckoutData, 'customerName' | 'phone'> {
	const customerName =
		normalizeString(rawData.customerName) || normalizeString(rawData.name)
	const phone = normalizeString(rawData.phone)

	return {
		...(customerName ? { customerName } : {}),
		...(phone ? { phone } : {})
	}
}

function isHallCheckoutData(rawData: Record<string, unknown>): boolean {
	return (
		normalizeString(rawData.orderMode).toUpperCase() === 'HALL' ||
		Boolean(
			normalizeString(
				rawData.iikoTableId ??
					rawData.hallTableId ??
					rawData.integrationExternalItemCode ??
					rawData.hallTableCode ??
					rawData.tableCode ??
					rawData.t
			)
		)
	)
}

function normalizeHallCheckoutData(params: {
	catalogAddress?: unknown
	mapUrl?: unknown
	rawData: Record<string, unknown>
}): CatalogCheckoutData {
	const integrationData = normalizeIntegrationCheckoutData(params.rawData)
	const customerData = normalizeCustomerCheckoutData(params.rawData)
	const catalogAddress = normalizeString(params.catalogAddress)
	const mapUrl = normalizeString(params.mapUrl)
	const tableId =
		integrationData.iikoTableId ??
		integrationData.hallTableId ??
		integrationData.tableId
	const tableCode =
		integrationData.integrationExternalItemCode ??
		integrationData.hallTableCode ??
		integrationData.tableCode ??
		integrationData.t
	if (!tableId && !tableCode) {
		throw new BadRequestException('iiko table id is required for hall order')
	}

	return {
		...customerData,
		...integrationData,
		orderMode: 'HALL',
		...(catalogAddress ? { address: catalogAddress } : {}),
		...(mapUrl ? { mapUrl } : {})
	}
}

function normalizeIntegrationCheckoutData(
	rawData: Record<string, unknown>
): CatalogCheckoutData {
	const guestsCount = normalizePositiveInt(
		rawData.guestsCount ?? rawData.personsCount
	)
	const textFields = {
		hallSectionId: normalizeString(rawData.hallSectionId),
		hallSectionName: normalizeString(rawData.hallSectionName),
		hallTableCode: normalizeString(rawData.hallTableCode),
		hallTableId: normalizeString(rawData.hallTableId),
		hallTableName: normalizeString(rawData.hallTableName),
		hallTableNumber: normalizeString(rawData.hallTableNumber),
		iikoRestaurantSectionId: normalizeString(rawData.iikoRestaurantSectionId),
		iikoRestaurantSectionName: normalizeString(rawData.iikoRestaurantSectionName),
		iikoTableId: normalizeString(rawData.iikoTableId),
		integrationExternalItemCode: normalizeString(
			rawData.integrationExternalItemCode
		),
		orderMode: normalizeString(rawData.orderMode),
		t: normalizeString(rawData.t),
		table: normalizeString(rawData.table),
		tableCode: normalizeString(rawData.tableCode),
		tableId: normalizeString(rawData.tableId),
		tableName: normalizeString(rawData.tableName),
		tableNumber: normalizeString(rawData.tableNumber)
	}

	return {
		...Object.fromEntries(
			Object.entries(textFields).filter((entry): entry is [string, string] =>
				Boolean(entry[1])
			)
		),
		...(guestsCount ? { guestsCount, personsCount: guestsCount } : {})
	} as CatalogCheckoutData
}

export function resolveCheckoutContactsSnapshot(params: {
	catalogContacts: CatalogContactSnapshot[]
	config: CatalogCheckoutConfig
	method: CartCheckoutMethod | null
}): CatalogCheckoutContactValues {
	if (params.method) {
		const customContacts = params.config.methodContacts[params.method] ?? {}
		if (hasCheckoutContacts(customContacts)) {
			return customContacts
		}
	}

	return params.catalogContacts.reduce<CatalogCheckoutContactValues>(
		(acc, contact) => {
			if (CHECKOUT_CONTACT_TYPES.has(contact.type)) {
				const value = normalizeString(contact.value)
				if (value) acc[contact.type] = value
			}
			return acc
		},
		{}
	)
}

function resolveCartCheckoutMethod(
	value: unknown,
	config: CatalogCheckoutConfig
): CartCheckoutMethod {
	const method = normalizeCheckoutMethod(value)
	if (method) return method

	if (config.enabledMethods.length === 1 && config.enabledMethods[0]) {
		return config.enabledMethods[0]
	}

	throw new BadRequestException('checkoutMethod is required')
}

function normalizeMethodArray(
	value: unknown,
	availableMethods: CartCheckoutMethod[],
	strict = false
): CartCheckoutMethod[] | null {
	if (!Array.isArray(value)) return null
	const methods = Array.from(
		new Set(value.map(normalizeCheckoutMethod).filter(Boolean))
	)
	const filtered = methods.filter(method => availableMethods.includes(method))

	if (strict && methods.length > 0 && filtered.length === 0) {
		throw new BadRequestException('enabledMethods must include available methods')
	}

	return filtered
}

function normalizeMethodContacts(
	value: unknown
): Partial<Record<CartCheckoutMethod, CatalogCheckoutContactValues>> | null {
	if (!isRecord(value)) return null

	const result: Partial<
		Record<CartCheckoutMethod, CatalogCheckoutContactValues>
	> = {}
	for (const [methodKey, contactsValue] of Object.entries(value)) {
		const method = normalizeCheckoutMethod(methodKey)
		if (!method || !isRecord(contactsValue)) continue

		const contacts: CatalogCheckoutContactValues = {}
		for (const [contactTypeKey, contactValue] of Object.entries(contactsValue)) {
			const contactType = normalizeContactType(contactTypeKey)
			const normalizedValue = normalizeString(contactValue)
			if (contactType && normalizedValue) {
				contacts[contactType] = normalizedValue
			}
		}

		if (hasCheckoutContacts(contacts)) {
			result[method] = contacts
		}
	}

	return Object.keys(result).length > 0 ? result : null
}

function normalizePreorderSettings(
	value: unknown
): CatalogCheckoutPreorderSettings | null {
	if (!isRecord(value)) return null

	return {
		minLeadTimeMinutes:
			normalizeIntInRange(value.minLeadTimeMinutes, 0, 24 * 60) ??
			DEFAULT_PREORDER_SETTINGS.minLeadTimeMinutes,
		maxAdvanceDays:
			normalizeIntInRange(value.maxAdvanceDays, 1, 365) ??
			DEFAULT_PREORDER_SETTINGS.maxAdvanceDays
	}
}

function normalizeContactType(value: unknown): ContactType | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim().toUpperCase()
	for (const type of CHECKOUT_CONTACT_TYPES) {
		if (type === normalized) return type
	}
	return null
}

function normalizePositiveInt(value: unknown): number | null {
	const numeric =
		typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number(value.trim())
				: Number.NaN

	if (!Number.isInteger(numeric) || numeric < 1) return null
	return numeric
}

function normalizeIntInRange(
	value: unknown,
	min: number,
	max: number
): number | null {
	const numeric =
		typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number(value.trim())
				: Number.NaN

	if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
		return null
	}

	return numeric
}

function normalizePreorderSchedule(
	rawData: Record<string, unknown>
): {
	date: Date
	scheduledAt: string
	visitDate: string
	visitTime: string
} | null {
	const explicit = normalizeString(
		rawData.scheduledAt ??
			rawData.completeBefore ??
			rawData.preorderAt ??
			rawData.visitAt ??
			rawData.plannedAt
	)
	if (explicit) {
		return normalizePreorderDateTime(explicit)
	}

	const visitDate = normalizeVisitDate(
		rawData.visitDate ?? rawData.date ?? rawData.preorderDate
	)
	const visitTime = normalizeVisitTime(
		rawData.visitTime ?? rawData.time ?? rawData.preorderTime
	)
	if (!visitDate || !visitTime) return null

	return buildPreorderSchedule(visitDate, visitTime)
}

function normalizePreorderDateTime(value: string): {
	date: Date
	scheduledAt: string
	visitDate: string
	visitTime: string
} | null {
	const normalized = value.trim()
	const match = normalized.match(
		/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d{1,7})?)?$/
	)
	if (match) {
		const visitDate = normalizeVisitDate(match[1])
		const visitTime = normalizeVisitTime(
			`${match[2]}:${match[3]}:${match[4] ?? '00'}`
		)
		return visitDate && visitTime
			? buildPreorderSchedule(visitDate, visitTime)
			: null
	}

	const parsed = new Date(normalized)
	if (Number.isNaN(parsed.getTime())) return null
	return buildPreorderSchedule(formatDateInput(parsed), formatTimeInput(parsed))
}

function normalizeVisitDate(value: unknown): string | null {
	const raw = normalizeString(value)
	if (!raw) return null

	const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (iso) return normalizeDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]))

	const ru = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
	if (ru) return normalizeDateParts(Number(ru[3]), Number(ru[2]), Number(ru[1]))

	return null
}

function normalizeVisitTime(value: unknown): string | null {
	const raw = normalizeString(value)
	if (!raw) return null

	const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
	if (!match) return null

	const hours = Number(match[1])
	const minutes = Number(match[2])
	const seconds = match[3] ? Number(match[3]) : 0
	if (
		!Number.isInteger(hours) ||
		!Number.isInteger(minutes) ||
		!Number.isInteger(seconds) ||
		hours < 0 ||
		hours > 23 ||
		minutes < 0 ||
		minutes > 59 ||
		seconds < 0 ||
		seconds > 59
	) {
		return null
	}

	return `${pad2(hours)}:${pad2(minutes)}`
}

function normalizeDateParts(
	year: number,
	month: number,
	day: number
): string | null {
	const date = new Date(year, month - 1, day)
	if (
		!Number.isInteger(year) ||
		!Number.isInteger(month) ||
		!Number.isInteger(day) ||
		year < 2000 ||
		year > 2100 ||
		month < 1 ||
		month > 12 ||
		day < 1 ||
		day > 31 ||
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day
	) {
		return null
	}

	return `${year}-${pad2(month)}-${pad2(day)}`
}

function buildPreorderSchedule(
	visitDate: string,
	visitTime: string
): {
	date: Date
	scheduledAt: string
	visitDate: string
	visitTime: string
} | null {
	const date = parseLocalDateTime(visitDate, visitTime)
	if (!date) return null

	return {
		date,
		scheduledAt: `${visitDate}T${visitTime}:00.000`,
		visitDate,
		visitTime
	}
}

function parseLocalDateTime(visitDate: string, visitTime: string): Date | null {
	const dateMatch = visitDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	const timeMatch = visitTime.match(/^(\d{2}):(\d{2})$/)
	if (!dateMatch || !timeMatch) return null

	const date = new Date(
		Number(dateMatch[1]),
		Number(dateMatch[2]) - 1,
		Number(dateMatch[3]),
		Number(timeMatch[1]),
		Number(timeMatch[2]),
		0,
		0
	)
	if (Number.isNaN(date.getTime())) return null
	return date
}

function formatDateInput(date: Date): string {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
		date.getDate()
	)}`
}

function formatTimeInput(date: Date): string {
	return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

function pad2(value: number): string {
	return String(value).padStart(2, '0')
}

function normalizeString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : ''
}

function hasCheckoutContacts(contacts: CatalogCheckoutContactValues): boolean {
	return Object.values(contacts).some(value => normalizeString(value).length > 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

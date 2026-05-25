import { CartCheckoutMethod, ContactType } from '@generated/enums'
import { BadRequestException } from '@nestjs/common'

export type CatalogCheckoutContactValues = Partial<Record<ContactType, string>>

export type CatalogCheckoutField = {
	key: string
	label: string
	required: boolean
	type: 'number' | 'text' | 'time'
}

export type CatalogCheckoutConfig = {
	availableMethods: CartCheckoutMethod[]
	enabledMethods: CartCheckoutMethod[]
	methodContacts: Partial<
		Record<CartCheckoutMethod, CatalogCheckoutContactValues>
	>
	methodFields: Record<CartCheckoutMethod, CatalogCheckoutField[]>
}

export type CatalogCheckoutSettingsInput = {
	enabledMethods?: unknown
	methodContacts?: unknown
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
			key: 'visitTime',
			label: 'Время визита',
			required: false,
			type: 'time'
		}
	]
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
	const normalized: CatalogCheckoutSettingsInput = {}

	if (enabledMethods) {
		normalized.enabledMethods = enabledMethods
	}

	if (methodContacts) {
		normalized.methodContacts = methodContacts
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
		methodFields: METHOD_FIELDS
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
	if (isHallCheckoutData(rawData)) {
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
		const visitTime = normalizeString(rawData.visitTime)
		return {
			checkoutMethod: method,
			checkoutData: {
				...customerData,
				...integrationData,
				personsCount,
				...(visitTime ? { visitTime } : {})
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

function normalizeString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : ''
}

function hasCheckoutContacts(contacts: CatalogCheckoutContactValues): boolean {
	return Object.values(contacts).some(value => normalizeString(value).length > 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

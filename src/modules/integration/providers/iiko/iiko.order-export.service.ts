import type { Prisma } from '@generated/client'
import {
	CartCheckoutMethod,
	IntegrationProvider,
	OrderStatus
} from '@generated/enums'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { AllInterfaces } from '@/core/config'
import {
	CAPABILITY_ASSERT_PORT,
	type CapabilityAssertPort
} from '@/modules/capability/contracts'
import {
	normalizeOrderProducts,
	type OrderExternalLinkSnapshot
} from '@/shared/order/order-products.utils'

import {
	type IntegrationOrderExportRecord,
	type IntegrationProductLinkRecord,
	IntegrationRepository,
	type IntegrationVariantLinkRecord,
	type OrderForExportRecord
} from '../../integration.repository'
import { renderSafeProviderErrorMessage } from '../../provider-error-redaction'

import { IikoClient } from './iiko.client'
import { IikoMetadataCryptoService } from './iiko.metadata'
import type {
	IikoAddressFormatType,
	IikoCommandStatusResponse,
	IikoCreateDeliveryOrderItem,
	IikoCreateDeliveryOrderPayload,
	IikoCreateDeliveryOrderResponse,
	IikoCreateTableOrderPayload,
	IikoDeliveryOrderServiceType,
	IikoDeliveryPoint
} from './iiko.types'

const EXPORTED_ORDER_EXTERNAL_NUMBER_PREFIX = 'ctlg'
const DEFAULT_TRANSPORT_TO_FRONT_TIMEOUT_SECONDS = 8
const DEFAULT_COMMAND_STATUS_MAX_ATTEMPTS = 12
const DEFAULT_COMMAND_STATUS_POLL_INTERVAL_MS = 1500
const DEFAULT_CUSTOMER_NAME = 'Guest'
const DEFAULT_SIZE_EXTERNAL_ID = 'default'

type ExportIikoOrderResult = {
	externalId: string
	correlationId: string
	created: boolean
	response: IikoCreateDeliveryOrderResponse & {
		commandStatus?: IikoCommandStatusResponse
	}
}

type IikoOrderItemRef = {
	productId: string
	sizeId: string | null
}

type IikoAddressSettings = {
	addressFormatType: IikoAddressFormatType | null
	restaurantAddress: string | null
}

type IikoHallOrderInfo = {
	tableId: string
	tableNumber: string | null
	tableName: string | null
	sectionId: string | null
	sectionName: string | null
	guestsCount: number | null
}

export class NonRetryableIikoOrderExportError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'NonRetryableIikoOrderExportError'
	}
}

@Injectable()
export class IikoOrderExportService {
	private readonly logger = new Logger(IikoOrderExportService.name)

	constructor(
		private readonly repo: IntegrationRepository,
		private readonly metadataCrypto: IikoMetadataCryptoService,
		private readonly configService: ConfigService<AllInterfaces>,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly featureEntitlements: CapabilityAssertPort
	) {}

	async exportOrder(
		exportRecord: IntegrationOrderExportRecord
	): Promise<ExportIikoOrderResult> {
		const order = await this.repo.findOrderForExport(exportRecord.orderId)
		if (!order) {
			throw new NonRetryableIikoOrderExportError(
				`Order ${exportRecord.orderId} was not found`
			)
		}
		await this.featureEntitlements.assertCanUseIikoIntegration(order.catalogId)

		const integration = await this.repo.findIiko(order.catalogId)
		if (!integration || integration.id !== exportRecord.integrationId) {
			throw new NonRetryableIikoOrderExportError(
				`iiko integration ${exportRecord.integrationId} is not active for order ${order.id}`
			)
		}
		if (!integration.isActive) {
			throw new NonRetryableIikoOrderExportError(
				`iiko integration ${integration.id} is disabled`
			)
		}

		const metadata = this.metadataCrypto.parseStoredMetadata(integration.metadata)
		if (!metadata.exportOrders) {
			throw new NonRetryableIikoOrderExportError(
				`iiko order export is disabled for integration ${integration.id}`
			)
		}
		if (!metadata.terminalGroupId) {
			throw new NonRetryableIikoOrderExportError(
				'iiko order export requires terminalGroupId'
			)
		}

		const client = new IikoClient({
			apiLogin: metadata.apiLogin,
			baseUrl: this.resolveApiBaseUrl()
		})
		const hallOrder = resolveHallOrderInfo(order)
		const payload = hallOrder
			? await this.buildTableOrderPayload(order, integration.id, {
					organizationId: metadata.organizationId,
					terminalGroupId: metadata.terminalGroupId,
					externalMenuId: metadata.externalMenuId,
					priceCategoryId: metadata.priceCategoryId,
					orderExportSourceKey: metadata.orderExportSourceKey,
					hallOrder
				})
			: await this.buildDeliveryPayload(order, integration.id, {
					organizationId: metadata.organizationId,
					terminalGroupId: metadata.terminalGroupId,
					externalMenuId: metadata.externalMenuId,
					priceCategoryId: metadata.priceCategoryId,
					orderExportServiceType: metadata.orderExportServiceType,
					orderExportSourceKey: metadata.orderExportSourceKey,
					addressSettings: await this.resolveAddressSettings(
						client,
						metadata.organizationId
					)
				})

		await this.repo.setOrderExportPayload(
			exportRecord.id,
			toPrismaInputJson(payload)
		)

		const response = hallOrder
			? await client.createTableOrder(payload as IikoCreateTableOrderPayload)
			: await client.createDeliveryOrder(payload as IikoCreateDeliveryOrderPayload)
		const creationStatus = response.orderInfo?.creationStatus
		if (creationStatus === 'Error') {
			throw new NonRetryableIikoOrderExportError(
				`iiko rejected order ${order.id}: ${renderSafeProviderErrorMessage(
					JSON.stringify({
						correlationId: response.correlationId,
						errorInfo: response.orderInfo.errorInfo ?? null,
						orderInfo: response.orderInfo
					})
				)}`
			)
		}
		const commandStatus = await this.waitForCommandCompletion(client, {
			organizationId: metadata.organizationId,
			correlationId: response.correlationId
		})
		if (commandStatus.state !== 'Success') {
			throw new NonRetryableIikoOrderExportError(
				`iiko command failed for order ${order.id}: ${renderSafeProviderErrorMessage(
					JSON.stringify(commandStatus)
				)}`
			)
		}

		return {
			externalId: response.orderInfo?.id ?? response.correlationId,
			correlationId: response.correlationId,
			created: true,
			response: {
				...response,
				commandStatus
			}
		}
	}

	private async buildDeliveryPayload(
		order: OrderForExportRecord,
		integrationId: string,
		refs: {
			organizationId: string
			terminalGroupId: string
			externalMenuId: string | null
			priceCategoryId: string | null
			orderExportServiceType: IikoDeliveryOrderServiceType | null
			orderExportSourceKey: string | null
			addressSettings: IikoAddressSettings
		}
	): Promise<IikoCreateDeliveryOrderPayload> {
		const phone = resolveOrderPhone(order)
		if (!phone) {
			throw new NonRetryableIikoOrderExportError(
				`Order ${order.id} has no valid phone for iiko delivery export`
			)
		}

		const payloadItems = await this.buildPayloadItems(order, integrationId)
		const serviceType =
			refs.orderExportServiceType ?? resolveOrderServiceType(order)
		const deliveryPoint =
			serviceType === 'DeliveryByCourier'
				? buildDeliveryPoint(order, refs.addressSettings)
				: null

		return {
			organizationId: refs.organizationId,
			terminalGroupId: refs.terminalGroupId,
			createOrderSettings: {
				transportToFrontTimeout: DEFAULT_TRANSPORT_TO_FRONT_TIMEOUT_SECONDS,
				checkStopList: true
			},
			order: {
				id: order.id,
				externalNumber: buildExternalNumber(order.id),
				phone,
				orderServiceType: serviceType,
				...(refs.externalMenuId ? { menuId: refs.externalMenuId } : {}),
				...(refs.priceCategoryId ? { priceCategoryId: refs.priceCategoryId } : {}),
				comment: buildOrderComment(order),
				customer: {
					type: 'one-time',
					name: resolveCustomerName(order)
				},
				...(deliveryPoint ? { deliveryPoint } : {}),
				items: payloadItems,
				...(refs.orderExportSourceKey
					? { sourceKey: refs.orderExportSourceKey }
					: {}),
				externalData: [
					{
						key: 'catalogOrderId',
						value: order.id,
						isPublic: false
					}
				]
			}
		}
	}

	private async buildTableOrderPayload(
		order: OrderForExportRecord,
		integrationId: string,
		refs: {
			organizationId: string
			terminalGroupId: string
			externalMenuId: string | null
			priceCategoryId: string | null
			orderExportSourceKey: string | null
			hallOrder: IikoHallOrderInfo
		}
	): Promise<IikoCreateTableOrderPayload> {
		const payloadItems = await this.buildPayloadItems(order, integrationId)
		const phone = resolveOrderPhone(order)
		const customerName = resolveCustomerName(order)
		const externalData = [
			{
				key: 'catalogOrderId',
				value: order.id,
				isPublic: false
			},
			{
				key: 'catalogMode',
				value: 'HALL',
				isPublic: false
			},
			{
				key: 'iikoTableId',
				value: refs.hallOrder.tableId,
				isPublic: false
			},
			...(customerName && customerName !== DEFAULT_CUSTOMER_NAME
				? [
						{
							key: 'customerName',
							value: customerName,
							isPublic: false
						}
					]
				: [])
		]

		return {
			organizationId: refs.organizationId,
			terminalGroupId: refs.terminalGroupId,
			createOrderSettings: {
				servicePrint: false,
				transportToFrontTimeout: DEFAULT_TRANSPORT_TO_FRONT_TIMEOUT_SECONDS,
				checkStopList: true
			},
			order: {
				id: order.id,
				externalNumber: buildExternalNumber(order.id),
				tableIds: [refs.hallOrder.tableId],
				...(phone ? { phone } : {}),
				...(refs.hallOrder.guestsCount
					? { guests: { count: refs.hallOrder.guestsCount } }
					: {}),
				...(refs.externalMenuId ? { menuId: refs.externalMenuId } : {}),
				...(refs.priceCategoryId ? { priceCategoryId: refs.priceCategoryId } : {}),
				items: payloadItems,
				...(refs.orderExportSourceKey
					? { sourceKey: refs.orderExportSourceKey }
					: {}),
				externalData
			}
		}
	}

	private async buildPayloadItems(
		order: OrderForExportRecord,
		integrationId: string
	): Promise<IikoCreateDeliveryOrderItem[]> {
		if (order.status !== OrderStatus.COMPLETED) {
			throw new NonRetryableIikoOrderExportError(
				`Only completed orders can be exported, got ${order.status}`
			)
		}

		const items = normalizeOrderProducts(order.products)
		if (!items.length) {
			throw new NonRetryableIikoOrderExportError(
				`Order ${order.id} has no product lines`
			)
		}

		const payloadItems: IikoCreateDeliveryOrderItem[] = []
		for (const item of items) {
			const ref = await this.resolveIikoItemRef(integrationId, item)
			const amount = normalizeAmount(item.quantity)
			const price = normalizeMoney(item.unitPrice)
			payloadItems.push({
				type: 'Product' as const,
				productId: ref.productId,
				...(ref.sizeId ? { productSizeId: ref.sizeId } : {}),
				amount,
				price
			})
		}

		return payloadItems
	}

	private async resolveIikoItemRef(
		integrationId: string,
		item: {
			productId: string | null
			variantId: string | null
			externalProducts: OrderExternalLinkSnapshot[]
			externalVariants: OrderExternalLinkSnapshot[]
		}
	): Promise<IikoOrderItemRef> {
		if (item.variantId) {
			const snapshotRef = this.resolveSnapshotLinkRef(
				integrationId,
				item.externalVariants
			)
			if (snapshotRef) return snapshotRef

			const variantLink = await this.repo.findVariantLinkByVariantId(
				integrationId,
				item.variantId
			)
			const linkRef = variantLink ? this.resolveLinkRef(variantLink) : null
			if (linkRef) return linkRef
		}

		if (item.productId) {
			const snapshotRef = this.resolveSnapshotLinkRef(
				integrationId,
				item.externalProducts
			)
			if (snapshotRef) return snapshotRef

			const productLink = await this.repo.findProductLinkByProductId(
				integrationId,
				item.productId
			)
			const linkRef = productLink ? this.resolveLinkRef(productLink) : null
			if (linkRef) return linkRef
		}

		throw new NonRetryableIikoOrderExportError(
			`No iiko mapping for product=${item.productId ?? 'null'}, variant=${item.variantId ?? 'null'}`
		)
	}

	private resolveSnapshotLinkRef(
		integrationId: string,
		links: OrderExternalLinkSnapshot[]
	): IikoOrderItemRef | null {
		for (const link of links) {
			if (link.integrationId !== integrationId) continue
			if (link.provider && link.provider !== IntegrationProvider.IIKO) continue

			const ref = parseIikoExternalId(link.externalId)
			if (ref) return ref
		}

		return null
	}

	private resolveLinkRef(
		link: IntegrationProductLinkRecord | IntegrationVariantLinkRecord
	): IikoOrderItemRef | null {
		const rawMeta = isRecord(link.rawMeta) ? link.rawMeta : null
		const rawProductId = readString(rawMeta?.productId)
		const rawSizeId = normalizeIikoSizeId(readString(rawMeta?.sizeId))
		if (rawProductId) {
			return {
				productId: rawProductId,
				sizeId: rawSizeId
			}
		}

		return parseIikoExternalId(link.externalId)
	}

	private resolveApiBaseUrl(): string {
		const config = this.configService.get('integration', { infer: true })
		return config?.iikoApiBaseUrl ?? 'https://api-ru.iiko.services'
	}

	private async waitForCommandCompletion(
		client: IikoClient,
		params: {
			organizationId: string
			correlationId: string
		}
	): Promise<IikoCommandStatusResponse> {
		const maxAttempts = this.resolveCommandStatusMaxAttempts()
		const pollIntervalMs = this.resolveCommandStatusPollIntervalMs()
		let lastStatus: IikoCommandStatusResponse | null = null

		for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
			lastStatus = await client.getCommandStatus(params)
			if (lastStatus.state === 'Success' || lastStatus.state === 'Error') {
				return lastStatus
			}
			if (attempt < maxAttempts) {
				await sleep(pollIntervalMs)
			}
		}

		throw new NonRetryableIikoOrderExportError(
			`iiko command ${params.correlationId} did not finish after ${maxAttempts} status check(s): ${renderSafeProviderErrorMessage(
				JSON.stringify(lastStatus ?? { state: 'Unknown' })
			)}`
		)
	}

	private resolveCommandStatusMaxAttempts(): number {
		const value = this.resolveIntegrationNumberConfig(
			'iikoCommandStatusMaxAttempts'
		)
		return value && value > 0
			? Math.floor(value)
			: DEFAULT_COMMAND_STATUS_MAX_ATTEMPTS
	}

	private resolveCommandStatusPollIntervalMs(): number {
		const value = this.resolveIntegrationNumberConfig(
			'iikoCommandStatusPollIntervalMs'
		)
		return value !== null && value >= 0
			? Math.floor(value)
			: DEFAULT_COMMAND_STATUS_POLL_INTERVAL_MS
	}

	private resolveIntegrationNumberConfig(key: string): number | null {
		const config: Record<string, unknown> | undefined = this.configService.get(
			'integration',
			{ infer: true }
		)
		const value = config?.[key]
		return typeof value === 'number' && Number.isFinite(value) ? value : null
	}

	private async resolveAddressSettings(
		client: IikoClient,
		organizationId: string
	): Promise<IikoAddressSettings> {
		try {
			const response = await client.getOrganizationSettings({
				organizationIds: [organizationId],
				parameters: ['AddressFormatType', 'RestaurantAddress']
			})
			const settings = response.organizations.find(
				item => item.id === organizationId
			)
			return {
				addressFormatType: settings?.addressFormatType ?? null,
				restaurantAddress: normalizeText(settings?.restaurantAddress)
			}
		} catch (error) {
			this.logger.warn(
				`Could not read iiko organization address format, using city address fallback: ${renderSafeProviderErrorMessage(
					error instanceof Error ? error.message : String(error)
				)}`
			)
			return {
				addressFormatType: null,
				restaurantAddress: null
			}
		}
	}
}

function resolveOrderServiceType(
	order: OrderForExportRecord
): IikoDeliveryOrderServiceType {
	return order.checkoutMethod === CartCheckoutMethod.DELIVERY || order.isDelivery
		? 'DeliveryByCourier'
		: 'DeliveryByClient'
}

function sleep(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve()
	return new Promise(resolve => setTimeout(resolve, ms))
}

function resolveHallOrderInfo(
	order: OrderForExportRecord
): IikoHallOrderInfo | null {
	const data = isRecord(order.checkoutData) ? order.checkoutData : {}
	const mode = normalizeText(data.orderMode ?? data.catalogMode)
	const tableId = normalizeText(
		data.iikoTableId ?? data.hallTableId ?? data.tableId
	)
	if (mode !== 'HALL' && !tableId) return null
	if (!tableId) {
		throw new NonRetryableIikoOrderExportError(
			`Order ${order.id} is a hall order but has no iiko table id`
		)
	}

	return {
		tableId,
		tableNumber: normalizeText(
			data.hallTableNumber ?? data.tableNumber ?? data.table
		),
		tableName: normalizeText(data.hallTableName ?? data.tableName),
		sectionId: normalizeText(data.iikoRestaurantSectionId ?? data.hallSectionId),
		sectionName: normalizeText(
			data.iikoRestaurantSectionName ?? data.hallSectionName
		),
		guestsCount:
			normalizePositiveInt(data.guestsCount ?? data.personsCount) ?? null
	}
}

function buildExternalNumber(orderId: string): string {
	return `${EXPORTED_ORDER_EXTERNAL_NUMBER_PREFIX}-${orderId}`.slice(0, 50)
}

function buildOrderComment(order: OrderForExportRecord): string | null {
	const parts = [`Catalog order ${order.id}`]
	const comment = normalizeText(order.comment)
	const address = resolveOrderAddress(order)
	if (comment) parts.push(comment)
	if (address) parts.push(`Address: ${address}`)
	return parts.join('\n').slice(0, 1000)
}

function buildDeliveryPoint(
	order: OrderForExportRecord,
	addressSettings: IikoAddressSettings
): IikoDeliveryPoint {
	const data = isRecord(order.checkoutData) ? order.checkoutData : {}
	const address = resolveOrderAddress(order)
	const coordinates = resolveDeliveryCoordinates(data)
	const externalCartographyId = normalizeText(data.externalCartographyId)
	const deliveryAddress = buildDeliveryAddress(data, address, addressSettings)

	if (!coordinates && !externalCartographyId && !deliveryAddress) {
		throw new NonRetryableIikoOrderExportError(
			`Order ${order.id} has no deliveryPoint address, coordinates or externalCartographyId for iiko courier export`
		)
	}

	return {
		...(coordinates ? { coordinates } : {}),
		...(deliveryAddress ? { address: deliveryAddress } : {}),
		...(externalCartographyId ? { externalCartographyId } : {}),
		...(address ? { comment: address.slice(0, 500) } : {})
	}
}

function buildDeliveryAddress(
	data: Record<string, unknown>,
	address: string | null,
	addressSettings: IikoAddressSettings
): IikoDeliveryPoint['address'] | null {
	if (!address) return null

	if (addressSettings.addressFormatType === 'Legacy') {
		return buildLegacyDeliveryAddress(data, address, addressSettings)
	}

	return {
		type: 'city',
		line1: readLimitedText(data.line1, 250) ?? address.slice(0, 250),
		...readCommonDeliveryAddressFields(data)
	}
}

function buildLegacyDeliveryAddress(
	data: Record<string, unknown>,
	address: string,
	addressSettings: IikoAddressSettings
): IikoDeliveryPoint['address'] {
	const parsed = parseLegacyAddress(address)
	const restaurantAddress = addressSettings.restaurantAddress
		? parseLegacyAddress(addressSettings.restaurantAddress)
		: null
	const streetId = normalizeText(data.streetId)
	const classifierId = normalizeText(data.streetClassifierId)
	const streetName = normalizeText(data.street) ?? parsed.street
	const city =
		normalizeText(data.city) ?? parsed.city ?? restaurantAddress?.city ?? null
	const house = normalizeText(data.house) ?? parsed.house

	if (!streetId && !classifierId && !streetName) {
		throw new NonRetryableIikoOrderExportError(
			'iiko legacy delivery address requires streetId, streetClassifierId, or street name'
		)
	}
	if (!house) {
		throw new NonRetryableIikoOrderExportError(
			'iiko legacy delivery address requires house'
		)
	}

	return {
		type: 'legacy',
		street: {
			...(streetId ? { id: streetId } : {}),
			...(classifierId ? { classifierId } : {}),
			...(streetName ? { name: streetName.slice(0, 60) } : {}),
			...(city ? { city: city.slice(0, 60) } : {})
		},
		house,
		...(readLimitedText(data.index, 10)
			? { index: readLimitedText(data.index, 10) }
			: {}),
		...(readLimitedText(data.building, 10)
			? { building: readLimitedText(data.building, 10) }
			: {}),
		...readCommonDeliveryAddressFields(data)
	}
}

function readCommonDeliveryAddressFields(
	data: Record<string, unknown>
): Pick<
	NonNullable<IikoDeliveryPoint['address']>,
	'flat' | 'entrance' | 'floor' | 'doorphone' | 'regionId'
> {
	return {
		...(readLimitedText(data.flat ?? data.apartment, 100)
			? { flat: readLimitedText(data.flat ?? data.apartment, 100) }
			: {}),
		...(readLimitedText(data.entrance, 10)
			? { entrance: readLimitedText(data.entrance, 10) }
			: {}),
		...(readLimitedText(data.floor, 10)
			? { floor: readLimitedText(data.floor, 10) }
			: {}),
		...(readLimitedText(data.doorphone ?? data.intercom, 10)
			? { doorphone: readLimitedText(data.doorphone ?? data.intercom, 10) }
			: {}),
		...(normalizeText(data.regionId)
			? { regionId: normalizeText(data.regionId) }
			: {})
	}
}

function parseLegacyAddress(address: string): {
	city: string | null
	street: string | null
	house: string | null
} {
	const parts = address
		.split(',')
		.map(part => normalizeText(part))
		.filter((part): part is string => Boolean(part))

	if (parts.length >= 3) {
		if (parts.length >= 4) {
			return {
				city: parts[parts.length - 3] ?? null,
				street: parts[parts.length - 2] ?? null,
				house: parts.slice(parts.length - 1).join(', ')
			}
		}
		return {
			city: parts[0],
			street: parts[1],
			house: parts.slice(2).join(', ')
		}
	}
	if (parts.length === 2) {
		return {
			city: null,
			street: parts[0],
			house: parts[1]
		}
	}

	const match = address.match(/^(.+?)\s+((?:д\.?\s*)?\d[\p{L}\d/-]*)$/iu)
	if (match) {
		return {
			city: null,
			street: normalizeText(match[1]),
			house: normalizeText(match[2])
		}
	}

	return {
		city: null,
		street: normalizeText(address),
		house: null
	}
}

function resolveDeliveryCoordinates(
	data: Record<string, unknown>
): IikoDeliveryPoint['coordinates'] | null {
	const coordinates = isRecord(data.coordinates) ? data.coordinates : data
	const latitude = normalizeCoordinate(coordinates.latitude ?? coordinates.lat)
	const longitude = normalizeCoordinate(coordinates.longitude ?? coordinates.lng)
	if (latitude === null || longitude === null) return null

	return { latitude, longitude }
}

function resolveOrderAddress(order: OrderForExportRecord): string | null {
	const data = isRecord(order.checkoutData) ? order.checkoutData : {}
	return (
		normalizeText(order.address) ??
		normalizeText(data.address) ??
		normalizeText(data.line1)
	)
}

function resolveOrderPhone(order: OrderForExportRecord): string | null {
	const contacts = isRecord(order.checkoutContacts) ? order.checkoutContacts : {}
	const candidates = [
		isRecord(order.checkoutData) ? order.checkoutData.phone : null,
		contacts.PHONE,
		contacts.SMS,
		contacts.WHATSAPP
	]

	for (const candidate of candidates) {
		const phone = normalizePhone(candidate)
		if (phone) return phone
	}

	return null
}

function resolveCustomerName(order: OrderForExportRecord): string {
	const data = isRecord(order.checkoutData) ? order.checkoutData : {}
	const contacts = isRecord(order.checkoutContacts) ? order.checkoutContacts : {}
	return (
		normalizeText(data.customerName) ??
		normalizeText(data.name) ??
		normalizeText(contacts.NAME) ??
		DEFAULT_CUSTOMER_NAME
	).slice(0, 60)
}

function normalizePhone(value: unknown): string | null {
	const raw = readString(value)
	if (!raw) return null

	const compact = raw.replace(/[^\d+]/g, '')
	if (/^\+\d{8,40}$/.test(compact)) return compact

	const digits = raw.replace(/\D/g, '')
	if (digits.length < 8 || digits.length > 40) return null
	if (digits.length === 11 && digits.startsWith('8')) {
		return `+7${digits.slice(1)}`
	}
	return `+${digits}`
}

function normalizeAmount(value: number): number {
	const normalized = Number(value)
	if (!Number.isFinite(normalized) || normalized <= 0) return 1
	return Math.min(999.999, Number(normalized.toFixed(3)))
}

function normalizeMoney(value: number): number {
	const normalized = Number(value)
	if (!Number.isFinite(normalized) || normalized < 0) return 0
	return Number(normalized.toFixed(2))
}

function parseIikoExternalId(value: unknown): IikoOrderItemRef | null {
	const externalId = readString(value)
	if (!externalId) return null

	const [productId, rawSizeId] = externalId.split(':')
	if (!productId) return null

	return {
		productId,
		sizeId: normalizeIikoSizeId(rawSizeId)
	}
}

function normalizeIikoSizeId(value: string | null | undefined): string | null {
	const normalized = readString(value)
	if (!normalized || normalized === DEFAULT_SIZE_EXTERNAL_ID) return null
	return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized || null
}

function normalizeText(value: unknown): string | null {
	return readString(value)?.replace(/\s+/g, ' ') ?? null
}

function readLimitedText(value: unknown, maxLength: number): string | null {
	return normalizeText(value)?.slice(0, maxLength) ?? null
}

function normalizeCoordinate(value: unknown): number | null {
	const number =
		typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number(value.trim().replace(',', '.'))
				: Number.NaN
	if (!Number.isFinite(number)) return null
	return number
}

function normalizePositiveInt(value: unknown): number | null {
	const number =
		typeof value === 'number'
			? value
			: typeof value === 'string'
				? Number(value.trim())
				: Number.NaN
	if (!Number.isInteger(number) || number < 1) return null
	return Math.min(number, 999)
}

function toPrismaInputJson(value: unknown): Prisma.InputJsonValue {
	return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue
}

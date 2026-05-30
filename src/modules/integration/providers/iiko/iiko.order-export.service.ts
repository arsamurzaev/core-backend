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

import { INTEGRATION_EXTERNAL_ITEM_TYPE_TABLE } from '../../integration-external-items'
import {
	type IntegrationExternalItemRecord,
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
	IikoCreateReservePayload,
	IikoCreateReserveResponse,
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
const DEFAULT_PREORDER_RESERVE_DURATION_MINUTES = 120

type ExportIikoOrderResult = {
	externalId: string
	correlationId: string
	created: boolean
	response: (IikoCreateDeliveryOrderResponse | IikoCreateReserveResponse) & {
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
		let hallOrder = resolveHallOrderInfo(order)
		const preorderStartTime =
			order.checkoutMethod === CartCheckoutMethod.PREORDER
				? resolveIikoCompleteBefore(order)
				: null
		const isReserveOrder = order.checkoutMethod === CartCheckoutMethod.PREORDER
		if (isReserveOrder && !preorderStartTime) {
			throw new NonRetryableIikoOrderExportError(
				`iiko preorder export requires visitDate and visitTime for order ${order.id}`
			)
		}
		if (isReserveOrder && !hallOrder?.tableId) {
			hallOrder = await this.resolvePreorderTableFromNumber(order, integration.id)
		}
		if (isReserveOrder && !hallOrder?.tableId) {
			throw new NonRetryableIikoOrderExportError(
				`iiko preorder export requires a table number for order ${order.id}; choose an iiko table before export`
			)
		}

		const payload = isReserveOrder
			? await this.buildBanquetPayload(order, integration.id, {
					organizationId: metadata.organizationId,
					terminalGroupId: metadata.terminalGroupId,
					externalMenuId: metadata.externalMenuId,
					orderExportSourceKey: metadata.orderExportSourceKey,
					hallOrder: hallOrder as IikoHallOrderInfo,
					estimatedStartTime: preorderStartTime as string
				})
			: hallOrder
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

		const response = isReserveOrder
			? await client.createReserve(payload as IikoCreateReservePayload)
			: hallOrder
				? await client.createTableOrder(payload as IikoCreateTableOrderPayload)
				: await client.createDeliveryOrder(
						payload as IikoCreateDeliveryOrderPayload
					)
		const creationInfo = resolveIikoCreationInfo(response)
		const creationStatus = creationInfo?.creationStatus
		if (creationStatus === 'Error') {
			throw new NonRetryableIikoOrderExportError(
				`iiko rejected order ${order.id}: ${renderSafeProviderErrorMessage(
					JSON.stringify({
						correlationId: response.correlationId,
						errorInfo: creationInfo.errorInfo ?? null,
						orderInfo: creationInfo
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
			externalId: creationInfo?.id ?? response.correlationId,
			correlationId: response.correlationId,
			created: true,
			response: {
				...response,
				commandStatus
			}
		}
	}

	private async buildBanquetPayload(
		order: OrderForExportRecord,
		integrationId: string,
		refs: {
			organizationId: string
			terminalGroupId: string
			externalMenuId: string | null
			orderExportSourceKey: string | null
			hallOrder: IikoHallOrderInfo
			estimatedStartTime: string
		}
	): Promise<IikoCreateReservePayload> {
		const phone = resolveOrderPhone(order)
		if (!phone) {
			throw new NonRetryableIikoOrderExportError(
				`Order ${order.id} has no valid phone for iiko preorder reserve export`
			)
		}

		const payloadItems = await this.buildPayloadItems(order, integrationId)
		const guestsCount = refs.hallOrder.guestsCount ?? 1

		return {
			organizationId: refs.organizationId,
			terminalGroupId: refs.terminalGroupId,
			id: order.id,
			externalNumber: buildExternalNumber(order.id),
			customer: {
				type: 'regular',
				name: resolveCustomerName(order)
			},
			phone,
			comment: buildOrderComment(order),
			durationInMinutes: resolvePreorderDurationMinutes(order),
			shouldRemind: resolvePreorderShouldRemind(order),
			tableIds: [refs.hallOrder.tableId],
			estimatedStartTime: refs.estimatedStartTime,
			guests: { count: guestsCount },
			eventType: 'Banquet',
			createReserveSettings: {
				transportToFrontTimeout: DEFAULT_TRANSPORT_TO_FRONT_TIMEOUT_SECONDS,
				checkStopList: true
			},
			order: {
				...(refs.externalMenuId ? { menuId: refs.externalMenuId } : {}),
				items: payloadItems,
				...(refs.orderExportSourceKey
					? { sourceKey: refs.orderExportSourceKey }
					: {}),
				externalData: [
					{
						key: 'catalogOrderId',
						value: order.id,
						isPublic: false
					},
					{
						key: 'catalogMode',
						value: 'PREORDER',
						isPublic: false
					},
					{
						key: 'iikoTableId',
						value: refs.hallOrder.tableId,
						isPublic: false
					}
				]
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
		const completeBefore = resolveIikoCompleteBefore(order)

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
				...(completeBefore ? { completeBefore } : {}),
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
				price,
				...(item.guestName ? { comment: `Guest: ${item.guestName}` } : {})
			})
		}

		return payloadItems
	}

	private async resolvePreorderTableFromNumber(
		order: OrderForExportRecord,
		integrationId: string
	): Promise<IikoHallOrderInfo | null> {
		const data = isRecord(order.checkoutData) ? order.checkoutData : {}
		const tableRef = resolvePreorderTableRef(data)
		if (!tableRef) return null

		const tables = await this.repo.findExternalItemsByType({
			integrationId,
			provider: IntegrationProvider.IIKO,
			type: INTEGRATION_EXTERNAL_ITEM_TYPE_TABLE
		})
		const matches = tables.filter(table =>
			integrationTableMatchesRef(table, tableRef)
		)

		if (matches.length === 0) {
			throw new NonRetryableIikoOrderExportError(
				`iiko preorder table "${tableRef}" was not found for order ${order.id}; sync iiko tables and check the table number`
			)
		}
		if (matches.length > 1) {
			throw new NonRetryableIikoOrderExportError(
				`iiko preorder table "${tableRef}" is ambiguous for order ${order.id}; specify a unique table number or section`
			)
		}

		return {
			...mapIntegrationTableToHallOrder(matches[0]),
			guestsCount:
				normalizePositiveInt(data.guestsCount ?? data.personsCount) ?? null
		}
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

function resolveIikoCompleteBefore(order: OrderForExportRecord): string | null {
	const data = isRecord(order.checkoutData) ? order.checkoutData : {}
	const explicit = normalizeIikoDateTime(
		data.completeBefore ??
			data.scheduledAt ??
			data.preorderAt ??
			data.visitAt ??
			data.plannedAt
	)
	if (explicit) return explicit
	if (order.checkoutMethod !== CartCheckoutMethod.PREORDER) return null

	const visitTime = normalizeVisitTime(
		data.visitTime ?? data.time ?? data.preorderTime
	)
	if (!visitTime) return null

	const visitDate = normalizeVisitDate(
		data.visitDate ?? data.date ?? data.preorderDate
	)
	if (visitDate) {
		return `${visitDate} ${visitTime}`
	}

	return buildNextIikoDateTime(order.createdAt, visitTime)
}

function resolvePreorderDurationMinutes(order: OrderForExportRecord): number {
	const data = isRecord(order.checkoutData) ? order.checkoutData : {}
	return (
		normalizePositiveInt(
			data.durationInMinutes ??
				data.reserveDurationInMinutes ??
				data.preorderDurationInMinutes
		) ?? DEFAULT_PREORDER_RESERVE_DURATION_MINUTES
	)
}

function resolvePreorderShouldRemind(order: OrderForExportRecord): boolean {
	const data = isRecord(order.checkoutData) ? order.checkoutData : {}
	return readBoolean(data.shouldRemind ?? data.reserveShouldRemind) ?? true
}

function resolveIikoCreationInfo(
	response: IikoCreateDeliveryOrderResponse | IikoCreateReserveResponse
): {
	id: string
	creationStatus: string
	errorInfo?: unknown
} | null {
	if ('reserveInfo' in response) {
		return response.reserveInfo
	}
	return response.orderInfo ?? null
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

function resolvePreorderTableRef(data: Record<string, unknown>): string | null {
	return normalizeTextOrNumber(
		data.iikoTableNumber ??
			data.hallTableNumber ??
			data.tableNumber ??
			data.table ??
			data.hallTableName ??
			data.tableName
	)
}

function integrationTableMatchesRef(
	table: IntegrationExternalItemRecord,
	tableRef: string
): boolean {
	const expected = normalizeComparableText(tableRef)
	if (!expected) return false

	return collectIntegrationTableRefs(table).some(
		value => normalizeComparableText(value) === expected
	)
}

function collectIntegrationTableRefs(
	table: IntegrationExternalItemRecord
): string[] {
	const rawMeta = isRecord(table.rawMeta) ? table.rawMeta : {}
	return [
		table.code,
		table.name,
		rawMeta.iikoTableNumber,
		rawMeta.displayTableNumber,
		rawMeta.tableNumber,
		rawMeta.tableName,
		rawMeta.name
	]
		.map(value => normalizeTextOrNumber(value))
		.filter((value): value is string => Boolean(value))
}

function mapIntegrationTableToHallOrder(
	table: IntegrationExternalItemRecord
): IikoHallOrderInfo {
	const rawMeta = isRecord(table.rawMeta) ? table.rawMeta : {}
	return {
		tableId: table.externalId,
		tableNumber:
			normalizeTextOrNumber(rawMeta.iikoTableNumber) ??
			normalizeTextOrNumber(rawMeta.displayTableNumber) ??
			normalizeTextOrNumber(rawMeta.tableNumber) ??
			normalizeText(table.code),
		tableName:
			normalizeText(rawMeta.tableName) ??
			normalizeText(rawMeta.name) ??
			normalizeText(table.name),
		sectionId:
			normalizeText(rawMeta.restaurantSectionId) ??
			normalizeText(table.externalParentId),
		sectionName: normalizeText(rawMeta.restaurantSectionName),
		guestsCount: null
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

function normalizeIikoDateTime(value: unknown): string | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : formatIikoDateTime(value)
	}

	const raw = readString(value)
	if (!raw) return null

	const iikoMatch = raw.match(
		/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,7}))?)?$/
	)
	if (iikoMatch) {
		const date = normalizeVisitDate(iikoMatch[1])
		const time = normalizeVisitTime(
			`${iikoMatch[2]}:${iikoMatch[3]}:${iikoMatch[4] ?? '00'}`
		)
		return date && time ? `${date} ${time}` : null
	}

	const parsed = new Date(raw)
	if (Number.isNaN(parsed.getTime())) return null
	return formatIikoDateTime(parsed)
}

function normalizeVisitDate(value: unknown): string | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : formatIikoDate(value)
	}

	const raw = readString(value)
	if (!raw) return null

	const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (iso) {
		return normalizeDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]))
	}

	const ru = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
	if (ru) {
		return normalizeDateParts(Number(ru[3]), Number(ru[2]), Number(ru[1]))
	}

	return null
}

function normalizeVisitTime(value: unknown): string | null {
	const raw = readString(value)
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

	return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.000`
}

function normalizeDateParts(
	year: number,
	month: number,
	day: number
): string | null {
	if (
		!Number.isInteger(year) ||
		!Number.isInteger(month) ||
		!Number.isInteger(day) ||
		year < 2000 ||
		year > 2100 ||
		month < 1 ||
		month > 12 ||
		day < 1 ||
		day > 31
	) {
		return null
	}

	const date = new Date(year, month - 1, day)
	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day
	) {
		return null
	}

	return `${year}-${pad2(month)}-${pad2(day)}`
}

function buildNextIikoDateTime(
	createdAt: Date,
	visitTime: string
): string | null {
	const time = visitTime.match(/^(\d{2}):(\d{2}):(\d{2})\.000$/)
	if (!time) return null

	const base =
		createdAt instanceof Date && !Number.isNaN(createdAt.getTime())
			? createdAt
			: new Date()
	const candidate = new Date(
		base.getFullYear(),
		base.getMonth(),
		base.getDate(),
		Number(time[1]),
		Number(time[2]),
		Number(time[3]),
		0
	)
	if (candidate.getTime() <= base.getTime()) {
		candidate.setDate(candidate.getDate() + 1)
	}

	return formatIikoDateTime(candidate)
}

function formatIikoDateTime(value: Date): string {
	return `${formatIikoDate(value)} ${pad2(value.getHours())}:${pad2(
		value.getMinutes()
	)}:${pad2(value.getSeconds())}.${pad3(value.getMilliseconds())}`
}

function formatIikoDate(value: Date): string {
	return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(
		value.getDate()
	)}`
}

function pad2(value: number): string {
	return String(value).padStart(2, '0')
}

function pad3(value: number): string {
	return String(value).padStart(3, '0')
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

function readBoolean(value: unknown): boolean | null {
	if (typeof value === 'boolean') return value
	if (typeof value !== 'string') return null
	const normalized = value.trim().toLowerCase()
	if (normalized === 'true') return true
	if (normalized === 'false') return false
	return null
}

function normalizeTextOrNumber(value: unknown): string | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return String(value)
	}
	return normalizeText(value)
}

function normalizeText(value: unknown): string | null {
	return readString(value)?.replace(/\s+/g, ' ') ?? null
}

function normalizeComparableText(value: unknown): string | null {
	return normalizeTextOrNumber(value)?.toLowerCase() ?? null
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

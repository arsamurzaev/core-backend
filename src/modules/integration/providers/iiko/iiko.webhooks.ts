import { createHash } from 'crypto'

import { BadRequestException } from '@nestjs/common'

import type {
	IikoWebhookEventType,
	IikoWebhookSettingsFilter
} from './iiko.types'

export const IIKO_WEBHOOK_EVENT_TYPES = [
	'DeliveryOrderUpdate',
	'DeliveryOrderError',
	'ReserveUpdate',
	'ReserveError',
	'TableOrderUpdate',
	'TableOrderError',
	'StopListUpdate',
	'PersonalShift',
	'KitchenOrderUpdate',
	'NomenclatureUpdate',
	'BusinessHoursAndMappingUpdate'
] as const satisfies readonly IikoWebhookEventType[]

export type NormalizedIikoWebhookEvent = {
	eventType: string
	eventTime: string | null
	organizationId: string | null
	correlationId: string | null
	eventInfo: Record<string, unknown> | null
	payload: Record<string, unknown>
	requestId: string
}

const DELIVERY_ORDER_STATUSES = [
	'Unconfirmed',
	'WaitCooking',
	'ReadyForCooking',
	'CookingStarted',
	'CookingCompleted',
	'Waiting',
	'OnWay',
	'Delivered',
	'Closed',
	'Cancelled'
]
const TABLE_ORDER_STATUSES = ['New', 'Bill', 'Closed', 'Deleted']
const ORDER_ITEM_STATUSES = [
	'Added',
	'PrintedNotCooking',
	'CookingStarted',
	'CookingCompleted',
	'Served'
]
const RETURNED_EXTERNAL_DATA_KEYS = ['catalogOrderId']

export function buildIikoWebhookSettingsFilter(): IikoWebhookSettingsFilter {
	return {
		deliveryOrderFilter: {
			orderStatuses: DELIVERY_ORDER_STATUSES,
			itemStatuses: ORDER_ITEM_STATUSES,
			errors: true,
			returnedExternalDataKeys: RETURNED_EXTERNAL_DATA_KEYS
		},
		tableOrderFilter: {
			orderStatuses: TABLE_ORDER_STATUSES,
			itemStatuses: ORDER_ITEM_STATUSES,
			errors: true
		},
		reserveFilter: {
			updates: true,
			errors: true
		},
		stopListUpdateFilter: {
			updates: true
		},
		personalShiftFilter: {
			updates: true
		},
		nomenclatureUpdateFilter: {
			updates: true
		},
		businessHoursAndMappingUpdateFilter: {
			updates: true
		}
	}
}

export function normalizeIikoWebhookPayload(
	payload: unknown
): NormalizedIikoWebhookEvent {
	const normalizedPayload = normalizeWebhookPayloadJson(payload)
	if (!isRecord(normalizedPayload)) {
		throw new BadRequestException('iiko webhook payload must be a JSON object')
	}

	const eventType = readString(normalizedPayload.eventType) || 'Unknown'
	const eventTime = readString(normalizedPayload.eventTime)
	const organizationId = readString(normalizedPayload.organizationId)
	const correlationId = readString(normalizedPayload.correlationId)
	const eventInfo = isRecord(normalizedPayload.eventInfo)
		? normalizedPayload.eventInfo
		: null
	const requestId = buildIikoWebhookRequestId({
		eventType,
		eventTime,
		organizationId,
		correlationId,
		eventInfo
	})

	return {
		eventType,
		eventTime,
		organizationId,
		correlationId,
		eventInfo,
		payload: normalizedPayload,
		requestId
	}
}

export function resolveIikoWebhookAction(
	eventType: string
): 'stock-sync' | 'catalog-sync' | 'order-update' | 'noop' {
	switch (eventType) {
		case 'StopListUpdate':
			return 'stock-sync'
		case 'NomenclatureUpdate':
		case 'BusinessHoursAndMappingUpdate':
			return 'catalog-sync'
		case 'DeliveryOrderUpdate':
		case 'DeliveryOrderError':
		case 'TableOrderUpdate':
		case 'TableOrderError':
			return 'order-update'
		default:
			return 'noop'
	}
}

export function resolveIikoWebhookOrderRefs(
	event: NormalizedIikoWebhookEvent
): {
	iikoOrderId: string | null
	localOrderId: string | null
	externalNumber: string | null
	creationStatus: string | null
	errorInfo: unknown
	orderStatus: string | null
} {
	const eventInfo = event.eventInfo
	const order = isRecord(eventInfo?.order) ? eventInfo.order : null
	const externalData = Array.isArray(order?.externalData)
		? order.externalData
		: Array.isArray(eventInfo?.externalData)
			? eventInfo.externalData
			: []
	const externalNumber =
		readString(eventInfo?.externalNumber) ?? readString(order?.externalNumber)
	const catalogOrderId = externalData
		.map(item => {
			if (!isRecord(item)) return null
			return readString(item.key) === 'catalogOrderId'
				? readString(item.value)
				: null
		})
		.find(Boolean)
	const localOrderId =
		catalogOrderId ?? parseCatalogOrderIdFromExternalNumber(externalNumber)

	return {
		iikoOrderId: readString(eventInfo?.id) ?? readString(order?.id),
		localOrderId,
		externalNumber,
		creationStatus: readString(eventInfo?.creationStatus),
		errorInfo: eventInfo?.errorInfo ?? null,
		orderStatus: readString(order?.status)
	}
}

function buildIikoWebhookRequestId(params: {
	eventType: string
	eventTime: string | null
	organizationId: string | null
	correlationId: string | null
	eventInfo: Record<string, unknown> | null
}): string {
	if (params.correlationId) {
		return `iiko:${params.eventType}:${params.correlationId}`.slice(0, 191)
	}

	const hash = createHash('sha256')
		.update(
			JSON.stringify({
				eventType: params.eventType,
				eventTime: params.eventTime,
				organizationId: params.organizationId,
				eventInfo: params.eventInfo
			})
		)
		.digest('hex')

	return `iiko:${params.eventType}:${hash}`.slice(0, 191)
}

function parseCatalogOrderIdFromExternalNumber(
	value: string | null
): string | null {
	if (!value?.startsWith('ctlg-')) return null
	const id = value.slice('ctlg-'.length).trim()
	return id || null
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeWebhookPayloadJson(payload: unknown): unknown {
	const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload
	if (typeof raw !== 'string') return raw

	const trimmed = raw.trim()
	if (!trimmed) {
		throw new BadRequestException('iiko webhook payload must not be empty')
	}

	try {
		return JSON.parse(trimmed)
	} catch {
		throw new BadRequestException('iiko webhook payload must be valid JSON')
	}
}

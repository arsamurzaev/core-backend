import { createHash } from 'crypto'

import { BadRequestException } from '@nestjs/common'

import type {
	IikoDeliveryOrderStatus,
	IikoOrderItemStatus,
	IikoTableOrderStatus,
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
] as const satisfies readonly IikoDeliveryOrderStatus[]
const TABLE_ORDER_STATUSES = [
	'New',
	'Bill',
	'Closed',
	'Deleted'
] as const satisfies readonly IikoTableOrderStatus[]
const ORDER_ITEM_STATUSES = [
	'Added',
	'PrintedNotCooking',
	'CookingStarted',
	'CookingCompleted',
	'Served'
] as const satisfies readonly IikoOrderItemStatus[]
const RETURNED_EXTERNAL_DATA_KEYS = ['catalogOrderId']

export function buildIikoWebhookSettingsFilter(): IikoWebhookSettingsFilter {
	return {
		deliveryOrderFilter: {
			orderStatuses: [...DELIVERY_ORDER_STATUSES],
			itemStatuses: [...ORDER_ITEM_STATUSES],
			errors: true,
			returnedExternalDataKeys: RETURNED_EXTERNAL_DATA_KEYS
		},
		tableOrderFilter: {
			orderStatuses: [...TABLE_ORDER_STATUSES],
			itemStatuses: [...ORDER_ITEM_STATUSES],
			errors: true
		},
		reserveFilter: {
			updates: true,
			errors: true
		},
		stopListUpdateFilter: {
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
	const normalizedPayload = unwrapIikoWebhookPayload(
		normalizeWebhookPayloadJson(payload)
	)
	if (!isRecord(normalizedPayload)) {
		throw new BadRequestException('iiko webhook payload must be a JSON object')
	}

	const eventInfo = resolveIikoWebhookEventInfo(normalizedPayload)
	const eventType =
		readString(normalizedPayload.eventType) ||
		inferIikoWebhookEventType(normalizedPayload, eventInfo) ||
		'Unknown'
	const eventTime = readString(normalizedPayload.eventTime)
	const organizationId = readString(normalizedPayload.organizationId)
	const correlationId = readString(normalizedPayload.correlationId)
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

export function isEmptyIikoWebhookPayload(payload: unknown): boolean {
	if (payload === null || payload === undefined) return true
	if (Buffer.isBuffer(payload)) return payload.toString('utf8').trim() === ''
	return typeof payload === 'string' && payload.trim() === ''
}

export function describeIikoWebhookPayload(payload: unknown): {
	kind: string
	preview: string | null
} {
	if (payload === null) return { kind: 'null', preview: null }
	if (payload === undefined) return { kind: 'undefined', preview: null }
	if (Buffer.isBuffer(payload)) {
		const text = payload.toString('utf8')
		return { kind: 'buffer', preview: trimPreview(text) }
	}
	if (typeof payload === 'string') {
		return { kind: 'string', preview: trimPreview(payload) }
	}
	if (Array.isArray(payload)) {
		return { kind: `array:${payload.length}`, preview: trimPreview(payload) }
	}
	if (isRecord(payload)) {
		return {
			kind: `object:${Object.keys(payload).sort().join(',')}`,
			preview: trimPreview(payload)
		}
	}
	return { kind: typeof payload, preview: trimPreview(payload) }
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

	if (looksLikeFormPayload(trimmed)) {
		return Object.fromEntries(new URLSearchParams(trimmed).entries())
	}

	try {
		return JSON.parse(trimmed)
	} catch {
		throw new BadRequestException('iiko webhook payload must be valid JSON')
	}
}

function unwrapIikoWebhookPayload(payload: unknown): unknown {
	if (Array.isArray(payload)) {
		return (
			payload.find(item => isIikoWebhookEventRecord(item)) ??
			(payload.length === 1 ? unwrapIikoWebhookPayload(payload[0]) : payload)
		)
	}

	if (!isRecord(payload)) return payload
	if (isIikoWebhookEventRecord(payload)) return payload

	for (const key of ['event', 'webhook', 'notification', 'payload', 'data']) {
		const nested = payload[key]
		if (isRecord(nested) || Array.isArray(nested)) {
			const unwrapped = unwrapIikoWebhookPayload(nested)
			if (isIikoWebhookEventRecord(unwrapped)) return unwrapped
		}
	}

	for (const key of ['events', 'webhooks', 'notifications', 'items']) {
		const nested = payload[key]
		if (Array.isArray(nested)) {
			const unwrapped = unwrapIikoWebhookPayload(nested)
			if (isIikoWebhookEventRecord(unwrapped)) return unwrapped
		}
	}

	return payload
}

function isIikoWebhookEventRecord(
	value: unknown
): value is Record<string, unknown> {
	if (!isRecord(value)) return false
	return Boolean(
		readString(value.eventType) ||
			readString(value.eventTime) ||
			readString(value.organizationId) ||
			readString(value.correlationId) ||
			isRecord(value.eventInfo) ||
			isIikoStopListEventInfo(value)
	)
}

function resolveIikoWebhookEventInfo(
	payload: Record<string, unknown>
): Record<string, unknown> | null {
	if (isRecord(payload.eventInfo)) return payload.eventInfo
	if (isIikoStopListEventInfo(payload)) return payload
	return null
}

function inferIikoWebhookEventType(
	payload: Record<string, unknown>,
	eventInfo: Record<string, unknown> | null
): string | null {
	if (isIikoStopListEventInfo(eventInfo) || isIikoStopListEventInfo(payload)) {
		return 'StopListUpdate'
	}
	return null
}

function isIikoStopListEventInfo(value: unknown): boolean {
	return (
		isRecord(value) && Array.isArray(value.terminalGroupsStopListsUpdates)
	)
}

function looksLikeFormPayload(value: string): boolean {
	const firstChar = value[0]
	return firstChar !== '{' && firstChar !== '[' && value.includes('=')
}

function trimPreview(value: unknown): string | null {
	const text =
		typeof value === 'string'
			? value
			: JSON.stringify(value, (_, nestedValue) => {
					if (typeof nestedValue === 'string' && nestedValue.length > 200) {
						return `${nestedValue.slice(0, 200)}...`
					}
					return nestedValue
				})
	if (!text) return null
	const normalized = text.replace(/\s+/g, ' ').trim()
	return normalized.length > 500
		? `${normalized.slice(0, 500)}...`
		: normalized
}

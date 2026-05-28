import {
	buildIikoWebhookSettingsFilter,
	describeIikoWebhookPayload,
	isEmptyIikoWebhookPayload,
	normalizeIikoWebhookPayload,
	resolveIikoWebhookAction,
	resolveIikoWebhookOrderRefs
} from './iiko.webhooks'

describe('iiko webhooks helpers', () => {
	it('builds an all-core-events webhook filter', () => {
		const filter = buildIikoWebhookSettingsFilter()

		expect(filter.stopListUpdateFilter).toEqual({ updates: true })
		expect(filter.nomenclatureUpdateFilter).toEqual({ updates: true })
		expect(filter.businessHoursAndMappingUpdateFilter).toEqual({
			updates: true
		})
		expect(filter.deliveryOrderFilter?.errors).toBe(true)
		expect(filter.deliveryOrderFilter?.orderStatuses).toContain('Unconfirmed')
		expect(filter.deliveryOrderFilter?.orderStatuses).not.toContain('New')
		expect(filter.deliveryOrderFilter?.returnedExternalDataKeys).toContain(
			'catalogOrderId'
		)
		expect(filter.tableOrderFilter?.orderStatuses).toContain('New')
		expect(filter.personalShiftFilter).toBeUndefined()
	})

	it('normalizes request id from event type and correlation id', () => {
		const event = normalizeIikoWebhookPayload({
			eventType: 'StopListUpdate',
			eventTime: '2026-05-21 12:00:00.000',
			organizationId: 'org-1',
			correlationId: 'corr-1',
			eventInfo: {}
		})

		expect(event.requestId).toBe('iiko:StopListUpdate:corr-1')
		expect(resolveIikoWebhookAction(event.eventType)).toBe('stock-sync')
	})

	it('accepts webhook JSON received as text', () => {
		const event = normalizeIikoWebhookPayload(
			JSON.stringify({
				eventType: 'StopListUpdate',
				eventTime: '2026-05-21 12:00:00.000',
				organizationId: 'org-1',
				correlationId: 'corr-1',
				eventInfo: {}
			})
		)

		expect(event.requestId).toBe('iiko:StopListUpdate:corr-1')
		expect(event.organizationId).toBe('org-1')
	})

	it('accepts webhook events wrapped in arrays and containers', () => {
		const event = normalizeIikoWebhookPayload({
			notifications: [
				{
					eventType: 'StopListUpdate',
					eventTime: '2026-05-21 12:00:00.000',
					organizationId: 'org-1',
					correlationId: 'corr-1',
					eventInfo: {}
				}
			]
		})

		expect(event.eventType).toBe('StopListUpdate')
		expect(event.requestId).toBe('iiko:StopListUpdate:corr-1')
	})

	it('accepts url-encoded webhook payloads', () => {
		const event = normalizeIikoWebhookPayload(
			'eventType=StopListUpdate&eventTime=2026-05-21+12%3A00%3A00.000&organizationId=org-1&correlationId=corr-1'
		)

		expect(event.eventType).toBe('StopListUpdate')
		expect(event.organizationId).toBe('org-1')
		expect(event.requestId).toBe('iiko:StopListUpdate:corr-1')
	})

	it('infers stop-list updates from eventInfo-only payloads', () => {
		const event = normalizeIikoWebhookPayload({
			terminalGroupsStopListsUpdates: [
				{
					terminalGroupId: 'terminal-group-1',
					products: []
				}
			]
		})

		expect(event.eventType).toBe('StopListUpdate')
		expect(event.eventInfo).toEqual({
			terminalGroupsStopListsUpdates: [
				{
					terminalGroupId: 'terminal-group-1',
					products: []
				}
			]
		})
		expect(resolveIikoWebhookAction(event.eventType)).toBe('stock-sync')
	})

	it('rejects invalid webhook payload as a bad request', () => {
		expect(() => normalizeIikoWebhookPayload('')).toThrow(
			'iiko webhook payload must not be empty'
		)
		expect(() => normalizeIikoWebhookPayload('not-json')).toThrow(
			'iiko webhook payload must be valid JSON'
		)
		expect(() => normalizeIikoWebhookPayload([])).toThrow(
			'iiko webhook payload must be a JSON object'
		)
	})

	it('detects empty webhook probe payloads', () => {
		expect(isEmptyIikoWebhookPayload(undefined)).toBe(true)
		expect(isEmptyIikoWebhookPayload(null)).toBe(true)
		expect(isEmptyIikoWebhookPayload('   ')).toBe(true)
		expect(isEmptyIikoWebhookPayload(Buffer.from(' '))).toBe(true)
		expect(isEmptyIikoWebhookPayload('{}')).toBe(false)
		expect(isEmptyIikoWebhookPayload({})).toBe(false)
	})

	it('describes webhook payload shape without throwing', () => {
		expect(describeIikoWebhookPayload([{ eventType: 'StopListUpdate' }])).toEqual(
			expect.objectContaining({
				kind: 'array:1',
				preview: expect.stringContaining('StopListUpdate')
			})
		)
	})

	it('routes catalog and order events', () => {
		expect(resolveIikoWebhookAction('NomenclatureUpdate')).toBe('catalog-sync')
		expect(resolveIikoWebhookAction('BusinessHoursAndMappingUpdate')).toBe(
			'catalog-sync'
		)
		expect(resolveIikoWebhookAction('DeliveryOrderError')).toBe('order-update')
		expect(resolveIikoWebhookAction('KitchenOrderUpdate')).toBe('noop')
	})

	it('extracts local order refs from external data', () => {
		const event = normalizeIikoWebhookPayload({
			eventType: 'DeliveryOrderUpdate',
			correlationId: 'corr-1',
			eventInfo: {
				id: 'iiko-order-1',
				externalNumber: 'ctlg-order-1',
				creationStatus: 'Success',
				order: {
					status: 'New',
					externalData: [
						{
							key: 'catalogOrderId',
							value: 'order-from-external-data'
						}
					]
				}
			}
		})

		expect(resolveIikoWebhookOrderRefs(event)).toMatchObject({
			iikoOrderId: 'iiko-order-1',
			localOrderId: 'order-from-external-data',
			creationStatus: 'Success',
			orderStatus: 'New'
		})
	})
})

import {
	buildIikoWebhookSettingsFilter,
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

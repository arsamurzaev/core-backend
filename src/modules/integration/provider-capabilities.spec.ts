import { IntegrationProvider } from '@generated/enums'

import {
	getIntegrationProviderCapabilities,
	INTEGRATION_PROVIDER_CAPABILITIES,
	INTEGRATION_PROVIDER_CAPABILITY_KEYS
} from './provider-capabilities'

describe('integration provider capabilities', () => {
	it('declares the full capability key set for UI feature gating', () => {
		expect(INTEGRATION_PROVIDER_CAPABILITY_KEYS).toEqual([
			'productImport',
			'variantImport',
			'stockImport',
			'imageImport',
			'orderExport',
			'reservation',
			'webhook'
		])
	})

	it('describes MoySklad supported features', () => {
		expect(
			INTEGRATION_PROVIDER_CAPABILITIES[IntegrationProvider.MOYSKLAD]
		).toEqual({
			productImport: true,
			variantImport: true,
			stockImport: true,
			imageImport: true,
			orderExport: true,
			reservation: false,
			webhook: false
		})
	})

	it('returns a copy so callers cannot mutate the source matrix', () => {
		const capabilities = getIntegrationProviderCapabilities(
			IntegrationProvider.MOYSKLAD
		)

		capabilities.productImport = false

		expect(
			getIntegrationProviderCapabilities(IntegrationProvider.MOYSKLAD)
				.productImport
		).toBe(true)
	})
})

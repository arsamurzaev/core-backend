import { IntegrationProvider } from '@generated/enums'

export const INTEGRATION_PROVIDER_CAPABILITY_KEYS = [
	'productImport',
	'variantImport',
	'stockImport',
	'imageImport',
	'orderExport',
	'reservation',
	'webhook'
] as const

export type IntegrationProviderCapabilityKey =
	(typeof INTEGRATION_PROVIDER_CAPABILITY_KEYS)[number]

export type IntegrationProviderCapabilities = Record<
	IntegrationProviderCapabilityKey,
	boolean
>

const EMPTY_CAPABILITIES: IntegrationProviderCapabilities = {
	productImport: false,
	variantImport: false,
	stockImport: false,
	imageImport: false,
	orderExport: false,
	reservation: false,
	webhook: false
}

export const INTEGRATION_PROVIDER_CAPABILITIES: Record<
	IntegrationProvider,
	IntegrationProviderCapabilities
> = {
	[IntegrationProvider.MOYSKLAD]: {
		productImport: true,
		variantImport: true,
		stockImport: true,
		imageImport: true,
		orderExport: true,
		reservation: false,
		webhook: true
	},
	[IntegrationProvider.IIKO]: {
		productImport: true,
		variantImport: true,
		stockImport: true,
		imageImport: true,
		orderExport: true,
		reservation: false,
		webhook: true
	},
	[IntegrationProvider.ONE_C]: {
		productImport: true,
		variantImport: true,
		stockImport: true,
		imageImport: false,
		orderExport: true,
		reservation: false,
		webhook: false
	}
}

export function getIntegrationProviderCapabilities(
	provider: IntegrationProvider
): IntegrationProviderCapabilities {
	return {
		...EMPTY_CAPABILITIES,
		...INTEGRATION_PROVIDER_CAPABILITIES[provider]
	}
}

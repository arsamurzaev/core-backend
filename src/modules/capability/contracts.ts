import type {
	CatalogCapability,
	CatalogCapabilityFlags
} from './capability.constants'
import type { CatalogCapabilitiesDto } from './capability.service'

export const CAPABILITY_READER_PORT = Symbol('CAPABILITY_READER_PORT')
export const CAPABILITY_ASSERT_PORT = Symbol('CAPABILITY_ASSERT_PORT')

export interface CapabilityReaderPort {
	getCurrentFeatures(
		catalogId: string,
		at?: Date
	): Promise<CatalogCapabilityFlags>
	can(
		catalogId: string,
		capability: CatalogCapability,
		at?: Date
	): Promise<boolean>
	getCatalogCapabilities(
		catalogId: string,
		at?: Date
	): Promise<CatalogCapabilitiesDto>
	canUseProductTypes(catalogId: string, at?: Date): Promise<boolean>
	canUseProductVariants(catalogId: string, at?: Date): Promise<boolean>
	canUseCatalogSaleUnits(catalogId: string, at?: Date): Promise<boolean>
	canUseInternalInventory(catalogId: string, at?: Date): Promise<boolean>
	canUseMoySkladIntegration(catalogId: string, at?: Date): Promise<boolean>
	canUseIikoIntegration(catalogId: string, at?: Date): Promise<boolean>
	canUseOneCIntegration(catalogId: string, at?: Date): Promise<boolean>
}

export interface CapabilityAssertPort {
	assertCanUse(
		catalogId: string,
		capability: CatalogCapability,
		message?: string
	): Promise<void>
	assertCanUseProductTypes(catalogId: string): Promise<void>
	assertCanUseProductVariants(catalogId: string): Promise<void>
	assertCanUseCatalogSaleUnits(catalogId: string): Promise<void>
	assertCanUseInternalInventory(catalogId: string): Promise<void>
	assertCanUseMoySkladIntegration(catalogId: string): Promise<void>
	assertCanUseIikoIntegration(catalogId: string): Promise<void>
	assertCanUseOneCIntegration(catalogId: string): Promise<void>
}

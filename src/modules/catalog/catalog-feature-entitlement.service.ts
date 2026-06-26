import { Inject, Injectable } from '@nestjs/common'

import {
	CAPABILITY_ASSERT_PORT,
	CAPABILITY_CATALOG_MODIFIERS,
	CAPABILITY_CATALOG_PRICE_LISTS,
	CAPABILITY_CATALOG_SALE_UNITS,
	CAPABILITY_INTEGRATION_IIKO,
	CAPABILITY_INTEGRATION_MOYSKLAD,
	CAPABILITY_INTEGRATION_ONE_C,
	CAPABILITY_INVENTORY_INTERNAL,
	CAPABILITY_PRODUCT_TYPES,
	CAPABILITY_PRODUCT_VARIANTS,
	CAPABILITY_READER_PORT,
	type CapabilityAssertPort,
	type CapabilityReaderPort,
	CATALOG_CAPABILITIES,
	type CatalogCapability,
	type CatalogCapabilityFlags
} from '@/modules/capability/public'

export const CATALOG_FEATURE_PRODUCT_TYPES = CAPABILITY_PRODUCT_TYPES
export const CATALOG_FEATURE_PRODUCT_VARIANTS = CAPABILITY_PRODUCT_VARIANTS
export const CATALOG_FEATURE_CATALOG_SALE_UNITS = CAPABILITY_CATALOG_SALE_UNITS
export const CATALOG_FEATURE_CATALOG_MODIFIERS = CAPABILITY_CATALOG_MODIFIERS
export const CATALOG_FEATURE_CATALOG_PRICE_LISTS =
	CAPABILITY_CATALOG_PRICE_LISTS
export const CATALOG_FEATURE_INVENTORY_INTERNAL = CAPABILITY_INVENTORY_INTERNAL
export const CATALOG_FEATURE_INTEGRATION_MOYSKLAD =
	CAPABILITY_INTEGRATION_MOYSKLAD
export const CATALOG_FEATURE_INTEGRATION_IIKO = CAPABILITY_INTEGRATION_IIKO
export const CATALOG_FEATURE_INTEGRATION_ONE_C = CAPABILITY_INTEGRATION_ONE_C
export const CATALOG_FEATURES = CATALOG_CAPABILITIES

export type CatalogFeature = CatalogCapability
export type CatalogFeatureFlags = CatalogCapabilityFlags

/**
 * Backward-compatible shim. New code should inject capability ports directly.
 */
@Injectable()
export class CatalogFeatureEntitlementService {
	constructor(
		@Inject(CAPABILITY_READER_PORT)
		private readonly reader: CapabilityReaderPort,
		@Inject(CAPABILITY_ASSERT_PORT)
		private readonly assertions: CapabilityAssertPort
	) {}

	canUse(catalogId: string, feature: string, at?: Date): Promise<boolean> {
		return this.reader.can(catalogId, feature as CatalogFeature, at)
	}

	canUseInternalInventory(catalogId: string, at?: Date): Promise<boolean> {
		return this.reader.canUseInternalInventory(catalogId, at)
	}

	assertCanUseInternalInventory(catalogId: string): Promise<void> {
		return this.assertions.assertCanUseInternalInventory(catalogId)
	}
}

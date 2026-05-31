import { Injectable } from '@nestjs/common'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import {
	CAPABILITY_CATALOG_SALE_UNITS,
	CAPABILITY_INTEGRATION_MOYSKLAD,
	CAPABILITY_INVENTORY_INTERNAL,
	CAPABILITY_PRODUCT_TYPES,
	CAPABILITY_PRODUCT_VARIANTS,
	CapabilityService,
	CATALOG_CAPABILITIES,
	type CatalogCapability,
	type CatalogCapabilityFlags
} from '@/modules/capability/public'

export const CATALOG_FEATURE_PRODUCT_TYPES = CAPABILITY_PRODUCT_TYPES
export const CATALOG_FEATURE_PRODUCT_VARIANTS = CAPABILITY_PRODUCT_VARIANTS
export const CATALOG_FEATURE_CATALOG_SALE_UNITS = CAPABILITY_CATALOG_SALE_UNITS
export const CATALOG_FEATURE_INVENTORY_INTERNAL = CAPABILITY_INVENTORY_INTERNAL
export const CATALOG_FEATURE_INTEGRATION_MOYSKLAD =
	CAPABILITY_INTEGRATION_MOYSKLAD
export const CATALOG_FEATURES = CATALOG_CAPABILITIES

export type CatalogFeature = CatalogCapability
export type CatalogFeatureFlags = CatalogCapabilityFlags

/**
 * Backward-compatible shim. New code should inject capability ports directly.
 */
@Injectable()
export class CatalogFeatureEntitlementService extends CapabilityService {
	constructor(prisma: PrismaService) {
		super(prisma)
	}

	canUse(catalogId: string, feature: string, at?: Date): Promise<boolean> {
		return this.can(catalogId, feature as CatalogFeature, at)
	}
}

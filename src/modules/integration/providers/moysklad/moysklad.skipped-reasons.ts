export const MOYSKLAD_SKIPPED_REASONS = {
	CAPABILITY_DISABLED: 'capability_disabled',
	INTERNAL_INVENTORY: 'internal_inventory',
	MISSING_MAPPING: 'missing_mapping',
	SNAPSHOT_INCOMPLETE: 'snapshot_incomplete',
	PRICE_UNKNOWN: 'price_unknown',
	STOCK_NOT_TRACKED: 'stock_not_tracked',
	STOCK_MISSING_IN_EXTERNAL_REPORT: 'stock_missing_in_external_report',
	STOCK_OWNED_BY_VARIANT_LINKS: 'stock_owned_by_variant_links',
	VARIANTS_CAPABILITY_DISABLED: 'variants_capability_disabled'
} as const

export type MoySkladSkippedReason =
	(typeof MOYSKLAD_SKIPPED_REASONS)[keyof typeof MOYSKLAD_SKIPPED_REASONS]

export type MoySkladExternalStockSkippedReasons = {
	missingStock: number
	productHasVariantLinks: number
	variantsCapabilityDisabled: number
	stockRowWithoutLocalLink: number
	capabilityDisabled: number
	internalInventory: number
	missingMapping: number
	snapshotIncomplete: number
	priceUnknown: number
	stockNotTracked: number
}

const EMPTY_STOCK_SKIPPED_REASONS: MoySkladExternalStockSkippedReasons = {
	missingStock: 0,
	productHasVariantLinks: 0,
	variantsCapabilityDisabled: 0,
	stockRowWithoutLocalLink: 0,
	capabilityDisabled: 0,
	internalInventory: 0,
	missingMapping: 0,
	snapshotIncomplete: 0,
	priceUnknown: 0,
	stockNotTracked: 0
}

export function createMoySkladStockSkippedReasons(
	overrides: Partial<MoySkladExternalStockSkippedReasons> = {}
): MoySkladExternalStockSkippedReasons {
	return {
		...EMPTY_STOCK_SKIPPED_REASONS,
		...overrides
	}
}

export function createMoySkladInternalInventorySkippedReasons(): MoySkladExternalStockSkippedReasons {
	return createMoySkladStockSkippedReasons({
		internalInventory: 1
	})
}

import type { CatalogInventoryMode } from '@generated/enums'

export const CATALOG_INVENTORY_MODE_INTERNAL: CatalogInventoryMode = 'INTERNAL'

export const INVENTORY_WAREHOUSE_STATUS = {
	ACTIVE: 'ACTIVE',
	DISABLED: 'DISABLED'
} as const

export type InventoryWarehouseStatusValue =
	(typeof INVENTORY_WAREHOUSE_STATUS)[keyof typeof INVENTORY_WAREHOUSE_STATUS]

export const INVENTORY_MOVEMENT_TYPE = {
	RECEIPT: 'RECEIPT',
	WRITE_OFF: 'WRITE_OFF',
	ADJUSTMENT: 'ADJUSTMENT',
	SALE: 'SALE',
	RESERVE: 'RESERVE',
	RELEASE: 'RELEASE'
} as const

export type InventoryMovementTypeValue =
	(typeof INVENTORY_MOVEMENT_TYPE)[keyof typeof INVENTORY_MOVEMENT_TYPE]

export const INVENTORY_MOVEMENT_SOURCE = {
	CART: 'CART',
	MANUAL: 'MANUAL',
	ORDER: 'ORDER',
	SYSTEM: 'SYSTEM'
} as const

export const INVENTORY_RESERVATION_STATUS = {
	ACTIVE: 'ACTIVE',
	RELEASED: 'RELEASED',
	CONSUMED: 'CONSUMED',
	EXPIRED: 'EXPIRED',
	CANCELLED: 'CANCELLED'
} as const

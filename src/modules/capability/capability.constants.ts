export const CAPABILITY_PRODUCT_TYPES = 'product.types'
export const CAPABILITY_PRODUCT_VARIANTS = 'product.variants'
export const CAPABILITY_CATALOG_SALE_UNITS = 'catalog.sale_units'
export const CAPABILITY_INVENTORY_INTERNAL = 'inventory.internal'
export const CAPABILITY_INTEGRATION_MOYSKLAD = 'integration.moysklad'
export const CAPABILITY_INTEGRATION_IIKO = 'integration.iiko'
export const CAPABILITY_INTEGRATION_ONE_C = 'integration.one_c'

export const CATALOG_CAPABILITIES = [
	CAPABILITY_PRODUCT_TYPES,
	CAPABILITY_PRODUCT_VARIANTS,
	CAPABILITY_CATALOG_SALE_UNITS,
	CAPABILITY_INVENTORY_INTERNAL,
	CAPABILITY_INTEGRATION_MOYSKLAD,
	CAPABILITY_INTEGRATION_IIKO,
	CAPABILITY_INTEGRATION_ONE_C
] as const

export type CatalogCapability = (typeof CATALOG_CAPABILITIES)[number]

export type CatalogCapabilityFlagMap = Record<CatalogCapability, boolean>

export type CatalogCapabilityDefinition = {
	key: CatalogCapability
	title: string
	description: string
	dependsOn: CatalogCapability[]
}

export const CATALOG_CAPABILITY_DEFINITIONS = [
	{
		key: CAPABILITY_PRODUCT_TYPES,
		title: 'Типы товара',
		description: 'Схемы свойств товара и подготовка вариаций.',
		dependsOn: []
	},
	{
		key: CAPABILITY_PRODUCT_VARIANTS,
		title: 'Вариации',
		description: 'Матрица вариантов товара.',
		dependsOn: [CAPABILITY_PRODUCT_TYPES]
	},
	{
		key: CAPABILITY_CATALOG_SALE_UNITS,
		title: 'Единицы продажи',
		description: 'Форматы продажи внутри каталога.',
		dependsOn: []
	},
	{
		key: CAPABILITY_INVENTORY_INTERNAL,
		title: 'Собственный склад',
		description: 'Внутренние склады, остатки, движения и резервы.',
		dependsOn: []
	},
	{
		key: CAPABILITY_INTEGRATION_MOYSKLAD,
		title: 'МойСклад',
		description: 'Синхронизация каталога, остатков и экспорт заказов.',
		dependsOn: []
	},
	{
		key: CAPABILITY_INTEGRATION_IIKO,
		title: 'iiko',
		description:
			'Импорт меню iikoCloud: категории, товары, варианты и изображения.',
		dependsOn: [CAPABILITY_PRODUCT_TYPES, CAPABILITY_PRODUCT_VARIANTS]
	},
	{
		key: CAPABILITY_INTEGRATION_ONE_C,
		title: '1C',
		description: 'Configurable 1C API, object and field mappings.',
		dependsOn: []
	}
] as const satisfies CatalogCapabilityDefinition[]

export const CATALOG_CAPABILITY_DEFINITION_BY_KEY = new Map(
	CATALOG_CAPABILITY_DEFINITIONS.map(definition => [definition.key, definition])
)

export type CatalogCapabilityFlags = {
	canUseProductTypes: boolean
	canUseProductVariants: boolean
	canUseCatalogSaleUnits: boolean
	canUseInternalInventory: boolean
	canUseMoySkladIntegration: boolean
	canUseIikoIntegration: boolean
	canUseOneCIntegration: boolean
}

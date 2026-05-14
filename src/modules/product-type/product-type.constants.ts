export const ProductTypeScope = {
	SYSTEM_TEMPLATE: 'SYSTEM_TEMPLATE',
	CATALOG: 'CATALOG'
} as const

export type ProductTypeScope =
	(typeof ProductTypeScope)[keyof typeof ProductTypeScope]
